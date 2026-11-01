/*
 * MESA PYA'E — ANDRADE · Backend en Google Apps Script
 *
 * Este proyecto se vincula a la planilla privada ANDRADE_MESA_PYAE_DB.
 * Expone un Web App (doPost) que SOLO acepta llamadas que traen el secreto
 * compartido con la función proxy de Netlify (PROXY_SECRET). Toda la lógica de
 * negocio está en Core.js (idéntico a core/core.js del repositorio).
 *
 * Primer uso: ejecutar setup() desde el editor (ver docs/manual-tecnico.md).
 */

var TZ = 'America/Asuncion';
var SMALL_TABLES = { Config: 1, Usuarios: 1, Mesas: 1, Puntos: 1, Cajas: 1, Categorias: 1, Productos: 1, Grupos: 1, Opciones: 1, Contadores: 1 };

// ------------------------------------------------------------------ entorno
function gasEnv_() {
  var props = PropertiesService.getScriptProperties();
  var cache = CacheService.getScriptCache();
  var ALPHA = 'abcdefghijkmnpqrstuvwxyz23456789';
  function hex(bytes) { return bytes.map(function (b) { var v = (b < 0 ? b + 256 : b).toString(16); return v.length === 1 ? '0' + v : v; }).join(''); }
  return {
    now: function () { return Date.now(); },
    uuid: function () { return Utilities.getUuid(); },
    token: function (n) {
      var s = '';
      while (s.length < n) {
        var h = Utilities.getUuid().replace(/-/g, '');
        // 30 nibbles aleatorios (se omiten los de versión/variante) -> 15 bytes
        h = h.slice(0, 12) + h.slice(13, 16) + h.slice(17);
        for (var i = 0; i + 1 < h.length && s.length < n; i += 2) s += ALPHA[parseInt(h.substr(i, 2), 16) % 32];
      }
      return s;
    },
    sha256: function (s) { return hex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8)); },
    hmac: function (k, m) { return hex(Utilities.computeHmacSha256Signature(String(m), String(k), Utilities.Charset.UTF_8)); },
    b64: function (s) { return Utilities.base64Encode(String(s), Utilities.Charset.UTF_8); },
    unb64: function (s) { return Utilities.newBlob(Utilities.base64Decode(s)).getDataAsString('UTF-8'); },
    dateKey: function (ms) { return Utilities.formatDate(new Date(ms), TZ, 'yyyy-MM-dd'); },
    secret: props.getProperty('SESSION_SECRET'),
    cache: { get: function (k) { return cache.get(k); }, put: function (k, v, s) { cache.put(k, v, Math.min(21600, s)); } },
    log: function (m) { console.error(m); }
  };
}

