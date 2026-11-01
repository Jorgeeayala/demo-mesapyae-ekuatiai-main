(function () {
  'use strict';
  var URLS = { PRODUCCION: 'https://ekuatia.set.gov.py/ekuatiai/', PRUEBAS: 'https://desa-ekuatia.set.gov.py/ekuatiai/' };
  var NOMBRES = { PENDIENTE: 'Pendiente', LLENANDO: 'Cargando', LISTA: 'Lista para firmar', EMITIDA: 'Emitida', FINALIZADA: 'Formulario cerrado', DESCARTADA: 'Descartada', ERROR: 'Con error' };
  function $(s) { return document.querySelector(s); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function gs(n) { return 'Gs. ' + String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }

  async function pestanaEkuatia() {
    var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    var t = tabs[0];
    if (t && /^https:\/\/(desa-)?ekuatia\.set\.gov\.py\//.test(t.url || '')) return t;
    var otras = await chrome.tabs.query({ url: ['https://ekuatia.set.gov.py/*', 'https://desa-ekuatia.set.gov.py/*'] });
    return otras[0] || null;
  }

  async function pintar() {
    var st = await chrome.storage.local.get(['pendiente', 'historial', 'entorno', 'obligacion']);
    $('#entorno').value = st.entorno || 'PRODUCCION';
    if (document.activeElement !== $('#obligacion')) $('#obligacion').value = st.obligacion || '211';
    var p = st.pendiente;
    if (p && p.factura) {
      var f = p.factura;
      $('#pendiente').className = '';
      $('#pendiente').innerHTML = '<span class="estado">' + esc(NOMBRES[p.estado] || p.estado) + '</span> · ' + esc(f.receptor.razon) + '<br><span class="muted">RUC/CI ' + esc(f.receptor.ruc + (f.receptor.dv ? '-' + f.receptor.dv : '')) + ' · ' + f.items.length + ' ítems · ' + gs(f.total_gs) + '</span>' + (p.mensaje ? '<br><span class="mal">' + esc(p.mensaje) + '</span>' : '');
      $('#descartar').hidden = false;
    } else {
      $('#pendiente').className = 'muted';
      $('#pendiente').textContent = 'Sin facturas pendientes. Esperando la próxima desde la caja.';
      $('#descartar').hidden = true;
    }
    var h = st.historial || {};
    var ids = Object.keys(h).sort(function (a, b) { return String(h[b].actualizado).localeCompare(String(h[a].actualizado)); }).slice(0, 8);
    $('#historial').innerHTML = ids.length ? ids.map(function (id) {
      var x = h[id];
      return '<li><span>' + esc(x.razon) + ' <span class="muted">' + gs(x.total_gs) + '</span></span><span class="' + (x.estado === 'EMITIDA' ? 'ok' : x.estado === 'ERROR' ? 'mal' : 'muted') + '">' + esc(NOMBRES[x.estado] || x.estado) + '</span></li>';
    }).join('') : '<li class="muted">—</li>';
  }

  $('#entorno').onchange = function () { chrome.storage.local.set({ entorno: this.value }); };
  $('#obligacion').onchange = function () { var v = this.value.replace(/[^0-9]/g, ''); this.value = v || '211'; chrome.storage.local.set({ obligacion: v || '211' }); };
  $('#ir').onclick = async function () {
    var t = await pestanaEkuatia();
    if (t) { await chrome.tabs.update(t.id, { active: true }); await chrome.windows.update(t.windowId, { focused: true }); }
    else { var st = await chrome.storage.local.get(['entorno']); chrome.tabs.create({ url: URLS[st.entorno === 'PRUEBAS' ? 'PRUEBAS' : 'PRODUCCION'] }); }
    window.close();
  };
  $('#descartar').onclick = async function () {
    var st = await chrome.storage.local.get(['pendiente']);
    var t = await pestanaEkuatia();
    if (t) chrome.tabs.sendMessage(t.id, { tipo: 'DESCARTAR' }).catch(function () {});
    if (st.pendiente && st.pendiente.factura) await chrome.runtime.sendMessage({ tipo: 'ESTADO_LLENADO', estado: 'DESCARTADA', cobro_id: st.pendiente.factura.cobro_id });
    pintar();
  };
  $('#revisar').onclick = async function () {
    var t = await pestanaEkuatia();
    if (!t) { $('#campos').innerHTML = '<li class="mal">Abrí e-Kuatia\'i primero.</li>'; return; }
    try {
      var r = await chrome.tabs.sendMessage(t.id, { tipo: 'DIAGNOSTICO' });
      $('#campos').innerHTML = r.campos.map(function (c) {
        var ok = c.encontrados > 0;
        return '<li><span>' + esc(c.nombre) + (c.calibrado ? ' <span class="muted">(calibrado)</span>' : '') + '</span><span class="' + (ok ? 'ok' : c.obligatorio ? 'mal' : 'muted') + '">' + (ok ? '✔' : c.obligatorio ? '✘' : '—') + '</span></li>';
      }).join('');
    } catch (e) { $('#campos').innerHTML = '<li class="mal">Recargá la pestaña de e-Kuatia\'i e intentá de nuevo.</li>'; }
  };
  $('#calibrar').onclick = async function () {
    var t = await pestanaEkuatia();
    if (!t) { $('#campos').innerHTML = '<li class="mal">Abrí “Nueva factura” en e-Kuatia\'i primero.</li>'; return; }
    await chrome.tabs.update(t.id, { active: true });
    chrome.tabs.sendMessage(t.id, { tipo: 'CALIBRAR' }).catch(function () {});
    window.close();
  };
  $('#borrar-mapa').onclick = async function () { await chrome.storage.local.remove('mapa'); $('#campos').innerHTML = '<li class="muted">Calibración borrada: se usan las pistas automáticas.</li>'; };

  chrome.storage.onChanged.addListener(pintar);
  pintar();
})();
