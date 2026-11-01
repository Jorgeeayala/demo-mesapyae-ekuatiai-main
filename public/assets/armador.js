/*
 * Upgrade "Armá tu pedido" (módulo ARMADOR): el cliente arma su pizza, su porción o su hamburguesa en la carta QR.
 * Cada ingrediente que toca cae sobre la pizza (repartido parejo) o se apila en la hamburguesa, y el precio se
 * actualiza al instante. Al terminar: la pizza y la porción se hornean y se cierran en su caja; la hamburguesa se
 * cierra en su caja. Las cajas llevan el logo de Mesa Pya'e. Los dibujos están en armador-dibujos.js.
 * Usa los grupos de opciones de siempre (los precios salen del catálogo del local):
 *   - grupo tipo TAMANO: tamaño de la pizza (cambia el tamaño del dibujo).
 *   - grupo tipo QUITAR: lo que trae el plato de la carta; el cliente lo puede sacar sin costo.
 *   - grupo de una sola elección (ej. Pan, Proteína): botones.
 *   - grupo de agregados: grilla de ingredientes; con "repetir" > 1 se puede pedir doble o triple.
 * Uso: Armador.abrir(producto, { grupos: [...], precio: fn(sel) → Gs., onAgregar: fn(sel, cantidad, nota) })
 */