// ------------------------------------------------------------------ persistencia en Sheets
function SheetsStore_(ss) {
  var cache = CacheService.getScriptCache();
  var inLock = false; // la caché solo se escribe dentro del candado (evita guardar lecturas viejas)
  function sheet(name) {
    var sh = ss.getSheetByName(name);
    if (!sh) throw new Error('Falta la hoja ' + name + '. Ejecutá setup().');
    return sh;
  }
  function safe(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string' && /^[=+@\-]/.test(v)) return "'" + v; // evita fórmulas inyectadas
    return v;
  }
  function readSheet(name) {
    var cols = MesaCore.SCHEMA[name];
    var sh = sheet(name);
    var last = sh.getLastRow();
    var values = last >= 1 ? sh.getRange(1, 1, last, cols.length).getValues() : [];
    var header = values.length ? values[0].map(String) : [];
    for (var i = 0; i < cols.length; i++) if (header[i] !== cols[i]) throw new Error('Encabezados inesperados en ' + name + ' (columna ' + (i + 1) + '). No reordenes columnas.');
    var rows = [];
    for (var r = 1; r < values.length; r++) {
      var o = { __r: r + 1 }, empty = true;
      for (var c = 0; c < cols.length; c++) { var v = values[r][c]; if (v instanceof Date) v = v.toISOString(); o[cols[c]] = v === null ? '' : v; if (v !== '') empty = false; }
      if (!empty) rows.push(o);
    }
    return rows;
  }
  function cacheGet(name) {
    if (!SMALL_TABLES[name]) return null;
    try { var j = cache.get('T:' + name); return j ? JSON.parse(j) : null; } catch (e) { return null; }
  }
  function cachePut(name, rows) {
    if (!SMALL_TABLES[name]) return;
    try { var j = JSON.stringify(rows); if (j.length < 95000) cache.put('T:' + name, j, 21600); else cache.remove('T:' + name); } catch (e) { cache.remove('T:' + name); }
  }

  function begin() {
    var work = {}, index = {}, dirty = {}, inserts = {}, rewrite = {}, archived = {};
    function tbl(t) {
      if (!MesaCore.SCHEMA[t]) throw new Error('Tabla desconocida ' + t);
      if (!work[t]) {
        var c = cacheGet(t);
        work[t] = c || readSheet(t);
        if (!c && inLock) cachePut(t, work[t]);
      }
      return work[t];
    }
    function ix(t) {
      if (!index[t]) { index[t] = {}; var k = MesaCore.KEYS[t]; tbl(t).forEach(function (r) { index[t][r[k]] = r; }); }
      return index[t];
    }
    return {
      all: function (t) { return tbl(t); },
      get: function (t, key) { return ix(t)[key] || null; },
      insert: function (t, row) {
        var k = MesaCore.KEYS[t];
        if (ix(t)[row[k]]) throw new Error('Clave duplicada ' + t + ':' + row[k]);
        var o = {};
        MesaCore.SCHEMA[t].forEach(function (c) { o[c] = row[c] === undefined || row[c] === null ? '' : row[c]; });
        tbl(t).push(o); ix(t)[o[k]] = o;
        (inserts[t] = inserts[t] || []).push(o);
      },
      update: function (t, key, patch) {
        var r = ix(t)[key];
        if (!r) throw new Error('No existe ' + t + ':' + key);
        Object.keys(patch).forEach(function (c) { if (MesaCore.SCHEMA[t].indexOf(c) >= 0) r[c] = patch[c] === undefined || patch[c] === null ? '' : patch[c]; });
        if (r.__r) (dirty[t] = dirty[t] || {})[r.__r] = r;
      },
      archive: function (t, pred) {
        var keep = [], move = [];
        tbl(t).forEach(function (r) { (pred(r) ? move : keep).push(r); });
        if (!move.length) return 0;
        work[t] = keep; delete index[t]; rewrite[t] = true;
        archived[t] = (archived[t] || []).concat(move);
        return move.length;
      },
      history: function (t) {
        var arch = ss.getSheetByName('Arch_' + t);
        var rows = [];
        if (arch && arch.getLastRow() > 1) {
          var cols = MesaCore.SCHEMA[t];
          arch.getRange(2, 1, arch.getLastRow() - 1, cols.length).getValues().forEach(function (v) {
            var o = {}; cols.forEach(function (c, i) { o[c] = v[i] instanceof Date ? v[i].toISOString() : v[i]; }); rows.push(o);
          });
        }
        return rows.concat(tbl(t));
      },
      commit: function () {
        var tables = {};
        Object.keys(dirty).concat(Object.keys(inserts), Object.keys(rewrite)).forEach(function (t) { tables[t] = 1; });
        Object.keys(tables).forEach(function (t) {
          var cols = MesaCore.SCHEMA[t], sh = sheet(t);
          var toRow = function (o) { return cols.map(function (c) { return safe(o[c]); }); };
          if (rewrite[t]) {
            var all = work[t];
            var last = sh.getLastRow();
            if (last > 1) sh.getRange(2, 1, last - 1, cols.length).clearContent();
            if (all.length) sh.getRange(2, 1, all.length, cols.length).setValues(all.map(toRow));
            all.forEach(function (o, i) { o.__r = i + 2; });
            if (archived[t] && archived[t].length) {
              var ar = ss.getSheetByName('Arch_' + t) || createSheet_(ss, 'Arch_' + t, cols);
              ar.getRange(ar.getLastRow() + 1, 1, archived[t].length, cols.length).setValues(archived[t].map(toRow));
            }
          } else {
            var d = dirty[t] ? Object.keys(dirty[t]).map(Number).sort(function (a, b) { return a - b; }) : [];
            // escribir bloques contiguos de filas modificadas
            var i = 0;
            while (i < d.length) {
              var j = i; while (j + 1 < d.length && d[j + 1] === d[j] + 1) j++;
              var block = []; for (var k = i; k <= j; k++) block.push(toRow(dirty[t][d[k]]));
              sh.getRange(d[i], 1, block.length, cols.length).setValues(block);
              i = j + 1;
            }
            var ins = inserts[t] || [];
            if (ins.length) {
              var start = Math.max(sh.getLastRow(), 1) + 1;
              sh.getRange(start, 1, ins.length, cols.length).setValues(ins.map(toRow));
              ins.forEach(function (o, n) { o.__r = start + n; });
            }
          }
          cachePut(t, work[t]);
        });
        SpreadsheetApp.flush();
      },
      rollback: function () {
        // Lo leído pudo modificarse en memoria: descartar caché de esas tablas.
        Object.keys(dirty).concat(Object.keys(inserts)).forEach(function (t) { if (SMALL_TABLES[t]) cache.remove('T:' + t); });
      }
    };
  }
  function withLock(fn) {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(25000)) {
      var e = new Error('OCUPADO'); e.busy = true; throw e;
    }
    inLock = true;
    try { return fn(); } finally { inLock = false; lock.releaseLock(); }
  }
  return { begin: begin, withLock: withLock };
}

