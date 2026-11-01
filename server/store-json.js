'use strict';
/*
 * Persistencia para desarrollo y pruebas: un archivo JSON con las mismas tablas
 * y columnas que el Google Sheet de producción. Transacciones con copia en
 * escritura: si una operación falla, nada se guarda.
 */
const fs = require('fs');
const path = require('path');
const MesaCore = require('../core/core.js');

function createJsonStore(file) {
  let data = { active: {}, archive: {} };
  if (file && fs.existsSync(file)) data = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const t of Object.keys(MesaCore.SCHEMA)) { data.active[t] = data.active[t] || []; data.archive[t] = data.archive[t] || []; }
  let locked = false;

  function persist() {
    if (!file) return;
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, file);
  }

  function begin() {
    const work = {};       // tabla -> array de filas (copia)
    const index = {};      // tabla -> {key: fila}
    const archived = {};   // tabla -> filas movidas
    const removed = {};    // tabla -> [predicados] (reinicio: se borran también del archivo)
    const tbl = (t) => {
      if (!MesaCore.SCHEMA[t]) throw new Error('Tabla desconocida ' + t);
      if (!work[t]) work[t] = data.active[t].map((r) => Object.assign({}, r));
      return work[t];
    };
    const ix = (t) => {
      if (!index[t]) { index[t] = {}; const k = MesaCore.KEYS[t]; for (const r of tbl(t)) index[t][r[k]] = r; }
      return index[t];
    };
    const normalize = (t, row) => {
      const o = {};
      for (const c of MesaCore.SCHEMA[t]) o[c] = row[c] === undefined || row[c] === null ? '' : row[c];
      return o;
    };
    return {
      all: (t) => tbl(t),
      get: (t, key) => ix(t)[key] || null,
      insert(t, row) {
        const k = MesaCore.KEYS[t];
        if (ix(t)[row[k]]) throw new Error('Clave duplicada ' + t + ':' + row[k]);
        const r = normalize(t, row);
        tbl(t).push(r); ix(t)[r[k]] = r;
      },
      update(t, key, patch) {
        const r = ix(t)[key];
        if (!r) throw new Error('No existe ' + t + ':' + key);
        for (const c of Object.keys(patch)) if (MesaCore.SCHEMA[t].includes(c)) r[c] = patch[c] === undefined || patch[c] === null ? '' : patch[c];
      },
      archive(t, pred) {
        const keep = [], move = [];
        for (const r of tbl(t)) (pred(r) ? move : keep).push(r);
        work[t] = keep; index[t] = null; delete index[t];
        archived[t] = (archived[t] || []).concat(move);
        return move.length;
      },
      remove(t, pred) {
        const keep = [];
        let n = 0;
        for (const r of tbl(t)) { if (pred(r)) n++; else keep.push(r); }
        work[t] = keep; delete index[t];
        (removed[t] = removed[t] || []).push(pred);
        return n + data.archive[t].filter(pred).length;
      },
      history: (t) => data.archive[t].concat(tbl(t)),
      commit() {
        for (const t of Object.keys(work)) data.active[t] = work[t];
        for (const t of Object.keys(archived)) data.archive[t] = data.archive[t].concat(archived[t]);
        for (const t of Object.keys(removed)) data.archive[t] = data.archive[t].filter((r) => !removed[t].some((f) => f(r)));
        persist();
      },
      rollback() { /* descarta la copia */ }
    };
  }

  function withLock(fn) {
    // Node ejecuta handle() de forma síncrona: el candado detecta reentradas.
    if (locked) throw new Error('Reentrada de candado');
    locked = true;
    try { return fn(); } finally { locked = false; }
  }

  return { begin, withLock, _data: () => data };
}

module.exports = { createJsonStore };
