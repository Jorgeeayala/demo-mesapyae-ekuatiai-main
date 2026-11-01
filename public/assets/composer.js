/* Compositor de pedidos reutilizable (mozo, caja, menú QR). */
(function (w) {
  'use strict';
  var M = w.Mesa, esc = M.esc, gs = M.gs;

  function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

  function Composer(opts) {
    // opts: {el, menu, publico, titulo, contexto, pedirAlias, aliasObligatorio, permitirDirecta, botonTxt, onSubmit(payload)->Promise, onCancel}
    var menu = opts.menu;
    var prods = {}; menu.productos.forEach(function (p) { prods[p.id] = p; });
    var grupos = {}; menu.grupos.forEach(function (g) { grupos[g.id] = g; });
    var opciones = {}; menu.grupos.forEach(function (g) { g.opciones.forEach(function (o) { opciones[o.id] = o; o.grupo = g.id; }); });
    var st = { cat: (opts.vista && opts.vista.cat) || (menu.categorias.length ? menu.categorias[0].id : ''), q: (opts.vista && opts.vista.q) || '', lines: [], obs: '', alias: '', directa: false, reqId: M.uid(), sending: false, persona: opts.personaInicial || '', personaNombre: '', wa: opts.waInicial || '', promos: false };
    var personas = opts.personas || []; // sub-cuentas de la mesa: [{id, nombre}]
    function nombrePersona(id) { var x = personas.filter(function (y) { return y.id === id; })[0]; return x ? x.nombre : 'Compartido'; }
    var el = opts.el;

    // Igual que el servidor: los grupos con regla MAYOR (mitad y mitad) suman solo la diferencia más alta.
    function unitPrice(p, sel) {
      var mayor = 0;
      return p.precio + sel.reduce(function (s, id) {
        var o = opciones[id]; if (!o) return s;
        if (grupos[o.grupo] && grupos[o.grupo].regla === 'MAYOR') { mayor = Math.max(mayor, o.delta); return s; }
        return s + o.delta;
      }, 0) + mayor;
    }
    // Igual que el servidor: "Pan: Brioche", "+ Carne x2", "Sin cebolla".
    function optText(sel) {
      var veces = {}, orden = [];
      sel.forEach(function (id) { if (!veces[id]) orden.push(id); veces[id] = (veces[id] || 0) + 1; });
      return orden.map(function (id) {
        var o = opciones[id]; if (!o) return '';
        var G = grupos[o.grupo], g = G.nombre, rep = Math.max(1, G.repetir || 1);
        if (G.tipo === 'QUITAR') return 'Sin ' + o.nombre.charAt(0).toLowerCase() + o.nombre.slice(1);
        var t = rep > 1 ? '+ ' + o.nombre : o.nombre.toLowerCase().indexOf(g.toLowerCase()) === 0 ? o.nombre : g + ': ' + o.nombre;
        return veces[id] > 1 ? t + ' x' + veces[id] : t;
      }).filter(Boolean).join(' · ');
    }
    function total() { return st.lines.reduce(function (s, l) { return s + l.precio * l.cantidad; }, 0); }
    function count() { return st.lines.reduce(function (s, l) { return s + l.cantidad; }, 0); }
    function changed() { st.reqId = M.uid(); } // carrito distinto => nueva solicitud

    function addLine(p, sel, qty, nota) {
      var key = p.id + '|' + sel.slice().sort().join(',') + '|' + (nota || '') + '|' + st.persona;
      var ex = st.lines.filter(function (l) { return l.key === key; })[0];
      if (ex) ex.cantidad = Math.min(20, ex.cantidad + qty);
      else st.lines.push({ key: key, producto_id: p.id, nombre: p.nombre, opciones: sel, opcionesTxt: optText(sel), precio: unitPrice(p, sel), cantidad: qty, observacion: nota || '', persona: st.persona });
      changed(); renderCart();
      M.toast(qty + ' × ' + p.nombre + ' agregado', 'ok', 1500);
    }

    function openProduct(p) {
      if (!p.disponible) { M.toast(p.nombre + ' no está disponible ahora.', 'error'); return; }
      var gs_ = p.grupos.map(function (g) { return grupos[g]; }).filter(Boolean);
      // Upgrade "Armá tu pedido": pizza y hamburguesa armables con animación en la carta del cliente.
      if (opts.armador && p.armador && w.Armador) {
        w.Armador.abrir(p, { grupos: gs_, precio: function (sel) { return unitPrice(p, sel); }, onAgregar: function (sel, qty, nota) { addLine(p, sel, qty, nota); } });
        return;
      }
      var foto = opts.publico && p.imagen;
      if (!gs_.length && !opts.siempreDetalle && !foto) { addLine(p, [], 1, ''); return; }
      var sel = {}; var qty = 1;
      var body = (foto ? '<img class="prod-hero" src="' + esc(p.imagen) + '" alt="' + esc(p.nombre) + '" loading="lazy" onerror="this.style.display=\'none\'">' : '') + (opts.ver3d && p.modelo_3d ? '<button type="button" class="btn block v3d-btn" data-ver3d>🧊 Ver este plato en 3D</button>' : '') +
        (p.descripcion ? '<p class="muted" style="margin-top:0">' + esc(p.descripcion) + '</p>' : '') +
        gs_.map(function (g) {
          var multi = g.max > 1, rep = Math.max(1, g.repetir || 1);
          return '<div class="opt-group" data-g="' + esc(g.id) + '"><h3><span>' + esc(g.nombre) + '</span><span class="chip ' + (g.min > 0 ? 'mostaza' : '') + '">' +
            (g.min > 0 ? (g.min === g.max ? 'Elegí ' + g.min : 'Mín. ' + g.min) : 'Opcional') + (multi && g.max !== g.min ? ' · máx. ' + g.max : '') + '</span></h3>' +
            g.opciones.filter(function (o) { return o.activo !== false; }).map(function (o) {
              var precioTxt = g.regla === 'MAYOR' ? '<span class="num muted">' + gs(p.precio + o.delta) + '</span>' : (o.delta ? '<span class="num">+ ' + gs(o.delta) + '</span>' : '');
              // Agregados que se pueden pedir más de una vez (doble carne): contador en vez de casilla.
              if (rep > 1) return '<div class="opt" data-rep="' + esc(o.id) + '" data-repg="' + esc(g.id) + '"><span class="grow">' + esc(o.nombre) + '</span>' + precioTxt +
                '<span class="qty"><button type="button" data-rq="-1" aria-label="Menos ' + esc(o.nombre) + '">−</button><span data-rv>0</span><button type="button" data-rq="1" aria-label="Más ' + esc(o.nombre) + '">+</button></span></div>';
              return '<label class="opt"><input type="' + (multi ? 'checkbox' : 'radio') + '" name="g_' + esc(g.id) + '" value="' + esc(o.id) + '">' +
                '<span class="grow">' + esc(g.tipo === 'QUITAR' ? 'Sin ' + o.nombre.toLowerCase() : o.nombre) + '</span>' + precioTxt + '</label>';
            }).join('') + '</div>';
        }).join('') +
        '<label class="f">Aclaración para cocina (opcional)</label><input class="input" data-nota maxlength="140" placeholder="Ej.: sin cebolla">' +
        '<div class="row" style="margin-top:14px"><span class="grow">Cantidad</span><span class="qty"><button type="button" data-q="-1" aria-label="Menos">−</button><span data-qv>1</span><button type="button" data-q="1" aria-label="Más">+</button></span></div>';
      var m = M.modal({
        title: p.nombre, body: body,
        foot: '<button class="btn prim big block" data-add>Agregar · <span data-pt>' + gs(p.precio) + '</span></button>', noFocus: true
      });
      var reps = {};
      function selected() {
        var s = M.$$('input:checked', m.el).map(function (i) { return i.value; });
        Object.keys(reps).forEach(function (id) { for (var k = 0; k < reps[id]; k++) s.push(id); });
        return s;
      }
      function enGrupo(gid) { return Object.keys(reps).reduce(function (t, id) { return t + (opciones[id].grupo === gid ? reps[id] : 0); }, 0); }
      function upd() {
        M.$$('.opt', m.el).forEach(function (l) { var i = l.querySelector('input'); if (i) l.classList.toggle('on', i.checked); }); // las filas con contador (dobles) marcan solas
        // respetar máximo en checkboxes
        gs_.forEach(function (g) {
          if (g.max <= 1) return;
          var boxes = M.$$('[data-g="' + g.id + '"] input', m.el), n = boxes.filter(function (b) { return b.checked; }).length;
          boxes.forEach(function (b) { b.disabled = !b.checked && n >= g.max; });
        });
        m.$('[data-qv]').textContent = qty;
        m.$('[data-pt]').textContent = gs(unitPrice(p, selected()) * qty);
      }
      m.el.addEventListener('change', upd);
      m.el.addEventListener('click', function (e) {
        var q = e.target.closest('[data-q]'); if (q) { qty = Math.max(1, Math.min(20, qty + Number(q.getAttribute('data-q')))); upd(); }
        var rq = e.target.closest('[data-rq]');
        if (rq) {
          var row = rq.closest('[data-rep]'), id = row.getAttribute('data-rep'), G = grupos[row.getAttribute('data-repg')], d = Number(rq.getAttribute('data-rq')), n = reps[id] || 0;
          if (d > 0 && n >= Math.max(1, G.repetir || 1)) { M.toast('Máximo ' + G.repetir + ' de ' + opciones[id].nombre.toLowerCase() + '.', '', 1800); return; }
          if (d > 0 && enGrupo(G.id) >= G.max) { M.toast('Máximo ' + G.max + ' en ' + G.nombre.toLowerCase() + '.', '', 1800); return; }
          reps[id] = Math.max(0, n + d);
          row.querySelector('[data-rv]').textContent = reps[id];
          row.classList.toggle('on', reps[id] > 0);
          upd();
        }
        if (e.target.closest('[data-ver3d]')) opts.ver3d(p, null);
      });
      m.$('[data-add]').onclick = function () {
        var s = selected();
        for (var i = 0; i < gs_.length; i++) {
          var g = gs_[i], n = s.filter(function (id) { return opciones[id] && opciones[id].grupo === g.id; }).length;
          if (n < g.min) { M.toast('Elegí "' + g.nombre + '".', 'error'); var sec = m.$('[data-g="' + g.id + '"]'); if (sec) sec.scrollIntoView({ behavior: 'smooth' }); return; }
        }
        addLine(p, s, qty, m.$('[data-nota]').value.trim());
        m.close();
      };
    }

    function prodHtml(p) {
      var foto = opts.publico && p.imagen;
      var armable = opts.armador && p.armador;
      return '<button type="button" class="prod' + (p.disponible ? '' : ' agotado') + (foto ? ' con-foto' : '') + '" data-p="' + esc(p.id) + '">' +
        (foto ? '<img class="prod-foto" src="' + esc(p.imagen) + '" alt="" loading="lazy" decoding="async" onerror="this.style.display=\'none\'"><span class="prod-txt">' : '') +
        '<span class="pn">' + esc(p.nombre) + (p.dia ? ' <span class="chip oliva dia-chip">Hoy · ' + esc(p.dia) + '</span>' : '') + (opts.ver3d && p.modelo_3d ? ' <span class="chip v3d-chip" data-3d="' + esc(p.id) + '" role="button" aria-label="Ver ' + esc(p.nombre) + ' en 3D">3D</span>' : '') + (armable ? ' <span class="chip mostaza arma-chip">' + (p.armador === 'HAMBURGUESA' ? '🍔' : '🍕') + ' Armala a tu gusto</span>' : '') + '</span>' +
        (opts.publico && p.descripcion ? '<span class="small muted">' + esc(p.descripcion) + '</span>' : '') +
        '<span class="row"><span class="pp">' + gs(p.precio) + (p.grupos.some(function (g) { return grupos[g] && grupos[g].min > 0 && grupos[g].opciones.some(function (o) { return o.delta > 0; }); }) ? '<span class="muted small"> desde</span>' : '') + '</span>' +
        (p.disponible ? '' : '<span class="chip vino right">Agotado</span>') + '</span>' + (foto ? '</span>' : '') + '</button>';
    }

    // La carta se arma una vez (buscador + categorías + lista) y después solo se actualiza la lista:
    // así la fila de categorías no vuelve al principio y la pantalla no salta al elegir otra.
    function renderMenu() {
      var box = M.$('[data-menu]', el);
      if (!menu.categorias.some(function (c) { return c.id === st.cat; })) st.cat = menu.categorias.length ? menu.categorias[0].id : '';
      var tabsScroll = box.querySelector('.tabs.cats') ? box.querySelector('.tabs.cats').scrollLeft : 0;
      box.innerHTML =
        '<div class="row" style="margin-bottom:10px"><input class="input" data-search type="search" placeholder="Buscar producto…" value="' + esc(st.q) + '" aria-label="Buscar producto"></div>' +
        '<div class="tabs cats" style="margin-bottom:12px" role="tablist">' + menu.categorias.map(function (c) {
          return '<button type="button" class="tab" role="tab" data-c="' + esc(c.id) + '">' + esc(c.nombre) + '</button>';
        }).join('') + '</div><div data-list></div>';
      M.$('.tabs.cats', box).scrollLeft = tabsScroll;
      renderList();
    }
    function renderList() {
      var box = M.$('[data-menu]', el), q = norm(st.q);
      var catNom = {}; menu.categorias.forEach(function (c) { catNom[c.id] = norm(c.nombre); });
      var list = menu.productos.filter(function (p) {  // la búsqueda también encuentra por categoría ("pizza" → todas las pizzas)
        return q ? (norm(p.nombre).indexOf(q) >= 0 || norm(p.descripcion).indexOf(q) >= 0 || (catNom[p.categoria] || '').indexOf(q) >= 0) : p.categoria === st.cat;
      });
      var tabs = M.$('.tabs.cats', box);
      tabs.hidden = !!q;
      M.$$('[data-c]', tabs).forEach(function (b) { var on = b.getAttribute('data-c') === st.cat; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
      M.$('[data-list]', box).innerHTML = list.length ? '<div class="prodlist">' + list.map(prodHtml).join('') + '</div>' : '<div class="empty">' + (q ? 'Sin resultados.' : 'Sin productos en esta categoría.') + '</div>';
      if (opts.onVista) opts.onVista({ cat: st.cat, q: st.q });
    }
    function elegirCategoria(id, boton) {
      if (id === st.cat) return;
      st.cat = id; renderList();
      // La categoría elegida queda visible en la fila (centrada si se puede)
      var tabs = boton.parentNode;
      tabs.scrollTo({ left: Math.max(0, boton.offsetLeft - (tabs.clientWidth - boton.offsetWidth) / 2), behavior: 'smooth' });
      // Si el cliente estaba más abajo, lo llevamos al comienzo de la nueva categoría (justo debajo de las categorías)
      var lista = M.$('[data-list]', el), top = lista.getBoundingClientRect().top;
      var alto = tabs.getBoundingClientRect().bottom;
      if (top < alto) window.scrollBy({ top: top - alto - 4, behavior: 'smooth' });
    }

    function cartHtml() {
      return (opts.publico ? '' : '<h2 style="margin-bottom:6px">' + esc(opts.carritoTitulo || 'Pedido') + '</h2>') + (opts.contexto ? '<div class="small muted" style="margin-bottom:6px">' + opts.contexto + '</div>' : '') +
        (personas.length ? '<div class="para-quien"><div class="f">¿Para quién? <span class="muted small">(lo que agregues va a esta persona)</span></div><div class="chips-p">' +
          personas.concat([{ id: '', nombre: 'Compartido' }]).map(function (x) { return '<button type="button" class="chip-p' + (st.persona === x.id ? ' on' : '') + '" data-pp="' + esc(x.id) + '">' + esc(x.nombre) + '</button>'; }).join('') + '</div></div>' : '') +
        (opts.personasNombres && opts.personasNombres.length ? '<label class="f" for="cmp-quien">¿Quién pide? (opcional)</label><input class="input" id="cmp-quien" data-quien list="cmp-quienes" maxlength="30" placeholder="Tu nombre" value="' + esc(st.personaNombre) + '" autocomplete="given-name"><datalist id="cmp-quienes">' + opts.personasNombres.map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist><p class="small muted" style="margin:4px 0 8px">Así tu consumo queda en tu cuenta y podés pagar por separado.</p>' : '') +
        (st.lines.length ? st.lines.map(function (l, i) {
          return '<div class="line"><div class="grow"><div><strong>' + esc(l.nombre) + '</strong></div>' +
            (l.opcionesTxt ? '<div class="small muted">' + esc(l.opcionesTxt) + '</div>' : '') +
            (l.observacion ? '<div class="small" style="color:var(--arcilla)">“' + esc(l.observacion) + '”</div>' : '') +
            (personas.length ? '<div class="small"><span class="chip">' + esc(nombrePersona(l.persona)) + '</span></div>' : '') +
            '<div class="small num">' + gs(l.precio * l.cantidad) + '</div></div>' +
            '<span class="qty"><button type="button" data-l="' + i + '" data-d="-1" aria-label="Menos">−</button><span>' + l.cantidad + '</span><button type="button" data-l="' + i + '" data-d="1" aria-label="Más">+</button></span></div>';
        }).join('') : '<div class="empty">Tocá un producto para agregarlo.</div>') +
        (opts.pedirAlias ? '<label class="f" style="margin-top:12px">' + esc(opts.aliasLabel || 'Nombre para llamar el pedido') + (opts.aliasObligatorio ? '' : ' (opcional)') + '</label><input class="input" data-alias maxlength="40" value="' + esc(st.alias) + '" autocomplete="given-name">' : '') +
        (opts.pedirWhatsapp ? '<label class="f" style="margin-top:12px">Tu WhatsApp' + (opts.pedirWhatsapp === 'OBLIGATORIO' ? '' : ' (opcional)') + '</label><input class="input" data-wa type="tel" inputmode="tel" maxlength="20" placeholder="0981 123 456" value="' + esc(st.wa) + '" autocomplete="tel">' +
          '<div class="small muted">Para avisarte cuando tu pedido esté listo.</div>' +
          '<label class="check"><input type="checkbox" data-promos' + (st.promos ? ' checked' : '') + '> Quiero recibir novedades y promociones' + (opts.negocio ? ' de ' + esc(opts.negocio) : '') + ' por WhatsApp</label>' : '') +
        '<label class="f" style="margin-top:12px">Observación general (opcional)</label><textarea class="input" data-obs maxlength="200" placeholder="Ej.: traer todo junto">' + esc(st.obs) + '</textarea>' +
        (opts.permitirDirecta ? '<label class="check"><input type="checkbox" data-directa' + (st.directa ? ' checked' : '') + '> Venta directa (se entrega ya, no pasa por cocina)</label>' : '') +
        '<div class="total-row"><span>Total estimado</span><span class="num">' + gs(total()) + '</span></div>' +
        '<p class="small muted" style="margin-top:-4px">El total final lo confirma el sistema al enviar.</p>' +
        '<div class="row"><button type="button" class="btn grow" data-cancel>' + esc(opts.cancelTxt || 'Volver') + '</button>' +
        '<button type="button" class="btn prim grow big" data-send' + (st.lines.length && !st.sending ? '' : ' disabled') + '>' + (st.sending ? 'Enviando…' : esc(opts.botonTxt || 'Enviar pedido')) + '</button></div>' +
        '<p class="small" data-err style="color:var(--vino);min-height:1em"></p>';
    }

    function renderCart() {
      var c = M.$('[data-cart]', el);
      if (opts.publico) {
        var bar = M.$('[data-bar]', el);
        bar.classList.toggle('hidden', !st.lines.length);
        bar.innerHTML = '<button type="button" class="btn prim big block" data-open-cart>Ver pedido (' + count() + ') · ' + gs(total()) + '</button>';
        if (st.cartModal) { st.cartModal.$('.sheet-b').innerHTML = '<div class="cart">' + cartHtml() + '</div>'; }
        return;
      }
      c.innerHTML = cartHtml();
    }

    function payload() {
      return {
        request_id: st.reqId, observacion: st.obs, alias: st.alias, venta_directa: st.directa, persona_nombre: st.personaNombre.trim(),
        whatsapp: opts.pedirWhatsapp ? st.wa.trim() : undefined, acepta_promos: opts.pedirWhatsapp ? st.promos : undefined,
        items: st.lines.map(function (l) { return { producto_id: l.producto_id, cantidad: l.cantidad, opciones: l.opciones, observacion: l.observacion, persona: l.persona || '' }; })
      };
    }
    function send() {
      if (st.sending || !st.lines.length) return;
      if (opts.pedirAlias && opts.aliasObligatorio && !st.alias.trim()) { M.toast('Indicá un nombre para llamar el pedido.', 'error'); return; }
      var waDig = st.wa.replace(/[^0-9]/g, '');
      if (opts.pedirWhatsapp === 'OBLIGATORIO' && !waDig) { M.toast('Dejanos tu WhatsApp para avisarte cuando tu pedido esté listo.', 'error'); return; }
      if (opts.pedirWhatsapp && waDig && waDig.length < 9) { M.toast('Revisá tu número de WhatsApp (ej.: 0981 123 456).', 'error'); return; }
      st.sending = true; renderCart();
      Promise.resolve(opts.onSubmit(payload())).then(function (res) {
        st.sending = false; st.lines = []; st.obs = ''; st.alias = ''; st.directa = false; changed();
        if (st.cartModal) { st.cartModal.close(); st.cartModal = null; }
        renderCart();
        return res;
      }, function (e) {
        st.sending = false; renderCart();
        var errEl = st.cartModal ? st.cartModal.$('[data-err]') : M.$('[data-err]', el);
        var msg = e && e.message ? e.message : 'No se pudo enviar.';
        if (e && e.red) msg += ' Tu pedido sigue acá: tocá de nuevo para reintentar (no se duplicará).';
        if (errEl) errEl.textContent = msg;
        M.toast(msg, 'error');
        // Si el catálogo cambió (agotado/precio), no conservar el mismo request_id
        if (e && !e.red) changed();
      });
    }

    function onClick(e) {
      var t;
      if ((t = e.target.closest('[data-pp]'))) { st.persona = t.getAttribute('data-pp'); renderCart(); return; }
      if ((t = e.target.closest('[data-c]'))) { elegirCategoria(t.getAttribute('data-c'), t); return; }
      if (opts.ver3d && (t = e.target.closest('[data-3d]'))) { e.stopPropagation(); opts.ver3d(prods[t.getAttribute('data-3d')], function (p) { openProduct(p); }); return; }
      if ((t = e.target.closest('[data-p]'))) { openProduct(prods[t.getAttribute('data-p')]); return; }
      if ((t = e.target.closest('[data-l]'))) {
        var l = st.lines[Number(t.getAttribute('data-l'))];
        l.cantidad += Number(t.getAttribute('data-d'));
        if (l.cantidad <= 0) st.lines.splice(st.lines.indexOf(l), 1);
        if (l.cantidad > 20) l.cantidad = 20;
        changed(); renderCart(); return;
      }
      if (e.target.closest('[data-send]')) { send(); return; }
      if (e.target.closest('[data-cancel]')) { if (st.cartModal) { st.cartModal.close(); st.cartModal = null; } else if (opts.onCancel) opts.onCancel(); return; }
      if (e.target.closest('[data-open-cart]')) {
        st.cartModal = M.modal({ title: 'Tu pedido', body: '<div class="cart">' + cartHtml() + '</div>', noFocus: true, onClose: function () { st.cartModal = null; } });
        st.cartModal.el.addEventListener('click', onClick);
        st.cartModal.el.addEventListener('input', onInput);
        st.cartModal.el.addEventListener('change', onInput);
      }
    }
    function onInput(e) {
      if (e.target.matches('[data-search]')) { if (st.q !== e.target.value) { st.q = e.target.value; renderList(); } }  // 'change' al salir del buscador no vuelve a dibujar (perdería el toque)
      else if (e.target.matches('[data-obs]')) { st.obs = e.target.value; changed(); }
      else if (e.target.matches('[data-alias]')) { st.alias = e.target.value; changed(); }
      else if (e.target.matches('[data-wa]')) { st.wa = e.target.value; changed(); }
      else if (e.target.matches('[data-promos]')) { st.promos = e.target.checked; changed(); }
      else if (e.target.matches('[data-quien]')) { st.personaNombre = e.target.value; changed(); }
      else if (e.target.matches('[data-directa]')) { st.directa = e.target.checked; changed(); }
    }

    el.innerHTML = (opts.titulo ? '<div class="section-h" style="margin-top:0">' + opts.titulo + '</div>' : '') +
      '<div class="composer' + (opts.publico ? ' publico' : '') + '"><div data-menu></div>' + (opts.publico ? '' : '<div class="cart card pad" data-cart></div>') + '</div>' +
      (opts.publico ? '<div data-bar class="hidden" style="position:sticky;bottom:0;padding:12px 0;background:linear-gradient(transparent,var(--crema) 30%)"></div>' : '');
    el.addEventListener('click', onClick);
    // Rueda del mouse sobre las categorías: desplaza en horizontal cuando la fila no entra.
    el.addEventListener('wheel', function (e) {
      var t = e.target.closest && e.target.closest('.tabs.cats');
      if (!t || t.scrollWidth <= t.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      t.scrollLeft += e.deltaY; e.preventDefault();
    }, { passive: false });
    el.addEventListener('input', onInput);
    el.addEventListener('change', onInput);
    renderMenu(); renderCart();

    return {
      setMenu: function (m) { menu = m; prods = {}; m.productos.forEach(function (p) { prods[p.id] = p; }); renderMenu(); },
      hasItems: function () { return st.lines.length > 0; }
    };
  }
  w.Composer = Composer;
})(window);
