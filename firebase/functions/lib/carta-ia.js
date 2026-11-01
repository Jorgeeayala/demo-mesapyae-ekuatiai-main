/*
 * MESA PYA'E — Carga de carta con IA (foto o PDF → propuesta de categorías y productos).
 *
 * Flujo: el encargado sube la foto o el PDF de su carta → el servidor la lee con Gemini en Vertex AI (mismo proyecto
 * de Google Cloud del local) → devuelve una PROPUESTA (no guarda nada) → el encargado la revisa y la corrige →
 * `admin.importarCarta` (core.js) crea categorías y productos con validación POR_VALIDAR.
 * La IA solo transcribe la carta del propio local: nunca inventa productos ni precios (regla 4 del producto).
 *
 * Corre en Node (Cloud Functions y servidor de desarrollo) y en el navegador (demo: lector de ejemplo).
 * Sintaxis ES2019.
 */
(function (root, factory) {
  var M = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = M; else root.CartaIA = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MODELO = 'gemini-3.8-flash';   // Vertex AI · modelo estable (lanzado 02/09/2026, retiro no antes de 09/2027). Se cambia con MESA_IA_MODELO.
  var REGION = 'global';             // endpoint global de Vertex AI. Se cambia con MESA_IA_REGION.
  var MAX_ARCHIVOS = 4;
  var MAX_BYTES = 4 * 1024 * 1024;   // por archivo (las fotos se achican en el navegador antes de subir)
  var MAX_PRODUCTOS = 300;
  var TIPOS = { 'image/jpeg': 1, 'image/png': 1, 'image/webp': 1, 'application/pdf': 1 };

  var PROMPT = [
    'Sos un asistente que transcribe cartas (menús) de restaurantes y cafeterías de Paraguay.',
    'Te paso fotos o un PDF de la carta de UN local. Devolvé SOLO lo que está escrito en la carta, en el JSON pedido:',
    '- categorias: las secciones de la carta en el mismo orden (ej.: "Cafés calientes", "Pizzas"). Si no hay secciones, una sola llamada "Carta".',
    '- productos de cada categoría: nombre tal como figura, descripción corta si la tiene (si no, vacío) y precio_gs.',
    '- precio_gs: precio en guaraníes como número entero, sin puntos ni símbolos ("25.000" → 25000; "25 mil" → 25000). Si el precio no se lee o no figura, 0.',
    '- Si un producto tiene varios tamaños o variantes con distinto precio (ej.: "chica 35.000 / grande 50.000"), poné el precio MÁS BAJO en precio_gs y',
    '  escribí las variantes con sus precios en "variantes" (ej.: "Chica 35.000 · Grande 50.000"). Si no hay variantes, vacío.',
    '- NO inventes productos, precios ni descripciones. NO traduzcas. NO incluyas promociones vencidas, horarios, direcciones ni textos que no sean productos.',
    '- Si una foto no es una carta o no se lee, devolvé categorias vacía.'
  ].join('\n');

  // Esquema de respuesta (subconjunto OpenAPI que acepta Vertex AI en generationConfig.responseSchema)
  var ESQUEMA = {
    type: 'OBJECT',
    properties: {
      categorias: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            nombre: { type: 'STRING' },
            productos: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: { nombre: { type: 'STRING' }, descripcion: { type: 'STRING' }, precio_gs: { type: 'INTEGER' }, variantes: { type: 'STRING' } },
                required: ['nombre', 'precio_gs']
              }
            }
          },
          required: ['nombre', 'productos']
        }
      }
    },
    required: ['categorias']
  };

  function txt(v, max) { var s = (v === null || v === undefined) ? '' : String(v).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim(); return max ? s.slice(0, max) : s; }
  // Precio a guaraníes enteros: acepta número o texto ("25.000", "Gs 25000", "25 mil"). Nunca decimales.
  function precio(v) {
    if (typeof v === 'number') return isFinite(v) && v > 0 ? Math.round(v) : 0;
    var s = String(v || '').toLowerCase();
    var mil = /\bmil\b/.test(s);
    var d = s.replace(/[^0-9]/g, '');
    var n = d ? parseInt(d, 10) : 0;
    if (mil && n < 1000) n = n * 1000;
    return isFinite(n) && n > 0 && n <= 10000000 ? n : 0;
  }
  function clave(s) {
    s = txt(s).toLowerCase(); if (s.normalize) s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
    return s.replace(/[^a-z0-9]+/g, ' ').trim();
  }

  // Respuesta del modelo → propuesta limpia. `existentes` = nombres de productos ya cargados (para marcar duplicados).
  function normalizar(raw, existentes) {
    var ya = {}; (existentes || []).forEach(function (n) { ya[clave(n)] = true; });
    var cats = (raw && Array.isArray(raw.categorias)) ? raw.categorias : [];
    var out = { categorias: [], productos: [], avisos: [] }, vistos = {}, sinPrecio = 0, dup = 0;
    cats.forEach(function (c) {
      var cn = txt(c && c.nombre, 60) || 'Carta';
      var ps = (c && Array.isArray(c.productos)) ? c.productos : [];
      var algun = false;
      ps.forEach(function (p) {
        if (out.productos.length >= MAX_PRODUCTOS) return;
        var nombre = txt(p && p.nombre, 80);
        if (nombre.length < 2) return;
        var k = clave(cn) + '|' + clave(nombre);
        if (vistos[k]) return; vistos[k] = true;
        var pr = precio(p && p.precio_gs);
        if (!pr) sinPrecio++;
        var existe = !!ya[clave(nombre)];
        if (existe) dup++;
        out.productos.push({ nombre: nombre, categoria: cn, descripcion: txt(p && p.descripcion, 300), precio_gs: pr, variantes: txt(p && p.variantes, 200), existe: existe, incluir: !existe && pr > 0 });
        algun = true;
      });
      if (algun && !out.categorias.some(function (x) { return clave(x) === clave(cn); })) out.categorias.push(cn);
    });
    if (!out.productos.length) out.avisos.push('No encontré productos. Probá con una foto más nítida, de frente y con buena luz.');
    if (sinPrecio) out.avisos.push(sinPrecio + ' producto' + (sinPrecio === 1 ? '' : 's') + ' sin precio legible: completalos antes de importar o dejalos sin marcar.');
    if (dup) out.avisos.push(dup + ' producto' + (dup === 1 ? ' ya está' : 's ya están') + ' en tu carta: quedan sin marcar para no duplicarlos.');
    if (out.productos.some(function (p) { return p.variantes; })) out.avisos.push('Los productos con tamaños o variantes se importan con el precio más bajo; las variantes quedan anotadas para armarlas como opciones.');
    return out;
  }

  function validarArchivos(archivos) {
    if (!Array.isArray(archivos) || !archivos.length) return 'Subí al menos una foto o un PDF de tu carta.';
    if (archivos.length > MAX_ARCHIVOS) return 'Hasta ' + MAX_ARCHIVOS + ' archivos por vez.';
    for (var i = 0; i < archivos.length; i++) {
      var a = archivos[i] || {};
      if (!TIPOS[a.mime]) return 'Formato no admitido: usá JPG, PNG, WEBP o PDF.';
      if (typeof a.datos !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(a.datos)) return 'Archivo inválido.';
      if (Math.floor(a.datos.length * 3 / 4) > MAX_BYTES) return 'Cada archivo puede pesar hasta ' + (MAX_BYTES / 1048576) + ' MB.';
    }
    return '';
  }

  // Lector real: Gemini en Vertex AI con la cuenta de servicio de la función (sin claves en el código).
  // opts: { proyecto, region, modelo, fetch, token: async () => accessToken }
  function crearLectorVertex(opts) {
    var region = opts.region || REGION, modelo = opts.modelo || MODELO;
    var host = region === 'global' ? 'https://aiplatform.googleapis.com' : 'https://' + region + '-aiplatform.googleapis.com';
    var url = host + '/v1/projects/' + encodeURIComponent(opts.proyecto) + '/locations/' + region + '/publishers/google/models/' + encodeURIComponent(modelo) + ':generateContent';
    return async function leer(archivos) {
      var token = await opts.token();
      var parts = archivos.map(function (a) { return { inlineData: { mimeType: a.mime, data: a.datos } }; });
      parts.push({ text: PROMPT });
      var r = await opts.fetch(url, {
        method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: parts }], generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: ESQUEMA } })
      });
      if (!r.ok) { var e = new Error('Vertex AI respondió ' + r.status); e.status = r.status; throw e; }
      var j = await r.json();
      var t = j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts && j.candidates[0].content.parts.map(function (p) { return p.text || ''; }).join('');
      if (!t) throw new Error('Vertex AI no devolvió contenido');
      return JSON.parse(t);
    };
  }
  // Token de la cuenta de servicio desde el servidor de metadatos de Google Cloud (Cloud Functions / Cloud Run).
  function tokenMetadatos(fetchFn) {
    var cache = null;
    return async function () {
      if (cache && cache.vence > Date.now() + 60000) return cache.token;
      var r = await fetchFn('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', { headers: { 'Metadata-Flavor': 'Google' } });
      if (!r.ok) throw new Error('Sin token de la cuenta de servicio');
      var j = await r.json();
      cache = { token: j.access_token, vence: Date.now() + (j.expires_in || 300) * 1000 };
      return cache.token;
    };
  }

  // Carta de ejemplo (demo y servidor de desarrollo sin Vertex): una cafetería ficticia.
  var EJEMPLO = { categorias: [
    { nombre: 'Cafetería', productos: [
      { nombre: 'Cortado', descripcion: '', precio_gs: 14000, variantes: '' },
      { nombre: 'Cappuccino', descripcion: 'Con canela', precio_gs: 22000, variantes: 'Chico 22.000 · Grande 28.000' },
      { nombre: 'Café con leche', descripcion: '', precio_gs: 18000, variantes: '' },
      { nombre: 'Espresso', descripcion: '', precio_gs: 12000, variantes: '' }] },
    { nombre: 'Tostados y sándwiches', productos: [
      { nombre: 'Tostado de jamón y queso', descripcion: 'En pan de molde', precio_gs: 20000, variantes: '' },
      { nombre: 'Sándwich de pollo', descripcion: 'Pollo desmechado, lechuga y tomate', precio_gs: 32000, variantes: '' },
      { nombre: 'Chipa so\'o', descripcion: '', precio_gs: 0, variantes: '' }] },
    { nombre: 'Jugos', productos: [
      { nombre: 'Jugo de naranja', descripcion: 'Exprimido', precio_gs: 15000, variantes: '' },
      { nombre: 'Limonada con menta', descripcion: '', precio_gs: 16000, variantes: '' }] }
  ] };
  function lectorEjemplo() { return async function () { return JSON.parse(JSON.stringify(EJEMPLO)); }; }

  // Acción `carta.leer` del servidor (asíncrona, fuera del núcleo): 1) el núcleo valida la sesión y cuenta el uso,
  // 2) se lee la carta, 3) se devuelve la propuesta. `handle` es el handle del núcleo (puede devolver una promesa).
  async function manejar(req, deps) {
    var p = req.payload || {};
    var uso = await deps.handle({ action: 'carta.iaUso', token: req.token, payload: { archivos: Array.isArray(p.archivos) ? p.archivos.length : 0 } });
    if (!uso.ok) return uso;
    var err = validarArchivos(p.archivos);
    if (err) return { ok: false, error: { code: 'ARCHIVO_INVALIDO', message: err }, status: 400 };
    var raw;
    try { raw = await deps.lector(p.archivos); } catch (e) {
      if (deps.log) deps.log('carta.leer: ' + (e && e.message));
      return { ok: false, error: { code: 'IA_NO_DISPONIBLE', message: 'No pude leer la carta en este momento. Reintentá en unos minutos o cargá los productos a mano.' }, status: 502 };
    }
    var prop = normalizar(raw, uso.data && uso.data.existentes);
    prop.usos_hoy = uso.data.usos; prop.max_dia = uso.data.max;
    if (deps.ejemplo) prop.avisos.unshift('Demo: se muestra una carta de ejemplo. En tu local se lee la foto o el PDF que subas.');
    return { ok: true, data: prop, status: 200 };
  }

  return { MODELO: MODELO, REGION: REGION, PROMPT: PROMPT, ESQUEMA: ESQUEMA, MAX_ARCHIVOS: MAX_ARCHIVOS, MAX_BYTES: MAX_BYTES, EJEMPLO: EJEMPLO,
    normalizar: normalizar, precio: precio, validarArchivos: validarArchivos, crearLectorVertex: crearLectorVertex, tokenMetadatos: tokenMetadatos, lectorEjemplo: lectorEjemplo, manejar: manejar };
});
