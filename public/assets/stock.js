/* Administración → 💰 Mesa Viru (Upgrade de stock y costos): insumos, compras, conteo, recetas y margen por plato, movimientos.
   El servidor guarda todo en unidades base enteras (g, ml, u) y guaraníes enteros; acá solo se convierte para mostrar
   y para cargar en kg / litros. */
(function (w) {
  'use strict';
  var M = w.Mesa, esc = M.esc, gs = M.gs;
  var UNI = { G: { base: 'g', grande: 'kg' }, ML: { base: 'ml', grande: 'l' }, UN: { base: 'u', grande: '' } };
  var TIPO_TXT = { COMPRA: ['Compra', 'oliva'], VENTA: ['Venta', ''], DEVOLUCION: ['Devolución', 'azul'], CONTEO: ['Conteo', 'mostaza'], MERMA: ['Merma', 'vino'] };
  var S = { el: null, d: null, menu: null, vista: 'insumos', q: '', orden: 'margen' };

  function num(n, max) { return Number(n).toLocaleString('es-PY', { maximumFractionDigits: max === undefined ? 2 : max }); }
  // 2500 g → "2,5 kg"; 750 ml → "750 ml"; 12 u → "12 u"
  function cant(n, unidad) {
    var u = UNI[unidad] || UNI.UN, a = Math.abs(n);
    if (u.grande && a >= 1000) return num(n / 1000, 3) + ' ' + u.grande;
    return num(n, 0) + ' ' + u.base;
  }
  // Costo para mostrar: por kg, por litro o por unidad
  function costoUnit(costoMil, unidad) {
    if (unidad === 'UN') return gs(Math.round(costoMil / 1000)) + ' / u';
    return gs(costoMil) + ' / ' + UNI[unidad].grande;
  }
  // "2,5" en kg → 2500 (entero en la unidad base). Acepta coma o punto decimal.
  function aBase(txt, unidadInput) {
    var v = parseFloat(String(txt || '').replace(/\./g, function (m, i, s) { return s.indexOf(',') >= 0 ? '' : m; }).replace(',', '.'));
    if (!isFinite(v) || v < 0) return NaN;
    return Math.round(unidadInput === 'kg' || unidadInput === 'l' ? v * 1000 : v);
  }
  function selUnidad(attr, unidad, preferGrande) {
    var u = UNI[unidad] || UNI.UN;
    if (!u.grande) return '<span class="small muted" style="padding:0 6px">u</span><input type="hidden" ' + attr + ' value="u">';
    return '<select class="input" ' + attr + ' style="width:auto">' + [u.grande, u.base].map(function (x) { return '<option' + ((preferGrande ? x === u.grande : x === u.base) ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select>';
  }
  function insOpts(sel, soloActivos) {
    return '<option value="">Elegí un insumo…</option>' + S.d.insumos.filter(function (i) { return !soloActivos || i.activo || i.insumo_id === sel; }).map(function (i) {
      return '<option value="' + esc(i.insumo_id) + '" data-u="' + i.unidad + '"' + (i.insumo_id === sel ? ' selected' : '') + '>' + esc(i.nombre) + ' (' + UNI[i.unidad].base + ')</option>';
    }).join('');
  }
  function insumo(id) { return S.d.insumos.filter(function (i) { return i.insumo_id === id; })[0]; }
  function err(e) { M.toast(e.message || 'Error', 'error'); }

  function cargar() { return M.call('stock.data', {}).then(function (d) { S.d = d; pintar(); }, function (e) { S.el.innerHTML = '<div class="banner warn">' + esc(e.message) + '</div>'; }); }

  function mount(el, opts) {
    S.el = el; S.menu = opts.menu;
    el.addEventListener('click', onClick);
    el.addEventListener('input', function (e) { if (e.target.id === 'st-q') { S.q = e.target.value; pintarLista(); } });
    el.addEventListener('change', function (e) { if (e.target.id === 'st-orden') { S.orden = e.target.value; pintar(); } });
    if (S.d) pintar(); else el.innerHTML = '<div class="empty">Cargando…</div>';
    cargar();
  }

  function pintar() {
    if (!S.d || !S.el || !document.body.contains(S.el)) return;
    var d = S.d, bajo = d.para_comprar.length;
    var tabs = [['insumos', 'Insumos'], ['costos', 'Recetas y margen'], ['movs', 'Movimientos']];
    S.el.innerHTML =
      '<div class="kpis" style="margin-bottom:12px">' +
      kpi('Valor del stock', gs(d.valor_total_gs), d.insumos.length + ' insumos') +
      kpi('Para comprar', String(bajo), bajo ? 'bajo su mínimo' : 'todo en orden') +
      kpi('Platos con receta', d.costos.filter(function (c) { return c.tiene_receta; }).length + ' de ' + d.costos.length, 'sin receta no se descuenta stock') + '</div>' +
      (bajo ? '<div class="banner warn" style="border-radius:8px;margin-bottom:12px"><strong>Para comprar:</strong> ' + d.para_comprar.map(function (i) { return esc(i.nombre) + ' (quedan ' + cant(i.stock, i.unidad) + ')'; }).join(' · ') + '</div>' : '') +
      '<div class="row wrap" style="margin-bottom:12px;gap:8px"><div class="tabs">' + tabs.map(function (t) { return '<button class="tab' + (S.vista === t[0] ? ' on' : '') + '" data-stv="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div><span class="grow"></span>' +
      '<button class="btn prim" data-compra>+ Compra</button><button class="btn" data-conteo>Conteo</button><button class="btn" data-ins="">+ Insumo</button></div>' +
      '<div id="st-vista"></div>';
    pintarLista();
  }
  function kpi(l, v, sub) { return '<div class="card kpi"><div class="l">' + esc(l) + '</div><div class="v num">' + esc(v) + '</div>' + (sub ? '<div class="small muted">' + esc(sub) + '</div>' : '') + '</div>'; }

  function pintarLista() {
    var v = S.el && S.el.querySelector('#st-vista'); if (!v) return;
    var q = S.q.toLowerCase(), d = S.d;
    var buscar = '<input class="input" id="st-q" placeholder="Buscar…" value="' + esc(S.q) + '" style="margin-bottom:10px">';
    if (S.vista === 'insumos') {
      var l = d.insumos.filter(function (i) { return !q || (i.nombre + ' ' + i.proveedor).toLowerCase().indexOf(q) >= 0; });
      v.innerHTML = (d.insumos.length ? '' : '<div class="banner info" style="border-radius:8px;margin-bottom:12px">Empezá cargando los insumos (café, leche, pan, carne…). Después registrá una compra o un conteo para tener el stock inicial, y armá la receta de cada plato en “Recetas y margen”.</div>') +
        '<div class="card tbl-wrap"><table class="tbl"><thead><tr><th>Insumo</th><th class="r">Stock</th><th class="r">Costo</th><th class="r">Valor</th><th class="r">Mínimo</th><th></th></tr></thead><tbody>' +
        (l.length ? l.map(function (i) {
          return '<tr' + (i.activo ? '' : ' class="muted"') + '><td><strong>' + esc(i.nombre) + '</strong>' + (i.activo ? '' : ' <span class="chip">Inactivo</span>') + '<div class="small muted">' + esc(i.proveedor || '') + '</div></td>' +
            '<td class="r num"' + (i.stock < 0 ? ' style="color:var(--vino)"' : '') + '>' + cant(i.stock, i.unidad) + (i.bajo_minimo ? ' <span class="chip vino" data-bajo>Comprar</span>' : '') + '</td>' +
            '<td class="r num small">' + (i.costo_mil_gs ? costoUnit(i.costo_mil_gs, i.unidad) : '—') + '</td><td class="r num">' + gs(i.valor_gs) + '</td>' +
            '<td class="r num small">' + (i.minimo ? cant(i.minimo, i.unidad) : '—') + '</td>' +
            '<td style="white-space:nowrap"><button class="btn small" data-ins="' + esc(i.insumo_id) + '">Editar</button> <button class="btn small" data-merma="' + esc(i.insumo_id) + '">Merma</button></td></tr>';
        }).join('') : '<tr><td colspan="6" class="muted">Sin insumos.</td></tr>') + '</tbody></table></div>';
      ponerBuscar(v, buscar);
    } else if (S.vista === 'costos') {
      var cs = d.costos.filter(function (c) { return !q || c.nombre.toLowerCase().indexOf(q) >= 0; }).slice();
      cs.sort(S.orden === 'margen' ? function (a, b) { return (a.margen_pct === null ? 999 : a.margen_pct) - (b.margen_pct === null ? 999 : b.margen_pct); } : function (a, b) { return a.nombre.localeCompare(b.nombre); });
      v.innerHTML = '<p class="small muted" style="margin-top:0">Margen = precio − costo de los insumos de la receta (con el costo promedio de hoy). En gastronomía el costo de los insumos suele rondar el 25–35 % del precio. Las opciones con receta propia suman su costo cuando el cliente las elige.</p>' +
        '<div class="row" style="gap:8px;margin-bottom:10px"><label class="small">Ordenar <select class="input" id="st-orden" style="width:auto"><option value="margen"' + (S.orden === 'margen' ? ' selected' : '') + '>Menor margen primero</option><option value="nombre"' + (S.orden === 'nombre' ? ' selected' : '') + '>Por nombre</option></select></label></div>' +
        '<div class="card tbl-wrap"><table class="tbl"><thead><tr><th>Plato</th><th class="r">Precio</th><th class="r">Costo</th><th class="r">Margen</th><th></th></tr></thead><tbody>' +
        cs.map(function (c) {
          var cls = c.margen_pct === null ? '' : c.margen_pct >= 65 ? 'oliva' : c.margen_pct >= 50 ? 'mostaza' : 'vino';
          return '<tr><td><strong>' + esc(c.nombre) + '</strong>' + (c.opciones.length ? '<div class="small muted">' + c.opciones.map(function (o) { return esc(o.nombre) + ' +' + gs(o.costo_gs); }).join(' · ') + '</div>' : '') + '</td>' +
            '<td class="r num">' + gs(c.precio_gs) + '</td><td class="r num">' + (c.tiene_receta ? gs(c.costo_gs) : '<span class="muted">sin receta</span>') + '</td>' +
            '<td class="r">' + (c.margen_pct === null ? '—' : '<span class="chip ' + cls + '" data-margen="' + esc(c.producto_id) + '">' + c.margen_pct + ' %</span><div class="small muted num">' + gs(c.margen_gs) + '</div>') + '</td>' +
            '<td><button class="btn small' + (c.tiene_receta ? '' : ' prim') + '" data-receta="' + esc(c.producto_id) + '">' + (c.tiene_receta ? 'Receta' : 'Armar receta') + '</button></td></tr>';
        }).join('') + '</tbody></table></div>';
      ponerBuscar(v, buscar);
    } else {
      v.innerHTML = '<p class="small muted" style="margin-top:0">Últimos 150 movimientos. No se editan ni se borran: una corrección se hace con un conteo o una merma.</p><div class="card tbl-wrap"><table class="tbl"><thead><tr><th>Fecha</th><th>Tipo</th><th>Insumo</th><th class="r">Cantidad</th><th class="r">Valor</th><th>Detalle</th></tr></thead><tbody>' +
        (d.movimientos.length ? d.movimientos.map(function (m) {
          var t = TIPO_TXT[m.tipo] || [m.tipo, ''], u = (insumo(m.insumo_id) || {}).unidad;
          return '<tr><td class="small">' + M.fechaHora(m.fecha) + '</td><td><span class="chip ' + t[1] + '">' + t[0] + '</span></td><td>' + esc(m.nombre) + '</td>' +
            '<td class="r num">' + (m.cantidad > 0 ? '+' : '') + cant(m.cantidad, u) + '<div class="small muted">queda ' + cant(m.stock_despues, u) + '</div></td><td class="r num">' + gs(m.costo_gs) + '</td>' +
            '<td class="small">' + esc([m.referencia, m.motivo, m.usuario_id].filter(Boolean).join(' · ')) + '</td></tr>';
        }).join('') : '<tr><td colspan="6" class="muted">Todavía no hay movimientos.</td></tr>') + '</tbody></table></div>';
    }
  }
  function ponerBuscar(v, html) {
    var f = document.activeElement && document.activeElement.id === 'st-q' ? document.activeElement.selectionStart : null;
    v.insertAdjacentHTML('afterbegin', html);
    if (f !== null) { var i = v.querySelector('#st-q'); i.focus(); i.setSelectionRange(f, f); }
  }

  function onClick(e) {
    var t;
    if ((t = e.target.closest('[data-stv]'))) { S.vista = t.getAttribute('data-stv'); S.q = ''; pintar(); return; }
    if ((t = e.target.closest('[data-ins]'))) return editarInsumo(t.getAttribute('data-ins'));
    if ((t = e.target.closest('[data-merma]'))) return merma(t.getAttribute('data-merma'));
    if (e.target.closest('[data-compra]')) return compra();
    if (e.target.closest('[data-conteo]')) return conteo();
    if ((t = e.target.closest('[data-receta]'))) return receta(t.getAttribute('data-receta'));
  }

  // ------------------------------------------------------------ insumo
  function editarInsumo(id) {
    var i = id ? insumo(id) : { insumo_id: '', nombre: '', unidad: 'G', minimo: 0, activo: true, proveedor: '', nota: '' };
    var md = M.modal({
      title: id ? 'Insumo · ' + i.nombre : 'Nuevo insumo',
      body: '<label class="f">Nombre</label><input class="input" data-i="nombre" maxlength="60" value="' + esc(i.nombre) + '" placeholder="Ej.: Café en grano">' +
        '<label class="f" style="margin-top:8px">Se mide en</label><select class="input" data-i="unidad"' + (id ? ' disabled' : '') + '>' +
        [['G', 'Peso (gramos / kg)'], ['ML', 'Volumen (ml / litros)'], ['UN', 'Unidades (pan, latas, huevos…)']].map(function (x) { return '<option value="' + x[0] + '"' + (i.unidad === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select>' +
        (id ? '<p class="small muted" style="margin:4px 0 0">La unidad no se cambia después de cargar movimientos.</p>' : '') +
        '<label class="f" style="margin-top:8px">Avisar para comprar cuando quede menos de</label><div class="row" style="gap:6px"><input class="input num" data-i="minimo" inputmode="decimal" value="' + (i.minimo ? esc(String(UNI[i.unidad].grande && i.minimo >= 1000 ? num(i.minimo / 1000, 3) : i.minimo)) : '') + '" placeholder="0 = sin aviso">' +
        '<span data-umin>' + selUnidad('data-i="umin"', i.unidad, UNI[i.unidad].grande && i.minimo >= 1000) + '</span></div>' +
        '<label class="f" style="margin-top:8px">Proveedor habitual (opcional)</label><input class="input" data-i="proveedor" maxlength="60" value="' + esc(i.proveedor) + '">' +
        '<label class="f" style="margin-top:8px">Nota (opcional)</label><input class="input" data-i="nota" maxlength="200" value="' + esc(i.nota) + '">' +
        '<label class="check"><input type="checkbox" data-i="activo"' + (i.activo ? ' checked' : '') + '> Activo</label>',
      foot: '<button class="btn grow" data-x>Cancelar</button><button class="btn prim grow" data-ok>Guardar</button>'
    });
    var g = function (k) { var x = md.$('[data-i="' + k + '"]'); return x.type === 'checkbox' ? x.checked : x.value; };
    md.$('[data-i="unidad"]').onchange = function () { md.$('[data-umin]').innerHTML = selUnidad('data-i="umin"', g('unidad'), false); };
    md.$('[data-ok]').onclick = function () {
      var min = g('minimo').trim() ? aBase(g('minimo'), g('umin')) : 0;
      if (isNaN(min)) return M.toast('Mínimo inválido.', 'error');
      M.call('stock.insumo', { insumo: { insumo_id: i.insumo_id, nombre: g('nombre'), unidad: g('unidad'), minimo: min, proveedor: g('proveedor'), nota: g('nota'), activo: g('activo') } })
        .then(function () { md.close(); M.toast('Insumo guardado.', 'ok'); cargar(); }, err);
    };
  }

  // ------------------------------------------------------------ compra
  function compra() {
    if (!S.d.insumos.length) return M.toast('Primero cargá los insumos.', 'error');
    var rid = 'compra-' + M.uid(), filas = [{ insumo_id: '', cantidad: '', u: '', costo: '' }];
    var md = M.modal({ title: 'Registrar compra', wide: true, body: '', foot: '<button class="btn grow" data-x>Cancelar</button><button class="btn prim grow" data-ok>Guardar compra</button>' });
    function leer() { M.$$('[data-fila]', md.el).forEach(function (tr) { var f = filas[+tr.getAttribute('data-fila')]; f.insumo_id = tr.querySelector('[data-c="ins"]').value; f.cantidad = tr.querySelector('[data-c="cant"]').value; f.u = tr.querySelector('[data-c="u"]').value; f.costo = tr.querySelector('[data-c="costo"]').value; }); }
    function total() { return filas.reduce(function (s, f) { return s + M.parseGs(f.costo); }, 0); }
    function paint() {
      md.$('.sheet-b').innerHTML = '<div class="grid2"><div><label class="f">Proveedor</label><input class="input" data-prov maxlength="60" value="' + esc(md.prov || '') + '" placeholder="Ej.: Distribuidora Central"></div><div><label class="f">Nota (opcional)</label><input class="input" data-nota maxlength="120" value="' + esc(md.nota || '') + '" placeholder="Factura 001-001-…"></div></div>' +
        '<table class="tbl" style="margin-top:10px"><thead><tr><th>Insumo</th><th>Cantidad</th><th>Total pagado (Gs.)</th></tr></thead><tbody>' +
        filas.map(function (f, ix) {
          var u = (insumo(f.insumo_id) || {}).unidad || 'UN';
          return '<tr data-fila="' + ix + '"><td><select class="input" data-c="ins">' + insOpts(f.insumo_id, true) + '</select></td>' +
            '<td><div class="row" style="gap:4px"><input class="input num" data-c="cant" inputmode="decimal" value="' + esc(f.cantidad) + '" style="width:100px">' + selUnidad('data-c="u"', u, !f.u || f.u === UNI[u].grande) + '</div></td>' +
            '<td><input class="input num" data-c="costo" inputmode="numeric" value="' + esc(f.costo) + '" style="width:130px"></td></tr>';
        }).join('') + '</tbody></table><div class="row" style="margin-top:8px"><button class="btn small" data-add>+ Otro insumo</button><span class="grow"></span><strong class="num" data-total>' + gs(total()) + '</strong></div>' +
        '<p class="small muted">Con cada compra el costo del insumo pasa a ser el promedio entre lo que había y lo que entra.</p>';
    }
    md.el.addEventListener('change', function (e) { if (e.target.matches('[data-c="ins"]')) { md.prov = md.$('[data-prov]').value; md.nota = md.$('[data-nota]').value; leer(); var f = filas[+e.target.closest('[data-fila]').getAttribute('data-fila')]; f.u = ''; paint(); } });
    md.el.addEventListener('input', function (e) { if (e.target.matches('[data-c="costo"]')) { leer(); md.$('[data-total]').textContent = gs(total()); } });
    md.el.addEventListener('click', function (e) {
      if (e.target.closest('[data-add]')) { md.prov = md.$('[data-prov]').value; md.nota = md.$('[data-nota]').value; leer(); filas.push({ insumo_id: '', cantidad: '', u: '', costo: '' }); paint(); }
      if (e.target.closest('[data-ok]')) {
        leer();
        var items = [], mal = '';
        filas.forEach(function (f) {
          if (!f.insumo_id && !f.cantidad && !f.costo) return;
          var ins = insumo(f.insumo_id), q = aBase(f.cantidad, f.u);
          if (!ins) { mal = mal || 'Elegí el insumo de cada línea.'; return; }
          if (!(q >= 1)) { mal = mal || 'Cantidad inválida en ' + ins.nombre + '.'; return; }
          items.push({ insumo_id: ins.insumo_id, cantidad: q, costo_total_gs: M.parseGs(f.costo) });
        });
        if (mal) return M.toast(mal, 'error');
        if (!items.length) return M.toast('Cargá al menos un insumo.', 'error');
        var b = e.target.closest('[data-ok]'); b.disabled = true;
        M.call('stock.compra', { request_id: rid, proveedor: md.$('[data-prov]').value, nota: md.$('[data-nota]').value, items: items })
          .then(function (r) { md.close(); M.toast('Compra registrada' + (r.total_gs ? ': ' + gs(r.total_gs) : '') + '.', 'ok'); cargar(); }, function (x) { b.disabled = false; err(x); });
      }
    });
    paint();
  }

  // ------------------------------------------------------------ conteo
  function conteo() {
    var act = S.d.insumos.filter(function (i) { return i.activo; });
    if (!act.length) return M.toast('Primero cargá los insumos.', 'error');
    var rid = 'conteo-' + M.uid();
    var md = M.modal({
      title: 'Conteo de stock', wide: true,
      body: '<p class="small muted" style="margin-top:0">Contá lo que hay y anotalo. Podés contar solo algunos (por ejemplo, las bebidas): los que dejes en blanco no cambian. La diferencia con lo que debería haber queda registrada y valorizada.</p>' +
        '<input class="input" data-q placeholder="Buscar…" style="margin-bottom:8px">' +
        '<table class="tbl"><thead><tr><th>Insumo</th><th class="r">Debería haber</th><th>Contado</th></tr></thead><tbody>' + act.map(function (i) {
          return '<tr data-row="' + esc(i.insumo_id) + '" data-n="' + esc(i.nombre.toLowerCase()) + '"><td>' + esc(i.nombre) + '</td><td class="r num">' + cant(i.stock, i.unidad) + '</td>' +
            '<td><div class="row" style="gap:4px"><input class="input num" data-cont inputmode="decimal" style="width:100px">' + selUnidad('data-cu', i.unidad, i.stock >= 1000) + '</div></td></tr>';
        }).join('') + '</tbody></table><label class="f" style="margin-top:8px">Nota (opcional)</label><input class="input" data-nota maxlength="120" placeholder="Ej.: conteo del lunes">',
      foot: '<button class="btn grow" data-x>Cancelar</button><button class="btn prim grow" data-ok>Guardar conteo</button>'
    });
    md.$('[data-q]').oninput = function () { var q = this.value.toLowerCase(); M.$$('[data-row]', md.el).forEach(function (tr) { tr.hidden = q && tr.getAttribute('data-n').indexOf(q) < 0; }); };
    md.$('[data-ok]').onclick = function () {
      var items = [], mal = '';
      M.$$('[data-row]', md.el).forEach(function (tr) {
        var v = tr.querySelector('[data-cont]').value.trim(); if (!v) return;
        var q = aBase(v, tr.querySelector('[data-cu]').value);
        if (isNaN(q)) { mal = 'Cantidad inválida en ' + tr.cells[0].textContent; return; }
        items.push({ insumo_id: tr.getAttribute('data-row'), contado: q });
      });
      if (mal) return M.toast(mal, 'error');
      if (!items.length) return M.toast('Anotá al menos un insumo contado.', 'error');
      var b = md.$('[data-ok]'); b.disabled = true;
      M.call('stock.conteo', { request_id: rid, nota: md.$('[data-nota]').value, items: items }).then(function (r) {
        md.close(); cargar();
        if (r.duplicado) return;
        var difs = r.detalle.filter(function (x) { return x.diferencia; });
        M.modal({
          title: 'Resultado del conteo',
          body: (difs.length ? '<table class="tbl"><thead><tr><th>Insumo</th><th class="r">Debía haber</th><th class="r">Contado</th><th class="r">Diferencia</th></tr></thead><tbody>' + difs.map(function (x) {
            return '<tr><td>' + esc(x.nombre) + '</td><td class="r num">' + cant(x.esperado, x.unidad) + '</td><td class="r num">' + cant(x.contado, x.unidad) + '</td><td class="r num" style="color:' + (x.diferencia < 0 ? 'var(--vino)' : 'inherit') + '">' + (x.diferencia > 0 ? '+' : '') + cant(x.diferencia, x.unidad) + '<div class="small">' + gs(x.valor_gs) + '</div></td></tr>';
          }).join('') + '</tbody></table><p><strong>Diferencia total: ' + gs(r.diferencia_gs) + '</strong></p><p class="small muted">Una diferencia negativa es mercadería que salió sin venderse (porciones más grandes, invitaciones, pérdidas o algo sin cobrar).</p>'
            : '<p>Todo coincide con lo que debía haber. 👌</p>'),
          foot: '<button class="btn prim block" data-x>Listo</button>'
        });
      }, function (x) { b.disabled = false; err(x); });
    };
  }

  // ------------------------------------------------------------ merma
  function merma(id) {
    var i = insumo(id), rid = 'merma-' + M.uid();
    var md = M.modal({
      title: 'Merma · ' + i.nombre,
      body: '<p class="small muted" style="margin-top:0">Lo que se tira o se pierde (vencido, se cayó, se cortó). Sale del stock y queda registrado con su costo.</p>' +
        '<label class="f">Cantidad</label><div class="row" style="gap:4px"><input class="input num" data-q inputmode="decimal">' + selUnidad('data-u', i.unidad, false) + '</div>' +
        '<label class="f" style="margin-top:8px">Motivo</label><input class="input" data-m maxlength="160" placeholder="Ej.: se venció">',
      foot: '<button class="btn grow" data-x>Cancelar</button><button class="btn prim grow" data-ok>Registrar merma</button>'
    });
    md.$('[data-ok]').onclick = function () {
      var q = aBase(md.$('[data-q]').value, md.$('[data-u]').value);
      if (!(q >= 1)) return M.toast('Cantidad inválida.', 'error');
      M.call('stock.merma', { request_id: rid, insumo_id: id, cantidad: q, motivo: md.$('[data-m]').value })
        .then(function (r) { md.close(); M.toast('Merma registrada (' + gs(r.costo_gs || 0) + ').', 'ok'); cargar(); }, err);
    };
  }

  // ------------------------------------------------------------ receta de un plato
  function receta(pid) {
    var c = S.d.costos.filter(function (x) { return x.producto_id === pid; })[0];
    var prod = S.menu.productos.filter(function (p) { return p.id === pid; })[0] || { grupos: [] };
    var grupos = S.menu.grupos.filter(function (g) { return prod.grupos.indexOf(g.id) >= 0; });
    var actual = S.d.recetas[pid] || [];
    // secciones: '' = receta base; cada opción con su lista de insumos que suma
    var sec = { '': [] };
    actual.forEach(function (l) { (sec[l.opcion_id] = sec[l.opcion_id] || []).push({ insumo_id: l.insumo_id, cantidad: String(l.cantidad) }); });
    var orig = JSON.stringify(sec);
    if (!sec[''].length) sec[''].push({ insumo_id: '', cantidad: '' });
    var md = M.modal({ title: 'Receta · ' + c.nombre, wide: true, body: '', foot: '<button class="btn grow" data-x>Cancelar</button><button class="btn prim grow" data-ok>Guardar receta</button>' });
    function costoSec(ls) { return ls.reduce(function (s, l) { var i = insumo(l.insumo_id), q = parseInt(l.cantidad, 10); return s + (i && q > 0 ? Math.round(q * i.costo_mil_gs / 1000) : 0); }, 0); }
    function filasHtml(op, ls) {
      return ls.map(function (l, ix) {
        var u = (insumo(l.insumo_id) || {}).unidad;
        return '<div class="row" style="gap:6px;margin-bottom:6px" data-l="' + esc(op) + '|' + ix + '"><select class="input grow" data-r="ins">' + insOpts(l.insumo_id, true) + '</select>' +
          '<input class="input num" data-r="cant" inputmode="numeric" value="' + esc(l.cantidad) + '" placeholder="0" style="width:90px"><span class="small muted" style="width:22px">' + (u ? UNI[u].base : '') + '</span>' +
          '<button class="btn ghost small" data-quitar="' + esc(op) + '|' + ix + '" aria-label="Quitar">✕</button></div>';
      }).join('') + '<button class="btn small" data-mas="' + esc(op) + '">+ Insumo</button>';
    }
    function paint() {
      var base = costoSec(sec['']);
      md.$('.sheet-b').innerHTML = '<p class="small muted" style="margin-top:0">Cantidades por <strong>una</strong> unidad vendida, en gramos, mililitros o unidades. Precio: ' + gs(c.precio_gs) + '.</p>' +
        '<h3 style="margin:8px 0">Receta base</h3>' + filasHtml('', sec['']) +
        '<div class="banner info" style="border-radius:8px;margin:10px 0">Costo: <strong data-costo>' + gs(base) + '</strong> · Margen: <strong>' + gs(c.precio_gs - base) + (c.precio_gs ? ' (' + Math.round((c.precio_gs - base) * 100 / c.precio_gs) + ' %)' : '') + '</strong></div>' +
        (grupos.length ? '<details' + (Object.keys(sec).length > 1 ? ' open' : '') + '><summary class="f" style="cursor:pointer">Opciones que suman insumos (ej.: queso extra, syrup)</summary>' + grupos.map(function (g) {
          return '<div style="margin:8px 0 4px"><strong>' + esc(g.nombre) + '</strong></div>' + g.opciones.map(function (o) {
            return '<div class="card pad" style="margin-bottom:6px"><div class="small" style="margin-bottom:4px">' + esc(o.nombre) + (o.delta ? ' (+' + gs(o.delta) + ')' : '') + (sec[o.id] && sec[o.id].length ? ' · costo ' + gs(costoSec(sec[o.id])) : '') + '</div>' + filasHtml(o.id, sec[o.id] || []) + '</div>';
          }).join('');
        }).join('') + '</details>' : '');
    }
    function leer() {
      M.$$('[data-l]', md.el).forEach(function (r) {
        var k = r.getAttribute('data-l').split('|'), l = sec[k[0]][+k[1]];
        l.insumo_id = r.querySelector('[data-r="ins"]').value; l.cantidad = r.querySelector('[data-r="cant"]').value;
      });
    }
    md.el.addEventListener('change', function (e) { if (e.target.matches('[data-r="ins"]')) { leer(); paint(); } });
    md.el.addEventListener('input', function (e) { if (e.target.matches('[data-r="cant"]')) { leer(); var x = md.$('[data-costo]'); if (x) x.textContent = gs(costoSec(sec[''])); } });
    md.el.addEventListener('click', function (e) {
      var t;
      if ((t = e.target.closest('[data-mas]'))) { leer(); var op = t.getAttribute('data-mas'); (sec[op] = sec[op] || []).push({ insumo_id: '', cantidad: '' }); paint(); return; }
      if ((t = e.target.closest('[data-quitar]'))) { leer(); var k = t.getAttribute('data-quitar').split('|'); sec[k[0]].splice(+k[1], 1); paint(); return; }
      if (e.target.closest('[data-ok]')) {
        leer();
        var limpio = {}, mal = '';
        Object.keys(sec).forEach(function (op) {
          limpio[op] = sec[op].filter(function (l) { return l.insumo_id || l.cantidad; }).map(function (l) {
            var q = parseInt(String(l.cantidad).replace(/\D/g, ''), 10);
            if (!l.insumo_id || !(q >= 1)) mal = mal || 'Completá insumo y cantidad (entero) en cada línea.';
            return { insumo_id: l.insumo_id, cantidad: q };
          });
        });
        if (mal) return M.toast(mal, 'error');
        var antes = JSON.parse(orig), cambios = Object.keys(limpio).concat(Object.keys(antes)).filter(function (op, i, a) { return a.indexOf(op) === i; }).filter(function (op) {
          var A = (antes[op] || []).map(function (l) { return l.insumo_id + ':' + l.cantidad; }).sort().join(','), B = (limpio[op] || []).map(function (l) { return l.insumo_id + ':' + l.cantidad; }).sort().join(',');
          return A !== B;
        });
        if (!cambios.length) { md.close(); return; }
        var b = e.target.closest('[data-ok]'); b.disabled = true;
        cambios.reduce(function (p, op) { return p.then(function () { return M.call('stock.receta', { producto_id: pid, opcion_id: op, lineas: limpio[op] || [] }); }); }, Promise.resolve())
          .then(function () { md.close(); M.toast('Receta guardada.', 'ok'); cargar(); }, function (x) { b.disabled = false; err(x); });
      }
    });
    paint();
  }

  w.StockAdmin = { mount: mount, cant: cant };
})(window);
