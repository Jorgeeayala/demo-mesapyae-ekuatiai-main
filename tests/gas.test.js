'use strict';
/*
 * Prueba el backend de Apps Script (gas/*.js) en un emulador de los servicios de Google.
 * El emulador imita lo que suele romper integraciones con Sheets: conversión automática
 * de textos a números/fechas cuando la columna no está en formato texto, fórmulas que
 * empiezan con "=", filas vacías, y la caché compartida entre ejecuciones.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

function emulator() {
  const sheets = new Map();
  let ssTz = 'UTC';
  function convert(v, text) {
    if (typeof v === 'string' && v.startsWith("'")) return v.slice(1);
    if (text) return v === '' ? '' : String(v);
    if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) return Number(v);
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}(T.*)?$/.test(v)) return new Date(v);
    if (typeof v === 'string' && v.startsWith('=')) return '#FORMULA!';
    return v;
  }
  function Sheet(name) {
    const cells = []; let text = false;
    const self = {
      _cells: cells, getName: () => name,
      getMaxRows: () => 1000,
      getLastRow() { for (let r = cells.length - 1; r >= 0; r--) if (cells[r] && cells[r].some((v) => v !== '' && v !== undefined)) return r + 1; return 0; },
      setFrozenRows() {},
      getRange(r, c, nr, nc) {
        nr = nr || 1; nc = nc || 1;
        const range = {
          setNumberFormat(f) { if (f === '@') text = true; return range; },
          setFontWeight() { return range; }, setBackground() { return range; },
          setValues(vals) {
            assert.equal(vals.length, nr, 'setValues filas'); vals.forEach((row) => assert.equal(row.length, nc, 'setValues columnas'));
            for (let i = 0; i < nr; i++) { cells[r - 1 + i] = cells[r - 1 + i] || []; for (let j = 0; j < nc; j++) cells[r - 1 + i][c - 1 + j] = convert(vals[i][j], text); }
            return range;
          },
          getValues() {
            const out = [];
            for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) { const v = (cells[r - 1 + i] || [])[c - 1 + j]; row.push(v === undefined ? '' : v); } out.push(row); }
            return out;
          },
          clearContent() { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (cells[r - 1 + i]) cells[r - 1 + i][c - 1 + j] = ''; return range; }
        };
        return range;
      }
    };
    return self;
  }
  const ss = {
    getId: () => 'SS_ID', getName: () => 'ANDRADE_MESA_PYAE_DB',
    getSheetByName: (n) => sheets.get(n) || null,
    insertSheet(n) { const s = Sheet(n); sheets.set(n, s); return s; },
    getSheets: () => [...sheets.values()], deleteSheet(s) { sheets.delete(s.getName()); },
    setSpreadsheetTimeZone(t) { ssTz = t; }
  };
  ss.insertSheet('Hoja 1');
  const cacheMap = new Map(), props = new Map();
  const logs = [];
  const toSigned = (buf) => [...buf].map((b) => (b > 127 ? b - 256 : b));
  const ctx = {
    console: { log: (m) => logs.push(String(m)), error: (m) => logs.push('ERR ' + m) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss, flush() {}, getUi: () => ({ createMenu: () => ({ addItem() { return this; }, addToUi() {} }) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    CacheService: { getScriptCache: () => ({ get: (k) => (cacheMap.has(k) ? cacheMap.get(k) : null), put: (k, v) => { assert.ok(v.length <= 100000, 'CacheService: valor > 100KB'); cacheMap.set(k, v); }, remove: (k) => cacheMap.delete(k), removeAll: (ks) => ks.forEach((k) => cacheMap.delete(k)) }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (props.has(k) ? props.get(k) : null), setProperty: (k, v) => props.set(k, v) }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      getUuid: () => crypto.randomUUID(),
      computeDigest: (a, s) => toSigned(crypto.createHash('sha256').update(s, 'utf8').digest()),
      computeHmacSha256Signature: (m, k) => toSigned(crypto.createHmac('sha256', k).update(m, 'utf8').digest()),
      base64Encode: (s) => Buffer.from(s, 'utf8').toString('base64'),
      base64Decode: (s) => [...Buffer.from(s, 'base64')],
      newBlob: (bytes) => ({ getDataAsString: () => Buffer.from(bytes.map((b) => (b < 0 ? b + 256 : b))).toString('utf8') }),
      formatDate: (d, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ setMimeType() { return this; }, getContent: () => s }) },
    ScriptApp: {}, DriveApp: {}, Date, JSON, Math, Object, Array, String, Number, Error, isFinite, parseInt
  };
  vm.createContext(ctx);
  for (const f of ['Core.js', 'Catalogo.js', 'Code.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'alternativas', 'apps-script', 'gas', f), 'utf8'), ctx, { filename: f });
  const post = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).getContent());
  return { ctx, ss, sheets, cacheMap, props, logs, post, newExecution() { vm.runInContext('APP_ = null;', ctx); } };
}

if (!process.env.MESA_SKIP_GAS_TESTS) test('GAS: setup crea hojas en formato texto, secretos y datos base', () => {
  const E = emulator();
  E.ctx.setup();
  for (const t of ['Config', 'Pedidos', 'PedidoItems', 'Cuentas', 'Cobros', 'Movimientos', 'Turnos', 'Usuarios', 'Productos']) assert.ok(E.ss.getSheetByName(t), t);
  assert.equal(E.ss.getSheetByName('Hoja 1'), null);
  assert.ok(E.props.get('SESSION_SECRET') && E.props.get('PROXY_SECRET') && E.props.get('SPREADSHEET_ID'));
  assert.equal(E.ss.getSheetByName('Productos').getLastRow(), 75);
  assert.equal(E.ss.getSheetByName('Mesas').getLastRow(), 21);
  // Setup es idempotente
  E.newExecution(); E.ctx.setup();
  assert.equal(E.ss.getSheetByName('Productos').getLastRow(), 75);
  assert.equal(E.ss.getSheetByName('Usuarios').getLastRow(), 2);
});

if (!process.env.MESA_SKIP_GAS_TESTS) test('GAS: flujo completo vía doPost con persistencia real en hojas', () => {
  const E = emulator();
  E.ctx.setup();
  const pin = E.logs.join('\n').match(/PIN inicial es: (\d+)/)[1];
  const S = E.props.get('PROXY_SECRET');
  const call = (action, payload, token) => { E.newExecution(); return E.post({ action, payload, token, proxy_secret: S }); };
  // Sin secreto del proxy: rechazado
  assert.equal(E.post({ action: 'health' }).error.code, 'NO_AUTORIZADO');
  const login = call('auth.login', { usuario: 'admin', pin });
  assert.equal(login.ok, true, JSON.stringify(login));
  const T = login.data.token;
  assert.equal(call('admin.user', { usuario: { usuario_id: 'cajaa', nombre: 'Caja A', rol: 'CAJA', caja_id: 'CAJA_A', pin: '3333', activo: true } }, T).ok, true);
  assert.equal(call('admin.user', { usuario: { usuario_id: 'mozo', nombre: 'Mozo', rol: 'MOZO', pin: '1111', activo: true } }, T).ok, true);
  const TM = call('auth.login', { usuario: 'mozo', pin: '1111' }).data.token;
  const TC = call('auth.login', { usuario: 'cajaa', pin: '3333' }).data.token;
  // Pedido con observación que intenta inyectar una fórmula
  const p = call('order.create', { request_id: 'gas-req-0001', mesa_id: 'M01', observacion: '=IMPORTRANGE("x")', items: [{ producto_id: 'PANINI_CESAR', cantidad: 2, opciones: ['PAN_CIA'], observacion: '+sin sal' }] }, TM);
  assert.equal(p.ok, true, JSON.stringify(p));
  assert.equal(p.data.pedido.numero, 'A-001'); assert.equal(p.data.pedido.total_gs, 80000);
  assert.equal(call('order.create', { request_id: 'gas-req-0001', mesa_id: 'M01', items: [{ producto_id: 'TE', cantidad: 1 }] }, TM).data.duplicado, true);
  // La observación quedó como texto, no como fórmula
  const ped = E.ss.getSheetByName('Pedidos');
  const hdr = ped._cells[0];
  assert.equal(ped._cells[1][hdr.indexOf('observacion')], '=IMPORTRANGE("x")');
  assert.equal(ped._cells[1][hdr.indexOf('fecha')].constructor, String, 'fecha guardada como texto');
  assert.equal(ped._cells[1][hdr.indexOf('numero')], 'A-001');
  // Segundo pedido de otra ejecución: número correlativo leído de la hoja
  const p2 = call('order.create', { request_id: 'gas-req-0002', mesa_id: 'M02', items: [{ producto_id: 'JUGO_NATURAL', cantidad: 1, opciones: ['JS_NAR', 'JT_500'] }] }, TM);
  assert.equal(p2.data.pedido.numero, 'A-002');
  // Sync ve ambos; con since=rev no devuelve datos
  const s1 = call('sync', {}, TM);
  assert.equal(s1.data.pedidos.length, 2);
  assert.equal(s1.data.pedidos[0].items[0].opciones, 'Pan ciabatta');
  assert.equal(call('sync', { since: s1.data.rev }, TM).data.sin_cambios, true);
  // Caja: abrir, cobrar, reintento idempotente, cerrar
  assert.equal(call('caja.abrir', { caja_id: 'CAJA_A', monto_inicial_gs: 50000 }, TC).ok, true);
  const c1 = call('caja.cobrar', { request_id: 'gas-cobro-0001', cuenta_id: p.data.pedido.cuenta_id, pagos: [{ medio: 'EFECTIVO', monto_gs: 80000 }] }, TC);
  assert.equal(c1.ok, true, JSON.stringify(c1));
  assert.equal(call('caja.cobrar', { request_id: 'gas-cobro-0001', cuenta_id: p.data.pedido.cuenta_id, pagos: [{ medio: 'EFECTIVO', monto_gs: 80000 }] }, TC).data.duplicado, true);
  assert.equal(call('caja.cobrar', { request_id: 'gas-cobro-0002', cuenta_id: p.data.pedido.cuenta_id, pagos: [{ medio: 'EFECTIVO', monto_gs: 80000 }] }, TC).error.code, 'YA_COBRADA');
  const est = call('caja.estado', { caja_id: 'CAJA_A' }, TC);
  assert.equal(est.data.turno.totales.efectivo_esperado_gs, 130000);
  const cierre = call('caja.cerrar', { caja_id: 'CAJA_A', efectivo_declarado_gs: 130000 }, TC);
  assert.equal(cierre.data.turno.diferencia_gs, 0);
  const rep = call('admin.report', {}, T);
  assert.equal(rep.data.consolidado_gs, 80000);
  // Movimientos en la hoja: montos persistidos
  const mv = E.ss.getSheetByName('Movimientos');
  assert.equal(mv.getLastRow(), 3); // encabezado + apertura + cobro
});

if (!process.env.MESA_SKIP_GAS_TESTS) test('GAS: edición manual en la planilla invalida la caché', () => {
  const E = emulator();
  E.ctx.setup();
  const S = E.props.get('PROXY_SECRET');
  const pin = E.logs.join('\n').match(/PIN inicial es: (\d+)/)[1];
  const call = (action, payload, token) => { E.newExecution(); return E.post({ action, payload, token, proxy_secret: S }); };
  const T = call('auth.login', { usuario: 'admin', pin }).data.token;
  call('product.availability', { producto_id: 'ESPRESSO', disponible: true }, T); // llena caché de Productos
  assert.ok(E.cacheMap.has('T:Productos'));
  // El encargado cambia a mano el precio en la hoja
  const sh = E.ss.getSheetByName('Productos'), hdr = sh._cells[0];
  const row = sh._cells.findIndex((r) => r && r[0] === 'ESPRESSO');
  sh.getRange(row + 1, hdr.indexOf('precio_gs') + 1).setValues([['13000']]);
  E.ctx.onEdit({ range: { getSheet: () => sh } });
  const r = call('order.create', { request_id: 'gas-req-0009', mesa_id: 'M03', items: [{ producto_id: 'ESPRESSO', cantidad: 1 }] }, T);
  assert.equal(r.data.pedido.total_gs, 13000);
});

if (!process.env.MESA_SKIP_GAS_TESTS) test('GAS: error de validación no deja escrituras parciales', () => {
  const E = emulator();
  E.ctx.setup();
  const S = E.props.get('PROXY_SECRET');
  const pin = E.logs.join('\n').match(/PIN inicial es: (\d+)/)[1];
  const call = (action, payload, token) => { E.newExecution(); return E.post({ action, payload, token, proxy_secret: S }); };
  const T = call('auth.login', { usuario: 'admin', pin }).data.token;
  const before = ['Pedidos', 'PedidoItems', 'Cuentas', 'Contadores'].map((t) => E.ss.getSheetByName(t).getLastRow());
  const r = call('order.create', { request_id: 'gas-req-0100', mesa_id: 'M04', items: [{ producto_id: 'ESPRESSO', cantidad: 1 }, { producto_id: 'PIZZA_PERSONAL', cantidad: 1, opciones: [] }] }, T);
  assert.equal(r.error.code, 'OPCION_REQUERIDA');
  const after = ['Pedidos', 'PedidoItems', 'Cuentas', 'Contadores'].map((t) => E.ss.getSheetByName(t).getLastRow());
  assert.deepEqual(after, before);
});

module.exports = { emulator };
