/*
 * Orquestador del Migrador e-Kuatia'i (Manifest V3).
 * 1. Recibe el paquete de factura desde la caja de Mesa Pya'e (chrome.runtime.sendMessage externo).
 * 2. Lo valida y lo deja pendiente en chrome.storage.local.
 * 3. Si e-Kuatia'i ya está abierto lo trae al frente; si no, abre una pestaña nueva.
 * 4. El content script rellena el formulario. La firma (PIN) y la emisión las hace siempre una persona.
 * No hace ninguna petición HTTP a la DNIT.
 */
importScripts('factura.js');

var URLS = {
  PRODUCCION: 'https://ekuatia.set.gov.py/ekuatiai/',
  PRUEBAS: 'https://desa-ekuatia.set.gov.py/ekuatiai/'
};
var PATRONES_PESTANA = ['https://ekuatia.set.gov.py/*', 'https://desa-ekuatia.set.gov.py/*'];

function leer(claves) { return chrome.storage.local.get(claves); }
function guardar(obj) { return chrome.storage.local.set(obj); }

// Mismo filtro que externally_connectable, también aplicado aquí por si alguien amplía el manifest sin querer.
function origenPermitido(url) {
  if (!url) return false;
  var u;
  try { u = new URL(url); } catch (e) { return false; }
  var lista = (chrome.runtime.getManifest().externally_connectable || {}).matches || [];
  return lista.some(function (patron) {
    var m = /^(https?):\/\/([^/]+)\//.exec(patron);
    if (!m) return false;
    if (u.protocol !== m[1] + ':') return false;
    var host = m[2];
    if (host.indexOf('*.') === 0) return u.hostname === host.slice(2) || u.hostname.endsWith(host.slice(1));
    return u.hostname === host;
  });
}

function badge(estado) {
  var txt = { PENDIENTE: '1', LLENANDO: '…', LISTA: '✍', EMITIDA: '✓', FINALIZADA: '✓', ERROR: '!' }[estado] || '';
  var color = { PENDIENTE: '#A9643C', LLENANDO: '#A9643C', LISTA: '#2F6F4E', EMITIDA: '#2F6F4E', FINALIZADA: '#2F6F4E', ERROR: '#8E2C2C' }[estado] || '#555';
  chrome.action.setBadgeText({ text: txt });
  chrome.action.setBadgeBackgroundColor({ color: color });
}

async function enfocarOAbrir() {
  var cfg = await leer(['entorno']);
  var entorno = cfg.entorno === 'PRUEBAS' ? 'PRUEBAS' : 'PRODUCCION';
  var host = new URL(URLS[entorno]).host;
  var tabs = await chrome.tabs.query({ url: PATRONES_PESTANA });
  // Prioriza una pestaña del entorno elegido y, dentro de ella, la que ya esté en el formulario.
  tabs = tabs.filter(function (t) { try { return new URL(t.url).host === host; } catch (e) { return false; } });
  tabs.sort(function (a, b) { return (/factura/i.test(b.url) ? 1 : 0) - (/factura/i.test(a.url) ? 1 : 0) || (b.lastAccessed || 0) - (a.lastAccessed || 0); });
  if (tabs.length) {
    var t = tabs[0];
    await chrome.tabs.update(t.id, { active: true });
    await chrome.windows.update(t.windowId, { focused: true });
    chrome.tabs.sendMessage(t.id, { tipo: 'LLENAR' }).catch(function () { /* la pestaña recarga: el content script lo toma al iniciar */ });
    return { pestana: 'ENFOCADA', tabId: t.id };
  }
  var nueva = await chrome.tabs.create({ url: URLS[entorno], active: true });
  if (nueva.windowId) chrome.windows.update(nueva.windowId, { focused: true }).catch(function () {});
  return { pestana: 'ABIERTA', tabId: nueva.id };
}