function createSheet_(ss, name, cols) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.getRange(1, 1, sh.getMaxRows(), Math.max(cols.length, 1)).setNumberFormat('@'); // todo texto: Sheets no convierte fechas/números
  sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold').setBackground('#F3EDE1');
  sh.setFrozenRows(1);
  return sh;
}

function db_() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

var APP_ = null;
function app_() {
  if (!APP_) APP_ = MesaCore.create(SheetsStore_(db_()), gasEnv_());
  return APP_;
}

// ------------------------------------------------------------------ Web App
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); } catch (x) { return json_({ ok: false, status: 400, error: { code: 'JSON_INVALIDO', message: 'Solicitud inválida.' } }); }
  var expected = PropertiesService.getScriptProperties().getProperty('PROXY_SECRET');
  if (!expected || body.proxy_secret !== expected) return json_({ ok: false, status: 403, error: { code: 'NO_AUTORIZADO', message: 'Origen no autorizado.' } });
  try {
    var r = app_().handle({ action: body.action, payload: body.payload, token: body.token });
    return json_({ ok: r.ok, status: r.status, data: r.data, error: r.error });
  } catch (x) {
    if (x && x.busy) return json_({ ok: false, status: 503, error: { code: 'OCUPADO', message: 'El sistema está ocupado. Reintentá en unos segundos.' } });
    console.error(x && x.stack || x);
    return json_({ ok: false, status: 500, error: { code: 'ERROR_INTERNO', message: 'Error interno.' } });
  }
}
function doGet() { return json_({ ok: true, servicio: "Mesa Pya'e Andrade", version: MesaCore.VERSION }); }

// ------------------------------------------------------------------ instalación y mantenimiento
/**
 * Crea las hojas, los secretos y los datos base. Seguro de re-ejecutar.
 * Devuelve el PIN inicial del usuario "admin" (solo la primera vez) por el log.
 */