(function (w) {
  'use strict';
  var M = w.Mesa, esc = M.esc, gs = M.gs, D = w.ArmadorDibujos;
  var reducir = w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var dibujoDe = D.dibujoDe;

  // ------------------------------------------------------------------ estilos
  var ESTILOS = [
    '.ar{position:fixed;inset:0;z-index:60;display:flex;justify-content:center;background:rgba(18,14,10,.55);animation:arFade .2s ease-out}',
    '.ar-app{width:100%;max-width:520px;height:100%;display:flex;flex-direction:column;overflow:hidden;position:relative}',
    '.ar.pizza .ar-app{background:radial-gradient(120% 70% at 50% 18%,#3A3245 0%,#211C29 55%,#17131D 100%);color:#F6EFE6}',
    '.ar.hamburguesa .ar-app{background:radial-gradient(120% 70% at 50% 20%,#FFFDF8 0%,#F5EEE1 60%,#EBE1CF 100%);color:var(--tinta)}',
    '.ar-top{display:flex;align-items:center;gap:10px;padding:12px 14px 4px}',
    '.ar-top h2{flex:1;font-size:1.2rem;line-height:1.15;text-transform:none;letter-spacing:0}',
    '.ar-top h2 small{display:block;font-family:var(--f-ui);font-weight:500;font-size:.78rem;opacity:.7;margin-top:2px}',
    '.ar-x{width:40px;height:40px;border-radius:50%;border:0;font-size:1.1rem;cursor:pointer;background:rgba(255,255,255,.14);color:inherit}',
    '.ar.hamburguesa .ar-x{background:rgba(0,0,0,.07)}',
    '.ar-pills{display:flex;gap:6px;flex-wrap:wrap;padding:4px 14px 0;align-items:center}',
    '.ar-pills .lbl{font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;opacity:.7;margin-right:2px}',
    '.ar-pill{border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.06);color:inherit;border-radius:999px;padding:6px 12px;font:inherit;font-size:.85rem;cursor:pointer;display:inline-flex;align-items:center;gap:6px;min-height:36px}',
    '.ar.hamburguesa .ar-pill{border-color:var(--linea-2);background:#fff}',
    '.ar-pill.on{background:#F4A934;border-color:#F4A934;color:#2A1A05;font-weight:600}',
    '.ar.hamburguesa .ar-pill.on{background:var(--tierra);border-color:var(--tierra);color:#fff}',
    '.ar-pill svg{width:30px;height:19px}',
    '.ar-pill small{opacity:.75;font-size:.75rem}',
    '.ar-stage{position:relative;flex:0 0 auto;height:clamp(200px,42vh,400px);transition:height .45s cubic-bezier(.3,1,.5,1);display:flex;align-items:flex-end;justify-content:center;overflow:visible;perspective:900px}',
    // pizza y porción
    '.ar-pzw{position:relative;width:min(84vw,300px);height:min(84vw,300px);max-height:100%;align-self:center}',
    '.ar-pzw>svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}',
    '.ar-pz{transition:transform .6s cubic-bezier(.3,1.2,.5,1),filter .8s}',
    '.ar-pz .raiz{transition:transform .45s cubic-bezier(.3,1.4,.5,1);transform-box:fill-box;transform-origin:center}',
    '.ar-pz .pz{transition:transform .35s ease,opacity .25s}',
    '.ar-pz .pz.cae>g{animation:arPzCae .5s cubic-bezier(.2,.9,.3,1.25) both;transform-box:fill-box;transform-origin:center}',
    '.ar-pz .pz.sale{opacity:0}',
    '.ar-pz .capa{transition:opacity .35s}',
    '.ar-pz .capa.cae{animation:arCapa .5s ease-out both;transform-box:fill-box;transform-origin:center}',
    '.ar-pz .tost{opacity:0;transition:opacity 1.1s ease-in}',
    '.ar.horneando .ar-pz .tost,.ar.encajando .ar-pz .tost{opacity:1}',
    '.ar.horneando .ar-pz{filter:saturate(1.15) brightness(1.05)}',
    '.ar-cfondo{opacity:0;transform:scale(1.12);transition:opacity .35s,transform .45s cubic-bezier(.3,1.2,.5,1)}',
    '.ar-ctapa{opacity:0;transform-origin:50% 8%;transform:rotateX(-100deg);transition:transform .75s cubic-bezier(.45,.05,.3,1.15),opacity .15s}',
    '.ar.encajando .ar-cfondo{opacity:1;transform:none}',
    '.ar.encajando .ar-pz{transform:scale(.86)}',
    '.ar.cerrada .ar-ctapa{opacity:1;transform:rotateX(0)}',
    // hamburguesa
    '.ar-hb{position:relative;width:240px;margin-bottom:22px;transform-origin:50% 100%;transition:transform .35s}',
    '.ar-hb .cap{position:absolute;left:0;width:240px;transition:bottom .35s cubic-bezier(.3,1.3,.5,1),opacity .25s}',
    '.ar-hb .cap svg{display:block;width:240px;overflow:visible}',
    '.ar-hb .cap.cae{animation:arHbCae .55s cubic-bezier(.25,.9,.35,1.15) both}',
    '.ar-hb .cap.sale{opacity:0;transform:translateY(-40px)}',
    '.ar-hcaja{position:absolute;left:-20px;width:280px;pointer-events:none}',
    '.ar-hcaja svg{display:block}',
    '.ar-habierta{left:-30px;width:300px;z-index:0;transform-origin:50% 100%;transform:scaleY(0);transition:transform .45s cubic-bezier(.3,1.2,.5,1)}',
    '.ar-hbase{z-index:200;transform:translateY(170%);opacity:0;transition:transform .5s cubic-bezier(.3,1.2,.5,1),opacity .2s}',
    '.ar-htapa{z-index:201;transform-origin:50% 100%;transform:perspective(700px) rotateX(-85deg) scaleY(.3);opacity:0;transition:transform .5s cubic-bezier(.35,.1,.3,1.2) .18s,opacity .15s .18s}',
    '.ar.empaque .ar-stage{height:clamp(260px,62vh,540px)}',
    '.ar.empaque .ar-hint{visibility:hidden}',
    '.ar.encajando .ar-hbase{transform:none;opacity:1}',
    '.ar.encajando .ar-habierta{transform:scaleY(1)}',
    '.ar.cerrada .ar-habierta{transform:scaleY(0);transition-duration:.25s}',
    '.ar.cerrada .ar-htapa{transform:none;opacity:1}',
    '.ar.cerrada .ar-hb{animation:arRebote .6s ease-out .55s}',
    '.ar-plato{position:absolute;bottom:8px;left:50%;width:300px;height:30px;margin-left:-150px;border-radius:50%;background:radial-gradient(closest-side,rgba(0,0,0,.22),rgba(0,0,0,0))}',
    '.ar.pizza .ar-plato{display:none}',
    '.ar-hint{text-align:center;font-size:.8rem;opacity:.75;padding:2px 14px 6px;min-height:1.4em}',
    '.ar-panel{flex:1 1 auto;overflow:auto;padding:4px 14px 10px;-webkit-overflow-scrolling:touch}',
    '.ar-sec{margin:8px 0 2px;font-size:.74rem;text-transform:uppercase;letter-spacing:.08em;opacity:.75;display:flex;justify-content:space-between}',
    '.ar-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}',
    '@media (max-width:360px){.ar-grid{grid-template-columns:repeat(3,1fr)}}',
    '.ar-ing{position:relative;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:inherit;border-radius:14px;padding:8px 4px 6px;font:inherit;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:2px;min-height:96px;transition:transform .12s,background .2s}',
    '.ar.hamburguesa .ar-ing{border-color:var(--linea);background:#fff}',
    '.ar-ing:active{transform:scale(.95)}',
    '.ar-ing .ic{width:48px;height:48px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.92)}',
    '.ar.hamburguesa .ar-ing .ic{background:var(--crema)}',
    '.ar-ing .ic svg{width:42px;height:42px}',
    '.ar-ing .nm{font-size:.74rem;line-height:1.15;text-align:center;font-weight:600}',
    '.ar-ing .pr{font-size:.68rem;opacity:.75}',
    '.ar-ing.on{border-color:#F4A934;background:rgba(244,169,52,.16)}',
    '.ar.hamburguesa .ar-ing.on{border-color:var(--tierra);background:#E8F0EA}',
    '.ar-ing .n{position:absolute;top:-6px;right:-4px;min-width:22px;height:22px;border-radius:11px;background:#F4A934;color:#2A1A05;font-size:.75rem;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 5px}',
    '.ar.hamburguesa .ar-ing .n{background:var(--tierra);color:#fff}',
    '.ar-ing .menos{position:absolute;top:-6px;left:-4px;width:24px;height:24px;border-radius:12px;border:0;background:#fff;color:#222;font-weight:700;box-shadow:0 1px 4px rgba(0,0,0,.25);cursor:pointer;line-height:1;display:flex;align-items:center;justify-content:center}',
    '.ar-ing.sin{opacity:.55}',
    '.ar-ing.sin .nm{text-decoration:line-through}',
    '.ar-ing.lleno{opacity:.5}',
    '.ar-nota{width:100%;margin-top:10px;border-radius:10px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.06);color:inherit;padding:10px 12px;font:inherit;font-size:.9rem}',
    '.ar.hamburguesa .ar-nota{border-color:var(--linea-2);background:#fff}',
    '.ar-foot{display:flex;gap:10px;align-items:center;padding:10px 14px calc(12px + env(safe-area-inset-bottom,0px));border-top:1px solid rgba(255,255,255,.1)}',
    '.ar.hamburguesa .ar-foot{border-top-color:var(--linea)}',
    '.ar-q{display:flex;align-items:center;gap:8px}',
    '.ar-q button{width:36px;height:36px;border-radius:50%;border:1px solid rgba(255,255,255,.3);background:transparent;color:inherit;font-size:1.1rem;cursor:pointer}',
    '.ar.hamburguesa .ar-q button{border-color:var(--linea-2)}',
    '.ar-add{flex:1;min-height:52px;white-space:nowrap;padding:0 12px;border:0;border-radius:14px;font:inherit;font-weight:700;font-size:1rem;cursor:pointer;background:#E5482F;color:#fff;box-shadow:0 6px 18px rgba(229,72,47,.35);transition:transform .15s,background .3s}',
    '.ar.hamburguesa .ar-add{background:var(--tierra);box-shadow:0 6px 18px rgba(19,78,57,.3)}',
    '.ar-add.ok{background:#2E9E5B}',
    '.ar-add .pt{display:inline-block}',
    '.ar-add .pt.bump{animation:arBump .35s ease-out}',
    // horno
    '.ar-horno{position:absolute;inset:0;pointer-events:none;opacity:0;background:radial-gradient(closest-side,rgba(255,140,40,.7),rgba(255,90,20,.28) 55%,rgba(0,0,0,0));transition:opacity .4s}',
    '.ar.horneando .ar-horno{opacity:1;animation:arHorno .9s ease-in-out infinite alternate}',
    '@keyframes arFade{from{opacity:0}}',
    '@keyframes arPzCae{0%{transform:translateY(-52px) scale(1.8);opacity:0}70%{opacity:1}100%{transform:none;opacity:1}}',
    '@keyframes arCapa{0%{transform:scale(.7);opacity:0}100%{transform:none;opacity:1}}',
    '@keyframes arHbCae{0%{transform:translateY(-330px);opacity:0}55%{opacity:1}75%{transform:translateY(7px)}90%{transform:translateY(-3px)}100%{transform:none}}',
    '@keyframes arBump{50%{transform:scale(1.15)}}',
    '@keyframes arHorno{from{transform:scale(.96)}to{transform:scale(1.05)}}',
    '@keyframes arRebote{0%{transform:scale(1)}30%{transform:scale(1.05,.92)}55%{transform:scale(.98,1.04)}100%{transform:scale(1)}}',
    '@media (prefers-reduced-motion:reduce){.ar *{animation:none!important;transition:none!important}}'
  ].join('\n');
  function estilos() {
    if (document.getElementById('ar-css')) return;
    var s = document.createElement('style'); s.id = 'ar-css'; s.textContent = ESTILOS; document.head.appendChild(s);
  }

  // ------------------------------------------------------------------ pantalla
  function abrir(p, o) {
    estilos();
    var tipo = p.armador === 'HAMBURGUESA' ? 'HAMBURGUESA' : p.armador === 'PORCION' ? 'PORCION' : 'PIZZA';
    var esPizza = tipo !== 'HAMBURGUESA';
    var tipoIcono = esPizza ? 'PIZZA' : 'HAMBURGUESA';
    // Copias: no se toca el menú de la carta.
    var grupos = (o.grupos || []).filter(Boolean).map(function (g) {
      var c = {}; Object.keys(g).forEach(function (k) { c[k] = g[k]; });
      c.opciones = g.opciones.filter(function (x) { return x.activo !== false; });
      return c;
    });
    var tamano = grupos.filter(function (g) { return g.tipo === 'TAMANO'; })[0] || null;
    var quitar = grupos.filter(function (g) { return g.tipo === 'QUITAR'; });
    var unicos = grupos.filter(function (g) { return g !== tamano && g.tipo !== 'QUITAR' && g.max === 1; });
    var multi = grupos.filter(function (g) { return g !== tamano && g.tipo !== 'QUITAR' && g.max > 1; });
    var opById = {}, grupoDe = {};
    grupos.forEach(function (g) { g.opciones.forEach(function (x) { opById[x.id] = x; grupoDe[x.id] = g; }); });

    // Estado: elección única por grupo, cantidades de agregados y lo que se sacó.
    var st = { unico: {}, n: {}, orden: [], sin: {}, qty: 1 };
    if (tamano && tamano.opciones.length) st.unico[tamano.id] = tamano.opciones[0].id;
    unicos.forEach(function (g) { if (g.min > 0 && g.opciones.length) st.unico[g.id] = g.opciones[0].id; });

    function seleccion() {
      var sel = [];
      if (tamano && st.unico[tamano.id]) sel.push(st.unico[tamano.id]);
      unicos.forEach(function (g) { if (st.unico[g.id]) sel.push(st.unico[g.id]); });
      quitar.forEach(function (g) { g.opciones.forEach(function (x) { if (st.sin[x.id]) sel.push(x.id); }); });
      st.orden.forEach(function (id) { for (var i = 0; i < (st.n[id] || 0); i++) sel.push(id); });
      return sel;
    }
    // Elecciones únicas que también se dibujan (ej. Proteína: carne o pollo). El pan y el tamaño se dibujan aparte.
    function unicasDibujables() {
      var out = [];
      unicos.forEach(function (g) { var x = opById[st.unico[g.id]]; if (x) { var d = dibujoDe(x); if (d !== 'GENERICO' && !/^PAN_/.test(d)) out.push(x); } });
      return out;
    }
    function totalGrupo(g) { return g.opciones.reduce(function (s, x) { return s + (st.n[x.id] || 0); }, 0); }

    var escenario;
    if (esPizza) {
      var caja = tipo === 'PORCION' ? D.cajaPorcion() : D.cajaPizza();
      escenario = '<div class="ar-pzw">' +
        '<svg class="ar-cfondo" viewBox="-170 -170 340 340" aria-hidden="true">' + caja.fondo + '</svg>' +
        '<svg class="ar-pz" viewBox="-170 -170 340 340" aria-hidden="true"><g class="raiz">' + (tipo === 'PORCION' ? D.porcionBase() : D.pizzaBase()) +
        '<g data-capas></g><g class="tost">' + (tipo === 'PORCION' ? D.porcionTostado() : D.pizzaTostado()) + '<g data-qtost></g></g><g data-piezas></g></g></svg>' +
        '<svg class="ar-ctapa" viewBox="-170 -170 340 340" aria-hidden="true">' + caja.tapa + '</svg></div>';
    } else {
      escenario = '<div class="ar-plato"></div><div class="ar-hb" data-hb></div>';
    }
    var ov = document.createElement('div');
    ov.className = 'ar ' + (esPizza ? 'pizza' : 'hamburguesa');
    ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'Armá tu ' + p.nombre);
    ov.innerHTML = D.DEFS + '<div class="ar-app">' +
      '<div class="ar-top"><h2>' + esc(p.nombre) + '<small>' + (tipo === 'HAMBURGUESA' ? 'Armala capa por capa' : tipo === 'PORCION' ? 'Armá tu porción a gusto' : 'Armala a tu gusto') + '</small></h2><button type="button" class="ar-x" data-arx aria-label="Cerrar">✕</button></div>' +
      '<div data-pills></div>' +
      '<div class="ar-stage"><div class="ar-horno"></div>' + escenario + '</div>' +
      '<div class="ar-hint" data-hint>' + (multi.length ? 'Tocá un ingrediente para agregarlo' : '') + '</div>' +
      '<div class="ar-panel" data-panel></div>' +
      '<div class="ar-foot"><div class="ar-q"><button type="button" data-q="-1" aria-label="Menos">−</button><strong data-qv>1</strong><button type="button" data-q="1" aria-label="Más">+</button></div>' +
      '<button type="button" class="ar-add" data-aradd>Agregar · <span class="pt" data-pt></span></button></div></div>';
    document.body.appendChild(ov);
    var $ = function (s) { return ov.querySelector(s); };
    var bodyOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    var timers = [];
    function cerrar() { timers.forEach(clearTimeout); ov.remove(); document.body.style.overflow = bodyOverflow; document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape' && !enviando) cerrar(); }
    document.addEventListener('keydown', onKey);

    // ---- botones de elección única (tamaño, pan, proteína…)
    function pillsHtml() {
      return [tamano].concat(unicos).filter(Boolean).map(function (g) {
        return '<div class="ar-pills" data-g="' + esc(g.id) + '"><span class="lbl">' + esc(g.nombre) + '</span>' + g.opciones.map(function (x) {
          var d = dibujoDe(x), on = st.unico[g.id] === x.id;
          return '<button type="button" class="ar-pill' + (on ? ' on' : '') + '" data-uni="' + esc(g.id) + '" data-op="' + esc(x.id) + '" aria-pressed="' + on + '">' +
            (/^PAN_/.test(d) && !esPizza ? D.icono(d, x, tipoIcono) : '') + esc(x.nombre) + (x.delta ? ' <small>+' + gs(x.delta) + '</small>' : '') + '</button>';
        }).join('') + '</div>';
      }).join('');
    }
    // ---- grilla de ingredientes
    function panelHtml() {
      var h = '';
      quitar.forEach(function (g) {
        if (!g.opciones.length) return;
        h += '<div class="ar-sec"><span>Trae · tocá para sacar</span></div><div class="ar-grid">' + g.opciones.map(function (x) {
          var sin = !!st.sin[x.id];
          return '<button type="button" class="ar-ing' + (sin ? ' sin' : ' on') + '" data-sin="' + esc(x.id) + '" aria-pressed="' + !sin + '" aria-label="' + (sin ? 'Volver a poner ' : 'Sacar ') + esc(x.nombre) + '">' +
            '<span class="ic">' + D.icono(dibujoDe(x), x, tipoIcono) + '</span><span class="nm">' + esc(sin ? 'Sin ' + x.nombre.toLowerCase() : x.nombre) + '</span><span class="pr">' + (sin ? 'Tocá para ponerlo' : 'Incluido') + '</span></button>';
        }).join('') + '</div>';
      });
      multi.forEach(function (g) {
        var tot = totalGrupo(g), lleno = tot >= g.max, rep = Math.max(1, g.repetir || 1);
        h += '<div class="ar-sec"><span>' + esc(g.nombre) + '</span><span>' + (g.min ? 'mín. ' + g.min + ' · ' : '') + tot + ' de ' + g.max + '</span></div><div class="ar-grid">' + g.opciones.map(function (x) {
          var n = st.n[x.id] || 0, tope = n >= rep || lleno;
          return '<button type="button" class="ar-ing' + (n ? ' on' : '') + (tope && !n ? ' lleno' : '') + '" data-mas="' + esc(x.id) + '" aria-label="Agregar ' + esc(x.nombre) + (x.delta ? ' (+' + gs(x.delta) + ')' : '') + (n ? ', van ' + n : '') + '">' +
            (n ? '<span class="n">' + (n > 1 ? 'x' + n : '✓') + '</span><span class="menos" data-menos="' + esc(x.id) + '" role="button" aria-label="Sacar uno de ' + esc(x.nombre) + '">−</span>' : '') +
            '<span class="ic">' + D.icono(dibujoDe(x), x, tipoIcono) + '</span><span class="nm">' + esc(x.nombre) + '</span><span class="pr">' + (x.delta ? '+ ' + gs(x.delta) : 'Sin costo') + '</span></button>';
        }).join('') + '</div>';
      });
      if (!quitar.length && !multi.length) h += '<p class="ar-hint">Este plato no tiene ingredientes para agregar.</p>';
      h += '<input class="ar-nota" data-nota maxlength="140" placeholder="Aclaración para cocina (opcional)">';
      return h;
    }

    // ---- dibujo: pizza y porción
    var vistos = {}; // primera pintura sin animación
    function ingredientesVisibles() {
      var l = unicasDibujables().map(function (x) { return { x: x, veces: 1 }; });
      quitar.forEach(function (g) { g.opciones.forEach(function (x) { if (!st.sin[x.id]) l.push({ x: x, veces: 1 }); }); });
      st.orden.forEach(function (id) { if (st.n[id]) l.push({ x: opById[id], veces: st.n[id] }); });
      return l;
    }
    function dibujarPizza() {
      var forma = tipo === 'PORCION' ? 'PORCION' : 'PIZZA', capas = [], piezas = [];
      ingredientesVisibles().forEach(function (v) {
        var d = dibujoDe(v.x);
        if (D.CAPA_PIZZA[d]) capas.push({ k: 'capa:' + v.x.id + ':' + v.veces, svg: D.capaQueso(D.CAPA_PIZZA[d], v.veces, v.x.id, forma), capa: true, id: v.x.id });
        else piezas.push({ k: v.x.id, d: d, veces: v.veces, o: v.x });
      });
      var raiz = $('.raiz');
      if (tamano && tipo === 'PIZZA') {
        var idx = Math.max(0, tamano.opciones.map(function (x) { return x.id; }).indexOf(st.unico[tamano.id]));
        var n = tamano.opciones.length, e = n > 1 ? 0.74 + 0.26 * idx / (n - 1) : 1;
        raiz.style.transform = 'scale(' + e.toFixed(3) + ')';
      }
      reconciliar($('[data-capas]'), capas, 'svg');
      // el queso gratinado del horno, sobre cada capa de queso
      $('[data-qtost]').innerHTML = capas.map(function (c) { return D.quesoTostado(c.id, forma); }).join('');
      var rep = D.repartir(piezas, forma).map(function (q, i) {
        return { k: q.k, svg: '<g><g>' + D.pieza(q.d, q.c, q.o) + '</g></g>', i: i, x: q.x, y: q.y, rot: q.rot };
      });
      reconciliar($('[data-piezas]'), rep, 'svg');
    }
    // ---- dibujo: hamburguesa
    function capasHamburguesa() {
      var pan = null;
      unicos.forEach(function (g) { var x = opById[st.unico[g.id]]; if (x && /^PAN_/.test(dibujoDe(x))) pan = dibujoDe(x); });
      var lista = unicasDibujables().map(function (x) { return { x: x, c: 0 }; });
      quitar.forEach(function (g) { g.opciones.forEach(function (x) { if (!st.sin[x.id]) lista.push({ x: x, c: 0 }); }); });
      st.orden.forEach(function (id) { for (var c = 0; c < (st.n[id] || 0); c++) lista.push({ x: opById[id], c: c + 1 }); });
      lista.forEach(function (l) { l.d = D.capaClave(dibujoDe(l.x)); l.o = D.ORDEN_HB.indexOf(l.d); if (l.o < 0) l.o = D.ORDEN_HB.length; });
      lista.sort(function (a, b) { return a.o - b.o || a.c - b.c; });
      // Doble carne: cada carne lleva su queso encima (se intercalan).
      var carnes = lista.filter(function (l) { return l.d === 'CARNE' || l.d === 'POLLO'; }), quesos = lista.filter(function (l) { return l.d === 'CHEDDAR' || l.d === 'QUESO'; });
      if (carnes.length > 1 && quesos.length) {
        var resto = lista.filter(function (l) { return carnes.indexOf(l) < 0 && quesos.indexOf(l) < 0; });
        var abajo = resto.filter(function (l) { return l.o < D.ORDEN_HB.indexOf('CARNE'); }), arriba = resto.filter(function (l) { return l.o >= D.ORDEN_HB.indexOf('CARNE'); });
        var medio = []; carnes.forEach(function (cn, i) { medio.push(cn); if (quesos[i]) medio.push(quesos[i]); });
        quesos.slice(carnes.length).forEach(function (q) { medio.push(q); });
        lista = abajo.concat(medio, arriba);
      }
      var capas = [{ k: 'pan-abajo:' + (pan || ''), h: 34, vh: 46, svg: '<svg viewBox="0 0 240 46">' + D.panAbajo(pan) + '</svg>' }];
      lista.forEach(function (l) { var C = D.capa(l.d, l.c, l.x); capas.push({ k: l.x.id + '#' + l.c, h: C.h, vh: C.vh, svg: '<svg viewBox="0 0 240 ' + C.vh + '">' + C.s + '</svg>' }); });
      capas.push({ k: 'pan-arriba:' + (pan || ''), h: 88, vh: 92, svg: '<svg viewBox="0 0 240 92">' + D.panArriba(pan) + '</svg>', tapa: true });
      return capas;
    }
    var altoHb = 0;
    function dibujarHamburguesa() {
      var capas = capasHamburguesa(), y = 0, cont = $('[data-hb]');
      capas.forEach(function (c, i) {
        c.bottom = c.tapa ? y - 4 : Math.max(0, y - (c.vh - c.h)); // el queso chorrea sobre la capa de abajo
        y += c.tapa ? c.h : (i === 0 ? c.h : c.h); c.z = i + 1;
      });
      altoHb = y + 4;
      cont.style.height = altoHb + 'px';
      escalarHb($('.ar-stage').clientHeight, altoHb);
      reconciliar(cont, capas, 'html');
    }
    // Crea, mueve o saca cada pieza según su clave: solo lo nuevo cae; lo que se fue se desvanece; lo demás se acomoda.
    function reconciliar(cont, lista, modo) {
      var actuales = {};
      Array.prototype.forEach.call(cont.children, function (n) { if (n.getAttribute('data-k') && !n.classList.contains('sale')) actuales[n.getAttribute('data-k')] = n; });
      var quedan = {};
      lista.forEach(function (it) {
        quedan[it.k] = true;
        var n = actuales[it.k];
        if (!n) {
          if (modo === 'svg') { n = document.createElementNS('http://www.w3.org/2000/svg', 'g'); n.setAttribute('class', it.capa ? 'capa' : 'pz'); n.innerHTML = it.svg; }
          else { n = document.createElement('div'); n.className = 'cap' + (it.tapa ? ' tapa' : ''); n.innerHTML = it.svg; }
          n.setAttribute('data-k', it.k);
          if (!reducir && vistos.listo) {
            n.classList.add('cae');
            if (modo === 'svg' && !it.capa) n.firstChild.firstChild.style.animationDelay = Math.min(it.i || 0, 30) * 22 + 'ms';
          }
          cont.appendChild(n);
        }
        if (modo === 'svg' && !it.capa) n.style.transform = 'translate(' + it.x.toFixed(1) + 'px,' + it.y.toFixed(1) + 'px) rotate(' + it.rot + 'deg)';
        if (modo === 'html') { n.style.bottom = it.bottom + 'px'; n.style.zIndex = it.z; }
      });
      Object.keys(actuales).forEach(function (k) {
        if (quedan[k]) return;
        var n = actuales[k]; n.classList.remove('cae'); n.classList.add('sale');
        setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, reducir ? 0 : 280);
      });
    }

    function dibujar() { if (esPizza) dibujarPizza(); else dibujarHamburguesa(); }
    var precioAnt = null;
    function pintar() {
      $('[data-pills]').innerHTML = pillsHtml();
      var nota = $('[data-nota]') ? $('[data-nota]').value : '';
      var scroll = $('[data-panel]').scrollTop;
      $('[data-panel]').innerHTML = panelHtml();
      $('[data-nota]').value = nota; $('[data-panel]').scrollTop = scroll;
      $('[data-qv]').textContent = st.qty;
      var precio = o.precio(seleccion()) * st.qty, pt = $('[data-pt]');
      pt.textContent = gs(precio);
      if (precioAnt !== null && precio !== precioAnt && !reducir) { pt.classList.remove('bump'); void pt.offsetWidth; pt.classList.add('bump'); }
      precioAnt = precio;
      dibujar();
      vistos.listo = true;
    }

    function avisar(t) { var h = $('[data-hint]'); h.textContent = t; clearTimeout(avisar.t); avisar.t = setTimeout(function () { h.textContent = multi.length ? 'Tocá un ingrediente para agregarlo' : ''; }, 2200); }

    ov.addEventListener('click', function (e) {
      var t;
      if (enviando) return;
      if (e.target === ov || e.target.closest('[data-arx]')) { cerrar(); return; }
      if ((t = e.target.closest('[data-menos]'))) {
        e.stopPropagation();
        var idm = t.getAttribute('data-menos');
        st.n[idm] = Math.max(0, (st.n[idm] || 0) - 1);
        if (!st.n[idm]) st.orden = st.orden.filter(function (x) { return x !== idm; });
        pintar(); return;
      }
      if ((t = e.target.closest('[data-mas]'))) {
        var id = t.getAttribute('data-mas'), g = grupoDe[id], x = opById[id], rep = Math.max(1, g.repetir || 1), n = st.n[id] || 0;
        if (n >= rep) { avisar(rep > 1 ? 'Máximo ' + rep + ' de ' + x.nombre.toLowerCase() + '.' : x.nombre + ' ya está. Tocá − para sacarlo.'); return; }
        if (totalGrupo(g) >= g.max) { avisar('Máximo ' + g.max + ' en ' + g.nombre.toLowerCase() + '.'); return; }
        st.n[id] = n + 1;
        if (st.orden.indexOf(id) < 0) st.orden.push(id);
        pintar(); return;
      }
      if ((t = e.target.closest('[data-sin]'))) { var ids = t.getAttribute('data-sin'); st.sin[ids] = !st.sin[ids]; pintar(); return; }
      if ((t = e.target.closest('[data-uni]'))) {
        var gu = grupos.filter(function (gg) { return gg.id === t.getAttribute('data-uni'); })[0], op = t.getAttribute('data-op');
        st.unico[gu.id] = st.unico[gu.id] === op && gu.min === 0 ? null : op;
        pintar(); return;
      }
      if ((t = e.target.closest('[data-q]'))) { st.qty = Math.max(1, Math.min(20, st.qty + Number(t.getAttribute('data-q')))); pintar(); return; }
      if (e.target.closest('[data-aradd]')) agregar();
    });

    // La hamburguesa (o la caja, que es un poco más alta) siempre entra entera en el escenario.
    function escalarHb(altoEscenario, altoDibujo) {
      var e = Math.min(1, (altoEscenario - 40) / altoDibujo);
      $('[data-hb]').style.transform = 'scale(' + e.toFixed(3) + ')';
    }
    // Caja de hamburguesa: se arma a la medida de la hamburguesa que quedó. El escenario se agranda (la grilla de
    // ingredientes se achica) y todo se escala para que la caja cerrada se vea entera.
    function armarCajaHamburguesa() {
      var cont = $('[data-hb]'), cj = D.cajaHamburguesa(altoHb), stage = $('.ar-stage');
      stage.style.transition = 'none'; ov.classList.add('empaque');
      var altoFinal = stage.clientHeight;
      ov.classList.remove('empaque'); void stage.offsetWidth; stage.style.transition = '';
      ov.classList.add('empaque');
      escalarHb(altoFinal, (cj.base.h - 8) + cj.tapa.h + 30);
      function pieza(cls, svg, bottom) { var n = document.createElement('div'); n.className = 'ar-hcaja ' + cls; n.innerHTML = svg; n.style.bottom = bottom + 'px'; cont.appendChild(n); return n; }
      pieza('ar-habierta', cj.abierta.svg, cj.base.h - 20);
      pieza('ar-hbase', cj.base.svg, -8);
      pieza('ar-htapa', cj.tapa.svg, cj.base.h - 8 - 12);
      void cont.offsetWidth;
    }

    var enviando = false;
    function despues(ms, fn) { timers.push(setTimeout(fn, ms)); }
    function agregar() {
      if (enviando) return;
      var sel = seleccion();
      for (var i = 0; i < grupos.length; i++) {
        var g = grupos[i], n = sel.filter(function (id) { return grupoDe[id] === g; }).length;
        if (n < g.min) { avisar('Elegí ' + (g.min > 1 ? g.min + ' en ' : '') + '"' + g.nombre + '".'); return; }
      }
      enviando = true;
      var nota = $('[data-nota]').value.trim();
      var listo = function () { cerrar(); o.onAgregar(sel, st.qty, nota); };
      if (reducir) return listo();
      var b = $('[data-aradd]');
      b.disabled = true;
      if (esPizza) {
        // 1) al horno  2) a la caja  3) se cierra la tapa con el logo
        ov.classList.add('horneando'); b.textContent = 'Horneando… 🔥';
        despues(1500, function () { ov.classList.remove('horneando'); ov.classList.add('encajando'); b.textContent = 'Empaquetando…'; });
        despues(2050, function () { ov.classList.add('cerrada'); });
        despues(2650, function () { b.classList.add('ok'); b.textContent = '✓ Agregada al pedido'; });
        despues(3300, listo);
      } else {
        armarCajaHamburguesa();
        ov.classList.add('encajando'); b.textContent = 'Empaquetando…';
        despues(800, function () { ov.classList.add('cerrada'); });
        despues(1500, function () { b.classList.add('ok'); b.textContent = '✓ Agregada al pedido'; });
        despues(2200, listo);
      }
    }

    pintar();
    return { cerrar: cerrar, el: ov };
  }

  w.Armador = { abrir: abrir, dibujoDe: dibujoDe, DIBUJOS: D.LISTA };
})(window);
