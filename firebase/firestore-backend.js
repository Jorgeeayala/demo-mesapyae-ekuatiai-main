'use strict';
/*
 * Mesa Pya'e — backend sobre Cloud Firestore.
 *
 * El núcleo (core/core.js) es síncrono y trabaja sobre tablas en memoria. Este
 * adaptador le da esas tablas desde Firestore con un diseño pensado para costo
 * y consistencia:
 *
 *  - Cada fila es un documento en la colección `t_<Tabla>` (id = clave) con dos
 *    campos internos: `_rev` (revisión en que se escribió) y `_seq` (orden).
 *  - El documento `meta/pulse` guarda la revisión global, la última revisión por
 *    tabla y una "época" (cambia al archivar).
 *  - Cada instancia de la función mantiene una caché. Para refrescar lee SOLO el
 *    pulso (1 lectura) y, si cambió algo, los documentos con `_rev` mayor a la
 *    revisión que tiene (lecturas = filas cambiadas).
 *  - Las escrituras usan una transacción que vuelve a leer el pulso: si otra
 *    instancia escribió en el medio, se refresca y se recalcula (concurrencia
 *    optimista). Dentro de una instancia, las escrituras se encolan.
 *  - El pulso es lo único que el navegador puede leer (reglas): las pantallas lo
 *    escuchan en tiempo real y piden datos nuevos apenas cambia.
 *  - Los registros cerrados se archivan por día en la colección `archivo`
 *    (documentos por día y tabla, troceados bajo 1 MiB) y los reportes los leen.
 */

const MAX_RETRIES = 12;
const CHUNK_BYTES = 700000;
const STALE = { stale: true };

