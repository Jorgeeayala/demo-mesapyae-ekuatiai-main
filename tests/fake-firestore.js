'use strict';
/*
 * Simulador en memoria de la API de firebase-admin/firestore usada por el backend.
 * Reproduce: transacciones con validación de lecturas (si otro escribió, ABORTED y
 * reintento automático hasta 5 veces), lecturas antes que escrituras en transacción,
 * lotes de hasta 500 operaciones, límite de 1 MiB por documento, ids sin "/",
 * valores undefined prohibidos, latencia aleatoria (intercala operaciones) y
 * conteo de lecturas/escrituras como las factura Firestore (mín. 1 lectura por consulta).
 */
const MAX_DOC = 1048487;

class FakeFirestore {
  constructor(opts) {
    opts = opts || {};
    this.docs = new Map(); // path -> { data, v }
    this.reads = 0; this.writes = 0; this.deletes = 0; this.aborts = 0;
    this.latency = opts.latency === undefined ? 3 : opts.latency;
    this.v = 0;
  }
  async _delay() { if (this.latency) await new Promise((r) => setTimeout(r, Math.random() * this.latency)); }
  _check(path, data) {
    const id = path.split('/').pop();
    if (!id || id === '.' || id === '..' || /^__.*__$/.test(id)) throw new Error('Id de documento inválido: ' + id);
    if (path.split('/').length % 2 !== 0) throw new Error('Ruta de documento inválida: ' + path);
    if (data !== undefined) {
      const walk = (o) => { for (const k of Object.keys(o)) { const v = o[k]; if (v === undefined) throw new Error('Cannot use "undefined" as a Firestore value (campo ' + k + ')'); if (v && typeof v === 'object') walk(v); } };
      walk(data);
      const size = Buffer.byteLength(JSON.stringify(data)) + path.length;
      if (size > MAX_DOC) throw new Error('Documento supera 1 MiB: ' + path + ' (' + size + ')');
    }
  }
  _snap(path) {
    const d = this.docs.get(path);
    return { id: path.split('/').pop(), exists: !!d, ref: this.doc(path), data: () => (d ? JSON.parse(JSON.stringify(d.data)) : undefined) };
  }
  _apply(op) {
    if (op.type === 'set') { this._check(op.path, op.data); this.docs.set(op.path, { data: JSON.parse(JSON.stringify(op.data)), v: ++this.v }); this.writes++; }
    else if (op.type === 'delete') { this.docs.delete(op.path); this.deletes++; }
  }
  _query(coll, filters) {
    const out = [];
    for (const [path, d] of this.docs) {
      const parts = path.split('/');
      if (parts.length !== 2 || parts[0] !== coll) continue;
      if (filters.every(([f, op, val]) => {
        const x = d.data[f];
        if (x === undefined) return false;
        return op === '>' ? x > val : op === '>=' ? x >= val : op === '<' ? x < val : op === '<=' ? x <= val : op === '==' ? x === val : false;
      })) out.push(path);
    }
    return out.sort();
  }
  doc(path) {
    const self = this;
    return {
      path, id: path.split('/').pop(), _isDoc: true,
      async get() { await self._delay(); self.reads++; return self._snap(path); },
      async set(data) { await self._delay(); self._apply({ type: 'set', path, data }); }
    };
  }
  collection(name) {
    const self = this;
    const mkQuery = (filters) => ({
      _isQuery: true, coll: name, filters,
      where(f, op, v) { return mkQuery(filters.concat([[f, op, v]])); },
      async get() {
        await self._delay();
        const paths = self._query(name, filters);
        self.reads += Math.max(1, paths.length);
        return { size: paths.length, empty: !paths.length, docs: paths.map((p) => self._snap(p)) };
      }
    });
    const q = mkQuery([]);
    q.doc = (id) => { if (String(id).includes('/')) throw new Error('El id no puede contener "/": ' + id); return self.doc(name + '/' + id); };
    return q;
  }
  batch() {
    const self = this, ops = [];
    return {
      set(ref, data) { ops.push({ type: 'set', path: ref.path, data }); },
      delete(ref) { ops.push({ type: 'delete', path: ref.path }); },
      async commit() {
        if (ops.length > 500) throw new Error('Un lote admite como máximo 500 operaciones');
        await self._delay();
        ops.forEach((o) => self._check(o.path, o.data));
        ops.forEach((o) => self._apply(o));
      }
    };
  }
  async runTransaction(fn) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const readV = new Map(), writes = [];
      const self = this;
      const tx = {
        async get(refOrQuery) {
          if (writes.length) throw new Error('Firestore transactions require all reads to be executed before all writes.');
          await self._delay();
          if (refOrQuery._isDoc) { const d = self.docs.get(refOrQuery.path); readV.set(refOrQuery.path, d ? d.v : 0); self.reads++; return self._snap(refOrQuery.path); }
          const paths = self._query(refOrQuery.coll, refOrQuery.filters);
          paths.forEach((p) => readV.set(p, self.docs.get(p).v)); self.reads += Math.max(1, paths.length);
          return { size: paths.length, docs: paths.map((p) => self._snap(p)) };
        },
        set(ref, data) { writes.push({ type: 'set', path: ref.path, data }); return tx; },
        delete(ref) { writes.push({ type: 'delete', path: ref.path }); return tx; }
      };
      const result = await fn(tx);           // si fn lanza, no se escribe nada
      await this._delay();
      const ok = [...readV].every(([p, v]) => { const d = this.docs.get(p); return (d ? d.v : 0) === v; });
      if (!ok) { this.aborts++; continue; }
      if (writes.length > 500) throw new Error('Una transacción admite como máximo 500 escrituras');
      writes.forEach((w) => this._check(w.path, w.data));
      writes.forEach((w) => this._apply(w));
      return result;
    }
    const e = new Error('10 ABORTED: Too much contention on these documents.'); e.code = 10; throw e;
  }
  count(prefix) { let n = 0; for (const p of this.docs.keys()) if (p.startsWith(prefix)) n++; return n; }
  resetCounters() { this.reads = 0; this.writes = 0; this.deletes = 0; this.aborts = 0; }
}

module.exports = { FakeFirestore };