function setup() {
  var props = PropertiesService.getScriptProperties();
  var ss = db_();
  if (!props.getProperty('SPREADSHEET_ID')) props.setProperty('SPREADSHEET_ID', ss.getId());
  if (!props.getProperty('SESSION_SECRET')) props.setProperty('SESSION_SECRET', Utilities.getUuid() + Utilities.getUuid());
  if (!props.getProperty('PROXY_SECRET')) props.setProperty('PROXY_SECRET', Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''));
  ss.setSpreadsheetTimeZone(TZ);
  Object.keys(MesaCore.SCHEMA).forEach(function (t) { if (!ss.getSheetByName(t)) createSheet_(ss, t, MesaCore.SCHEMA[t]); });
  var hoja1 = ss.getSheetByName('Hoja 1') || ss.getSheetByName('Sheet1');
  if (hoja1 && ss.getSheets().length > 1 && hoja1.getLastRow() === 0) ss.deleteSheet(hoja1);
  CacheService.getScriptCache().removeAll(Object.keys(SMALL_TABLES).map(function (t) { return 'T:' + t; }));
  APP_ = null;
  var pin = String(100000 + Math.floor(Math.random() * 900000));
  var r = app_().seed({ catalogo: CATALOGO_ANDRADE, mesas: 20, admin: { usuario_id: 'admin', nombre: 'Encargado (Admin)', pin: pin } });
  console.log('Setup OK. Registros creados: ' + r.creados);
  console.log('PROXY_SECRET (copiar a Netlify como variable GAS_PROXY_SECRET): ' + props.getProperty('PROXY_SECRET'));
  if (r.creados > 0) console.log('Si se creó el usuario admin, su PIN inicial es: ' + pin + '  — cambialo en Administración > Usuarios.');
  return r;
}

/** Instala los disparadores diarios de respaldo y archivo (ejecutar una vez). */
function instalarDisparadores() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (['backupDiario', 'archivarDiario'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('backupDiario').timeBased().everyDays(1).atHour(4).inTimezone(TZ).create();
  ScriptApp.newTrigger('archivarDiario').timeBased().everyDays(1).atHour(5).inTimezone(TZ).create();
}

/** Copia diaria de la planilla a la carpeta de respaldos; conserva las últimas 30. */
function backupDiario() {
  var props = PropertiesService.getScriptProperties();
  var ss = db_();
  var folderId = props.getProperty('BACKUP_FOLDER_ID');
  var folder = folderId ? DriveApp.getFolderById(folderId) : null;
  if (!folder) { folder = DriveApp.createFolder('ANDRADE_MESA_PYAE_RESPALDOS'); props.setProperty('BACKUP_FOLDER_ID', folder.getId()); }
  DriveApp.getFileById(ss.getId()).makeCopy('RESPALDO_' + Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd_HHmm') + '_' + ss.getName(), folder);
  var files = [], it = folder.getFiles();
  while (it.hasNext()) files.push(it.next());
  files.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  files.slice(30).forEach(function (f) { f.setTrashed(true); });
}

/** Mueve a hojas Arch_* los registros cerrados con más de N días (config dias_activos). */
function archivarDiario() { console.log(JSON.stringify(app_().archive())); }

/** Si alguien edita la planilla a mano, invalidar caché de esa hoja y forzar resincronización. */
function onEdit(e) {
  try {
    var name = e.range.getSheet().getName();
    CacheService.getScriptCache().removeAll(['T:' + name, 'T:Config']);
  } catch (x) { }
}

/** Menú en la planilla para el administrador técnico. */
function onOpen() {
  SpreadsheetApp.getUi().createMenu("Mesa Pya'e")
    .addItem('Limpiar caché (después de editar a mano)', 'limpiarCache')
    .addItem('Respaldo ahora', 'backupDiario')
    .addToUi();
}
function limpiarCache() { CacheService.getScriptCache().removeAll(Object.keys(SMALL_TABLES).map(function (t) { return 'T:' + t; })); }
