/* Módulo Gold · Menú 3D — visor de platos en 3D con realidad aumentada (model-viewer de Google).
 * El visor se descarga solo la primera vez que el cliente toca "Ver en 3D". */
(function (w) {
  'use strict';
  var M = w.Mesa, esc = M.esc;
  var LIB = 'https://cdn.jsdelivr.net/npm/@google/model-viewer@3.5.0/dist/model-viewer.min.js';
  var cargando = null;
  function cargar() {
    if (w.customElements && w.customElements.get('model-viewer')) return Promise.resolve();
    if (cargando) return cargando;
    cargando = new Promise(function (res, rej) {
      var s = document.createElement('script'); s.type = 'module'; s.src = LIB;
      s.onerror = function () { cargando = null; rej(new Error('red')); };
      document.head.appendChild(s);
      var t0 = Date.now();
      (function esperar() {
        if (w.customElements.get('model-viewer')) return res();
        if (Date.now() - t0 > 15000) { cargando = null; return rej(new Error('tiempo')); }
        setTimeout(esperar, 120);
      })();
    });
    return cargando;
  }
  // En la demo los modelos de ejemplo vienen embebidos (window.MODELOS_DEMO) y se sirven como blob.
  var blobs = {};
  function fuente(src) {
    var b64 = w.MODELOS_DEMO && w.MODELOS_DEMO[src];
    if (!b64) return src;
    if (!blobs[src]) {
      var bin = atob(b64), u = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      blobs[src] = URL.createObjectURL(new Blob([u], { type: 'model/gltf-binary' }));
    }
    return blobs[src];
  }
  // opts: { onAgregar(p) }
  function abrir(p, opts) {
    opts = opts || {};
    var m = M.modal({
      title: p.nombre, noFocus: true,
      body: '<div class="v3d"><div class="v3d-load" data-load>Cargando el plato en 3D…</div></div>' +
        '<p class="small muted" style="margin:8px 0 0">Girá el plato con el dedo y acercalo con dos dedos. En celulares compatibles, tocá <strong>Ver en mi mesa</strong> para verlo en tamaño real con la cámara.</p>',
      foot: '<button class="btn grow" data-x>Cerrar</button>' + (opts.onAgregar && p.disponible !== false ? '<button class="btn prim grow" data-add3d>Agregar al pedido</button>' : '')
    });
    if (m.$('[data-add3d]')) m.$('[data-add3d]').onclick = function () { m.close(); opts.onAgregar(p); };
    cargar().then(function () {
      var box = m.$('.v3d'); if (!box) return;
      box.innerHTML = '<model-viewer src="' + esc(fuente(p.modelo_3d)) + '" alt="' + esc(p.nombre) + ' en 3D" camera-controls auto-rotate touch-action="pan-y" ' +
        'ar ar-modes="webxr scene-viewer quick-look" ar-scale="fixed" shadow-intensity="1" exposure="1.05" camera-orbit="30deg 65deg auto" interaction-prompt="auto">' +
        '<button slot="ar-button" class="btn prim v3d-ar">📱 Ver en mi mesa</button></model-viewer>';
      if (w.Mesa && typeof opts.onVer === 'function') opts.onVer(p);
    }, function () {
      var l = m.$('[data-load]'); if (l) l.textContent = 'No se pudo cargar el visor 3D. Revisá la conexión e intentá de nuevo.';
    });
    return m;
  }
  w.Menu3D = { abrir: abrir, cargar: cargar, LIB: LIB };
})(window);
