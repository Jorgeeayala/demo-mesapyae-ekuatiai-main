/*
 * MODO DEMO — el núcleo de Mesa Pya'e corriendo dentro del navegador.
 * Datos en localStorage de este navegador (compartidos entre pestañas del mismo sitio).
 * NO es producción: sirve para mostrar el flujo sin backend.
 */
(function (w) {
  'use strict';
  var KEY = 'mesapyae.demo.db.v1';

  // ---- SHA-256 síncrono (FIPS 180-4) ----
  var K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  function utf8(s) { var e = unescape(encodeURIComponent(s)), a = []; for (var i = 0; i < e.length; i++) a.push(e.charCodeAt(i)); return a; }
  function sha256bytes(bytes) {
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var l = bytes.length, m = bytes.slice(); m.push(0x80);
    while (m.length % 64 !== 56) m.push(0);
    var bits = l * 8; for (var i = 7; i >= 0; i--) m.push(i >= 4 ? 0 : (bits >>> (i * 8)) & 0xff);
    var W = new Array(64);
    for (var o = 0; o < m.length; o += 64) {
      for (var t = 0; t < 16; t++) W[t] = (m[o + t * 4] << 24) | (m[o + t * 4 + 1] << 16) | (m[o + t * 4 + 2] << 8) | m[o + t * 4 + 3];
      for (t = 16; t < 64; t++) {
        var s0 = rr(W[t - 15], 7) ^ rr(W[t - 15], 18) ^ (W[t - 15] >>> 3), s1 = rr(W[t - 2], 17) ^ rr(W[t - 2], 19) ^ (W[t - 2] >>> 10);
        W[t] = (W[t - 16] + s0 + W[t - 7] + s1) | 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (t = 0; t < 64; t++) {
        var S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25), ch = (e & f) ^ (~e & g), t1 = (h + S1 + ch + K[t] + W[t]) | 0;
        var S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22), mj = (a & b) ^ (a & c) ^ (b & c), t2 = (S0 + mj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0; H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    var out = []; H.forEach(function (x) { out.push((x >>> 24) & 255, (x >>> 16) & 255, (x >>> 8) & 255, x & 255); });
    return out;
  }
  function rr(x, n) { return (x >>> n) | (x << (32 - n)); }
  function hex(b) { return b.map(function (x) { return ('0' + x.toString(16)).slice(-2); }).join(''); }
  function sha256(s) { return hex(sha256bytes(utf8(String(s)))); }
  function hmac(k, m) {
    var key = utf8(String(k)); if (key.length > 64) key = sha256bytes(key); while (key.length < 64) key.push(0);
    var ip = key.map(function (x) { return x ^ 0x36; }), op = key.map(function (x) { return x ^ 0x5c; });
    return hex(sha256bytes(op.concat(sha256bytes(ip.concat(utf8(String(m)))))));
  }

  // ---- almacenamiento en localStorage ----
  function load() {
    var d = null; try { d = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { }
    d = d || { active: {}, archive: {}, secret: null };
    Object.keys(MesaCore.SCHEMA).forEach(function (t) { d.active[t] = d.active[t] || []; d.archive[t] = d.archive[t] || []; });
    return d;
  }
  var data = load();
  var store = {
    begin: function () {
      data = load();
      var work = {}, index = {};
      function tbl(t) { if (!work[t]) work[t] = data.active[t].map(function (r) { return Object.assign({}, r); }); return work[t]; }
      function ix(t) { if (!index[t]) { index[t] = {}; var k = MesaCore.KEYS[t]; tbl(t).forEach(function (r) { index[t][r[k]] = r; }); } return index[t]; }
      return {
        all: tbl, get: function (t, k) { return ix(t)[k] || null; },
        insert: function (t, row) { var o = {}; MesaCore.SCHEMA[t].forEach(function (c) { o[c] = row[c] === undefined || row[c] === null ? '' : row[c]; }); tbl(t).push(o); ix(t)[o[MesaCore.KEYS[t]]] = o; },
        update: function (t, k, p) { var r = ix(t)[k]; Object.keys(p).forEach(function (c) { if (MesaCore.SCHEMA[t].indexOf(c) >= 0) r[c] = p[c] === undefined || p[c] === null ? '' : p[c]; }); },
        archive: function () { return 0; },
        remove: function (t, pred) { var keep = [], n = 0; tbl(t).forEach(function (r) { if (pred(r)) n++; else keep.push(r); }); work[t] = keep; delete index[t]; return n; },
        history: tbl,
        commit: function () { Object.keys(work).forEach(function (t) { data.active[t] = work[t]; }); try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { if (w.Mesa) w.Mesa.toast('El almacenamiento del navegador está lleno. Usá "Reiniciar demo".', 'error'); } },
        rollback: function () { }
      };
    },
    withLock: function (fn) { return fn(); }
  };
  if (!data.secret) { data.secret = hex(Array.prototype.slice.call(crypto.getRandomValues(new Uint8Array(32)))); try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { } }
  // Plan de la demo: se puede cambiar desde la barra (solo en la demo)
  var DEMO_PLAN = (function () { try { return localStorage.getItem('mesapyae.demo.plan') || ''; } catch (e) { return ''; } })() || (w.MESA_CONFIG && w.MESA_CONFIG.plan) || '';
  // Upgrade e-Kuatia'i en la demo: se prende y apaga desde la barra (solo en la demo).
  var DEMO_EKUA = (function () { try { return localStorage.getItem('mesapyae.demo.ekuatiai') === 'SI'; } catch (e) { return false; } })();
  // Upgrade Mesa Viru (stock y costos) en la demo: también se prende y apaga desde la barra.
  var DEMO_STOCK = (function () { try { return localStorage.getItem('mesapyae.demo.stock') === 'SI'; } catch (e) { return false; } })();
  // Upgrade Atención Integrada (WhatsApp) en la demo: Whaticket simulado; los avisos no salen a ningún teléfono.
  var DEMO_WA = (function () { try { return localStorage.getItem('mesapyae.demo.atencion') === 'SI'; } catch (e) { return false; } })();
  // Upgrade "Armá tu pedido" (pizza y hamburguesa armables con animación) en la demo.
  var DEMO_ARMADOR = (function () { try { return localStorage.getItem('mesapyae.demo.armador') === 'SI'; } catch (e) { return false; } })();
  var ALPHA = 'abcdefghijkmnpqrstuvwxyz23456789', mem = {};
  var env = {
    now: function () { return Date.now(); },
    uuid: function () { return crypto.randomUUID ? crypto.randomUUID() : sha256(Math.random() + ':' + Date.now()).slice(0, 32); },
    token: function (n) { var b = crypto.getRandomValues(new Uint8Array(n)), s = ''; for (var i = 0; i < n; i++) s += ALPHA[b[i] % 32]; return s; },
    sha256: sha256, hmac: hmac,
    b64: function (s) { return btoa(unescape(encodeURIComponent(s))); },
    unb64: function (s) { return decodeURIComponent(escape(atob(s))); },
    dateKey: function (ms) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms)); },
    secret: data.secret,
    plan: DEMO_PLAN,
    modulos: ((w.MESA_CONFIG && w.MESA_CONFIG.modulos) || []).concat(DEMO_EKUA ? ['EKUATIAI'] : []).concat(DEMO_STOCK ? ['STOCK'] : []).concat(DEMO_WA ? ['ATENCION'] : []).concat(DEMO_ARMADOR ? ['ARMADOR'] : []),
    cache: { get: function (k) { var v = mem[k]; return v && v.e > Date.now() ? v.v : null; }, put: function (k, v, s) { mem[k] = { v: v, e: Date.now() + s * 1000 }; } },
    log: function (m) { console.warn(m); }
  };
  var app = MesaCore.create(store, env);
  var DEMO_USERS = [
    { usuario_id: 'mozo', nombre: 'Mozo Demo', rol: 'MOZO', pin: '1111' },
    { usuario_id: 'cocina', nombre: 'Cocina Demo', rol: 'COCINA', pin: '2222' },
    { usuario_id: 'cajaa', nombre: 'Caja 01 Demo', rol: 'CAJA', caja_id: 'CAJA_A', pin: '3333' },
    { usuario_id: 'cajab', nombre: 'Caja 02 Demo', rol: 'CAJA', caja_id: 'CAJA_B', pin: '4444' }
  ];
  app.seed({ catalogo: w.CATALOGO_DEMO, mesas: 20, admin: { usuario_id: 'admin', nombre: 'Encargado Demo', pin: '1234' }, usuarios: DEMO_USERS, imagenes: w.FOTOS_DEMO || {} });

  // ---- QR fijos y WhatsApp en para llevar (28/10/2026)
  // Los QR de la demo son iguales en todos los navegadores: así el QR que se muestra en la pantalla de un equipo
  // (o un link compartido) abre la carta en el celular del cliente en vez de "Este código QR ya no es válido".
  // Ojo: cada navegador guarda su propia demo; el pedido hecho en el celular no aparece en la caja de otro equipo.
  // Además, la demo pide "Tu WhatsApp" (opcional) en para llevar, como en los locales que lo usan.
  // Se aplica una sola vez por navegador (marca demo_v2); después el encargado puede cambiarlo en Configuración.
  (function () {
    var d = load(); if (d.demo_v2) return;
    d.active.Mesas.forEach(function (m) { var n = String(m.mesa_id || '').replace(/\D/g, ''); if (n) m.qr_token = 'demomesa' + ('0' + n).slice(-2); });
    d.active.Puntos.forEach(function (p) { if (p.punto_id === 'B_TAKEAWAY') p.qr_token = 'demotakeaway'; else if (p.punto_id === 'A_CAFE') p.qr_token = 'demosalon01'; });
    var wa = d.active.Config.filter(function (c) { return c.clave === 'para_llevar_whatsapp'; })[0];
    if (wa) { if (String(wa.valor || 'NO').toUpperCase() === 'NO') wa.valor = 'OPCIONAL'; }
    else d.active.Config.push({ clave: 'para_llevar_whatsapp', valor: 'OPCIONAL', descripcion: 'WhatsApp del cliente en los pedidos para llevar del QR o la web' });
    var nb = d.active.Config.filter(function (c) { return c.clave === 'nombre_negocio'; })[0];  // "promociones de Café Demo", no "de Mi local"
    if (!nb) d.active.Config.push({ clave: 'nombre_negocio', valor: 'Café Demo', descripcion: 'Nombre visible' });
    else if (!nb.valor || nb.valor === 'Mi local') nb.valor = 'Café Demo';
    d.demo_v2 = 1;
    try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { }
  })();

  // ---- Módulo Premium Recompensas: programa configurado y clientes de ejemplo (ficticios)
  var PLAN_UP = String(DEMO_PLAN || '').toUpperCase();
  var CON_REC = PLAN_UP === 'PREMIUM' || ((w.MESA_CONFIG && w.MESA_CONFIG.modulos) || []).indexOf('RECOMPENSAS') >= 0;
  var CON_GOLD = PLAN_UP === 'GOLD' || PLAN_UP === 'PREMIUM';
  // ---- Plan Gold: modelos 3D de ejemplo y opiniones ficticias para el panel de reseñas
  (function () {
    var d = load(), cambio = false;
    [['ESPRESSO', 'modelos/espresso.glb'], ['PIZZA_PERSONAL', 'modelos/pizza.glb'], ['PANINI_CESAR', 'modelos/panini.glb']].forEach(function (x) {
      var pr = d.active.Productos.filter(function (p) { return p.producto_id === x[0]; })[0];
      if (pr && !pr.modelo_3d) { pr.modelo_3d = x[1]; cambio = true; }
    });
    if (!d.active.Config.some(function (c) { return c.clave === 'res_google_url'; })) {
      d.active.Config.push({ clave: 'res_google_url', valor: 'https://maps.app.goo.gl/6FimfmrStirt5egP6', descripcion: 'Link de Google para escribir una reseña' }); cambio = true;
    }
    if (!d.active.Resenas.length) {
      var OP = [[5, 'El capuchino de la casa es lo mejor, y la atención súper rápida.'], [5, 'Pedimos por QR y llegó todo junto, excelente.'], [4, 'Muy rica la pizza, el lugar es hermoso.'], [5, ''],
        [3, 'La comida bien, pero tardó un poco en salir.'], [5, 'Las obras de arte le dan un ambiente único.'], [4, 'Buen café. Faltaba azúcar en la mesa.'], [2, 'Esperamos casi 30 minutos el panini.'],
        [5, 'Volvemos siempre por el lomito.'], [4, ''], [5, 'La moza muy atenta, nos recomendó todo.'], [1, 'El jugo vino caliente y nadie vino a cambiarlo.'], [5, 'Perfecto para trabajar con la compu.'],
        [4, 'Rico todo, un poco ruidoso a la noche.'], [5, 'La pizza mitad y mitad, un golazo.'], [3, 'El pedido de la casita salió con un error.'], [5, ''], [4, 'Muy buenos precios.'], [5, 'El mejor café de Asunción.'],
        [4, 'Nos dividieron la cuenta por persona sin drama, genial para cumpleaños.'], [5, 'Atención de 10.'], [2, 'Mesa sucia cuando llegamos.'], [5, 'Me encantó la tarjeta de sellos.'], [4, '']];
      var ahora2 = Date.now();
      OP.forEach(function (o, i) {
        var t = ahora2 - Math.floor((i * 37 % 40) + 1) * 86400000 + (i % 9) * 3600000;
        d.active.Resenas.push({ resena_id: 'RES_demo' + i, request_id: '', clave: '', fecha: new Date(t).toISOString(), pedido_id: '', cuenta_id: '', punto_id: i % 4 === 3 ? 'B_TAKEAWAY' : 'A_CAFE',
          mesa_id: i % 4 === 3 ? '' : 'M' + ('0' + (1 + i % 12)).slice(-2), mozo_id: i % 4 === 3 ? '' : 'mozo', cliente_id: '', estrellas: o[0], comentario: o[1], canal: i % 3 ? 'PEDIDO' : 'QR',
          google_click: o[0] >= 4 && i % 2 ? new Date(t + 60000).toISOString() : (o[0] < 4 && i % 5 === 0 ? new Date(t + 60000).toISOString() : ''), leida: o[0] <= 3 && i % 2 ? 'SI' : 'NO', nota: o[0] <= 3 && i % 2 ? 'Hablamos con el equipo.' : '', sello: '' });
      });
      cambio = true;
    }
    if (cambio) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { } }
  })();
  if (CON_REC && !load().active.RecPremios.length) {
    var adm = app.handle({ action: 'auth.login', payload: { usuario: 'admin', pin: '1234' } }).data.token;
    app.handle({ action: 'rec.config', token: adm, payload: {
      premios: [
        { tipo: 'SELLOS', sellos: 6, nombre: '1 Espresso gratis', producto_id: 'ESPRESSO', costo_gs: 4000 },
        { tipo: 'SELLOS', sellos: 10, nombre: '1 Panini César gratis', producto_id: 'PANINI_CESAR', costo_gs: 15000 },
        { tipo: 'CUMPLE', nombre: 'Porción de torta de cumpleaños', valor_gs: 18000, costo_gs: 7000 }
      ],
      config: { rec_activo: 'SI', rec_nombre: 'Club Café Demo', rec_minimo_gs: '20000', rec_mensaje: 'Sumá un sello en cada visita y ganá premios de la casa.' }
    } });
    var d0 = load(), pr = d0.active.RecPremios, ahora = Date.now(), DIA = 86400000;
    var NOMBRES = ['María González', 'José Benítez', 'Ana Martínez', 'Carlos Giménez', 'Lucía Fernández', 'Diego Ramírez', 'Sofía Duarte', 'Javier Acosta', 'Valentina Rojas', 'Matías Báez',
      'Camila Ortiz', 'Nicolás Villalba', 'Florencia Cabrera', 'Andrés Sosa', 'Paula Núñez', 'Rodrigo Escobar', 'Belén Aquino', 'Gustavo Ayala', 'Natalia Cáceres', 'Fernando Ríos',
      'Micaela Vera', 'Hugo Insfrán', 'Daniela Paredes', 'Sebastián Vázquez', 'Laura Galeano', 'Tomás Riveros', 'Gabriela Medina', 'Emilio Franco', 'Jazmín Ocampo', 'Pablo Cardozo', 'Rocío Benegas', 'Iván Zárate'];
    var rnd = (function () { var x = 7; return function () { x = (x * 16807) % 2147483647; return (x - 1) / 2147483646; }; })();
    var mesHoy = new Date(ahora).toISOString().slice(5, 7), ALPHA2 = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    function cod() { var c = ''; for (var i = 0; i < 6; i++) c += ALPHA2[Math.floor(rnd() * ALPHA2.length)]; return c; }
    function tok() { var c = ''; for (var i = 0; i < 20; i++) c += ALPHA[Math.floor(rnd() * 32)]; return c; }
    function iso(ms) { return new Date(ms).toISOString(); }
    var p6 = pr.filter(function (x) { return +x.sellos === 6; })[0], p10 = pr.filter(function (x) { return +x.sellos === 10; })[0];
    NOMBRES.forEach(function (n, k) {
      var visitas = Math.max(1, Math.round(Math.pow(rnd(), 1.6) * 16)), alta = ahora - (20 + Math.floor(rnd() * 70)) * DIA;
      var id = 'CLI_demo' + k, sellos = visitas % 10, ciclos = Math.floor(visitas / 10);
      var dias = []; for (var v = 0; v < visitas; v++) dias.push(alta + Math.floor((ahora - alta - DIA) * (v + 1) / (visitas + 1)) + Math.floor(rnd() * 8) * 3600000);
      var cel = '5959' + (71 + Math.floor(rnd() * 15)) + String(100000 + Math.floor(rnd() * 899999));
      var cumple = (k % 6 === 0 ? mesHoy : ('0' + (1 + Math.floor(rnd() * 12))).slice(-2)) + '-' + ('0' + (1 + Math.floor(rnd() * 28))).slice(-2);
      d0.active.RecClientes.push({ cliente_id: id, celular: cel, nombre: n, cumple: k % 4 === 3 ? '' : cumple, email: '', codigo: cod(), token: tok(), sellos: sellos, ciclos: ciclos, visitas: visitas,
        canjes: 0, ultima_visita: iso(dias[dias.length - 1]), ultimo_sello_dia: '', creado_en: iso(alta), origen: k % 3 ? 'WEB' : 'CAJA', activo: 'SI', nota: '' });
      d0.active.RecMovs.push({ mov_id: 'RMV_da' + k, cliente_id: id, fecha: iso(alta), tipo: 'ALTA', sellos_delta: 0, sellos_despues: 0, cuenta_id: '', cobro_id: '', cupon_id: '', caja_id: '', usuario_id: '', detalle: '' });
      var canjes = 0;
      dias.forEach(function (t, v) {
        var n2 = (v + 1) % 10;
        d0.active.RecMovs.push({ mov_id: 'RMV_d' + k + '_' + v, cliente_id: id, fecha: iso(t), tipo: 'SELLO', sellos_delta: 1, sellos_despues: n2, cuenta_id: '', cobro_id: '', cupon_id: '', caja_id: v % 3 ? 'CAJA_A' : 'CAJA_B', usuario_id: v % 3 ? 'cajaa' : 'cajab', detalle: '' });
        var hit = (v + 1) % 10 === 6 ? p6 : (v + 1) % 10 === 0 ? p10 : null;
        if (hit) {
          var usado = v < visitas - 2 || rnd() < 0.3;
          d0.active.RecCupones.push({ cupon_id: 'CUP_d' + k + '_' + v, cliente_id: id, premio_id: hit.premio_id, nombre: hit.nombre, producto_id: hit.producto_id, valor_gs: 0, costo_gs: +hit.costo_gs,
            estado: usado ? 'CANJEADO' : 'DISPONIBLE', creado_en: iso(t), vence_en: iso(t + 60 * DIA), canjeado_en: usado ? iso(t + 3 * DIA) : '', cobro_id: '', usuario_id: 'cajaa', motivo: (v + 1) % 10 + ' sellos' });
          if (usado) canjes++;
        }
      });
      d0.active.RecClientes[d0.active.RecClientes.length - 1].canjes = canjes;
    });
    try { localStorage.setItem(KEY, JSON.stringify(d0)); } catch (e) { }
  }

  // ---- Estaciones (todos los planes): la demo trabaja con Cocina y Barra; las bebidas van a la Barra.
  var admTk = null;
  function admin() { if (!admTk) admTk = app.handle({ action: 'auth.login', payload: { usuario: 'admin', pin: '1234' } }).data.token; return admTk; }
  // (solo la primera vez: la configuración nace con "Cocina" y ninguna categoría tiene estación)
  if (!load().active.Categorias.some(function (c) { return c.estacion; }) && load().active.Config.some(function (c) { return c.clave === 'estaciones' && c.valor === 'Cocina'; })) {
    app.handle({ action: 'admin.config', token: admin(), payload: { clave: 'estaciones', valor: 'Cocina, Barra' } });
    load().active.Categorias.forEach(function (c) {
      if (['CAF_CAL', 'CAF_FRI', 'JUGOS', 'CERVEZAS', 'BEBIDAS'].indexOf(c.categoria_id) < 0) return;
      app.handle({ action: 'admin.category', token: admin(), payload: { categoria: { categoria_id: c.categoria_id, nombre: c.nombre, orden: +c.orden, activa: c.activa === 'SI', nota: c.nota, estacion: 'BARRA' } } });
    });
  }
  // ---- Upgrade Mesa Viru: insumos, una compra inicial y recetas de ejemplo (precios ficticios, solo para mostrar)
  if (DEMO_STOCK && !load().active.Insumos.length) {
    var INS = [
      ['Café en grano', 'G', 500, 3000, 390000], ['Leche entera', 'ML', 4000, 20000, 170000], ['Syrup de sabores', 'ML', 300, 2000, 160000],
      ['Pan de miga', 'UN', 20, 80, 120000], ['Jamón cocido', 'G', 500, 3000, 180000], ['Queso paraguay', 'G', 1000, 6000, 330000],
      ['Masa de pizza', 'UN', 10, 40, 240000], ['Salsa de tomate', 'ML', 1000, 5000, 75000], ['Cerveza Munich lata', 'UN', 24, 12, 108000], ['Chop Heineken (barril)', 'ML', 10000, 30000, 900000]
    ], ids = {};
    INS.forEach(function (x) { ids[x[0]] = app.handle({ action: 'stock.insumo', token: admin(), payload: { insumo: { nombre: x[0], unidad: x[1], minimo: x[2], proveedor: 'Proveedor de ejemplo' } } }).data.insumo.insumo_id; });
    app.handle({ action: 'stock.compra', token: admin(), payload: { request_id: 'demo-compra-inicial', proveedor: 'Proveedor de ejemplo', nota: 'Datos ficticios de la demo', items: INS.map(function (x) { return { insumo_id: ids[x[0]], cantidad: x[3], costo_total_gs: x[4] }; }) } });
    var R = function (pid, op, l) { app.handle({ action: 'stock.receta', token: admin(), payload: { producto_id: pid, opcion_id: op || '', lineas: l.map(function (x) { return { insumo_id: ids[x[0]], cantidad: x[1] }; }) } }); };
    R('ESPRESSO', '', [['Café en grano', 9]]); R('DOBLE_ESPRESSO', '', [['Café en grano', 18]]); R('AMERICANO', '', [['Café en grano', 9]]);
    R('LATTE', '', [['Café en grano', 9], ['Leche entera', 200]]); R('CAPUCHINO', '', [['Café en grano', 9], ['Leche entera', 150]]);
    ['SY_VAI', 'SY_CHO', 'SY_AVE', 'SY_CAR'].forEach(function (o) { ['ESPRESSO', 'LATTE', 'CAPUCHINO'].forEach(function (p) { R(p, o, [['Syrup de sabores', 15]]); }); });
    R('MIXTO', '', [['Pan de miga', 2], ['Jamón cocido', 30], ['Queso paraguay', 30]]); R('MIXTO_DOBLE', '', [['Pan de miga', 3], ['Jamón cocido', 60], ['Queso paraguay', 60]]);
    R('PIZZA_MUZZARELLA', '', [['Masa de pizza', 1], ['Queso paraguay', 300], ['Salsa de tomate', 120]]);
    R('MUNICH_ULTRA', '', [['Cerveza Munich lata', 1]]); R('CHOP_HEINEKEN', '', [['Chop Heineken (barril)', 500]]);
  }

  // Demo con Atención: el número ya viene «conectado» (simulado) y la carta para llevar pide el WhatsApp.
  if (DEMO_WA) {
    var dw = load(), cfgSet = function (k, v) { var r = dw.active.Config.filter(function (x) { return x.clave === k; })[0]; if (r) { if (!r.valor) r.valor = v; } else dw.active.Config.push({ clave: k, valor: v, descripcion: '' }); };
    cfgSet('wa_conexion_id', 'conn-demo'); cfgSet('wa_conexion_nombre', 'WhatsApp del local (demo)'); cfgSet('wa_avisos', 'AMBOS');
    var pw = dw.active.Config.filter(function (x) { return x.clave === 'para_llevar_whatsapp'; })[0]; if (pw && pw.valor === 'NO') pw.valor = 'OPCIONAL';
    try { localStorage.setItem(KEY, JSON.stringify(dw)); } catch (e) { }
  }
  var WA_DEMO = { handle: function (x) { return app.handle(x); }, token: 'demo', firmar: function (m) { return hmac(env.secret, m); } };
  // ---- Upgrade "Armá tu pedido": pizzas y hamburguesas armables de ejemplo (precios ficticios, solo para mostrar)
  if (DEMO_ARMADOR && !load().active.Productos.some(function (p) { return p.producto_id === 'PIZZA_A_TU_GUSTO'; })) {
    var A = function (action, payload) { var r = app.handle({ action: action, token: admin(), payload: payload }); if (!r.ok) console.warn(action, r.error); return r.data; };
    var O = function (id, nombre, delta, dibujo) { return { opcion_id: id, nombre: nombre, delta_gs: delta, activo: true, dibujo: dibujo || '' }; };
    A('admin.category', { categoria: { categoria_id: 'HAMBURGUESAS', nombre: 'Hamburguesas', orden: 9, activa: true, nota: '' } });
    A('admin.group', { grupo: { grupo_id: 'G_PZ_TAM', nombre: 'Tamaño', tipo: 'TAMANO', min: 1, max: 1, activo: true, opciones: [O('PZT_P', 'Personal', 0), O('PZT_M', 'Mediana', 15000), O('PZT_G', 'Grande', 30000)] } });
    A('admin.group', { grupo: { grupo_id: 'G_PZ_ING', nombre: 'Ingredientes', min: 0, max: 12, repetir: 2, activo: true, opciones: [
      O('PZI_MUZ', 'Muzzarella', 6000, 'QUESO'), O('PZI_PEP', 'Pepperoni', 9000, 'PEPPERONI'), O('PZI_JAM', 'Jamón', 7000, 'JAMON'), O('PZI_CHA', 'Champiñones', 6000, 'CHAMPINON'),
      O('PZI_ACE', 'Aceitunas', 4000, 'ACEITUNA'), O('PZI_CEB', 'Cebolla', 3000, 'CEBOLLA'), O('PZI_LOC', 'Locote', 3000, 'MORRON'), O('PZI_TOM', 'Tomate', 3000, 'TOMATE'),
      O('PZI_ALB', 'Albahaca', 3000, 'ALBAHACA'), O('PZI_CHO', 'Choclo', 4000, 'CHOCLO'), O('PZI_ANA', 'Ananá', 5000, 'ANANA'), O('PZI_PAN', 'Panceta', 8000, 'PANCETA')] } });
    A('admin.group', { grupo: { grupo_id: 'G_PZ_SIN_PEP', nombre: 'Trae', tipo: 'QUITAR', min: 0, max: 2, activo: true, opciones: [O('PZS_P_MUZ', 'Muzzarella', 0, 'QUESO'), O('PZS_P_PEP', 'Pepperoni', 0, 'PEPPERONI')] } });
    A('admin.group', { grupo: { grupo_id: 'G_PZ_SIN_MAR', nombre: 'Trae', tipo: 'QUITAR', min: 0, max: 3, activo: true, opciones: [O('PZS_M_MUZ', 'Muzzarella', 0, 'QUESO'), O('PZS_M_TOM', 'Tomate', 0, 'TOMATE'), O('PZS_M_ALB', 'Albahaca', 0, 'ALBAHACA')] } });
    A('admin.group', { grupo: { grupo_id: 'G_HB_PAN', nombre: 'Pan', min: 1, max: 1, activo: true, opciones: [O('HBP_BRI', 'Brioche', 0, 'PAN_BRIOCHE'), O('HBP_NEG', 'Pan negro', 3000, 'PAN_NEGRO'), O('HBP_PAP', 'Pan de papa', 3000, 'PAN_PAPA')] } });
    A('admin.group', { grupo: { grupo_id: 'G_HB_PROT', nombre: 'Proteína', min: 1, max: 1, activo: true, opciones: [O('HBR_CAR', 'Carne', 0, 'CARNE'), O('HBR_POL', 'Pollo crispy', 0, 'POLLO')] } });
    A('admin.group', { grupo: { grupo_id: 'G_HB_SIN_CLA', nombre: 'Trae', tipo: 'QUITAR', min: 0, max: 4, activo: true, opciones: [O('HBS_CHE', 'Cheddar', 0, 'CHEDDAR'), O('HBS_LEC', 'Lechuga', 0, 'LECHUGA'), O('HBS_TOM', 'Tomate', 0, 'TOMATE'), O('HBS_CEB', 'Cebolla', 0, 'CEBOLLA')] } });
    A('admin.group', { grupo: { grupo_id: 'G_HB_EXT', nombre: 'Agregados', min: 0, max: 10, repetir: 3, activo: true, opciones: [
      O('HBE_CAR', 'Carne', 15000, 'CARNE'), O('HBE_POL', 'Pollo crispy', 14000, 'POLLO'), O('HBE_CHE', 'Cheddar', 5000, 'CHEDDAR'), O('HBE_QUE', 'Queso', 4000, 'QUESO'),
      O('HBE_BAC', 'Bacon', 7000, 'PANCETA'), O('HBE_HUE', 'Huevo', 4000, 'HUEVO'), O('HBE_LEC', 'Lechuga', 2000, 'LECHUGA'), O('HBE_TOM', 'Tomate', 2000, 'TOMATE'),
      O('HBE_CEB', 'Cebolla', 2000, 'CEBOLLA'), O('HBE_CAM', 'Cebolla caramelizada', 4000, 'CEBOLLA_CARAMELIZADA'), O('HBE_PEP', 'Pepinillos', 3000, 'PEPINO'),
      O('HBE_JAL', 'Jalapeños', 3000, 'JALAPENO'), O('HBE_BBQ', 'Salsa barbacoa', 2000, 'SALSA'), O('HBE_MOS', 'Mostaza', 1000, 'SALSA')] } });
    var P = function (id, cat, nombre, desc, precio, grupos, armador, orden) {
      A('admin.product', { producto: { producto_id: id, categoria_id: cat, nombre: nombre, descripcion: desc, precio_gs: precio, activo: true, disponible: true, puntos: 'A_CAFE,B_TAKEAWAY', grupos: grupos, orden: orden, validacion: 'APROBADO', nota: 'Ejemplo de la demo', armador: armador } });
    };
    P('PIZZA_A_TU_GUSTO', 'PIZZAS', 'Pizza a tu gusto', 'Elegí el tamaño y sumá los ingredientes que quieras', 35000, 'G_PZ_TAM,G_PZ_ING', 'PIZZA', 0);
    P('HAMB_A_TU_GUSTO', 'HAMBURGUESAS', 'Hamburguesa a tu gusto', 'Elegí el pan y armala capa por capa', 30000, 'G_HB_PAN,G_HB_PROT,G_HB_EXT', 'HAMBURGUESA', 1);
    P('HAMB_CLASICA', 'HAMBURGUESAS', 'Clásica', 'Cheddar, lechuga, tomate y cebolla', 38000, 'G_HB_PAN,G_HB_PROT,G_HB_SIN_CLA,G_HB_EXT', 'HAMBURGUESA', 2);
    // Pizzas de la carta: se pueden armar desde lo que traen (sacar y agregar)
    var menuAdm = A('admin.data', {}).menu;
    [['PIZZA_PEPERONI', 'G_PZ_SIN_PEP,G_PZ_ING'], ['PIZZA_MARGARITA', 'G_PZ_SIN_MAR,G_PZ_ING']].forEach(function (x) {
      var p = menuAdm.productos.filter(function (y) { return y.id === x[0]; })[0]; if (!p) return;
      A('admin.product', { producto: { producto_id: p.id, categoria_id: p.categoria, nombre: p.nombre, descripcion: p.descripcion, precio_gs: p.precio, activo: p.activo, disponible: p.disponible, puntos: p.puntos, grupos: x[1], orden: p.orden, validacion: p.validacion, nota: p.nota, armador: 'PIZZA' } });
    });
  }
  // Porción (slice) de pizza armable: se agrega también a las demos que ya tenían el Upgrade activo.
  if (DEMO_ARMADOR && !load().active.Productos.some(function (p) { return p.producto_id === 'PORCION_A_TU_GUSTO'; })) {
    var A2 = function (action, payload) { var r = app.handle({ action: action, token: admin(), payload: payload }); if (!r.ok) console.warn(action, r.error); return r.data; };
    var O2 = function (id, nombre, delta, dibujo) { return { opcion_id: id, nombre: nombre, delta_gs: delta, activo: true, dibujo: dibujo || '' }; };
    A2('admin.group', { grupo: { grupo_id: 'G_PO_ING', nombre: 'Ingredientes', min: 0, max: 6, repetir: 2, activo: true, opciones: [
      O2('POI_MUZ', 'Muzzarella', 3000, 'QUESO'), O2('POI_PEP', 'Pepperoni', 4000, 'PEPPERONI'), O2('POI_JAM', 'Jamón', 3000, 'JAMON'), O2('POI_CHA', 'Champiñones', 3000, 'CHAMPINON'),
      O2('POI_ACE', 'Aceitunas', 2000, 'ACEITUNA'), O2('POI_LOC', 'Locote', 2000, 'MORRON'), O2('POI_ALB', 'Albahaca', 1500, 'ALBAHACA'), O2('POI_ANA', 'Ananá', 2500, 'ANANA')] } });
    A2('admin.product', { producto: { producto_id: 'PORCION_A_TU_GUSTO', categoria_id: 'PIZZAS', nombre: 'Porción a tu gusto', descripcion: 'Una porción grande con los ingredientes que elijas', precio_gs: 12000, activo: true, disponible: true, puntos: 'A_CAFE,B_TAKEAWAY', grupos: 'G_PO_ING', orden: 1, validacion: 'APROBADO', nota: 'Ejemplo de la demo', armador: 'PORCION' } });
  }

  w.MesaDemo = {
    handle: function (req) {
      if (req.action === 'wa.probar' && w.AtencionWA) return w.AtencionWA.probar(req, Object.assign({ cliente: w.AtencionWA.clienteSimulado() }, WA_DEMO)).then(function (r) { return { ok: r.ok, data: r.data, error: r.error }; });
      // Carta con IA en la demo: se muestra una carta de ejemplo (no hay servidor ni IA en el navegador).
      if (req.action === 'carta.leer' && w.CartaIA) return w.CartaIA.manejar(req, { handle: function (x) { return app.handle(x); }, lector: w.CartaIA.lectorEjemplo(), ejemplo: true }).then(function (r) { return { ok: r.ok, data: r.data, error: r.error }; });
      var r = app.handle(req);
      if (r.ok && DEMO_WA && w.AtencionWA && w.AtencionWA.DISPARAN[req.action]) setTimeout(function () { w.AtencionWA.enviarPendientes(Object.assign({ cliente: w.AtencionWA.clienteSimulado() }, WA_DEMO)); }, 0);
      return { ok: r.ok, data: r.data, error: r.error };
    },
    reset: function () { localStorage.removeItem(KEY); try { localStorage.removeItem('mesapyae.sesion'); } catch (e) { } location.reload(); },
    qr: function () { var d = load(); return { mesas: d.active.Mesas.map(function (m) { return { nombre: m.nombre, token: m.qr_token }; }), takeaway: (d.active.Puntos.filter(function (p) { return p.punto_id === 'B_TAKEAWAY'; })[0] || {}).qr_token }; }
  };

  // Banda superior de aviso
  document.addEventListener('DOMContentLoaded', function () {
    var b = document.createElement('div');
    b.className = 'banner warn no-print';
    b.style.cssText = 'text-align:center;font-size:.82rem;padding:6px 12px';
    var pl = PLAN_UP || 'BASICO';
    b.innerHTML = '<strong>DEMO</strong> · plan: ' + ['BASICO', 'GOLD', 'PREMIUM'].map(function (x) { return '<a href="#" data-plan="' + x + '" style="' + (x === pl ? 'font-weight:700;text-decoration:none;background:#fff;padding:1px 6px;border-radius:6px' : '') + '">' + { BASICO: 'Básico', GOLD: 'Gold', PREMIUM: 'Premium' }[x] + '</a>'; }).join(' ') +
      ' · <a href="#" id="demo-ekua" title="Upgrade aparte: factura en e-Kuatia\'i desde la caja (necesita la extensión)" style="' + (DEMO_EKUA ? 'font-weight:700;text-decoration:none;background:#fff;padding:1px 6px;border-radius:6px' : '') + '">' + (DEMO_EKUA ? '✓ ' : '+ ') + 'e-Kuatia\'i</a>' +
      ' · <a href="#" id="demo-armador" title="Upgrade Armá tu pedido: pizzas y hamburguesas armables con animación en la carta QR" style="' + (DEMO_ARMADOR ? 'font-weight:700;text-decoration:none;background:#fff;padding:1px 6px;border-radius:6px' : '') + '">' + (DEMO_ARMADOR ? '✓ ' : '+ ') + 'Armá tu pedido</a>' +
      ' · <a href="#" id="demo-stock" title="Upgrade Mesa Viru: stock, recetas y margen por plato (Administración → Mesa Viru)" style="' + (DEMO_STOCK ? 'font-weight:700;text-decoration:none;background:#fff;padding:1px 6px;border-radius:6px' : '') + '">' + (DEMO_STOCK ? '✓ ' : '+ ') + 'Mesa Viru</a>' +
      ' · <a href="#" id="demo-wa" title="Upgrade Atención Integrada: avisos automáticos por WhatsApp al cliente de para llevar (simulados en la demo)" style="' + (DEMO_WA ? 'font-weight:700;text-decoration:none;background:#fff;padding:1px 6px;border-radius:6px' : '') + '">' + (DEMO_WA ? '✓ ' : '+ ') + 'Atención</a>' +
      ' · usuarios: admin 1234 · mozo 1111 · cocina 2222 · cajaa 3333 · cajab 4444 · como cliente: <a href="menu.html?t=' + w.MesaDemo.qr().mesas[0].token + '">QR Mesa 1</a> · <a href="menu.html?t=' + w.MesaDemo.qr().takeaway + '">QR Takeaway</a>' +
      (CON_GOLD ? ' · <a href="resena.html?t=' + w.MesaDemo.qr().mesas[0].token + '">Encuesta Mesa 1</a>' : '') + (CON_REC ? ' · <a href="tarjeta.html">Tarjeta del cliente</a>' : '') + ' · <a href="index.html?nostay=1">Inicio</a> · <a href="#" id="demo-reset">Reiniciar demo</a>';
    document.body.insertBefore(b, document.body.firstChild);
    Array.prototype.forEach.call(b.querySelectorAll('[data-plan]'), function (a) { a.onclick = function (e) { e.preventDefault(); try { localStorage.setItem('mesapyae.demo.plan', a.getAttribute('data-plan')); } catch (x) { } location.reload(); }; });
    document.getElementById('demo-ekua').onclick = function (e) { e.preventDefault(); try { localStorage.setItem('mesapyae.demo.ekuatiai', DEMO_EKUA ? 'NO' : 'SI'); } catch (x) { } location.reload(); };
    document.getElementById('demo-wa').onclick = function (e) { e.preventDefault(); try { localStorage.setItem('mesapyae.demo.atencion', DEMO_WA ? 'NO' : 'SI'); } catch (x) { } location.reload(); };
    document.getElementById('demo-armador').onclick = function (e) { e.preventDefault(); try { localStorage.setItem('mesapyae.demo.armador', DEMO_ARMADOR ? 'NO' : 'SI'); } catch (x) { } location.reload(); };
    document.getElementById('demo-stock').onclick = function (e) { e.preventDefault(); try { localStorage.setItem('mesapyae.demo.stock', DEMO_STOCK ? 'NO' : 'SI'); } catch (x) { } location.reload(); };
    document.getElementById('demo-reset').onclick = function (e) { e.preventDefault(); w.Mesa.confirmar('Reiniciar demo', 'Se borran todos los pedidos, cobros y cambios de esta demo.', 'Borrar todo', true).then(function (ok) { if (ok) w.MesaDemo.reset(); }); };
  });
})(window);
