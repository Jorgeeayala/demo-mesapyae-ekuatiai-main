/* Mesa Pya'e · Cargar la carta con IA (Administración → Catálogo).
   1) El encargado sube fotos o un PDF de su carta. 2) El servidor la lee con IA (acción `carta.leer`).
   3) Se revisa todo en una tabla editable: nada entra a la carta sin que una persona lo marque.
   4) `admin.importarCarta` crea categorías y productos con precio POR VALIDAR. Nunca se inventan precios:
      un producto sin precio legible no se puede importar hasta que alguien lo escriba. */
(function (w) {
  'use strict';
  var MAX_ARCHIVOS = 4, MAX_BYTES = 4 * 1024 * 1024, LADO = 1800;

  function leerBase64(blob) {
    return new Promise(function (ok, mal) {
      var r = new FileReader();
      r.onload = function () { ok(String(r.result).split(',')[1] || ''); };
      r.onerror = function () { mal(new Error('No pude leer el archivo.')); };
      r.readAsDataURL(blob);
    });
  }
  // Las fotos se achican en el navegador (lado mayor 1800 px, JPG): suben rápido y alcanzan para leer la carta.
  function achicar(file) {
    return new Promise(function (ok, mal) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var esc = Math.min(1, LADO / Math.max(img.naturalWidth, img.naturalHeight));
        var c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * esc); c.height = Math.round(img.naturalHeight * esc);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(function (b) { b ? ok(b) : mal(new Error('No pude procesar la foto.')); }, 'image/jpeg', 0.85);
      };
      img.onerror = function () { URL.revokeObjectURL(url); mal(new Error('No pude abrir la foto ' + file.name + '.')); };
      img.src = url;
    });
  }
  function prepararArchivos(files) {
    files = Array.prototype.slice.call(files || []);
    if (!files.length) return Promise.reject(new Error('Elegí al menos una foto o un PDF de tu carta.'));
    if (files.length > MAX_ARCHIVOS) return Promise.reject(new Error('Hasta ' + MAX_ARCHIVOS + ' archivos por vez.'));
    return Promise.all(files.map(function (f) {
      if (f.type === 'application/pdf') {
        if (f.size > MAX_BYTES) return Promise.reject(new Error('El PDF ' + f.name + ' pesa más de 4 MB. Probá con fotos de cada página.'));
        return leerBase64(f).then(function (d) { return { mime: 'application/pdf', datos: d, nombre: f.name }; });
      }
      if (!/^image\//.test(f.type)) return Promise.reject(new Error('Formato no admitido: ' + f.name + '. Usá fotos (JPG, PNG) o PDF.'));
      return achicar(f).then(function (b) {
        if (b.size > MAX_BYTES) throw new Error('La foto ' + f.name + ' es demasiado grande.');
        return leerBase64(b).then(function (d) { return { mime: 'image/jpeg', datos: d, nombre: f.name }; });
      });
    }));
  }

  function abrir(M, opts) {
    var esc = M.esc, prop = null;
    var md = M.modal({
      title: '📷 Cargar carta con IA', wide: true,
      body: '<div data-paso="subir"><p>Subí fotos de tu carta (hasta ' + MAX_ARCHIVOS + ') o un PDF. La IA lee los platos, las categorías y los precios, y <strong>vos revisás todo antes de que entre a la carta</strong>.</p>' +
        '<ul class="small muted" style="margin:6px 0 12px 18px"><li>Fotos de frente, con buena luz y sin reflejos.</li><li>Los productos entran con precio <strong>Por validar</strong>: los aprobás después, como siempre.</li><li>Las opciones (pan, tamaño, extras) se arman después en “Grupos de opciones”.</li></ul>' +
        '<input class="input" type="file" data-ia-files accept="image/*,application/pdf" multiple></div>' +
        '<div data-paso="leyendo" hidden><p class="muted" style="text-align:center;padding:24px 0">⏳ Leyendo tu carta… puede tardar hasta un minuto.</p></div>' +
        '<div data-paso="revisar" hidden></div>',
      foot: '<button class="btn grow" data-x>Cancelar</button><button class="btn prim grow" data-ia-leer>Leer carta</button><button class="btn prim grow" data-ia-importar hidden>Importar</button>'
    });
    function paso(n) { M.$$('[data-paso]', md.el).forEach(function (d) { d.hidden = d.getAttribute('data-paso') !== n; }); }
    function marcados() { return M.$$('[data-ia-row]', md.el).filter(function (tr) { return tr.querySelector('[data-k="incluir"]').checked; }); }
    function contar() {
      var n = marcados().length, b = md.$('[data-ia-importar]');
      b.textContent = n ? 'Importar ' + n + ' producto' + (n === 1 ? '' : 's') : 'Importar';
      b.disabled = !n;
    }
    function revisar() {
      var cats = {}; prop.productos.forEach(function (p) { cats[p.categoria] = true; });
      md.$('[data-paso="revisar"]').innerHTML =
        (prop.avisos.length ? '<div class="banner warn" style="border-radius:8px;margin-bottom:10px">' + prop.avisos.map(esc).join('<br>') + '</div>' : '') +
        '<p class="small muted" style="margin:0 0 8px">Encontré <strong>' + prop.productos.length + '</strong> productos en ' + Object.keys(cats).length + ' categorías. Corregí lo que haga falta y dejá marcado solo lo que querés importar. Usos de hoy: ' + prop.usos_hoy + ' de ' + prop.max_dia + '.</p>' +
        '<div class="row" style="gap:8px;margin-bottom:8px"><button class="btn small" data-ia-todos="1">Marcar todos</button><button class="btn small" data-ia-todos="0">Desmarcar todos</button></div>' +
        '<datalist id="ia-cats">' + S_cats(opts).concat(Object.keys(cats)).map(function (c) { return '<option value="' + esc(c) + '">'; }).join('') + '</datalist>' +
        '<div class="tbl-wrap" style="max-height:52vh;overflow:auto"><table class="tbl"><thead><tr><th></th><th>Producto</th><th>Categoría</th><th class="r">Precio (Gs.)</th><th>Descripción</th></tr></thead><tbody>' +
        prop.productos.map(function (p, i) {
          return '<tr data-ia-row="' + i + '"><td><input type="checkbox" data-k="incluir"' + (p.incluir ? ' checked' : '') + ' aria-label="Importar ' + esc(p.nombre) + '"></td>' +
            '<td><input class="input" data-k="nombre" maxlength="80" value="' + esc(p.nombre) + '">' +
            (p.existe ? '<div class="small"><span class="chip">Ya está en tu carta</span></div>' : '') +
            (p.variantes ? '<div class="small muted">Variantes: ' + esc(p.variantes) + '</div>' : '') + '</td>' +
            '<td><input class="input" data-k="categoria" list="ia-cats" maxlength="60" value="' + esc(p.categoria) + '"></td>' +
            '<td><input class="input num" data-k="precio" inputmode="numeric" style="width:110px" value="' + (p.precio_gs ? M.gs(p.precio_gs).replace(/^Gs\.?\s*/, '') : '') + '" placeholder="Falta"></td>' +
            '<td><input class="input" data-k="descripcion" maxlength="300" value="' + esc(p.descripcion) + '"></td></tr>';
        }).join('') + '</tbody></table></div>';
      paso('revisar');
      md.$('[data-ia-leer]').hidden = true; md.$('[data-ia-importar]').hidden = false;
      contar();
    }
    md.el.addEventListener('change', function (e) { if (e.target.matches('[data-k="incluir"]')) contar(); });
    md.el.addEventListener('click', function (e) {
      var t = e.target.closest('[data-ia-todos]'); if (!t) return;
      var on = t.getAttribute('data-ia-todos') === '1';
      M.$$('[data-k="incluir"]', md.el).forEach(function (c) { c.checked = on; }); contar();
    });
    md.$('[data-ia-leer]').onclick = function () {
      var b = this;
      prepararArchivos(md.$('[data-ia-files]').files).then(function (archivos) {
        b.disabled = true; paso('leyendo');
        var pl = { archivos: archivos.map(function (a) { return { mime: a.mime, datos: a.datos }; }) };
        // Directo al servidor del local: la lectura puede tardar más que los 26 s del proxy de Netlify.
        // Si la llamada directa no sale (red o navegador), se intenta por el camino de siempre.
        return M.call('carta.leer', pl, { timeout: 110000, directo: true }).catch(function (e) {
          if (e && e.red && w.MESA_CONFIG && w.MESA_CONFIG.apiDirecta) return M.call('carta.leer', pl, { timeout: 110000 });
          throw e;
        });
      }).then(function (r) { prop = r; revisar(); }, function (e) {
        b.disabled = false; paso('subir');
        M.toast((e && e.message) || 'No pude leer la carta.', 'error');
      });
    };
    md.$('[data-ia-importar]').onclick = function () {
      var b = this, faltan = [];
      var productos = marcados().map(function (tr) {
        var g = function (k) { return tr.querySelector('[data-k="' + k + '"]').value.trim(); };
        var pr = M.parseGs(g('precio'));
        if (!(pr >= 1)) faltan.push(g('nombre') || '(sin nombre)');
        var p = prop.productos[+tr.getAttribute('data-ia-row')];
        return { nombre: g('nombre'), categoria: g('categoria'), descripcion: g('descripcion'), precio_gs: pr, variantes: p.variantes };
      });
      if (faltan.length) { M.toast('Falta el precio de: ' + faltan.slice(0, 3).join(', ') + (faltan.length > 3 ? '…' : '') + '. Escribilo o desmarcá el producto.', 'error'); return; }
      b.disabled = true;
      M.call('admin.importarCarta', { request_id: M.uid(), productos: productos }).then(function (r) {
        md.close();
        if (r.duplicado) { M.toast('Esa carta ya se había importado.', 'ok'); if (opts && opts.listo) opts.listo(r); return; }
        M.toast(r.productos_nuevos + ' productos importados' + (r.categorias_nuevas ? ' y ' + r.categorias_nuevas + ' categorías nuevas' : '') + (r.omitidos ? ' (' + r.omitidos + ' ya estaban)' : '') + '. Quedan Por validar.', 'ok');
        if (opts && opts.listo) opts.listo(r);
      }, function (e) { b.disabled = false; M.toast((e && e.message) || 'No se pudo importar.', 'error'); });
    };
    return md;
  }
  function S_cats(opts) { return (opts && opts.categorias) || []; }

  w.CartaIAUI = { abrir: abrir, prepararArchivos: prepararArchivos };
})(window);
