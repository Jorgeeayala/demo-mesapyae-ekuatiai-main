/* Render y acciones de comandas (tickets) compartidos por Pedidos, Cocina y Cajas. */
(function (w) {
  'use strict';
  var M = w.Mesa, esc = M.esc, gs = M.gs;
  var BTN = {
    aceptar: ['Aceptar y enviar a cocina', 'ok'], rechazar: ['Rechazar', 'danger'], entregar: ['Marcar entregado', 'ok'],
    cancelar: ['Cancelar comanda', 'danger small'], empezar: ['Empezar', 'warn big'], listo: ['¡Listo!', 'ok big'], volver: ['Deshacer', 'small']
  };
  function destino(p) {
    if (p.modo === 'SALON') return esc(p.mesa || p.mesa_id) + (p.mesa_antes ? ' <span class="chip mostaza" data-antes>antes ' + esc(p.mesa_antes) + '</span>' : '');
    return (p.modo === 'TAKEAWAY' ? 'Para llevar' : 'Mostrador') + (p.alias ? ' · ' + esc(p.alias) : '');
  }
  // Última versión de cada pedido mostrado, para poder imprimir su comanda.
  var VISTOS = {};
  function ticket(p, o) {
    o = o || {};
    VISTOS[p.pedido_id] = { p: p, precios: o.precios !== false, estacion: o.estacion ? o.estacion.nombre : '' };
    var desdeTs = p.estado === 'PENDIENTE' ? p.creado_en : p.estado === 'LISTO' ? p.listo_en : (p.aceptado_en || p.creado_en);
    var items = p.items.map(function (i) {
      return '<div class="ticket-i' + (i.anulado ? ' anulado' : '') + '"><div class="q">' + i.cantidad + '×</div><div class="grow"><div class="nm">' + esc(i.nombre) + (i.persona_nombre ? ' <span class="quien">· ' + esc(i.persona_nombre) + '</span>' : '') + '</div>' +
        (i.opciones ? '<div class="op">' + esc(i.opciones) + '</div>' : '') +
        (i.observacion ? '<div class="nota">' + esc(i.observacion) + '</div>' : '') +
        (i.anulado ? '<div class="small" style="color:var(--vino)">Anulado: ' + esc(i.anulado_motivo) + '</div>' : '') + '</div>' +
        (o.precios === false ? '' : '<div class="small num muted">' + gs(i.total_gs) + '</div>') +
        (o.anularItems && !i.anulado ? '<button class="btn ghost small" data-anular="' + esc(i.item_id) + '" title="Anular ítem" aria-label="Anular ' + esc(i.nombre) + '">✕</button>' : '') + '</div>';
    }).join('');
    var et = o.estacion || null; // pantalla de una estación: las acciones marcan solo su parte
    var acts = (o.acciones || []).map(function (a) {
      return '<button class="btn ' + BTN[a][1] + (a === 'cancelar' || a === 'volver' ? '' : ' grow') + '" data-act="' + a + '" data-id="' + esc(p.pedido_id) + '" data-desde="' + esc(et ? et.estado : p.estado) + '" data-num="' + esc(p.numero) + '"' +
        (et ? ' data-est="' + esc(et.id) + '"' : '') + '>' + BTN[a][0] + '</button>';
    }).join('');
    // Pedido repartido en varias estaciones: cómo va cada una (en "Todas", en el mozo y en la caja).
    var partes = !et && p.estaciones && p.estaciones.length > 1 && ['ACEPTADO', 'EN_PREPARACION', 'LISTO'].indexOf(p.estado) >= 0 ?
      '<div class="row wrap est-partes" style="gap:4px;margin-bottom:6px">' + p.estaciones.map(function (x) {
        return '<span class="chip ' + (x.estado === 'LISTO' ? 'oliva' : x.estado === 'EN_PREPARACION' ? 'mostaza' : '') + '" data-est-chip="' + esc(x.id) + '">' + esc(x.nombre) + (x.estado === 'LISTO' ? ' ✓' : x.estado === 'EN_PREPARACION' ? ' · preparando' : ' · en espera') + '</span>';
      }).join('') + '</div>' : '';
    return '<article class="ticket" data-ticket="' + esc(p.pedido_id) + '">' +
      '<div class="ticket-h"><span class="tn">' + esc(p.numero) + '</span><span class="tw grow">' + destino(p) + '</span>' +
      (p.origen === 'QR' ? '<span class="chip azul">QR</span>' : '') + (o.cocina ? '' : M.estadoChip(p.estado)) +
      (o.imprimir === false ? '' : '<button class="btn ghost iconbtn small no-print" data-imprimir="' + esc(p.pedido_id) + '" title="Imprimir comanda" aria-label="Imprimir comanda ' + esc(p.numero) + '">🖨</button>') +
      (p.estado !== 'ENTREGADO' && p.estado !== 'CANCELADO' ? M.elapsedChip(desdeTs, o.warn || 10, o.danger || 20) : '<span class="small muted">' + M.hora(p.entregado_en || p.cancelado_en) + '</span>') + '</div>' +
      '<div class="ticket-b">' + partes + (et ? '<div class="small muted" style="margin-bottom:4px">' + esc(et.nombre) + '</div>' : '') + items + (p.observacion ? '<div class="nota">Pedido: ' + esc(p.observacion) + '</div>' : '') +
      (p.estado === 'CANCELADO' ? '<div class="small" style="color:var(--vino);margin-top:6px">Cancelado: ' + esc(p.motivo_cancelacion) + '</div>' : '') +
      (p.whatsapp && !o.cocina ? '<div class="row wa-row" style="margin-top:8px;gap:8px;align-items:center"><span class="small">📱 ' + esc(M.waTxt(p.whatsapp)) + '</span>' +
        (p.estado !== 'CANCELADO' ? '<a class="btn small ' + (p.estado === 'LISTO' ? 'ok' : '') + '" data-wa-link target="_blank" rel="noopener" href="' + esc(M.waLink(p)) + '">Avisar por WhatsApp</a>' : '') + '</div>' : '') +
      '<div class="small muted" style="margin-top:6px">Recibido ' + M.hora(p.creado_en) + (p.creado_por && p.creado_por !== 'PUBLICO' ? ' · por ' + esc(p.creado_por) : ' · cliente') +
      (o.precios === false ? '' : ' · <strong class="num">' + gs(p.total_gs) + '</strong>') + '</div></div>' +
      (acts ? '<div class="ticket-f">' + acts + '</div>' : '') + '</article>';
  }

  // Comanda impresa: formato de impresora de tickets (58 u 80 mm), también sirve en A4.
  function comandaHtml(p, precios, estacion) {
    var dest = p.modo === 'SALON' ? esc(p.mesa || p.mesa_id) + (p.mesa_antes ? ' (antes ' + esc(p.mesa_antes) + ')' : '')
      : (p.modo === 'TAKEAWAY' ? 'PARA LLEVAR' : 'MOSTRADOR') + (p.alias ? ' · ' + esc(p.alias) : '');
    var items = p.items.map(function (i) {
      return '<div class="ci' + (i.anulado ? ' an' : '') + '"><b>' + i.cantidad + ' × ' + esc(i.nombre) + '</b>' + (precios && !i.anulado ? '<span>' + gs(i.total_gs) + '</span>' : '') +
        (i.persona_nombre ? '<div>Para: ' + esc(i.persona_nombre) + '</div>' : '') +
        (i.opciones ? '<div>' + esc(i.opciones) + '</div>' : '') +
        (i.observacion ? '<div class="obs">» ' + esc(i.observacion) + '</div>' : '') +
        (i.anulado ? '<div>ANULADO</div>' : '') + '</div>';
    }).join('');
    return '<div class="cp-neg">' + esc(M.negocio || '') + '</div>' +
      '<div class="cp-num">' + esc(p.numero) + '</div><div class="cp-dest">' + dest + '</div>' + (estacion ? '<div class="cp-dest">' + esc(estacion).toUpperCase() + '</div>' : '') +
      (p.estado === 'CANCELADO' ? '<div class="cp-dest">*** CANCELADO ***</div>' : '') +
      '<div class="cp-meta">Recibido ' + M.fechaHora(p.creado_en) + (p.origen === 'QR' ? ' · QR' : '') + (p.creado_por && p.creado_por !== 'PUBLICO' ? ' · ' + esc(p.creado_por) : '') + '</div><hr>' + items +
      (p.observacion ? '<hr><div class="obs">Pedido: ' + esc(p.observacion) + '</div>' : '') +
      (precios ? '<hr><div class="ci"><b>TOTAL</b><span><b>' + gs(p.total_gs) + '</b></span></div>' : '') +
      // Ticket para llevar que se lleva el cliente (impreso desde mozo o caja): pie del club en Premium.
      (precios && p.modo === 'TAKEAWAY' && p.estado !== 'CANCELADO' ? M.pieClub(false) : '') +
      '<hr><div class="cp-meta">Impreso ' + M.fechaHora(new Date().toISOString()) + (precios && p.modo === 'TAKEAWAY' ? '' : ' · Comanda interna') + '</div>';
  }
  function imprimir(id) {
    var v = VISTOS[id]; if (!v) return;
    var old = document.getElementById('comanda-print'); if (old) old.remove();
    var div = document.createElement('div'); div.id = 'comanda-print'; div.innerHTML = comandaHtml(v.p, v.precios, v.estacion);
    document.body.appendChild(div); document.body.classList.add('imprimiendo');
    function fin() { document.body.classList.remove('imprimiendo'); div.remove(); w.removeEventListener('afterprint', fin); }
    w.addEventListener('afterprint', fin);
    w.print();
    setTimeout(function () { if (document.body.contains(div)) fin(); }, 60000);
  }

  var MAP = { aceptar: 'ACEPTADO', entregar: 'ENTREGADO', empezar: 'EN_PREPARACION', listo: 'LISTO' };
  function handleClick(e, after) {
    var pr = e.target.closest('[data-imprimir]');
    if (pr) { imprimir(pr.getAttribute('data-imprimir')); return; }
    var b = e.target.closest('[data-act]');
    if (b) {
      var a = b.getAttribute('data-act'), id = b.getAttribute('data-id'), desde = b.getAttribute('data-desde'), num = b.getAttribute('data-num'), est = b.getAttribute('data-est');
      if (est && (a === 'empezar' || a === 'listo' || a === 'volver')) {
        b.disabled = true;
        var to = a === 'empezar' ? 'EN_PREPARACION' : a === 'listo' ? 'LISTO' : (desde === 'LISTO' ? 'EN_PREPARACION' : 'NUEVO');
        return go('order.station', { pedido_id: id, estacion: est, estado: to, desde: desde }, a === 'listo' ? num + ' listo' : null, after, b);
      }
      if (MAP[a]) { b.disabled = true; return go('order.state', { pedido_id: id, estado: MAP[a], desde: desde }, a === 'listo' ? num + ' listo' : null, after, b); }
      if (a === 'volver') { b.disabled = true; return go('order.state', { pedido_id: id, estado: desde === 'LISTO' ? 'EN_PREPARACION' : 'ACEPTADO', desde: desde }, null, after, b); }
      if (a === 'rechazar' || a === 'cancelar') {
        var auth = !(a === 'rechazar' || desde === 'PENDIENTE');
        return M.pedirMotivo((a === 'rechazar' ? 'Rechazar ' : 'Cancelar ') + num, { auth: auth, ok: a === 'rechazar' ? 'Rechazar' : 'Cancelar comanda', texto: auth ? 'Cancelar una comanda ya aceptada requiere autorización del encargado.' : '' })
          .then(function (r) { if (r) go('order.cancel', { pedido_id: id, motivo: r.motivo, autorizacion: r.autorizacion }, num + ' cancelado', after); });
      }
    }
    var an = e.target.closest('[data-anular]');
    if (an) {
      return M.pedirMotivo('Anular ítem', { auth: true, ok: 'Anular', texto: 'Anular un ítem requiere autorización del encargado. Queda registrado.' })
        .then(function (r) { if (r) go('order.voidItem', { item_id: an.getAttribute('data-anular'), motivo: r.motivo, autorizacion: r.autorizacion }, 'Ítem anulado', after); });
    }
  }
  function go(action, payload, okMsg, after, btn) {
    return M.call(action, payload, { retries: 1 }).then(function () { if (okMsg) M.toast(okMsg, 'ok'); if (after) after(); }, function (e) {
      if (btn) btn.disabled = false;
      M.toast(e.message || 'Error', 'error'); if (after) after();
    });
  }
  w.Comandas = { ticket: ticket, handleClick: handleClick, destino: destino, imprimir: imprimir, comandaHtml: comandaHtml };
})(window);
