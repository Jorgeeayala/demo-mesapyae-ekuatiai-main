/* Administración → 💬 WhatsApp (Upgrade Atención Integrada): avisos automáticos al cliente de para llevar por Whaticket.
   La conexión (token y número) la configura Ser o Límites; el encargado elige qué avisos salen y con qué texto.
   El token de Whaticket nunca pasa por el navegador: vive en Secret Manager del servidor del local. */
(function (w) {
  'use strict';
  var M = w.Mesa, esc = M.esc;
  var S = { el: null, d: null, prueba: null };
  var EST = { PENDIENTE: ['Por enviar', 'mostaza'], ENVIADO: ['Enviado', 'oliva'], ERROR: ['No salió', 'vino'] };
  var TIPO = { RECIBIDO: 'Recibido', LISTO: 'Listo' };

  function err(e) { M.toast(e.message || 'Error', 'error'); }
  function cargar() { return M.call('wa.estado', {}).then(function (d) { S.d = d; pintar(); }, function (e) { S.el.innerHTML = '<div class="banner warn">' + esc(e.message) + '</div>'; }); }
  function mount(el) {
    S.el = el; S.prueba = null;
    el.addEventListener('click', onClick);
    el.innerHTML = '<div class="empty">Cargando…</div>';
    cargar();
  }
  // 595981123456 → 0981 ••• 456 (en pantalla no hace falta el número entero)
  function cel(n) { n = String(n || ''); var l = n.replace(/^595/, '0'); return l.length > 6 ? l.slice(0, 4) + ' ••• ' + l.slice(-3) : l; }
  function hora(t) { if (!t) return ''; var d = new Date(t); return d.toLocaleString('es-PY', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }

  function pintar() {
    if (!S.d || !S.el || !document.body.contains(S.el)) return;
    var d = S.d, c = d.config, conectado = !!c.wa_conexion_id;
    var sinWa = String(d.whatsapp_llevar || 'NO').toUpperCase() === 'NO';
    S.el.innerHTML =
      '<div class="banner info" style="border-radius:8px;margin-bottom:12px">Cuando un pedido para llevar tiene el WhatsApp del cliente, Mesa Pya\'e le avisa solo: «recibimos tu pedido» y «tu pedido está listo». Sale desde el número del local, sin tocar el celular.</div>' +
      (sinWa ? '<div class="banner warn" data-sinwa style="border-radius:8px;margin-bottom:12px">Hoy la carta para llevar no pide el WhatsApp del cliente. Activalo en <strong>Configuración → para_llevar_whatsapp</strong> (OPCIONAL u OBLIGATORIO) para que haya a quién avisar.</div>' : '') +
      '<div class="card pad" style="margin-bottom:12px"><h3 style="margin-top:0">Conexión con WhatsApp</h3>' +
      (conectado ? '<p data-conexion>✅ Conectado a <strong>' + esc(c.wa_conexion_nombre || c.wa_conexion_id) + '</strong>.</p>' : '<p class="muted" data-conexion>Todavía sin conectar. Lo configura Ser o Límites.</p>') +
      (d.plataforma ? '<button class="btn" data-probar>Probar conexión (SoL)</button>' + pintarPrueba() : '') + '</div>' +
      '<div class="card pad" style="margin-bottom:12px"><h3 style="margin-top:0">Avisos al cliente</h3>' +
      '<label class="f">¿Qué avisos salen?</label><select class="input" id="wa-modo"' + (conectado ? '' : ' disabled') + '>' +
      [['NO', 'Ninguno (apagado)'], ['LISTO', 'Solo cuando el pedido está listo'], ['AMBOS', 'Al recibir el pedido y cuando está listo']].map(function (o) { return '<option value="' + o[0] + '"' + (c.wa_avisos === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
      '<label class="f" style="margin-top:10px">Mensaje al recibir el pedido</label><textarea class="input" id="wa-recibido" rows="2" maxlength="600">' + esc(c.wa_aviso_recibido) + '</textarea>' +
      '<label class="f" style="margin-top:10px">Mensaje cuando está listo</label><textarea class="input" id="wa-listo" rows="2" maxlength="600">' + esc(c.wa_aviso_listo) + '</textarea>' +
      '<p class="small muted" style="margin:6px 0 10px">Podés usar {nombre} (el nombre del pedido), {numero} (ej.: T-012) y {local}. Cada aviso sale una sola vez por pedido.</p>' +
      '<button class="btn prim" data-guardar>Guardar</button></div>' +
      '<h3 style="margin:16px 0 8px">Últimos avisos</h3>' +
      (d.con_error ? '<p class="small" style="color:var(--vino)">' + d.con_error + ' aviso(s) no salieron después de 3 intentos. Revisá el número del cliente o la conexión.</p>' : '') +
      (d.avisos.length ? '<div class="card tbl-wrap"><table class="tbl"><thead><tr><th>Pedido</th><th>Aviso</th><th>Cliente</th><th>Estado</th><th>Hora</th></tr></thead><tbody>' + d.avisos.map(function (a) {
        var e = EST[a.estado] || [a.estado, ''];
        return '<tr data-aviso="' + esc(a.aviso_id) + '"><td>' + esc(a.pedido) + '</td><td>' + (TIPO[a.tipo] || esc(a.tipo)) + '</td><td class="num">' + esc(cel(a.numero)) + '</td><td><span class="chip ' + e[1] + '">' + e[0] + '</span>' +
          (a.error ? '<div class="small muted">' + esc(a.error) + '</div>' : '') + '</td><td class="small">' + esc(hora(a.enviado_en || a.creado_en)) + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<p class="muted">Todavía no salió ningún aviso.</p>');
  }
  function pintarPrueba() {
    var p = S.prueba; if (!p) return '';
    var cur = S.d.config.wa_conexion_id;
    return '<div data-prueba style="margin-top:12px"><p class="small">Empresa en Whaticket: <strong>' + esc(p.empresa) + '</strong> · Token: <strong>' + esc(p.token_nombre) + '</strong></p>' +
      '<label class="f">Número por el que salen los avisos</label><select class="input" id="wa-conexion">' +
      p.conexiones.map(function (x) { return '<option value="' + esc(x.id) + '" data-nombre="' + esc(x.nombre) + '"' + (x.id === cur ? ' selected' : '') + '>' + esc(x.nombre) + ' · ' + esc(x.canal) + ' · ' + esc(x.estado) + '</option>'; }).join('') +
      '</select><button class="btn prim" style="margin-top:8px" data-conectar>Usar este número</button></div>';
  }

  function onClick(e) {
    if (e.target.closest('[data-probar]')) {
      var b = e.target.closest('[data-probar]'); b.disabled = true; b.textContent = 'Probando…';
      M.call('wa.probar', {}).then(function (r) { S.prueba = r; M.toast('Conexión con Whaticket OK', 'ok'); pintar(); }, function (x) { b.disabled = false; b.textContent = 'Probar conexión (SoL)'; err(x); });
      return;
    }
    if (e.target.closest('[data-conectar]')) {
      var sel = S.el.querySelector('#wa-conexion'), op = sel.options[sel.selectedIndex];
      M.call('wa.config', { config: { wa_conexion_id: sel.value, wa_conexion_nombre: op.getAttribute('data-nombre') } }).then(function (d) { S.d = d; S.prueba = null; M.toast('Número guardado', 'ok'); pintar(); }, err);
      return;
    }
    if (e.target.closest('[data-guardar]')) {
      M.call('wa.config', { config: { wa_avisos: S.el.querySelector('#wa-modo').value, wa_aviso_recibido: S.el.querySelector('#wa-recibido').value, wa_aviso_listo: S.el.querySelector('#wa-listo').value } })
        .then(function (d) { S.d = d; M.toast('Avisos guardados', 'ok'); pintar(); }, err);
    }
  }

  w.AtencionAdmin = { mount: mount };
})(window);
