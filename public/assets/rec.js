/* Módulo Premium · Recompensas — piezas de interfaz para el personal (caja y mozos). */
(function (w) {
  'use strict';
  var M = w.Mesa, esc = M.esc, gs = M.gs;
  var ICON = { cafe: '☕', pizza: '🍕', estrella: '⭐' };

  function linkTarjeta(token) {
    var base = location.href.replace(/[^\/]*([?#].*)?$/, '');
    return base + 'tarjeta.html?c=' + encodeURIComponent(token);
  }
  function waTarjeta(celular, nombre, token, programa) {
    var d = String(celular || '').replace(/[^0-9]/g, '');
    if (/^09\d{8}$/.test(d)) d = '595' + d.slice(1);
    var txt = '¡Hola ' + nombre + '! Esta es tu tarjeta de ' + (programa || 'recompensas') + ': ' + linkTarjeta(token) + ' — Guardala en tu pantalla de inicio y mostrala en caja para sumar sellos.';
    return 'https://wa.me/' + d + '?text=' + encodeURIComponent(txt);
  }

  // Escanea el QR de la tarjeta con la cámara (Chrome/Android). Devuelve el texto leído o null.
  function scan() {
    return new Promise(function (res) {
      if (!('BarcodeDetector' in w) || !navigator.mediaDevices) {
        M.toast('Este navegador no puede escanear. Escribí el celular o el código de 6 letras de la tarjeta.', 'error', 6000);
        return res(null);
      }
      var stream = null, done = false, det;
      try { det = new w.BarcodeDetector({ formats: ['qr_code'] }); } catch (e) { M.toast('No se pudo usar la cámara para escanear.', 'error'); return res(null); }
      var m = M.modal({
        title: 'Escanear tarjeta', noFocus: true,
        body: '<video playsinline muted style="width:100%;border-radius:12px;background:#000;aspect-ratio:1/1;object-fit:cover"></video><p class="small muted" style="text-align:center">Apuntá al QR de la tarjeta del cliente.</p>',
        onClose: function () { done = true; if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); res(null); }
      });
      var v = m.$('video');
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(function (s) {
        stream = s; v.srcObject = s; v.play();
        (function loop() {
          if (done) return;
          det.detect(v).then(function (codes) {
            if (codes && codes[0] && !done) { var txt = codes[0].rawValue; var r = res; res = function () { }; r(txt); m.close(); return; }
            setTimeout(loop, 250);
          }, function () { setTimeout(loop, 400); });
        })();
      }, function () { M.toast('Sin permiso para usar la cámara.', 'error'); m.close(); });
    });
  }

  function registrar(pref, programa) {
    pref = pref || {};
    return new Promise(function (res) {
      var m = M.modal({
        title: 'Nuevo cliente · ' + (programa || 'Recompensas'),
        body: '<label class="f">Nombre</label><input class="input" data-n maxlength="40" value="' + esc(pref.nombre || '') + '">' +
          '<label class="f" style="margin-top:8px">Celular</label><input class="input" data-c inputmode="tel" placeholder="0981 123456" value="' + esc(pref.celular || '') + '">' +
          '<label class="f" style="margin-top:8px">Cumpleaños (opcional, día/mes)</label><input class="input" data-b placeholder="15/10" maxlength="5">' +
          '<p class="small muted">Avisale al cliente que sus datos se usan solo para el programa de recompensas del local.</p><p class="small" data-e style="color:var(--vino)"></p>',
        foot: '<button class="btn grow" data-x>Volver</button><button class="btn prim grow" data-ok>Registrar</button>',
        onClose: function () { res(null); }
      });
      m.$('[data-ok]').onclick = function () {
        var b = this; b.disabled = true;
        M.call('rec.registrar', { nombre: m.$('[data-n]').value.trim(), celular: m.$('[data-c]').value.trim(), cumple: m.$('[data-b]').value.trim() }).then(function (r) {
          var out = r; var f = res; res = function () { }; m.close(); f(out);
          var cel = m.$('[data-c]').value.trim();
          M.toast((r.existente ? 'Ya tenía tarjeta: ' : 'Tarjeta creada: ') + r.cliente.nombre, 'ok', 4000);
          if (!r.existente) enviarTarjeta(cel, r.cliente.nombre, r.link_token, programa);
        }, function (e) { b.disabled = false; m.$('[data-e]').textContent = e.message; });
      };
    });
  }
  function enviarTarjeta(cel, nombre, token, programa) {
    var m = M.modal({
      title: 'Enviar la tarjeta', noFocus: true,
      body: '<p>Mandale a <strong>' + esc(nombre) + '</strong> el link de su tarjeta por WhatsApp. Con eso la guarda en su celular.</p>' +
        '<div style="display:flex;justify-content:center;margin:8px 0">' + (w.QR ? w.QR.svg(linkTarjeta(token), { size: 180, margin: 2 }) : '') + '</div>' +
        '<p class="small muted" style="text-align:center">También puede escanear este QR ahora.</p>',
      foot: '<button class="btn grow" data-x>Listo</button><a class="btn prim grow" target="_blank" rel="noopener" href="' + esc(waTarjeta(cel, nombre, token, programa)) + '">Enviar por WhatsApp</a>'
    });
    return m;
  }

  // Valor que descuenta un premio, con la misma regla del servidor.
  function valorCupon(cu, items, menu) {
    if (!cu.producto_id) return cu.valor_gs || 0;
    var its = items.filter(function (i) { return i.producto_id === cu.producto_id && !i.anulado; });
    if (!its.length) return -1;
    var unit = Math.max.apply(null, its.map(function (i) { return i.precio_unit_gs; }));
    var prod = menu ? menu.productos.filter(function (p) { return p.id === cu.producto_id; })[0] : null;
    return Math.min(unit, (prod && prod.precio) || unit);
  }
  function sellosHtml(n, meta, icono) {
    var out = '';
    for (var i = 1; i <= meta; i++) out += '<span class="rec-sello' + (i <= n ? ' on' : '') + '">' + (i <= n ? (ICON[icono] || '☕') : i) + '</span>';
    return '<div class="rec-sellos">' + out + '</div>';
  }

  // Panel dentro del cobro. opts: {programa, cliente_id (vinculado), items, menu, onChange(estado)}
  function panelCobro(root, opts) {
    var st = { cli: null, sello: true, cupones: {}, buscando: false };
    var box = root.querySelector('[data-rec]');
    function emit() { if (opts.onChange) opts.onChange(estado()); }
    function estado() {
      if (!st.cli) return { activo: false, desc: 0 };
      var desc = 0, faltan = [];
      st.cli.cupones.forEach(function (cu) {
        if (!st.cupones[cu.cupon_id]) return;
        var v = valorCupon(cu, opts.items, opts.menu);
        if (v < 0) faltan.push(cu.nombre); else desc += v;
      });
      return { activo: true, cliente_id: st.cli.cliente_id, sello: st.sello, cupones: Object.keys(st.cupones).filter(function (k) { return st.cupones[k]; }), desc: desc, faltan: faltan };
    }
    function pintar() {
      var html = '<div class="row" style="gap:6px"><input class="input grow" data-rq placeholder="Celular o código de la tarjeta" autocomplete="off">' +
        '<button class="btn" data-rb>Buscar</button>' + ('BarcodeDetector' in w ? '<button class="btn" data-rs title="Escanear QR" aria-label="Escanear QR">📷</button>' : '') + '</div>';
      if (st.cli) {
        var c = st.cli, pr = opts.programa;
        html = '<div class="row"><div class="grow"><strong>' + esc(c.nombre) + '</strong> <span class="small muted">' + esc(c.celular) + ' · ' + esc(c.codigo) + '</span></div><button class="btn small ghost" data-rx>Quitar</button></div>' +
          sellosHtml(c.sellos, c.meta, pr && pr.icono) +
          '<div class="small muted">' + c.premios.map(function (p) { return p.sellos + ' sellos: ' + esc(p.nombre); }).join(' · ') + '</div>' +
          '<label class="check" style="margin-top:6px"><input type="checkbox" data-rsello' + (st.sello ? ' checked' : '') + (c.sello_hoy ? ' disabled' : '') + '> Sumar sello de esta visita' +
          (c.sello_hoy ? ' <span class="chip">ya sumó hoy</span>' : ' <span class="small muted">(compra mínima ' + gs(pr ? pr.minimo_gs : 0) + ')</span>') + '</label>' +
          (c.cupones.length ? '<div class="f" style="margin-top:6px">Premios disponibles</div>' + c.cupones.map(function (cu) {
            var v = valorCupon(cu, opts.items, opts.menu);
            return '<label class="check"><input type="checkbox" data-rcu="' + esc(cu.cupon_id) + '"' + (st.cupones[cu.cupon_id] ? ' checked' : '') + '> 🎁 ' + esc(cu.nombre) +
              (v >= 0 ? ' · <span class="num">−' + gs(v) + '</span>' : ' <span class="small" style="color:var(--vino)">(agregá el producto a la cuenta para canjearlo)</span>') +
              (cu.vence_en ? ' <span class="small muted">vence ' + M.fechaHora(cu.vence_en).slice(0, 5) + '</span>' : '') + '</label>';
          }).join('') : '');
      } else {
        html += '<div class="row small" style="margin-top:6px"><span class="muted grow">Si el cliente no tiene tarjeta, registralo en 20 segundos.</span><button class="btn small" data-rn>+ Nuevo cliente</button></div><div class="small" data-rmsg style="color:var(--vino)"></div>';
      }
      box.innerHTML = html;
    }
    function buscar(q) {
      if (!q) return;
      st.buscando = true;
      M.call('rec.buscar', { q: q }).then(function (r) {
        st.buscando = false;
        if (!r.encontrado) { pintar(); var e = box.querySelector('[data-rmsg]'); if (e) e.textContent = 'No encontramos esa tarjeta. Revisá el número o registralo.'; var i = box.querySelector('[data-rq]'); if (i) i.value = q; return; }
        st.cli = r.cliente; st.sello = !r.cliente.sello_hoy; st.cupones = {};
        if (r.cumple_nuevo) M.toast('🎂 ¡Cumpleaños! ' + r.cliente.nombre + ' tiene un premio de regalo.', 'ok', 6000);
        pintar(); emit();
      }, function (e) { st.buscando = false; M.toast(e.message, 'error'); });
    }
    box.addEventListener('click', function (e) {
      if (e.target.closest('[data-rb]')) buscar(box.querySelector('[data-rq]').value.trim());
      if (e.target.closest('[data-rs]')) scan().then(function (t) { if (t) buscar(t); });
      if (e.target.closest('[data-rx]')) { st.cli = null; st.cupones = {}; pintar(); emit(); }
      if (e.target.closest('[data-rn]')) registrar({ celular: (box.querySelector('[data-rq]') || {}).value }, opts.programa && opts.programa.nombre).then(function (r) { if (r) buscar(r.cliente.codigo); });
    });
    box.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.matches('[data-rq]')) { e.preventDefault(); buscar(e.target.value.trim()); } });
    box.addEventListener('change', function (e) {
      if (e.target.matches('[data-rsello]')) { st.sello = e.target.checked; emit(); }
      if (e.target.matches('[data-rcu]')) { st.cupones[e.target.getAttribute('data-rcu')] = e.target.checked; pintar(); emit(); }
    });
    pintar();
    if (opts.vinculado) buscar(opts.vinculado);
    return { estado: estado };
  }

  w.Rec = { scan: scan, registrar: registrar, enviarTarjeta: enviarTarjeta, panelCobro: panelCobro, linkTarjeta: linkTarjeta, waTarjeta: waTarjeta, sellosHtml: sellosHtml, ICON: ICON };
})(window);
