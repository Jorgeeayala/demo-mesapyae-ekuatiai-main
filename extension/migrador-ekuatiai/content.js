/*
 * Motor de relleno en e-Kuatia'i (content script).
 * - Lee la factura pendiente que dejó el service worker y rellena receptor e ítems del formulario "Nueva factura".
 * - Simula el clic en "Buscar" del RUC para que el portal traiga la razón social oficial.
 * - Se detiene antes de firmar: el PIN del certificado y el botón de emitir son siempre de una persona.
 * - Al ver el mensaje de éxito (o la pantalla limpia) avisa y queda escuchando la próxima factura.
 * Nunca toca el inicio de sesión ni hace peticiones a los servidores de la DNIT.
 */
(function () {
  'use strict';
  if (window.__migradorEkuatiai) return;
  window.__migradorEkuatiai = true;

  var C = window.MigradorCampos;
  var S = { ocupado: false, abortar: false, mapa: {}, actual: null, vigilando: null, calibrando: false };
  var banner = null;

  function dormir(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function gs(n) { return 'Gs. ' + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  function avisar(estado, cobroId, mensaje) {
    try { chrome.runtime.sendMessage({ tipo: 'ESTADO_LLENADO', estado: estado, cobro_id: cobroId, mensaje: mensaje || '' }); } catch (e) { /* extensión recargada */ }
  }

  // ---------- Banner de estado ----------
  var tOcultar = null;
  function mostrar(html, clase, botones) {
    clearTimeout(tOcultar);
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'migrador-ekuatiai';
      document.documentElement.appendChild(banner);
    }
    banner.className = clase || '';
    banner.innerHTML = '<div class="mg-logo">Mesa Pya\'e → e-Kuatia\'i</div><div class="mg-txt">' + html + '</div><div class="mg-btns"></div>';
    var cont = banner.querySelector('.mg-btns');
    (botones || []).forEach(function (b) {
      var el = document.createElement('button'); el.type = 'button'; el.textContent = b.txt; el.onclick = b.fn; cont.appendChild(el);
    });
  }
  function ocultar() { if (banner) { banner.remove(); banner = null; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // ---------- Escritura compatible con AngularJS ----------
  function escribir(el, valor) {
    valor = String(valor);
    el.focus();
    if (el.tagName === 'SELECT') return elegir(el, valor);
    var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, valor);
    ['input', 'change', 'keyup'].forEach(function (t) { el.dispatchEvent(new Event(t, { bubbles: true })); });
    el.dispatchEvent(new Event('blur', { bubbles: false }));
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    return true;
  }
  function elegir(sel, iva) {
    var n = Number(iva);
    var re = n === 0 ? /exent|^\s*0\s*%?\s*$/i : new RegExp('(^|[^0-9])' + n + '\\s*%?([^0-9]|$)');
    var op = [].filter.call(sel.options, function (o) { return re.test(o.textContent) || re.test(o.value); })[0];
    if (!op) return false;
    sel.value = op.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    sel.dispatchEvent(new Event('blur', { bubbles: false }));
    return true;
  }
  function mismoValor(a, b) {
    if (String(a).trim() === String(b).trim()) return true;
    var na = Number(String(a).replace(/\./g, '').replace(',', '.')), nb = Number(b);
    return String(b).trim() !== '' && !isNaN(nb) && !isNaN(Number(a)) && Number(a) === nb || (!isNaN(na) && na === nb);
  }
  // ui-select de AngularJS: abrir, escribir en su buscador, tocar la opción. Devuelve true si quedó elegida.
  function vistas() { var v = S.opcionesVistas; S.opcionesVistas = null; return v && v.length ? ' <small>(opciones: ' + esc(v.join(' · ')) + ')</small>' : v ? ' <small>(la lista no se abrió)</small>' : ''; }
  async function elegirUiSelect(cont, re, buscar) {
    S.opcionesVistas = null;
    var multiple = cont.matches('.ui-select-multiple');
    var ya = function () { return multiple ? C.elegidosUiSelect(cont).some(function (t) { return re.test(t); }) : re.test(C.textoUiSelect(cont)); };
    if (ya()) return true; // ya está elegido
    // El ng-click de ui-select está en el botón .ui-select-toggle (simple) o en su buscador (múltiple).
    var abrir = (multiple && cont.querySelector('input.ui-select-search')) || cont.querySelector('.ui-select-toggle') || cont.querySelector('.ui-select-match-text') || cont.querySelector('.ui-select-match') || cont;
    clic(abrir);
    var filas = function () { return [].slice.call(cont.querySelectorAll('.ui-select-choices-row')).filter(C.visible); };
    await esperar(function () { return filas().length || cont.querySelector('input.ui-select-search'); }, 2500);
    var q = cont.querySelector('input.ui-select-search');
    if (q && buscar) { escribir(q, buscar); await dormir(250); }
    var fila = await esperar(function () { return filas().filter(function (r) { return re.test(r.textContent.replace(/\s+/g, ' ').trim()); })[0]; }, 2500);
    if (!fila && q) { escribir(q, ''); await dormir(250); fila = filas().filter(function (r) { return re.test(r.textContent.replace(/\s+/g, ' ').trim()); })[0]; }
    if (!fila) {
      S.opcionesVistas = filas().map(function (r) { return r.textContent.replace(/\s+/g, ' ').trim(); }).slice(0, 8);
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
      return false;
    }
    clic(fila.querySelector('.ui-select-choices-row-inner, a, span') || fila);
    var ok = !!(await esperar(ya, 2000));
    if (multiple) document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true })); // cierra la lista
    return ok;
  }
  function reIva(iva) { var n = Number(iva); return n === 0 ? /exent/i : new RegExp('(^|[^0-9])' + n + '\\s*%?([^0-9]|$)'); }

  function clic(el) {
    ['mousedown', 'mouseup'].forEach(function (t) { el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })); });
    el.click();
  }
  function campo(id) { return C.CAMPOS.filter(function (c) { return c.id === id; })[0]; }
  // Campos de ítem: la última fila; el resto: el primero que coincide (ej. RUC antes que DV).
  // Campos de ítem en todo el documento: la última fila. Dentro de una fila, o para el resto: el primero
  // que coincide (así "Precio" no termina en una casilla posterior de la fila, ni el RUC en la del DV).
  function uno(id, raiz) { var c = campo(id), l = C.buscarTodos(raiz || document, c, S.mapa); return l.length ? (c.item && !raiz ? l[l.length - 1] : l[0]) : null; }
  function todos(id, raiz) { return C.buscarTodos(raiz || document, campo(id), S.mapa); }

  async function esperar(fn, ms) {
    var fin = Date.now() + ms;
    while (Date.now() < fin) {
      if (S.abortar) throw new Error('Detenido por la persona.');
      var v = fn(); if (v) return v;
      await dormir(200);
    }
    return null;
  }

  // ---------- Relleno ----------
  async function llenar(f) {
    S.ocupado = true; S.abortar = false; S.actual = f;
    var avisos = [];
    try {
      mostrar('Esperando el formulario <b>Nueva factura</b>…<br><small>Si todavía no entraste, iniciá sesión a mano y abrí “Nueva factura”. Los datos se cargan solos.</small><br><small>' + esc(f.receptor.razon) + ' · ' + gs(f.total_gs) + '</small>', 'mg-espera', [{ txt: 'Descartar', fn: descartar }]);
      var ruc = await esperar(function () { return uno('ruc'); }, 30 * 60 * 1000);
      if (!ruc) throw new Error('No apareció el formulario de factura.');
      avisar('LLENANDO', f.cobro_id);
      mostrar('Cargando datos del receptor…', 'mg-trabajo', [{ txt: 'Detener', fn: detener }]);

      var r = f.receptor;
      var dv = uno('dv');
      escribir(ruc, r.ruc);
      if (dv && r.dv) escribir(dv, r.dv);
      var razon = uno('razon');
      var razonAntes = razon ? razon.value : '';
      var buscar = uno('buscarRuc');
      if (buscar && r.tipo === 'RUC') { await dormir(150); clic(buscar); }
      if (razon && (r.tipo === 'RUC' || razon.readOnly || razon.disabled)) {
        // El portal consulta el RUC (con "Buscar" o al salir del DV) y completa la razón social oficial.
        await esperar(function () { var z = uno('razon'); return z && z.value && z.value !== razonAntes ? z : null; }, 8000);
      }
      razon = uno('razon');
      var soloLectura = razon && (razon.readOnly || razon.disabled);
      if (razon && !razon.value && !soloLectura) escribir(razon, r.razon);
      else if (razon && !razon.value) avisos.push('La DNIT no devolvió la razón social de ese RUC: revisá RUC y DV.');
      else if (razon && razon.value.trim().toUpperCase() !== r.razon.trim().toUpperCase()) avisos.push('La DNIT devolvió la razón social “' + esc(razon.value) + '” (en la caja figura “' + esc(r.razon) + '”).');
      if (!razon) avisos.push('No encontré el campo de razón social.');
      var em = uno('email');
      if (em && r.email && !em.value) escribir(em, r.email);
      await cargarObligacion(avisos);

      for (var i = 0; i < f.items.length; i++) {
        if (S.abortar) throw new Error('Detenido por la persona.');
        mostrar('Cargando ítem ' + (i + 1) + ' de ' + f.items.length + '…', 'mg-trabajo', [{ txt: 'Detener', fn: detener }]);
        await cargarItem(f.items[i], i, avisos);
      }

      await cargarPago(f, avisos);

      avisar('LISTA', f.cobro_id);
      mostrar('<b>Datos cargados ✔</b> ' + f.items.length + ' ítem' + (f.items.length === 1 ? '' : 's') + ' · total ' + gs(f.total_gs) +
        '<br>Revisá el formulario, ingresá <b>tu PIN</b> y emití la factura.' +
        (avisos.length ? '<ul>' + avisos.map(function (a) { return '<li>' + a + '</li>'; }).join('') + '</ul>' : ''),
        avisos.length ? 'mg-aviso' : 'mg-listo', [{ txt: 'Descartar', fn: descartar }]);
      vigilarFin(f);
    } catch (e) {
      if (S.abortar) { mostrar('Relleno detenido. Podés completar a mano o descartar.', 'mg-aviso', [{ txt: 'Reintentar', fn: reintentar }, { txt: 'Descartar', fn: descartar }]); avisar('ERROR', f.cobro_id, 'Detenido'); }
      else { mostrar('No pude completar: ' + esc(e.message) + '<br><small>Si la DNIT cambió la pantalla, usá “Calibrar campos” en el ícono de la extensión.</small>', 'mg-error', [{ txt: 'Reintentar', fn: reintentar }, { txt: 'Descartar', fn: descartar }]); avisar('ERROR', f.cobro_id, e.message); }
    } finally {
      S.ocupado = false;
    }
  }

  // Dos formas de carga de ítems que usan los formularios:
  //  - "tabla": cada ítem es una fila (tr / ng-repeat / ventana) que aparece al tocar "Agregar".
  //  - "entrada fija": casillas únicas que se completan y "Agregar" las pasa a la tabla (y las limpia).
  function esFila(el) { return !!(el && el.closest('tr, [ng-repeat], [data-ng-repeat], .modal-content')); }

  async function cargarItem(it, i, avisos) {
    function vacia() { var l = todos('descripcion'); var u = l[l.length - 1]; return u && !u.value ? u : null; }
    var desc = vacia();
    var ag = uno('agregarItem');
    var fija = !!(desc && !esFila(desc) && ag);
    if (!desc && !fija) {
      var antes = todos('descripcion').length;
      if (!ag) throw new Error('No encontré el botón para agregar ítems.');
      clic(ag);
      desc = await esperar(function () { return todos('descripcion').length > antes ? vacia() : null; }, 5000);
      if (!desc) throw new Error('No apareció la fila del ítem ' + (i + 1) + '.');
    }
    var fila = fija ? document : (desc.closest('tr, [ng-repeat], [data-ng-repeat], .modal-content') || document);
    function enFila(id) { return uno(id, fila) || uno(id); }

    var cantidad = it.cantidad, precio = it.precio_unit_gs, texto = it.descripcion;
    var dEl = it.descuento_gs ? enFila('descuento') : null;
    if (it.descuento_gs && !dEl) {
      // Sin casilla de descuento: se carga el importe neto en una sola línea para que el total coincida con lo cobrado.
      precio = it.cantidad * it.precio_unit_gs - it.descuento_gs; cantidad = 1;
      if (it.cantidad > 1) texto = (it.cantidad + ' × ' + it.descripcion).slice(0, 120);
      avisos.push('Ítem ' + (i + 1) + ': descuento aplicado al precio (no encontré la casilla de descuento).');
    }
    escribir(desc, texto);
    var c = enFila('cantidad'); if (!c) throw new Error('No encontré la cantidad del ítem.'); escribir(c, cantidad);
    var p = enFila('precio'); if (!p) throw new Error('No encontré el precio del ítem.'); escribir(p, precio);
    if (dEl) escribir(dEl, it.descuento_gs);
    var iva = enFila('iva');
    var ivaTxt = it.iva ? it.iva + '%' : 'exenta';
    if (!iva) avisos.push('Ítem ' + (i + 1) + ': no encontré la tasa de IVA; revisala (' + ivaTxt + ').');
    else if (iva.matches('.ui-select-container') ? !(await elegirUiSelect(iva, reIva(it.iva), it.iva ? 'IVA ' + it.iva : 'Exent')) : !escribir(iva, it.iva)) avisos.push('Ítem ' + (i + 1) + ': no pude elegir IVA ' + ivaTxt + '; revisalo.' + vistas());
    await dormir(120);
    // Verificación: AngularJS a veces vuelve a dibujar la fila (ng-change → calculototal). Se reescribe lo que no quedó.
    await dormir(150);
    var esperado = [[desc, texto], [c, cantidad], [p, precio]].concat(dEl ? [[dEl, it.descuento_gs]] : []);
    for (var k = 0; k < esperado.length; k++) {
      var par = esperado[k], el = par[0];
      if (!el.isConnected) el = enFila(['descripcion', 'cantidad', 'precio', 'descuento'][k]);
      if (el && !mismoValor(el.value, par[1])) { escribir(el, par[1]); await dormir(120); }
      if (!el || !mismoValor(el.value, par[1])) avisos.push('Ítem ' + (i + 1) + ': revisá ' + ['la descripción', 'la cantidad', 'el precio', 'el descuento'][k] + ' (debía ser ' + par[1] + ').');
    }
    var conf = uno('confirmarItem');
    if (fija) {
      clic(conf || ag);
      if (!(await esperar(function () { var d = uno('descripcion'); return d && !d.value; }, 4000))) throw new Error('El ítem ' + (i + 1) + ' no se agregó a la tabla.');
    } else if (conf && fila !== document && fila.matches('.modal-content')) {
      clic(conf); await dormir(400);
    }
  }

  // Tipo de obligación afectada (ui-select múltiple). Por defecto 211 - IVA; se cambia en el popup de la extensión.
  async function cargarObligacion(avisos) {
    var st = await chrome.storage.local.get(['obligacion']);
    var cod = String(st.obligacion || '211').trim();
    if (!cod || cod === '-') return;
    var cont = uno('obligacion');
    if (!cont) { avisos.push('No encontré “Tipo de obligación”: elegí <b>' + esc(cod) + '</b> a mano.'); return; }
    mostrar('Eligiendo obligación ' + esc(cod) + '…', 'mg-trabajo', [{ txt: 'Detener', fn: detener }]);
    var re = new RegExp('^\\s*' + cod.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
    var ok = cont.matches('.ui-select-container') ? await elegirUiSelect(cont, re, cod) : escribirLista(cont, { re: re });
    if (!ok) avisos.push('No pude elegir la obligación <b>' + esc(cod) + '</b>; elegila a mano.');
  }

  // Pagos: uno por cada medio cobrado en la caja. En e-Kuatia'i cada pago es una fila con su "Tipo de Pago";
  // "Agregar" (emitir.agregarPago()) crea la fila siguiente. Si el botón pasara el pago a una tabla en vez de
  // crear una fila, también funciona: se detecta porque no aparece una lista nueva.
  async function cargarPago(f, avisos) {
    var pagos = [];
    (f.pagos || []).forEach(function (x) { // un pago por medio (si se repite, se suma)
      if (!x || !x.medio) return;
      var ya = pagos.filter(function (y) { return y.medio === x.medio; })[0];
      if (ya) ya.monto_gs += x.monto_gs; else pagos.push({ medio: x.medio, monto_gs: x.monto_gs });
    });
    if (!pagos.length) return;
    var agregar = uno('agregarPago');
    if (!agregar) pagos = [pagos.slice().sort(function (a, b) { return b.monto_gs - a.monto_gs; })[0]];
    var listas = function () { return C.buscarTodos(document, C.CAMPOS.filter(function (c) { return c.id === 'tipoPago'; })[0], S.mapa).filter(function (el) { return el.matches('select, .ui-select-container'); }); };
    var modoTabla = false, cargados = [];
    for (var k = 0; k < pagos.length; k++) {
      if (S.abortar) throw new Error('Detenido por la persona.');
      var x = pagos[k], m = C.medioEkuatia(x.medio), monto = x.monto_gs;
      mostrar('Pago ' + (k + 1) + ' de ' + pagos.length + ': ' + esc(m.txt) + ' ' + gs(monto) + '…', 'mg-trabajo', [{ txt: 'Detener', fn: detener }]);
      if (k > 0 && agregar && !modoTabla) {
        var antes = listas().length;
        clic(uno('agregarPago') || agregar);
        if (!(await esperar(function () { return listas().length > antes; }, 2500))) modoTabla = true;
      }
      var l = listas(), cont = l[l.length - 1];
      if (!cont) { avisos.push('No encontré “Tipo de Pago”: cargá ' + esc(m.txt) + ' ' + gs(monto) + ' a mano.'); continue; }
      var ok = cont.matches('.ui-select-container') ? await elegirUiSelect(cont, m.re, m.txt) : escribirLista(cont, m);
      if (!ok) { avisos.push('No pude elegir el tipo de pago <b>' + esc(m.txt) + '</b> (' + gs(monto) + '); cargalo a mano.' + vistas()); continue; }
      var lm = todos('montoPago'), cm = lm[lm.length - 1];
      if (cm) { await dormir(120); escribir(cm, monto); }
      if (modoTabla) { clic(uno('agregarPago') || agregar); await dormir(500); }
      cargados.push(m.txt + ' ' + gs(monto));
    }
    if (!agregar && (f.pagos || []).length > 1) avisos.push('Se cobró con varios medios: cargué ' + esc(cargados.join('')) + '; agregá los otros a mano.');
  }
  function escribirLista(sel, m) {
    if (sel.tagName !== 'SELECT') return false;
    var op = [].filter.call(sel.options, function (o) { return m.re.test(o.textContent.trim()); })[0];
    if (!op) return false;
    sel.value = op.value; sel.dispatchEvent(new Event('change', { bubbles: true })); return true;
  }

  // ---------- Fin del ciclo: éxito o pantalla limpia ----------
  var RE_EXITO = /(factura|documento|comprobante|\bDE\b)[^.\n]{0,80}(emitid|generad|aprobad|registrad|firmad)|(emitid|generad|aprobad)[^.\n]{0,40}(correctamente|con [ée]xito)|\bCDC\b[^0-9]{0,10}[0-9 ]{44,60}/i;
  function vigilarFin(f) {
    if (S.vigilando) S.vigilando.disconnect();
    var obs = new MutationObserver(function (muts) {
      var nuevo = '';
      muts.forEach(function (m) { [].forEach.call(m.addedNodes, function (n) { if (n !== banner && !(banner && banner.contains(n))) nuevo += ' ' + (n.textContent || ''); }); });
      if (RE_EXITO.test(nuevo)) return fin(f, 'EMITIDA');
      var ruc = uno('ruc'); // si el formulario se va (vista previa, firma) se sigue esperando
      if (ruc && !ruc.value && todos('descripcion').every(function (d) { return !d.value; })) return fin(f, 'FINALIZADA');
    });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
    S.vigilando = obs;
  }
  function fin(f, estado) {
    if (S.vigilando) { S.vigilando.disconnect(); S.vigilando = null; }
    avisar(estado, f.cobro_id);
    S.actual = null;
    mostrar(estado === 'EMITIDA' ? '<b>Factura emitida ✔</b> Volvé a la caja para facturar el siguiente cobro.' : 'Formulario cerrado. Quedo esperando la próxima factura.', 'mg-listo', [{ txt: 'Cerrar', fn: ocultar }]);
    tOcultar = setTimeout(ocultar, 12000);
  }

  function detener() { S.abortar = true; }
  function descartar() {
    S.abortar = true;
    if (S.vigilando) { S.vigilando.disconnect(); S.vigilando = null; }
    if (S.actual) avisar('DESCARTADA', S.actual.cobro_id);
    S.actual = null; ocultar();
  }
  function reintentar() { revisarPendiente(true); }

  async function revisarPendiente(forzar) {
    if (S.ocupado || S.calibrando) return;
    var st = await chrome.storage.local.get(['pendiente', 'mapa']);
    S.mapa = st.mapa || {};
    var p = st.pendiente;
    if (!p || !p.factura) return;
    if (p.estado === 'PENDIENTE' || forzar || p.estado === 'ERROR') return llenar(p.factura);
    if (p.estado === 'LISTA' || p.estado === 'LLENANDO') {
      // Recarga de la página con una factura ya cargada: se ofrece volver a cargarla.
      mostrar('Hay una factura de <b>' + esc(p.factura.receptor.razon) + '</b> (' + gs(p.factura.total_gs) + ') sin emitir.', 'mg-aviso', [{ txt: 'Volver a cargar', fn: reintentar }, { txt: 'Descartar', fn: function () { S.actual = p.factura; descartar(); } }]);
    }
  }

  // ---------- Calibración ----------
  async function calibrar() {
    if (S.ocupado) return;
    S.calibrando = true;
    var st = await chrome.storage.local.get(['mapa']);
    var mapa = Object.assign({}, st.mapa || {});
    var lista = C.CAMPOS.slice(), i = 0, marcado = null;
    function paso() {
      if (i >= lista.length) return terminar(true);
      var c = lista[i];
      mostrar('<b>Calibrar (' + (i + 1) + '/' + lista.length + ')</b>: hacé clic en <b>' + esc(c.nombre) + '</b>' + (c.obligatorio ? '' : ' <small>(si no existe, “Saltar”)</small>') +
        (c.item ? '<br><small>Si no hay ninguna fila de ítem, primero agregá una a mano (antes de calibrar) y luego borrala.</small>' : '') +
        (c.tipo === 'boton' ? '<br><small>El clic no se ejecuta: solo se registra.</small>' : ''),
        'mg-calibra', [{ txt: 'Saltar', fn: function () { i++; paso(); } }, { txt: 'Cancelar', fn: function () { terminar(false); } }]);
    }
    function sobre(e) {
      if (banner && banner.contains(e.target)) return;
      if (marcado) marcado.classList.remove('mg-marca');
      marcado = e.target.closest('.ui-select-container') || e.target.closest('input, select, textarea, button, a, [role=button]');
      if (marcado) marcado.classList.add('mg-marca');
    }
    function bloquear(e) {
      if (banner && banner.contains(e.target)) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.type !== 'click') return;
      var el = (lista[i].tipo === 'lista' && e.target.closest('.ui-select-container')) || e.target.closest('input, select, textarea, button, a, [role=button]');
      if (!el) return;
      mapa[lista[i].id] = C.selectorDe(el);
      i++; paso();
    }
    function terminar(guardar) {
      ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'click'].forEach(function (t) { window.removeEventListener(t, bloquear, true); });
      window.removeEventListener('mouseover', sobre, true);
      if (marcado) marcado.classList.remove('mg-marca');
      S.calibrando = false;
      if (guardar) chrome.storage.local.set({ mapa: mapa }).then(function () { S.mapa = mapa; mostrar('Calibración guardada ✔', 'mg-listo', [{ txt: 'Cerrar', fn: ocultar }]); tOcultar = setTimeout(ocultar, 5000); });
      else ocultar();
    }
    ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'click'].forEach(function (t) { window.addEventListener(t, bloquear, true); });
    window.addEventListener('mouseover', sobre, true);
    paso();
  }

  // Revisión rápida desde el popup: qué campos se encuentran en la pantalla actual.
  async function diagnostico() {
    var st = await chrome.storage.local.get(['mapa']);
    S.mapa = st.mapa || {};
    return C.CAMPOS.map(function (c) { return { id: c.id, nombre: c.nombre, encontrados: todos(c.id).length, calibrado: !!S.mapa[c.id], obligatorio: !!c.obligatorio }; });
  }

  chrome.runtime.onMessage.addListener(function (msg, _s, responder) {
    if (!msg) return false;
    if (msg.tipo === 'LLENAR') { revisarPendiente(false); responder({ ok: true }); return false; }
    if (msg.tipo === 'CALIBRAR') { calibrar(); responder({ ok: true }); return false; }
    if (msg.tipo === 'DIAGNOSTICO') { diagnostico().then(function (d) { responder({ ok: true, campos: d }); }); return true; }
    if (msg.tipo === 'DESCARTAR') { descartar(); responder({ ok: true }); return false; }
    return false;
  });

  revisarPendiente(false);
})();