function createFirestoreBackend(opts) {
  const fs = opts.firestore;
  const MesaCore = opts.MesaCore;
  const env = opts.env;
  const log = opts.log || ((m) => console.error(m));
  const pulseTtlMs = opts.pulseTtlMs === undefined ? 1500 : opts.pulseTtlMs;
  const chunkBytes = opts.chunkBytes || CHUNK_BYTES;
  const TABLES = Object.keys(MesaCore.SCHEMA);
  const KEYS = MesaCore.KEYS;
  const PULSE = fs.doc('meta/pulse');

  const enc = (k) => String(k).replace(/%/g, '%25').replace(/\//g, '%2F');
  let cache = null;          // { epoch, rev, tableRev, tables, checkedAt }
  let version = 0;           // cambia cada vez que se modifica la caché
  let refreshing = null;
  let chain = Promise.resolve();
  let seeded = false;

  // ------------------------------------------------------------ utilidades
  function sortRows(rows) { return rows.sort((a, b) => (a._seq || 0) - (b._seq || 0)); }
  function clean(row) {
    const o = {};
    for (const k of Object.keys(row)) { const v = row[k]; o[k] = v === undefined || v === null ? '' : v; }
    return o;
  }
  function mutex(fn) {
    const run = chain.then(fn, fn);
    chain = run.then(() => {}, () => {});
    return run;
  }
  function emptyPulse() { return { rev: 0, epoch: 0, tables: {} }; }

  // ------------------------------------------------------------ caché
  async function fullLoad(p) {
    const tables = {};
    await Promise.all(TABLES.map(async (t) => {
      const s = await fs.collection('t_' + t).get();
      tables[t] = sortRows(s.docs.map((d) => d.data()));
    }));
    cache = { epoch: p.epoch || 0, rev: p.rev || 0, tableRev: Object.assign({}, p.tables || {}), tables, checkedAt: Date.now() };
    version++;
  }

  async function doRefresh() {
    for (let guard = 0; guard < 5; guard++) {
      const startVersion = version;
      const snap = await PULSE.get();
      const p = snap.exists ? snap.data() : emptyPulse();
      if (!cache || cache.epoch !== (p.epoch || 0) || (p.rev || 0) < cache.rev) { await fullLoad(p); return; }
      if ((p.rev || 0) === cache.rev) { cache.checkedAt = Date.now(); return; }
      const base = cache.rev;
      const changed = Object.keys(p.tables || {}).filter((t) => cache.tables[t] && (p.tables[t] || 0) > (cache.tableRev[t] || 0));
      const results = await Promise.all(changed.map(async (t) => [t, (await fs.collection('t_' + t).where('_rev', '>', base).get()).docs.map((d) => d.data())]));
      if (version !== startVersion) continue; // la caché cambió mientras leíamos: reintentar
      for (const [t, rows] of results) {
        const k = KEYS[t];
        const idx = new Map(cache.tables[t].map((r, i) => [r[k], i]));
        for (const r of rows) { if (idx.has(r[k])) cache.tables[t][idx.get(r[k])] = r; else cache.tables[t].push(r); }
        sortRows(cache.tables[t]);
      }
      cache.rev = p.rev; cache.tableRev = Object.assign({}, p.tables); cache.checkedAt = Date.now();
      version++;
      return;
    }
    await fullLoad((await PULSE.get()).data() || emptyPulse());
  }

  async function refresh(minRev, force) {
    for (let i = 0; i < 3; i++) {
      const fresh = cache && !force && Date.now() - cache.checkedAt < pulseTtlMs && !(Number(minRev) > cache.rev);
      if (fresh) return;
      if (!refreshing) refreshing = doRefresh().finally(() => { refreshing = null; });
      await refreshing;
      force = false;
      if (!(Number(minRev) > cache.rev)) return;
      force = true;
    }
  }

  // ------------------------------------------------------------ store para el núcleo
  function makeStore(extraHistory) {
    let committed = null;
    const store = {
      begin() {
        const work = {}, index = {}, touched = {}, archived = {}, removed = {};
        const tbl = (t) => {
          if (!MesaCore.SCHEMA[t]) throw new Error('Tabla desconocida ' + t);
          if (!work[t]) work[t] = cache.tables[t].map((r) => Object.assign({}, r));
          return work[t];
        };
        const ix = (t) => {
          if (!index[t]) { index[t] = {}; const k = KEYS[t]; for (const r of tbl(t)) index[t][r[k]] = r; }
          return index[t];
        };
        const touch = (t, key) => { (touched[t] = touched[t] || new Set()).add(key); };
        return {
          all: tbl,
          get: (t, key) => ix(t)[key] || null,
          insert(t, row) {
            const k = KEYS[t];
            if (ix(t)[row[k]]) throw new Error('Clave duplicada ' + t + ':' + row[k]);
            const o = {};
            for (const c of MesaCore.SCHEMA[t]) o[c] = row[c] === undefined || row[c] === null ? '' : row[c];
            tbl(t).push(o); ix(t)[o[k]] = o; touch(t, o[k]);
          },
          update(t, key, patch) {
            const r = ix(t)[key];
            if (!r) throw new Error('No existe ' + t + ':' + key);
            for (const c of Object.keys(patch)) if (MesaCore.SCHEMA[t].includes(c)) r[c] = patch[c] === undefined || patch[c] === null ? '' : patch[c];
            touch(t, key);
          },
          archive(t, pred) {
            const keep = [], move = [];
            for (const r of tbl(t)) (pred(r) ? move : keep).push(r);
            work[t] = keep; delete index[t];
            archived[t] = (archived[t] || []).concat(move);
            return move.length;
          },
          // Reinicio de datos: las filas salen de la tabla activa; persistirlas lo hace purge() (con respaldo).
          remove(t, pred) {
            const keep = [], out = [];
            for (const r of tbl(t)) (pred(r) ? out : keep).push(r);
            work[t] = keep; delete index[t];
            removed[t] = (removed[t] || []).concat(out);
            return out.length;
          },
          history: (t) => ((extraHistory && extraHistory[t]) || []).concat(tbl(t)),
          commit() { committed = { work, touched, archived, removed, index }; },
          rollback() {}
        };
      },
      withLock: (fn) => fn()
    };
    return { store, result: () => committed };
  }
  // Cada intento usa una capa sobre la caché de límites (rate limit): solo el intento
  // que termina se aplica, así los reintentos optimistas no consumen cupo de más.
  function overlayEnv() {
    const pend = [];
    const e = Object.assign({}, env, {
      cache: {
        get: (k) => { for (let i = pend.length - 1; i >= 0; i--) if (pend[i][0] === k) return pend[i][1]; return env.cache ? env.cache.get(k) : null; },
        put: (k, v, s) => { pend.push([k, v, s]); }
      }
    });
    e.__apply = () => { if (env.cache) pend.forEach(([k, v, s]) => env.cache.put(k, v, s)); };
    return e;
  }
  function appFor(store, e) { return MesaCore.create(store, e || env); }
  function hasWrites(c) { return c && Object.keys(c.touched).some((t) => c.touched[t].size); }
  function hasRemoved(c) { return c && c.removed && Object.keys(c.removed).length > 0; }
  function hasArchive(c) { return c && Object.keys(c.archived).some((t) => c.archived[t].length); }

  // ------------------------------------------------------------ persistencia
  async function persist(baseRev, c) {
    const newRev = baseRev + 1;
    const ops = [], tables = {};
    let n = 0;
    for (const t of Object.keys(c.touched)) {
      const k = KEYS[t];
      const byKey = new Map(c.work[t].map((r) => [r[k], r]));
      for (const key of c.touched[t]) {
        const row = byKey.get(key);
        if (!row) continue;
        row._rev = newRev;
        if (!row._seq) row._seq = newRev * 10000 + (n++);
        ops.push([t, key, row]);
      }
      tables[t] = newRev;
    }
    if (ops.length > 450) throw new Error('Demasiadas escrituras en una operación: ' + ops.length);
    let wrotePulse = null;
    await fs.runTransaction(async (tx) => {
      const s = await tx.get(PULSE);
      const p = s.exists ? s.data() : emptyPulse();
      if ((p.rev || 0) !== baseRev || (p.epoch || 0) !== cache.epoch) throw STALE;
      for (const [t, key, row] of ops) tx.set(fs.collection('t_' + t).doc(enc(key)), clean(row));
      wrotePulse = { rev: newRev, epoch: p.epoch || 0, tables: Object.assign({}, p.tables || {}, tables), at: new Date(env.now()).toISOString() };
      tx.set(PULSE, wrotePulse);
    });
    for (const t of Object.keys(c.work)) if (c.touched[t]) cache.tables[t] = sortRows(c.work[t]);
    cache.rev = newRev; cache.tableRev = Object.assign({}, wrotePulse.tables); cache.checkedAt = Date.now();
    version++;
  }

  // Ejecuta una función síncrona del núcleo.
  // Lecturas: sobre la caché, sin bloquear. Escrituras: en cola dentro de la instancia;
  // si otra instancia escribió primero (pulso distinto), se refresca y se recalcula.
  const isConflict = (e) => e === STALE || (e && (e.code === 10 || e.code === 'aborted' || e.code === 'ABORTED'));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function execute(runCore, opt) {
    opt = opt || {};
    await refresh(opt.minRev, opt.force);
    const run = () => {
      const S = makeStore(opt.extra), e = overlayEnv(), base = cache.rev;
      const out = runCore(appFor(S.store, e));
      return { out, c: S.result(), e, base };
    };
    let r = run();
    if (hasRemoved(r.c)) {
      // Reinicio de datos: se recalcula con la caché al día y se aplica con respaldo, fuera del camino normal.
      return mutex(async () => {
        await refresh(undefined, true);
        r = run();
        if (hasRemoved(r.c)) await purge(r.c);
        r.e.__apply();
        return r.out;
      });
    }
    if (!hasWrites(r.c)) { r.e.__apply(); return r.out; }
    return mutex(async () => {
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        if (attempt > 0) { await sleep(Math.min(800, 15 * Math.pow(2, attempt)) * (0.5 + Math.random())); await refresh(undefined, true); }
        if (attempt > 0 || cache.rev !== r.base) {
          r = run();
          if (!hasWrites(r.c)) { r.e.__apply(); return r.out; }
        }
        try { await persist(r.base, r.c); r.e.__apply(); return r.out; }
        catch (e) { if (isConflict(e)) continue; throw e; }
      }
      const err = new Error('OCUPADO'); err.busy = true; throw err;
    });
  }

  // ------------------------------------------------------------ semilla
  async function ensureSeeded(seedOpts) {
    if (seeded) return null;
    await refresh(undefined, true);
    const hadAdmin = cache.tables.Usuarios.some((u) => u.rol === 'ADMIN');
    const pin = String(100000 + Math.floor(Math.random() * 900000));
    await execute((app) => app.seed(Object.assign({}, seedOpts, { admin: { usuario_id: 'admin', nombre: 'Encargado (Admin)', pin } })), { force: true });
    seeded = true;
    if (!hadAdmin && cache.tables.Usuarios.some((u) => u.usuario_id === 'admin')) {
      log('Mesa Pya\'e: base inicializada. Usuario "admin", PIN inicial: ' + pin + ' — cambialo en Administración > Usuarios.');
      return pin;
    }
    return null;
  }

  // ------------------------------------------------------------ archivo y reportes
  const DAY = {
    Pedidos: (r) => r.fecha,
    Cuentas: (r) => env.dateKey(Date.parse(r.abierta_en)),
    Cobros: (r) => env.dateKey(Date.parse(r.fecha)),
    Movimientos: (r) => env.dateKey(Date.parse(r.fecha)),
    Turnos: (r) => env.dateKey(Date.parse(r.abierto_en)),
    Auditoria: (r) => env.dateKey(Date.parse(r.fecha))
  };
  function chunks(rows) {
    const out = []; let cur = [], size = 0;
    for (const r of rows) {
      const s = JSON.stringify(r).length + 1;
      if (cur.length && size + s > chunkBytes) { out.push(cur); cur = []; size = 0; }
      cur.push(r); size += s;
    }
    if (cur.length) out.push(cur);
    return out;
  }

  async function archive() {
    return mutex(async () => {
      await refresh(undefined, true);
      const S = makeStore();
      const counts = appFor(S.store).archive();
      const c = S.result();
      if (!hasArchive(c)) return counts;
      const pedFecha = new Map();
      for (const r of (c.archived.Pedidos || [])) pedFecha.set(r.pedido_id, r.fecha);
      for (const r of cache.tables.Pedidos) pedFecha.set(r.pedido_id, r.fecha);
      const dayOf = (t, r) => {
        if (t === 'PedidoItems' || t === 'Historial') return pedFecha.get(r.pedido_id) || env.dateKey(env.now());
        return (DAY[t] ? DAY[t](r) : '') || env.dateKey(env.now());
      };
      const runId = env.uuid().replace(/-/g, '').slice(0, 10);
      const writes = [], deletes = [];
      for (const t of Object.keys(c.archived)) {
        const byDay = {};
        for (const r of c.archived[t]) {
          const o = Object.assign({}, r); delete o._rev; delete o._seq;
          (byDay[dayOf(t, r)] = byDay[dayOf(t, r)] || []).push(o);
          deletes.push(fs.collection('t_' + t).doc(enc(r[KEYS[t]])));
        }
        for (const d of Object.keys(byDay)) chunks(byDay[d]).forEach((rows, i) => {
          writes.push([fs.collection('archivo').doc(d + '_' + t + '_' + runId + '_' + i), { dia: d, tabla: t, filas: rows }]);
        });
      }
      // 1) escribir copias de archivo, 2) borrar de las tablas activas, 3) nueva época
      for (let i = 0; i < writes.length; i += 400) { const b = fs.batch(); writes.slice(i, i + 400).forEach(([ref, data]) => b.set(ref, data)); await b.commit(); }
      for (let i = 0; i < deletes.length; i += 400) { const b = fs.batch(); deletes.slice(i, i + 400).forEach((ref) => b.delete(ref)); await b.commit(); }
      await fs.runTransaction(async (tx) => {
        const s = await tx.get(PULSE); const p = s.exists ? s.data() : emptyPulse();
        tx.set(PULSE, { rev: (p.rev || 0) + 1, epoch: (p.epoch || 0) + 1, tables: {}, at: new Date(env.now()).toISOString() });
      });
      cache = null;
      return counts;
    });
  }

  // Reinicio: 1) copia de respaldo de todo lo que se borra (tablas y archivo de días anteriores) en 'respaldo',
  // 2) borra, 3) guarda lo modificado (mesas, auditoría), 4) nueva época: todas las instancias recargan.
  async function purge(c) {
    const stamp = new Date(env.now()).toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    const tablas = Object.keys(c.removed);
    const writes = [], deletes = [];
    for (const t of tablas) {
      const rows = c.removed[t].map((r) => { const o = Object.assign({}, r); delete o._rev; delete o._seq; return o; });
      chunks(rows).forEach((part, i) => writes.push([fs.collection('respaldo').doc(stamp + '_' + t + '_' + i), { fecha: stamp, motivo: 'reinicio', tabla: t, filas: part }]));
      for (const r of c.removed[t]) deletes.push(fs.collection('t_' + t).doc(enc(r[KEYS[t]])));
    }
    const arch = await fs.collection('archivo').get();
    for (const d of arch.docs) {
      const v = d.data();
      if (tablas.indexOf(v.tabla) < 0) continue;
      writes.push([fs.collection('respaldo').doc(stamp + '_archivo_' + d.id), Object.assign({ fecha: stamp, motivo: 'reinicio', origen: 'archivo' }, v)]);
      deletes.push(d.ref);
    }
    for (let i = 0; i < writes.length; i += 400) { const b = fs.batch(); writes.slice(i, i + 400).forEach(([ref, data]) => b.set(ref, data)); await b.commit(); }
    for (let i = 0; i < deletes.length; i += 400) { const b = fs.batch(); deletes.slice(i, i + 400).forEach((ref) => b.delete(ref)); await b.commit(); }
    const p0 = (await PULSE.get()).data() || emptyPulse();
    const newRev = (p0.rev || 0) + 1;
    const sets = [];
    let n = 0;
    for (const t of Object.keys(c.touched)) {
      if (tablas.indexOf(t) >= 0) continue;
      const k = KEYS[t];
      const byKey = new Map(c.work[t].map((row) => [row[k], row]));
      for (const key of c.touched[t]) {
        const row = byKey.get(key); if (!row) continue;
        row._rev = newRev; if (!row._seq) row._seq = newRev * 10000 + (n++);
        sets.push(fs.collection('t_' + t).doc(enc(key)).set(clean(row)));
      }
    }
    await Promise.all(sets);
    await fs.runTransaction(async (tx) => {
      const s = await tx.get(PULSE); const p = s.exists ? s.data() : emptyPulse();
      tx.set(PULSE, { rev: Math.max(newRev, (p.rev || 0) + 1), epoch: (p.epoch || 0) + 1, tables: {}, at: new Date(env.now()).toISOString() });
    });
    cache = null;
    await refresh(undefined, true);
    log('Mesa Pya\'e: datos reiniciados (respaldo ' + stamp + '): ' + tablas.map((t) => t + ' ' + c.removed[t].length).join(', '));
  }

  async function loadArchive(desde, hasta) {
    const extra = {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta) || desde > hasta) return extra;
    const s = await fs.collection('archivo').where('dia', '>=', desde).where('dia', '<=', hasta).get();
    for (const d of s.docs) { const v = d.data(); (extra[v.tabla] = extra[v.tabla] || []).push(...v.filas); }
    return extra;
  }

  // ------------------------------------------------------------ API pública
  async function handle(req, seedOpts) {
    await ensureSeeded(seedOpts);
    req = req || {};
    let extra;
    if (req.action === 'admin.report') {
      const p = req.payload || {};
      const hoy = env.dateKey(env.now());
      extra = await loadArchive(String(p.desde || hoy), String(p.hasta || p.desde || hoy));
    }
    const out = await execute((app) => app.handle(req), { minRev: req.pulse, extra });
    out.pulse = cache.rev;
    return out;
  }

  async function exportDay(dia) {
    await refresh(undefined, true);
    const extra = await loadArchive(dia, dia);
    const sel = (t, f) => (extra[t] || []).concat(cache.tables[t]).filter(f);
    const inDay = (iso) => iso && env.dateKey(Date.parse(iso)) === dia;
    const pedidos = sel('Pedidos', (r) => r.fecha === dia);
    const ids = new Set(pedidos.map((p) => p.pedido_id));
    const strip = (r) => { const o = Object.assign({}, r); delete o._rev; delete o._seq; return o; };
    return {
      dia,
      pedidos: pedidos.map(strip),
      items: sel('PedidoItems', (r) => ids.has(r.pedido_id)).map(strip),
      cobros: sel('Cobros', (r) => inDay(r.fecha)).map(strip),
      movimientos: sel('Movimientos', (r) => inDay(r.fecha)).map(strip),
      turnos: sel('Turnos', (r) => inDay(r.abierto_en)).map(strip)
    };
  }

  return { handle, archive, exportDay, ensureSeeded, _cache: () => cache, _refresh: refresh };
}

module.exports = { createFirestoreBackend };