async function recibirFactura(msg) {
  var f = msg.factura;
  var errores = MigradorFactura.validarFactura(f);
  if (errores.length) return { ok: false, codigo: 'PAQUETE_INVALIDO', errores: errores };
  var st = await leer(['historial', 'pendiente']);
  var hist = st.historial || {};
  var previo = hist[f.cobro_id];
  if (previo && (previo.estado === 'EMITIDA' || previo.estado === 'FINALIZADA') && !msg.forzar) {
    return { ok: false, codigo: 'YA_EMITIDA', seguro: previo.estado === 'EMITIDA', emitida_en: previo.actualizado };
  }
  var p = st.pendiente;
  if (p && p.factura && p.factura.cobro_id !== f.cobro_id && (p.estado === 'LLENANDO' || p.estado === 'LISTA') && !msg.forzar) {
    return { ok: false, codigo: 'OTRA_EN_CURSO', cobro_en_curso: p.factura.cobro_id, receptor: p.factura.receptor.razon };
  }
  var ahora = new Date().toISOString();
  await guardar({ pendiente: { factura: f, estado: 'PENDIENTE', recibido: ahora, actualizado: ahora, mensaje: '' } });
  hist[f.cobro_id] = { estado: 'PENDIENTE', actualizado: ahora, razon: f.receptor.razon, total_gs: f.total_gs };
  await guardar({ historial: recortar(hist) });
  badge('PENDIENTE');
  var r = await enfocarOAbrir();
  return { ok: true, pestana: r.pestana };
}

// Guarda solo los últimos 200 cobros para no crecer sin límite.
function recortar(hist) {
  var ids = Object.keys(hist).sort(function (a, b) { return String(hist[b].actualizado).localeCompare(String(hist[a].actualizado)); });
  var out = {};
  ids.slice(0, 200).forEach(function (k) { out[k] = hist[k]; });
  return out;
}

chrome.runtime.onMessageExternal.addListener(function (msg, sender, responder) {
  if (!origenPermitido(sender.url || sender.origin)) { responder({ ok: false, codigo: 'ORIGEN_NO_PERMITIDO' }); return false; }
  if (!msg || typeof msg !== 'object') { responder({ ok: false, codigo: 'MENSAJE_INVALIDO' }); return false; }
  if (msg.tipo === 'PING') {
    leer(['pendiente', 'entorno']).then(function (st) {
      responder({ ok: true, version: chrome.runtime.getManifest().version, entorno: st.entorno || 'PRODUCCION', ocupado: !!(st.pendiente && /LLENANDO|LISTA/.test(st.pendiente.estado)) });
    });
    return true;
  }
  if (msg.tipo === 'FACTURAR') {
    recibirFactura(msg).then(responder, function (e) { responder({ ok: false, codigo: 'ERROR', mensaje: String(e && e.message || e) }); });
    return true;
  }
  if (msg.tipo === 'ESTADO') {
    leer(['historial']).then(function (st) {
      var h = (st.historial || {})[String(msg.cobro_id || '')];
      responder({ ok: true, estado: h ? h.estado : null });
    });
    return true;
  }
  responder({ ok: false, codigo: 'TIPO_DESCONOCIDO' });
  return false;
});

// Avisos del content script (en e-Kuatia'i) y del popup.
chrome.runtime.onMessage.addListener(function (msg, sender, responder) {
  if (!msg || msg.tipo !== 'ESTADO_LLENADO') return false;
  leer(['pendiente', 'historial']).then(async function (st) {
    var p = st.pendiente;
    var ahora = new Date().toISOString();
    var hist = st.historial || {};
    if (msg.cobro_id && hist[msg.cobro_id]) { hist[msg.cobro_id].estado = msg.estado; hist[msg.cobro_id].actualizado = ahora; }
    if (msg.estado === 'EMITIDA' || msg.estado === 'FINALIZADA' || msg.estado === 'DESCARTADA') {
      await guardar({ pendiente: null, historial: hist }); // reinicio del bucle: queda escuchando la próxima factura
    } else if (p && p.factura && p.factura.cobro_id === msg.cobro_id) {
      p.estado = msg.estado; p.actualizado = ahora; p.mensaje = msg.mensaje || '';
      await guardar({ pendiente: p, historial: hist });
    }
    badge(msg.estado === 'DESCARTADA' ? '' : msg.estado);
    responder({ ok: true });
  });
  return true;
});

chrome.runtime.onInstalled.addListener(function () {
  leer(['entorno', 'obligacion']).then(function (st) { if (!st.entorno) guardar({ entorno: 'PRODUCCION' }); if (!st.obligacion) guardar({ obligacion: '211' }); });
  badge('');
});
