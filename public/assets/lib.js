/* Mesa Pya'e — librería compartida de las interfaces (sin dependencias). */
(function (w) {
  'use strict';
  var API_URL = (w.MESA_CONFIG && w.MESA_CONFIG.apiUrl) || '/api';
  var SKEY = 'mesapyae.sesion';

  // ------------------------------------------------------------ utilidades
  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function gs(n) { n = Math.round(Number(n) || 0); var s = Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.'); return (n < 0 ? '-' : '') + 'Gs. ' + s; }
  function parseGs(s) { var d = String(s || '').replace(/[^0-9]/g, ''); return d ? parseInt(d, 10) : 0; }
  function uid() {
    if (w.crypto && w.crypto.randomUUID) return w.crypto.randomUUID();
    var a = new Uint8Array(16); w.crypto.getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function hora(iso) { if (!iso) return ''; var d = new Date(iso); return d.toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Asuncion' }); }
  function fechaHora(iso) { if (!iso) return ''; return new Date(iso).toLocaleString('es-PY', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Asuncion' }); }
  function minutosDesde(iso, ahora) { if (!iso) return 0; return Math.max(0, Math.floor(((ahora || Date.now()) - Date.parse(iso)) / 60000)); }
  function elapsedChip(iso, warn, danger) {
    var m = minutosDesde(iso);
    var cls = m >= (danger || 20) ? 'd' : m >= (warn || 10) ? 'w' : '';
    return '<span class="elapsed ' + cls + '" data-since="' + esc(iso) + '">' + fmtMin(m) + '</span>';
  }
  function fmtMin(m) { return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min'; }
  function tickElapsed(warn, danger) {
    $$('.elapsed[data-since]').forEach(function (el) {
      var m = minutosDesde(el.getAttribute('data-since'));
      el.textContent = fmtMin(m);
      el.className = 'elapsed ' + (m >= (danger || 20) ? 'd' : m >= (warn || 10) ? 'w' : '');
    });
  }
  var ESTADO_TXT = { PENDIENTE: 'Pendiente', ACEPTADO: 'Aceptado', EN_PREPARACION: 'En preparación', LISTO: 'Listo', ENTREGADO: 'Entregado', CANCELADO: 'Cancelado' };
  var ESTADO_CHIP = { PENDIENTE: 'vino', ACEPTADO: 'azul', EN_PREPARACION: 'mostaza', LISTO: 'oliva', ENTREGADO: '', CANCELADO: 'vino' };
  function estadoChip(e) { return '<span class="chip ' + (ESTADO_CHIP[e] || '') + '">' + esc(ESTADO_TXT[e] || e) + '</span>'; }
  var PAGO_TXT = { PARCIAL: 'Pago parcial',  NO_COBRADO: 'Sin cobrar', COBRADO: 'Cobrado', REVERTIDO: 'Cobro revertido' };
  function pagoChip(e) { return '<span class="chip ' + (e === 'COBRADO' ? 'oliva' : e === 'REVERTIDO' ? 'vino' : 'mostaza') + '">' + esc(PAGO_TXT[e] || e) + '</span>'; }
  var MEDIO_TXT = { EFECTIVO: 'Efectivo', TRANSFERENCIA: 'Transferencia', TC: 'TC · Tarjeta de crédito', TD: 'TD · Tarjeta de débito', TARJETA: 'Tarjeta (registro anterior)', QR: 'QR' };
  function medioTxt(m) { return MEDIO_TXT[m] || (m.charAt(0) + m.slice(1).toLowerCase()); }

  // ------------------------------------------------------------ pedidos para llevar del QR (EQUIPO)
  // Todo el equipo de atención se entera de cada pedido para llevar que llega por el QR o la web,
  // y recibe una alerta más fuerte si sigue sin aceptar a los minutos configurados (ej.: 3 y 5).
  function avisosLlevar(d, mem) {
    var aj = (d.ajustes || {}).para_llevar;
    if (!aj || aj.modo !== 'EQUIPO') return null;
    mem = mem || { visto: null, alertas: {} };
    var primera = !mem.visto; mem.visto = mem.visto || {};
    (d.avisos_llevar || []).forEach(function (a) {
      if (!primera && !mem.visto[a.pedido_id]) {
        beep(3);
        toast('🥡 Pedido para llevar ' + a.numero + (a.alias ? ' · ' + a.alias : '') + (aj.atiendo ? ': aceptalo para pasarlo a cocina.' : ': lo acepta el mozo de barra o la caja del salón.'), 'ok', 9000);
      }
      mem.visto[a.pedido_id] = 1;
    });
    mem.lista = d.avisos_llevar || []; mem.aj = aj;
    mem.offset = d.ahora ? Date.parse(d.ahora) - Date.now() : 0;
    revisarAlertasLlevar(mem);
    return mem;
  }
  function revisarAlertasLlevar(mem) {
    if (!mem || !mem.lista) return;
    var ahora = Date.now() + (mem.offset || 0);
    mem.lista.forEach(function (a) {
      var min = minutosDesde(a.creado_en, ahora);
      (mem.aj.alertas || []).forEach(function (lim) {
        var k = a.pedido_id + ':' + lim;
        if (min >= lim && !mem.alertas[k]) {
          mem.alertas[k] = 1; beep(4);
          toast('⏰ ' + a.numero + (a.alias ? ' · ' + a.alias : '') + ': hace ' + lim + ' min que el pedido para llevar espera ser aceptado.', 'error', 12000);
        }
      });
    });
  }
  // WhatsApp del cliente (para llevar): número legible y link para avisarle con el mensaje ya escrito.
  function waTxt(n) { n = String(n || ''); if (n.indexOf('595') === 0) n = '0' + n.slice(3); return n.length === 10 ? n.slice(0, 4) + ' ' + n.slice(4, 7) + ' ' + n.slice(7) : n; }
  function waLink(p) {
    var neg = (w.Mesa && w.Mesa.negocio) || '';
    var hola = '¡Hola' + (p.alias ? ', ' + p.alias : '') + '! ';
    var txt = p.estado === 'LISTO' ? hola + 'Tu pedido ' + p.numero + (neg ? ' de ' + neg : '') + ' ya está listo para retirar. ¡Te esperamos!'
      : hola + 'Te escribimos' + (neg ? ' de ' + neg : '') + ' por tu pedido ' + p.numero + '.';
    return 'https://wa.me/' + String(p.whatsapp).replace(/[^0-9]/g, '') + '?text=' + encodeURIComponent(txt);
  }
  function bannerLlevar(mem) {
    if (!mem || !mem.lista || !mem.lista.length) return '';
    var ahora = Date.now() + (mem.offset || 0);
    var max = Math.max.apply(null, mem.lista.map(function (a) { return minutosDesde(a.creado_en, ahora); }));
    var tarde = (mem.aj.alertas || []).length && max >= mem.aj.alertas[0];
    return '<div class="banner ' + (tarde ? 'error' : 'warn') + '" data-banner-llevar style="border-radius:8px;margin-bottom:12px">🥡 <strong>' + mem.lista.length + ' pedido' + (mem.lista.length > 1 ? 's' : '') + ' para llevar por aceptar</strong> · ' +
      mem.lista.map(function (a) { return esc(a.numero) + (a.alias ? ' ' + esc(a.alias) : ''); }).join(', ') + ' · el más antiguo hace ' + fmtMin(max) +
      (mem.aj.atiendo ? '' : '. Lo acepta el mozo de barra o la caja del salón.') + '</div>';
  }

  // ------------------------------------------------------------ toasts y modales
  function toast(msg, kind, ms) {
    var wrap = $('.toast-wrap');
    if (!wrap) { wrap = document.createElement('div'); wrap.className = 'toast-wrap'; wrap.setAttribute('role', 'status'); document.body.appendChild(wrap); }
    var t = document.createElement('div'); t.className = 'toast ' + (kind || ''); t.textContent = msg; wrap.appendChild(t);
    setTimeout(function () { t.remove(); }, ms || (kind === 'error' ? 6000 : 3000));
  }
  function modal(opts) {
    // opts: {title, body (html), foot (html), wide, onClose}
    var ov = document.createElement('div'); ov.className = 'overlay';
    ov.innerHTML = '<div class="sheet ' + (opts.wide ? 'wide' : '') + '" role="dialog" aria-modal="true">' +
      '<div class="sheet-h"><h2 class="grow">' + esc(opts.title || '') + '</h2><button class="btn ghost iconbtn" data-x aria-label="Cerrar">✕</button></div>' +
      '<div class="sheet-b">' + (opts.body || '') + '</div>' + (opts.foot ? '<div class="sheet-f">' + opts.foot + '</div>' : '') + '</div>';
    function close() { ov.remove(); document.removeEventListener('keydown', onKey); if (opts.onClose) opts.onClose(); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    ov.addEventListener('click', function (e) { if (e.target === ov || e.target.closest('[data-x]')) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(ov);
    var first = ov.querySelector('input,select,textarea'); if (first && !opts.noFocus) setTimeout(function () { first.focus(); }, 50);
    return { el: ov, close: close, $: function (s) { return ov.querySelector(s); } };
  }
  function confirmar(titulo, texto, okTxt, danger) {
    return new Promise(function (res) {
      var m = modal({
        title: titulo, body: '<p>' + esc(texto) + '</p>',
        foot: '<button class="btn grow" data-no>Volver</button><button class="btn grow ' + (danger ? 'danger' : 'prim') + '" data-ok>' + esc(okTxt || 'Confirmar') + '</button>',
        onClose: function () { res(false); }, noFocus: true
      });
      m.$('[data-no]').onclick = function () { m.close(); };
      m.$('[data-ok]').onclick = function () { res(true); m.close(); };
    });
  }
  // Comprobante del cliente: ticket sin factura o factura con RUC/CI, razón social y correo (opcional).
  function comprobanteForm(cp) {
    cp = cp || { tipo: 'TICKET' };
    var fac = cp.tipo === 'FACTURA';
    return '<div class="cpte" data-cpte><div class="seg" style="display:flex;gap:8px;margin-bottom:8px">' +
      '<label class="opt grow' + (fac ? '' : ' on') + '"><input type="radio" name="cpte_tipo" value="TICKET"' + (fac ? '' : ' checked') + '> <span class="grow">Ticket sin factura</span></label>' +
      '<label class="opt grow' + (fac ? ' on' : '') + '"><input type="radio" name="cpte_tipo" value="FACTURA"' + (fac ? ' checked' : '') + '> <span class="grow">Factura</span></label></div>' +
      '<div data-cpte-f class="' + (fac ? '' : 'hidden') + '">' +
      '<label class="f">RUC o CI</label><input class="input" data-cpte-ruc inputmode="numeric" autocomplete="off" placeholder="Ej.: 80012345-6 o 1234567" value="' + esc(cp.ruc || '') + '">' +
      '<label class="f" style="margin-top:8px">Razón social o nombre</label><input class="input" data-cpte-razon maxlength="120" value="' + esc(cp.razon || '') + '">' +
      '<label class="f" style="margin-top:8px">Correo (opcional, para enviar la factura)</label><input class="input" data-cpte-email type="email" maxlength="120" autocomplete="off" value="' + esc(cp.email || '') + '"></div></div>';
  }
  function comprobanteBind(root) {
    var box = root.querySelector('[data-cpte]'); if (!box) return;
    box.addEventListener('change', function (e) {
      if (!e.target.matches('[name="cpte_tipo"]')) return;
      Array.prototype.forEach.call(box.querySelectorAll('.seg .opt'), function (l) { l.classList.toggle('on', l.querySelector('input').checked); });
      box.querySelector('[data-cpte-f]').classList.toggle('hidden', e.target.value !== 'FACTURA');
      if (e.target.value === 'FACTURA') box.querySelector('[data-cpte-ruc]').focus();
    });
  }
  // Devuelve {tipo, ruc, razon, email} o {error}
  function comprobanteLeer(root) {
    var box = root.querySelector('[data-cpte]'); if (!box) return null;
    var tipo = (box.querySelector('[name="cpte_tipo"]:checked') || {}).value || 'TICKET';
    if (tipo === 'TICKET') return { tipo: 'TICKET' };
    var ruc = box.querySelector('[data-cpte-ruc]').value.replace(/[\s.]/g, ''), razon = box.querySelector('[data-cpte-razon]').value.trim(), email = box.querySelector('[data-cpte-email]').value.trim();
    if (!/^[0-9]{3,10}(-[0-9])?$/.test(ruc)) return { error: 'RUC o CI inválido (ej.: 80012345-6 o 1234567).' };
    if (razon.length < 2) return { error: 'Indicá la razón social o el nombre para la factura.' };
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Correo inválido.' };
    return { tipo: 'FACTURA', ruc: ruc, razon: razon, email: email };
  }
  // Pedido de cuenta hecho por el cliente desde su celular: medio, con cuánto paga y si dividen
  function cierreTxt(c) {
    var pd = c && c.estado === 'CIERRE_SOLICITADO' && c.cierre_pedido;
    if (!pd || pd.origen !== 'CLIENTE') return '';
    var falta = (c.total_gs || 0) - (c.pagado_gs || 0);
    return '<div class="small cierre-cli" style="margin-top:4px">📱 <strong>Pidió la cuenta desde el celular</strong>' +
      (pd.medio ? ' · paga con <strong>' + esc(medioTxt(pd.medio)) + '</strong>' : '') +
      (pd.paga_con ? ' · trae ' + gs(pd.paga_con) + (pd.paga_con > falta ? ' (vuelto ' + gs(pd.paga_con - falta) + ')' : '') : '') +
      (pd.separado ? ' · <strong>pagan por separado</strong>' : '') + '</div>';
  }
  function comprobanteChip(cp) {
    if (!cp) return '';
    return cp.tipo === 'FACTURA' ? '<span class="chip azul" title="' + esc(cp.razon) + '">Factura · ' + esc(cp.ruc) + '</span>' : '<span class="chip">Ticket</span>';
  }
  function pedirComprobante(titulo, texto, cp, okTxt) {
    return new Promise(function (res) {
      var done = false;
      var m = modal({
        title: titulo, noFocus: true,
        body: (texto ? '<p style="margin-top:0">' + esc(texto) + '</p>' : '') + '<h3 style="margin:0 0 8px">¿Cómo quiere el comprobante?</h3>' + comprobanteForm(cp) + '<p class="small" data-err style="color:var(--vino);min-height:1em"></p>',
        foot: '<button class="btn grow" data-no>Volver</button><button class="btn prim grow" data-ok>' + esc(okTxt || 'Confirmar') + '</button>',
        onClose: function () { if (!done) res(null); }
      });
      comprobanteBind(m.el);
      m.$('[data-no]').onclick = function () { m.close(); };
      m.$('[data-ok]').onclick = function () {
        var v = comprobanteLeer(m.el);
        if (v.error) { m.$('[data-err]').textContent = v.error; return; }
        done = true; res(v); m.close();
      };
    });
  }
  // Pide motivo y, si hace falta, autorización del encargado (usuario + PIN)
  function pedirMotivo(titulo, opts) {
    opts = opts || {};
    return new Promise(function (res) {
      var needAuth = opts.auth && Mesa.session && Mesa.session.usuario.rol !== 'ADMIN';
      var m = modal({
        title: titulo,
        body: (opts.texto ? '<p>' + esc(opts.texto) + '</p>' : '') +
          '<label class="f">Motivo</label><textarea class="input" data-m maxlength="200" placeholder="Obligatorio"></textarea>' +
          (needAuth ? '<div class="card pad" style="margin-top:12px;background:var(--papel-2)"><strong>Autorización del encargado</strong>' +
            '<div class="row" style="margin-top:8px"><input class="input" data-u placeholder="Usuario encargado" autocomplete="off"><input class="input" data-p placeholder="PIN" inputmode="numeric" type="password" autocomplete="off"></div></div>' : ''),
        foot: '<button class="btn grow" data-no>Volver</button><button class="btn grow danger" data-ok>' + esc(opts.ok || 'Confirmar') + '</button>',
        onClose: function () { res(null); }
      });
      m.$('[data-no]').onclick = function () { m.close(); };
      m.$('[data-ok]').onclick = function () {
        var motivo = m.$('[data-m]').value.trim();
        if (motivo.length < 3) { toast('Escribí el motivo.', 'error'); return; }
        var out = { motivo: motivo };
        if (needAuth) out.autorizacion = { usuario: m.$('[data-u]').value.trim(), pin: m.$('[data-p]').value.trim() };
        var r = res; res = function () { }; r(out); m.close();
      };
    });
  }

  // ------------------------------------------------------------ sonido
  var audioCtx = null, soundOn = false;
  function enableSound() {
    try {
      audioCtx = audioCtx || new (w.AudioContext || w.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      soundOn = true; beep(1);
      try { localStorage.setItem('mesapyae.sonido', '1'); } catch (e) { }
    } catch (e) { soundOn = false; }
    return soundOn;
  }
  function beep(times) {
    if (!soundOn || !audioCtx) return;
    var t0 = audioCtx.currentTime;
    for (var i = 0; i < (times || 2); i++) {
      [880, 1175].forEach(function (f, j) {
        var o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = 'sine'; o.frequency.value = f; o.connect(g); g.connect(audioCtx.destination);
        var s = t0 + i * 0.5 + j * 0.16;
        g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.35, s + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.25);
        o.start(s); o.stop(s + 0.3);
      });
    }
    if (navigator.vibrate) navigator.vibrate([150, 80, 150]);
  }
  // Alarma de demora: tres tonos descendentes, repetidos dos veces (distinta al aviso de pedido nuevo)
  function alarm(nivel) {
    if (!soundOn || !audioCtx) return;
    var t0 = audioCtx.currentTime, reps = Math.min(4, (nivel || 1) + 1);
    for (var r = 0; r < reps; r++) [988, 784, 587].forEach(function (f, j) {
      var o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'square'; o.frequency.value = f; o.connect(g); g.connect(audioCtx.destination);
      var s = t0 + r * 0.9 + j * 0.22;
      g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.25, s + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.2);
      o.start(s); o.stop(s + 0.22);
    });
    if (navigator.vibrate) navigator.vibrate([300, 100, 300, 100, 300]);
  }
  function soundEnabled() { return soundOn; }
  function disableSound() { soundOn = false; try { localStorage.setItem('mesapyae.sonido', '0'); } catch (e) { } }
  // Sonido ACTIVADO por defecto (se puede apagar). Los navegadores exigen un primer toque/clic para reproducir audio:
  // el sonido queda listo solo con el primer toque en cualquier parte de la pantalla.
  function soundToggle(btn, banner) {
    var pref = true; try { pref = localStorage.getItem('mesapyae.sonido') !== '0'; } catch (e) { }
    function pintar() {
      btn.textContent = pref ? (soundOn ? '🔔 Sonido activado' : '🔔 Sonido: tocá la pantalla') : '🔕 Sonido apagado';
      btn.title = pref ? 'Tocá para apagar el sonido' : 'Tocá para activar el sonido';
      if (banner) banner.classList.toggle('hidden', !pref || soundOn);
    }
    function desbloquear() {
      if (!pref || soundOn) return;
      try { audioCtx = audioCtx || new (w.AudioContext || w.webkitAudioContext)(); if (audioCtx.state === 'suspended') audioCtx.resume(); soundOn = true; } catch (e) { }
      pintar();
    }
    ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) { document.addEventListener(ev, desbloquear, { capture: true, passive: true }); });
    btn.onclick = function () {
      if (pref) { pref = false; disableSound(); } else { pref = true; enableSound(); }
      pintar();
    };
    pintar();
  }

  // ------------------------------------------------------------ API
  var conn = { online: true, lastOk: 0, failures: 0 };
  function setConn(ok) {
    conn.online = ok; if (ok) { conn.lastOk = Date.now(); conn.failures = 0; } else conn.failures++;
    var el = $('#conn');
    if (el) {
      el.className = 'conn' + (ok ? '' : conn.failures > 1 ? ' off' : ' slow');
      el.textContent = ok ? 'En línea' : (conn.failures > 1 ? 'Sin conexión' : 'Reintentando…');
    }
    var b = $('#offline-banner');
    if (b) b.classList.toggle('hidden', ok || conn.failures < 2);
  }
  function call(action, payload, opts) {
    opts = opts || {};
    var body = JSON.stringify({ action: action, payload: payload || {}, token: opts.publico ? undefined : (Mesa.session && Mesa.session.token), pulse: Mesa.minPulse || undefined });
    var attempts = opts.retries === undefined ? 0 : opts.retries;
    function once() {
      var ctrl = w.AbortController ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, opts.timeout || 20000);
      var req = (w.MESA_CONFIG && w.MESA_CONFIG.demo && w.MesaDemo)
        ? new Promise(function (ok) { setTimeout(function () { ok(w.MesaDemo.handle(JSON.parse(body))); }, 120); })
        : fetch((opts.directo && w.MESA_CONFIG && w.MESA_CONFIG.apiDirecta) || API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, signal: ctrl ? ctrl.signal : undefined, cache: 'no-store' })
          .then(function (r) { return r.json().catch(function () { throw { red: true, message: 'Respuesta inválida del servidor (' + r.status + ').' }; }); });
      return req
        .then(function (j) {
          clearTimeout(timer); setConn(true);
          if (!j.ok) {
            var e = j.error || { code: 'ERROR', message: 'Error' };
            if ((e.code === 'NO_SESION' || e.code === 'SESION_VENCIDA') && !opts.publico) { Mesa.logout(true); }
            throw e;
          }
          return j.data;
        }, function (err) {
          clearTimeout(timer);
          if (err && err.code) throw err;
          setConn(false);
          throw { red: true, code: 'RED', message: 'Sin conexión con el servidor. Revisá internet e intentá de nuevo.' };
        });
    }
    function attempt(n) {
      return once().catch(function (e) {
        if (e.red && n < attempts) return new Promise(function (r) { setTimeout(r, 800 * (n + 1)); }).then(function () { return attempt(n + 1); });
        throw e;
      });
    }
    return attempt(0);
  }

  // ------------------------------------------------------------ sesión
  function loadSession() { try { return JSON.parse(localStorage.getItem(SKEY) || 'null'); } catch (e) { return null; } }
  function saveSession(s) { try { if (s) localStorage.setItem(SKEY, JSON.stringify(s)); else localStorage.removeItem(SKEY); } catch (e) { } }

  function loginScreen(target, onOk, titulo) {
    var pin = '';
    target.innerHTML = '<div class="login-wrap"><div class="login card pad">' +
      '<img class="logo" src="assets/logo-local.png" alt="Tu Local Gastronómico">' +
      '<div class="sub">Mesa Pya\'e' + (titulo ? ' · ' + esc(titulo) : '') + '</div>' +
      '<input class="input" id="lg-u" placeholder="Usuario" autocomplete="username" autocapitalize="none" spellcheck="false" value="' + esc(localStorage.getItem('mesapyae.ultimoUsuario') || '') + '">' +
      '<div class="pin-dots" aria-label="PIN">' + '<span></span><span></span><span></span><span></span><span></span><span></span>' + '</div>' +
      '<input id="lg-p" type="password" inputmode="numeric" autocomplete="current-password" class="input" placeholder="PIN" style="position:absolute;opacity:0;pointer-events:none;height:1px" tabindex="-1">' +
      '<div class="keypad">' + [1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (n) { return '<button type="button" data-k="' + n + '">' + n + '</button>'; }).join('') +
      '<button type="button" data-k="del" aria-label="Borrar">⌫</button><button type="button" data-k="0">0</button><button type="button" data-k="ok" style="background:var(--tinta);color:var(--papel)">OK</button></div>' +
      '<p class="small muted" id="lg-msg" style="min-height:1.2em;margin:12px 0 0"></p>' +
      '<div class="powered-login">powered by<img src="assets/mesapyae-logo.png" alt="Mesa Pya\'e by Ser o Límites"></div></div></div>';
    var dots = $$('.pin-dots span', target), msg = $('#lg-msg', target), u = $('#lg-u', target);
    function paint() { dots.forEach(function (d, i) { d.classList.toggle('on', i < pin.length); }); }
    function submit() {
      var usr = u.value.trim().toLowerCase();
      if (!usr) { msg.textContent = 'Ingresá tu usuario.'; u.focus(); return; }
      if (pin.length < 4) { msg.textContent = 'El PIN tiene al menos 4 dígitos.'; return; }
      msg.textContent = 'Ingresando…';
      call('auth.login', { usuario: usr, pin: pin }, { publico: true, retries: 1 }).then(function (d) {
        try { localStorage.setItem('mesapyae.ultimoUsuario', usr); } catch (e) { }
        Mesa.session = d; saveSession(d); onOk(d);
      }, function (e) { pin = ''; paint(); msg.textContent = e.message || 'No se pudo ingresar.'; });
    }
    target.addEventListener('click', function (e) {
      var b = e.target.closest('[data-k]'); if (!b) return;
      var k = b.getAttribute('data-k');
      if (k === 'del') pin = pin.slice(0, -1); else if (k === 'ok') return submit(); else if (pin.length < 8) pin += k;
      paint();
    });
    document.addEventListener('keydown', function onk(e) {
      if (!document.body.contains(u)) { document.removeEventListener('keydown', onk); return; }
      if (document.activeElement === u) { if (e.key === 'Enter') { e.preventDefault(); u.blur(); } return; }
      if (/^[0-9]$/.test(e.key) && pin.length < 8) { pin += e.key; paint(); }
      else if (e.key === 'Backspace') { pin = pin.slice(0, -1); paint(); }
      else if (e.key === 'Enter') submit();
    });
    if (!u.value) u.focus();
  }

  // Inicializa una página de personal: exige sesión y rol.
  function staffPage(opts) {
    // opts: {modulo, roles:[...], render(session)}
    var root = $('#app');
    function go(s) {
      if (opts.roles && opts.roles.indexOf(s.usuario.rol) < 0) {
        root.innerHTML = '<div class="login-wrap"><div class="login card pad"><img class="logo" src="assets/logo-local.png" alt="Tu Local"><h2>Sin acceso</h2><p>Tu usuario (' + esc(s.usuario.nombre) + ') no tiene permiso para ' + esc(opts.modulo) + '.</p><a class="btn block" href="index.html">Volver al inicio</a><button class="btn ghost block" style="margin-top:8px" onclick="Mesa.logout()">Cambiar de usuario</button></div></div>';
        return;
      }
      opts.render(s);
    }
    Mesa.session = loadSession();
    if (!Mesa.session) return loginScreen(root, go, opts.modulo);
    call('me', {}).then(function (d) { Mesa.session.usuario = d.usuario; saveSession(Mesa.session); go(Mesa.session); }, function (e) {
      if (e.red) go(Mesa.session); // sin red: usar sesión guardada, el servidor validará cada acción
      else { Mesa.session = null; saveSession(null); loginScreen(root, go, opts.modulo); }
    });
  }
  function topbar(modulo, extra) {
    var s = Mesa.session && Mesa.session.usuario;
    return '<header class="topbar"><a href="index.html" title="Inicio" class="marca"><img class="logo" src="assets/logo-local.png" alt="Tu Local Gastronómico"><span class="powered">powered by <img src="assets/mesapyae-logo.png" alt="Mesa Pya\'e by Ser o Límites"></span></a>' +
      '<div class="modulo">' + esc(modulo) + '</div>' + (extra || '') +
      '<span class="right"></span><span id="conn" class="conn">En línea</span>' +
      (s ? '<div class="usuario">' + esc(s.nombre) + '<br><a href="#" onclick="Mesa.logout();return false" class="small">Salir</a></div>' : '') +
      '</header><div id="offline-banner" class="banner error hidden">Sin conexión con el servidor. Los cambios no se guardan hasta que vuelva la conexión. Si persiste, usá la comanda en papel (ver manual de contingencia).</div>';
  }

  // ------------------------------------------------------------ sincronización
  // Sincronización: consulta periódica + aviso instantáneo cuando cambia el "pulso"
  // (Firestore en tiempo real, ver realtime.js). Con tiempo real activo, la consulta
  // periódica queda como respaldo cada 30 s.
  var pulseListeners = [];
  function onPulse(rev) {
    rev = Number(rev) || 0;
    if (rev > (Mesa.minPulse || 0)) Mesa.minPulse = rev;
    Mesa.realtime = true;
    pulseListeners.forEach(function (f) { f(rev); });
  }
  // Pie de los tickets que se lleva el cliente (Premium, con el club activo): QR para unirse y mensaje del local.
  // vinculado = el cobro ya sumó en la tarjeta del cliente (no hace falta el QR).
  function pieClub(vinculado) {
    var r = w.Mesa && w.Mesa.rec, t = r && r.ticket; if (!t) return '';
    var base = ''; try { base = localStorage.getItem('mesapyae.baseUrl') || ''; } catch (e) { }
    var link = base ? base.replace(/\/?$/, '/') + 'tarjeta.html' : new URL('tarjeta.html', location.href).href;
    var qr = t.qr && !vinculado && w.QR ? '<div class="cp-club"><b>' + esc(r.nombre) + '</b><div class="cp-qr">' + w.QR.svg(link, { margin: 1 }) + '</div>' +
      'Escaneá, sacá tu tarjeta gratis y sumá un sello en cada visita.' + (t.premio ? '<br>' + esc(t.premio) : '') + '</div>' : '';
    var msg = t.mensaje ? '<div class="cp-msg">' + esc(t.mensaje) + '</div>' : '';
    return qr || msg ? '<hr>' + qr + msg : '';
  }
  function syncLoop(onData, opts) {
    opts = opts || {};
    var rev = 0, timer = null, busy = false, stopped = false, again = false, traslados = null;
    // Aviso a todo el personal cuando una mesa se muda a otra (ej.: "Mesa 3 → Mesa 7").
    function avisarTraslados(d) {
      var lista = d.traslados || [], primera = !traslados; traslados = traslados || {};
      lista.forEach(function (x) {
        var k = x.cuenta_id + '|' + x.en;
        if (!primera && !traslados[k]) { beep(2); toast('🔀 ' + x.de + ' se cambió a ' + x.a + '. Lo que estaba en ' + x.de + ' ahora va a ' + x.a + '.', 'ok', 9000); }
        traslados[k] = 1;
      });
    }
    function interval() {
      if (document.hidden) return opts.hiddenMs || 15000;
      return Mesa.realtime ? 30000 : (opts.ms || 4000);
    }
    function tick() {
      if (stopped) return;
      if (busy) { again = true; return; }
      busy = true; again = false;
      call('sync', { since: rev }, { timeout: 15000 }).then(function (d) {
        busy = false;
        if (!d.sin_cambios) { rev = d.rev; if (d.negocio) Mesa.negocio = d.negocio; if ('recompensas' in d) Mesa.rec = d.recompensas; avisarTraslados(d); onData(d); }
        if (again) tick(); else schedule();
      }, function () { busy = false; if (again) setTimeout(tick, 1000); else schedule(); });
    }
    function schedule() { clearTimeout(timer); timer = setTimeout(tick, interval()); }
    document.addEventListener('visibilitychange', function () { if (!document.hidden) { clearTimeout(timer); tick(); } });
    w.addEventListener('online', function () { clearTimeout(timer); tick(); });
    pulseListeners.push(function () { clearTimeout(timer); tick(); });
    tick();
    return { now: function () { clearTimeout(timer); rev = 0; tick(); }, refresh: function () { clearTimeout(timer); tick(); }, stop: function () { stopped = true; clearTimeout(timer); } };
  }

  // ------------------------------------------------------------ wake lock (pantallas fijas)
  function keepAwake() {
    var lock = null;
    function req() { if (navigator.wakeLock && !document.hidden) navigator.wakeLock.request('screen').then(function (l) { lock = l; }, function () { }); }
    document.addEventListener('visibilitychange', req); req();
  }

  var Mesa = {
    session: null, call: call, esc: esc, gs: gs, parseGs: parseGs, uid: uid, $: $, $$: $$, hora: hora, fechaHora: fechaHora,
    waTxt: waTxt, waLink: waLink, pieClub: pieClub, avisosLlevar: avisosLlevar, revisarAlertasLlevar: revisarAlertasLlevar, bannerLlevar: bannerLlevar,
    minutosDesde: minutosDesde, elapsedChip: elapsedChip, tickElapsed: tickElapsed, estadoChip: estadoChip, pagoChip: pagoChip, ESTADO_TXT: ESTADO_TXT,
    medioTxt: medioTxt, toast: toast, modal: modal, confirmar: confirmar, pedirMotivo: pedirMotivo, pedirComprobante: pedirComprobante, comprobanteForm: comprobanteForm, comprobanteBind: comprobanteBind, comprobanteLeer: comprobanteLeer, comprobanteChip: comprobanteChip, cierreTxt: cierreTxt, enableSound: enableSound, disableSound: disableSound, soundToggle: soundToggle, beep: beep, alarm: alarm, soundEnabled: soundEnabled,
    staffPage: staffPage, topbar: topbar, syncLoop: syncLoop, onPulse: onPulse, minPulse: 0, realtime: false, keepAwake: keepAwake, loginScreen: loginScreen, conn: conn,
    // Cierra la sesión en este dispositivo (otros dispositivos del mismo usuario siguen activos;
    // para cerrarlas todas, Admin > Usuarios > "Cerrar sesiones").
    logout: function () { Mesa.session = null; saveSession(null); location.reload(); }
  };
  w.Mesa = Mesa;
})(window);
