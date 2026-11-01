'use strict';
/* Backend Firebase (Firestore) sobre el simulador: consistencia entre instancias, concurrencia, archivo y costos. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const MesaCore = require('../core/core.js');
const { createNodeEnv } = require('../server/env-node.js');
const { createFirestoreBackend } = require('../firebase/firestore-backend.js');
const { FakeFirestore } = require('./fake-firestore.js');
const catalogo = JSON.parse(fs.readFileSync(path.join(__dirname, '../locales/andrade/catalogo.json'), 'utf8'));

function world(opts) {
  opts = opts || {};
  const db = new FakeFirestore({ latency: opts.latency });
  const logs = [];
  let clock = null;
  const mk = () => {
    const env = createNodeEnv({ secret: 'secreto-compartido', log: () => {} });
    if (clock) env.setClock(() => clock());
    const b = createFirestoreBackend({ firestore: db, MesaCore, env, log: (m) => logs.push(m), pulseTtlMs: opts.ttl === undefined ? 0 : opts.ttl, chunkBytes: opts.chunkBytes });
    return { b, env, call: (action, payload, token, extra) => b.handle(Object.assign({ action, payload: payload || {}, token }, extra || {}), { catalogo, mesas: 20 }) };
  };
  return { db, logs, mk, setClock(fn) { clock = fn; } };
}
const pinOf = (logs) => (logs.join('\n').match(/PIN inicial: (\d+)/) || [])[1];
async function ok(p) { const r = await p; assert.equal(r.ok, true, JSON.stringify(r.error)); return r.data; }
async function bad(p, code) { const r = await p; assert.equal(r.ok, false, 'debía fallar'); if (code) assert.equal(r.error.code, code, JSON.stringify(r.error)); return r; }

async function setupUsers(I, pin) {
  const T = (await ok(I.call('auth.login', { usuario: 'admin', pin }))).token;
  for (const u of [['mozo', 'MOZO', '', '1111'], ['cocina', 'COCINA', '', '2222'], ['cajaa', 'CAJA', 'CAJA_A', '3333'], ['cajab', 'CAJA', 'CAJA_B', '4444']]) {
    await ok(I.call('admin.user', { usuario: { usuario_id: u[0], nombre: u[0], rol: u[1], caja_id: u[2], pin: u[3], activo: true } }, T));
  }
  const tk = { admin: T };
  for (const [u, p] of [['mozo', '1111'], ['cocina', '2222'], ['cajaa', '3333'], ['cajab', '4444']]) tk[u] = (await ok(I.call('auth.login', { usuario: u, pin: p }))).token;
  return tk;
}

test('Firebase: primera ejecución crea la base (catálogo, mesas, cajas, admin) una sola vez', async () => {
  const W = world();
  const A = W.mk();
  const h = await ok(A.call('health'));
  assert.equal(h.ok, true);
  const pin = pinOf(W.logs);
  assert.match(pin, /^\d{6}$/);
  assert.equal(W.db.count('t_Productos/'), 75);
  assert.equal(W.db.count('t_Mesas/'), 20);
  assert.equal(W.db.count('t_Usuarios/'), 1);
  assert.ok(!JSON.stringify([...W.db.docs.values()]).includes(pin), 'el PIN no se guarda en texto plano');
  // Otra instancia no vuelve a sembrar ni crea otro admin
  const B = W.mk();
  await ok(B.call('health'));
  assert.equal(W.db.count('t_Usuarios/'), 1);
  assert.equal(W.logs.filter((l) => /PIN inicial/.test(l)).length, 1);
});

test('Firebase: flujo completo entre dos instancias (pedido, cocina, cobro, cierre, reporte)', async () => {
  const W = world();
  const A = W.mk(), B = W.mk();
  await ok(A.call('health'));
  const tk = await setupUsers(A, pinOf(W.logs));
  // Pedido en A; la instancia B lo ve
  const p = (await ok(A.call('order.create', { request_id: 'fb-req-0001', mesa_id: 'M03', items: [{ producto_id: 'PANINI_URUGUAYO', cantidad: 2, opciones: ['PAN_CIA', 'PU_POL'] }] }, tk.mozo))).pedido;
  assert.equal(p.numero, 'A-001'); assert.equal(p.total_gs, 90000);
  const sB = await ok(B.call('sync', {}, tk.cocina));
  assert.equal(sB.pedidos.length, 1); assert.equal(sB.pedidos[0].items[0].opciones, 'Pan ciabatta · Carne o pollo: Pollo');
  // Reintento del mismo pedido en la otra instancia: no duplica
  assert.equal((await ok(B.call('order.create', { request_id: 'fb-req-0001', mesa_id: 'M03', items: [{ producto_id: 'TE', cantidad: 1 }] }, tk.mozo))).duplicado, true);
  // Numeración correlativa alternando instancias
  const p2 = (await ok(B.call('order.create', { request_id: 'fb-req-0002', mesa_id: 'M04', items: [{ producto_id: 'TE', cantidad: 1 }] }, tk.mozo))).pedido;
  const p3 = (await ok(A.call('order.create', { request_id: 'fb-req-0003', mesa_id: 'M05', items: [{ producto_id: 'TE', cantidad: 1 }] }, tk.mozo))).pedido;
  assert.deepEqual([p2.numero, p3.numero], ['A-002', 'A-003']);
  // Cocina en B, entrega en A
  await ok(B.call('order.state', { pedido_id: p.pedido_id, estado: 'EN_PREPARACION' }, tk.cocina));
  await ok(B.call('order.state', { pedido_id: p.pedido_id, estado: 'LISTO' }, tk.cocina));
  await ok(A.call('order.state', { pedido_id: p.pedido_id, estado: 'ENTREGADO', desde: 'LISTO' }, tk.mozo));
  // Caja: abrir en A, cobrar en B, reintento en A
  await ok(A.call('caja.abrir', { caja_id: 'CAJA_A', monto_inicial_gs: 50000 }, tk.cajaa));
  const c1 = await ok(B.call('caja.cobrar', { request_id: 'fb-cobro-01', cuenta_id: p.cuenta_id, pagos: [{ medio: 'EFECTIVO', monto_gs: 40000 }, { medio: 'TD', monto_gs: 50000 }] }, tk.cajaa));
  assert.equal(c1.cobro.total_gs, 90000);
  assert.equal((await ok(A.call('caja.cobrar', { request_id: 'fb-cobro-01', cuenta_id: p.cuenta_id, pagos: [{ medio: 'EFECTIVO', monto_gs: 90000 }] }, tk.cajaa))).duplicado, true);
  await bad(A.call('caja.cobrar', { request_id: 'fb-cobro-02', cuenta_id: p.cuenta_id, pagos: [{ medio: 'EFECTIVO', monto_gs: 90000 }] }, tk.cajaa), 'YA_COBRADA');
  const cierre = await ok(B.call('caja.cerrar', { caja_id: 'CAJA_A', efectivo_declarado_gs: 90000 }, tk.cajaa));
  assert.equal(cierre.turno.esperado_efectivo_gs, 90000); assert.equal(cierre.turno.diferencia_gs, 0);
  const rep = await ok(A.call('admin.report', {}, tk.admin));
  assert.equal(rep.consolidado_gs, 90000);
  assert.equal(rep.cajas.find((c) => c.caja_id === 'CAJA_A').por_medio.TD, 50000);
  // Seguridad: sin sesión
  await bad(B.call('sync', {}, undefined), 'NO_SESION');
});

test('Firebase: 60 pedidos simultáneos repartidos en 3 instancias, con reintentos duplicados', async () => {
  const W = world({ latency: 4 });
  const I = [W.mk(), W.mk(), W.mk()];
  await ok(I[0].call('health'));
  const toks = [...W.db.docs.entries()].filter(([p]) => p.startsWith('t_Mesas/')).map(([, d]) => d.data).sort((a, b) => a.numero - b.numero).slice(0, 12).map((m) => m.qr_token);
  const jobs = [];
  for (let i = 0; i < 60; i++) {
    const body = { token: toks[i % 12], request_id: 'conc-fb-' + i, items: [{ producto_id: 'LATTE', cantidad: (i % 4) + 1, opciones: [] }] };
    jobs.push(I[i % 3].call('public.order', body));
    if (i % 5 === 0) jobs.push(I[(i + 1) % 3].call('public.order', body)); // mismo pedido por otra instancia
  }
  W.db.resetCounters();
  const res = await Promise.all(jobs);
  assert.ok(res.every((r) => r.ok), JSON.stringify(res.find((r) => !r.ok)));
  process.stderr.write('CONCURRENCIA choques=' + W.db.aborts + ' escrituras=' + W.db.writes + ' lecturas=' + W.db.reads + '\n'); void ('# concurrencia: choques de transacción resueltos =', W.db.aborts, '· escrituras =', W.db.writes, '· lecturas =', W.db.reads);
  const peds = [...W.db.docs.entries()].filter(([p]) => p.startsWith('t_Pedidos/')).map(([, d]) => d.data);
  assert.equal(peds.length, 60, 'exactamente 60 pedidos');
  assert.equal(new Set(peds.map((p) => p.numero)).size, 60, 'números únicos');
  const mesas = new Map([...W.db.docs.entries()].filter(([p]) => p.startsWith('t_Mesas/')).map(([, d]) => [d.data.mesa_id, d.data.qr_token]));
  for (const p of peds) {
    const i = Number(p.request_id.split('-')[2]);
    assert.equal(mesas.get(p.mesa_id), toks[i % 12], 'mesa correcta');
    assert.equal(p.total_gs, 20000 * ((i % 4) + 1), 'total correcto');
  }
  // Las tres instancias terminan viendo lo mismo
  const pin = pinOf(W.logs);
  const tk = (await ok(I[2].call('auth.login', { usuario: 'admin', pin }))).token;
  for (const x of I) assert.equal((await ok(x.call('sync', {}, tk))).pedidos.length, 60);
});

test('Firebase: dos cajas cobrando la misma cuenta a la vez desde instancias distintas → un solo cobro', async () => {
  const W = world({ latency: 5 });
  const A = W.mk(), B = W.mk();
  await ok(A.call('health'));
  const tk = await setupUsers(A, pinOf(W.logs));
  const p = (await ok(A.call('order.create', { request_id: 'fb-dup-0001', mesa_id: 'M07', items: [{ producto_id: 'APEROL', cantidad: 1 }] }, tk.mozo))).pedido;
  await ok(A.call('caja.abrir', { caja_id: 'CAJA_A', monto_inicial_gs: 0 }, tk.cajaa));
  const [r1, r2] = await Promise.all([
    A.call('caja.cobrar', { request_id: 'fb-dup-cobro-a', cuenta_id: p.cuenta_id, pagos: [{ medio: 'EFECTIVO', monto_gs: 55000 }] }, tk.cajaa),
    B.call('caja.cobrar', { request_id: 'fb-dup-cobro-b', cuenta_id: p.cuenta_id, pagos: [{ medio: 'TC', monto_gs: 55000 }] }, tk.cajaa)
  ]);
  assert.equal([r1, r2].filter((r) => r.ok).length, 1, 'solo un cobro gana');
  assert.equal([r1, r2].find((r) => !r.ok).error.code, 'YA_COBRADA');
  assert.equal(W.db.count('t_Cobros/'), 1);
});

test('Firebase: costo de lecturas — consulta sin cambios = 1 lectura; con cambios, solo lo modificado', async () => {
  const W = world();
  const A = W.mk(), B = W.mk();
  await ok(A.call('health'));
  const tk = await setupUsers(A, pinOf(W.logs));
  const s0 = await ok(B.call('sync', {}, tk.cocina)); // B carga todo una vez
  W.db.resetCounters();
  const s1 = await ok(B.call('sync', { since: s0.rev }, tk.cocina));
  assert.equal(s1.sin_cambios, true);
  assert.equal(W.db.reads, 1, 'solo el pulso');
  await ok(A.call('order.create', { request_id: 'fb-cost-001', mesa_id: 'M01', items: [{ producto_id: 'CHIPA', cantidad: 3 }] }, tk.mozo));
  W.db.resetCounters();
  const s2 = await ok(B.call('sync', { since: s0.rev }, tk.cocina));
  assert.equal(s2.pedidos.length, 1);
  assert.ok(W.db.reads <= 8, 'lecturas para traer el cambio: ' + W.db.reads);
  // Con TTL de pulso, ráfagas de consultas no leen nada (y el cliente puede exigir una revisión mínima)
  const W2 = world({ ttl: 60000 });
  const C = W2.mk(); await ok(C.call('health'));
  const t2 = (await ok(C.call('auth.login', { usuario: 'admin', pin: pinOf(W2.logs) }))).token;
  await ok(C.call('sync', {}, t2));
  W2.db.resetCounters();
  for (let i = 0; i < 10; i++) await ok(C.call('sync', { since: 999999 }, t2));
  assert.equal(W2.db.reads, 0, 'ráfaga servida desde caché');
});

test('Firebase: un error de validación no escribe nada', async () => {
  const W = world();
  const A = W.mk();
  await ok(A.call('health'));
  const tk = await setupUsers(A, pinOf(W.logs));
  W.db.resetCounters();
  await bad(A.call('order.create', { request_id: 'fb-val-001', mesa_id: 'M02', items: [{ producto_id: 'ESPRESSO', cantidad: 1 }, { producto_id: 'PIZZA_PERSONAL', cantidad: 1, opciones: [] }] }, tk.mozo), 'OPCION_REQUERIDA');
  assert.equal(W.db.writes, 0);
  // Login fallido sí registra el intento (bloqueo por intentos)
  await bad(A.call('auth.login', { usuario: 'mozo', pin: '9999' }), 'LOGIN_INVALIDO');
  assert.ok(W.db.writes >= 1);
});

test('Firebase: archivo diario por día y reportes que leen lo archivado; otras instancias recargan', async () => {
  const W = world({ chunkBytes: 4000 });
  let now = Date.parse('2026-10-01T15:00:00Z');
  W.setClock(() => now);
  const A = W.mk(), B = W.mk();
  await ok(A.call('health'));
  const tk = await setupUsers(A, pinOf(W.logs));
  await ok(A.call('caja.abrir', { caja_id: 'CAJA_A', monto_inicial_gs: 0 }, tk.cajaa));
  let total = 0;
  for (let i = 0; i < 12; i++) {
    const p = (await ok(A.call('order.create', { request_id: 'fb-arch-' + i, mesa_id: 'M' + String((i % 9) + 1).padStart(2, '0'), venta_directa: true, items: [{ producto_id: 'ESPRESSO', cantidad: 1 + (i % 2) }] }, tk.mozo))).pedido;
    await ok(A.call('caja.cobrar', { request_id: 'fb-arch-c-' + i, cuenta_id: p.cuenta_id, pagos: [{ medio: 'EFECTIVO', monto_gs: p.total_gs }] }, tk.cajaa));
    total += p.total_gs;
  }
  await ok(A.call('caja.cerrar', { caja_id: 'CAJA_A', efectivo_declarado_gs: total }, tk.cajaa));
  await ok(B.call('sync', {}, tk.admin)); // B con caché caliente
  now = Date.parse('2026-10-09T15:00:00Z');
  const n = await A.b.archive();
  assert.equal(n.Pedidos, 12); assert.equal(n.Cobros, 12);
  assert.equal(W.db.count('t_Pedidos/'), 0);
  assert.ok(W.db.count('archivo/') > 6, 'archivo troceado en varios documentos: ' + W.db.count('archivo/'));
  // B detecta la nueva época y recarga
  const tk2 = (await ok(B.call('auth.login', { usuario: 'admin', pin: pinOf(W.logs) }))).token;
  assert.equal((await ok(B.call('sync', {}, tk2))).pedidos.length, 0);
  const rep = await ok(B.call('admin.report', { desde: '2026-10-01', hasta: '2026-10-01' }, tk2));
  assert.equal(rep.consolidado_gs, total);
  assert.equal(rep.pedidos.total, 12);
  assert.equal(rep.top_productos[0].cantidad, 18);
  assert.equal(rep.cierres.length, 1);
  // Exportación del día (para Google Sheets)
  const ex = await A.b.exportDay('2026-10-01');
  assert.equal(ex.pedidos.length, 12); assert.equal(ex.cobros.length, 12);
  // Después del archivo se puede seguir operando normalmente
  const p = (await ok(A.call('order.create', { request_id: 'fb-arch-post', mesa_id: 'M01', items: [{ producto_id: 'TE', cantidad: 1 }] }, tk2))).pedido;
  assert.equal(p.numero, 'A-001');
});

test('Firebase: el límite de pedidos por QR sigue activo (y no cuenta reintentos)', async () => {
  const W = world();
  const A = W.mk();
  await ok(A.call('health'));
  const tok = [...W.db.docs.entries()].find(([p, d]) => p.startsWith('t_Mesas/') && d.data.numero === 9)[1].data.qr_token;
  for (let i = 0; i < 6; i++) await ok(A.call('public.order', { token: tok, request_id: 'fb-ratelim-' + i, items: [{ producto_id: 'TE', cantidad: 1 }] }));
  await ok(A.call('public.order', { token: tok, request_id: 'fb-ratelim-0', items: [{ producto_id: 'TE', cantidad: 1 }] })); // reintento: no cuenta
  await bad(A.call('public.order', { token: tok, request_id: 'fb-ratelim-7', items: [{ producto_id: 'TE', cantidad: 1 }] }), 'DEMASIADOS_PEDIDOS');
});

test('Firebase: reinicio de datos de prueba con respaldo; borra también lo archivado y las otras instancias recargan', async () => {
  const crypto = require('crypto');
  const sha = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
  const salt = 'saltfb123'; let h = salt + ':' + '135790'; for (let i = 0; i < 300; i++) h = sha(h + ':' + salt);
  const W = world();
  let now = Date.parse('2026-10-10T15:00:00Z');
  W.setClock(() => now);
  const A = W.mk(), B = W.mk();
  const seed = { catalogo, mesas: 20, plataforma: { usuario_id: 'sol', salt, hash: h } };
  const callA = (action, payload, token) => A.b.handle({ action, payload: payload || {}, token }, seed);
  const callB = (action, payload, token) => B.b.handle({ action, payload: payload || {}, token }, seed);
  await ok(callA('health'));
  const tk = await setupUsers({ call: callA }, pinOf(W.logs));
  const sol = (await ok(callA('auth.login', { usuario: 'sol', pin: '135790' }))).token;
  const qrAntes = (await ok(callA('admin.data', {}, tk.admin))).mesas.map((m) => m.qr_token);
  // Un día con ventas, archivado
  await ok(callA('caja.abrir', { caja_id: 'CAJA_A', monto_inicial_gs: 0 }, tk.cajaa));
  for (let i = 0; i < 3; i++) {
    const p = (await ok(callA('order.create', { request_id: 'fb-rei-' + i, mesa_id: 'M0' + (i + 1), venta_directa: true, items: [{ producto_id: 'ESPRESSO', cantidad: 1 }] }, tk.mozo))).pedido;
    await ok(callA('caja.cobrar', { request_id: 'fb-rei-c-' + i, cuenta_id: p.cuenta_id, pagos: [{ medio: 'EFECTIVO', monto_gs: p.total_gs }] }, tk.cajaa));
  }
  await ok(callA('caja.cerrar', { caja_id: 'CAJA_A', efectivo_declarado_gs: 36000 }, tk.cajaa));
  now = Date.parse('2026-10-14T15:00:00Z');
  await A.b.archive();
  assert.ok(W.db.count('archivo/') > 0);
  for (const [u, pin] of [['admin', pinOf(W.logs)], ['mozo', '1111'], ['cajaa', '3333']]) tk[u] = (await ok(callA('auth.login', { usuario: u, pin }))).token;
  const sol2 = (await ok(callA('auth.login', { usuario: 'sol', pin: '135790' }))).token;
  // Y otro día sin archivar
  const p = (await ok(callA('order.create', { request_id: 'fb-rei-x', mesa_id: 'M05', items: [{ producto_id: 'TE', cantidad: 1 }] }, tk.mozo))).pedido;
  await ok(callA('caja.abrir', { caja_id: 'CAJA_A', monto_inicial_gs: 0 }, tk.cajaa));
  await ok(callA('caja.cobrar', { request_id: 'fb-rei-cx', cuenta_id: p.cuenta_id, pagos: [{ medio: 'EFECTIVO', monto_gs: p.total_gs }] }, tk.cajaa));
  await ok(callA('caja.cerrar', { caja_id: 'CAJA_A', efectivo_declarado_gs: p.total_gs }, tk.cajaa));
  await ok(callB('sync', {}, tk.admin)); // B con caché caliente
  // Reinicio desde la instancia B
  const r = await ok(callB('plataforma.reiniciar', { confirmar: 'REINICIAR' }, sol2));
  assert.ok(sol);
  assert.equal(r.borrados.Pedidos, 1, 'en la tabla activa quedaba 1 pedido');
  assert.equal(W.db.count('t_Pedidos/'), 0); assert.equal(W.db.count('t_Cobros/'), 0); assert.equal(W.db.count('t_Turnos/'), 0);
  const quedan = [...W.db.docs.entries()].filter(([k]) => k.startsWith('archivo/')).map(([, d]) => d.data.tabla);
  assert.deepEqual([...new Set(quedan)], ['Auditoria'], 'del archivo solo queda la auditoría: ' + quedan.join(','));
  assert.ok(W.db.count('respaldo/') > 0, 'hay copia de respaldo');
  assert.ok(W.logs.some((l) => /datos reiniciados/.test(l)));
  // A (caché vieja) ve todo en cero; reportes en cero; carta, mesas y usuarios intactos
  assert.equal((await ok(callA('sync', {}, tk.admin))).pedidos.length, 0);
  const rep = await ok(callA('admin.report', { desde: '2026-10-01', hasta: '2026-10-31' }, tk.admin));
  assert.equal(rep.pedidos.total, 0); assert.equal(rep.consolidado_gs, 0);
  const ad = await ok(callA('admin.data', {}, tk.admin));
  assert.deepEqual(ad.mesas.map((m) => m.qr_token), qrAntes);
  assert.ok(ad.menu.productos.length > 50);
  await ok(callA('auth.login', { usuario: 'mozo', pin: '1111' }));
  // Se sigue operando
  const n = (await ok(callA('order.create', { request_id: 'fb-rei-post', mesa_id: 'M01', items: [{ producto_id: 'TE', cantidad: 1 }] }, tk.mozo))).pedido;
  assert.equal(n.numero, 'A-001');
});
