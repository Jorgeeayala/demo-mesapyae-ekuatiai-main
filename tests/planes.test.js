'use strict';
/* Planes de Mesa Pya'e (Básico / Gold / Premium) y módulos Gold: Reseñas y Menú 3D.  node --test tests/planes.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../server/dev-server.js');

const PIN = { admin: '246810', mozo: '1111', cajaa: '3333' };
const USUARIOS = [
  { usuario_id: 'mozo', nombre: 'Mozo Uno', rol: 'MOZO', pin: PIN.mozo },
  { usuario_id: 'cajaa', nombre: 'Cajera A', rol: 'CAJA', caja_id: 'CAJA_A', pin: PIN.cajaa }
];
function fresh(plan) {
  const b = buildApp(null, { secret: 'test-secret', adminPin: PIN.admin, mesas: 20, log: () => {}, usuarios: USUARIOS, plan: plan || '', modulos: '' });
  const call = (action, payload, token) => b.app.handle({ action, payload: payload || {}, token });
  const ok = (a, p, t) => { const r = call(a, p, t); assert.equal(r.ok, true, a + ' falló: ' + JSON.stringify(r.error)); return r.data; };
  const bad = (a, p, t, code) => { const r = call(a, p, t); assert.equal(r.ok, false, a + ' debía fallar'); if (code) assert.equal(r.error.code, code, JSON.stringify(r.error)); return r; };
  const tk = {}; for (const u of Object.keys(PIN)) tk[u] = ok('auth.login', { usuario: u, pin: PIN[u] }).token;
  const data = b.store._data();
  const mesaTok = (n) => data.active.Mesas.find((m) => m.numero === n).qr_token;
  let seq = 0; const rid = () => 'req-pl-' + (++seq) + '-' + Math.random().toString(36).slice(2);
  return { b, call, ok, bad, tk, data, mesaTok, rid };
}
const item = (producto_id, cantidad, opciones) => ({ producto_id, cantidad, opciones: opciones || [] });

test('P01 plan Básico (Andrade hoy): nada de los módulos Gold/Premium', () => {
  const t = fresh('');
  assert.equal(t.ok('health').plan, 'BASICO');
  const pl = t.ok('sync', {}, t.tk.mozo).plan; assert.equal(pl.nombre, 'BASICO'); assert.deepEqual(pl.modulos, []);
  const r = t.ok('public.resolve', { token: t.mesaTok(1) });
  assert.deepEqual(r.modulos, []); assert.equal(r.resenas, undefined); assert.equal(r.recompensas, undefined);
  t.bad('public.resena', { token: t.mesaTok(1), estrellas: 5 }, null, 'NO_DISPONIBLE');
  assert.deepEqual(t.ok('res.admin', {}, t.tk.admin), { licencia: false });
  assert.deepEqual(t.ok('rec.admin', {}, t.tk.admin), { licencia: false });
  // El modelo 3D cargado no se muestra al cliente sin el módulo
  t.data.active.Productos.find((p) => p.producto_id === 'ESPRESSO').modelo_3d = 'modelos/espresso.glb';
  t.data.active.Productos.find((p) => p.producto_id === 'ESPRESSO').imagen = 'https://images.example.com/e.jpg';
  const e = t.ok('public.resolve', { token: t.mesaTok(1) }).menu.productos.find((p) => p.id === 'ESPRESSO');
  assert.equal(e.modelo_3d, undefined); assert.equal(e.imagen, undefined, 'las fotos de los platos son de Gold');
});

test('P02 plan Gold: fotos y reseñas; el menú 3D y las recompensas son de Premium', () => {
  const t = fresh('GOLD');
  assert.equal(t.ok('health').plan, 'GOLD');
  assert.deepEqual(t.ok('sync', {}, t.tk.mozo).plan.modulos, ['FOTOS', 'RESENAS']);
  assert.deepEqual(t.ok('rec.admin', {}, t.tk.admin), { licencia: false });
  // Menú 3D: el encargado carga el modelo y el cliente lo ve
  const adm = t.ok('admin.data', {}, t.tk.admin).menu.productos.find((p) => p.id === 'ESPRESSO');
  const base = { producto_id: 'ESPRESSO', categoria_id: adm.categoria, nombre: adm.nombre, precio_gs: adm.precio, activo: true, disponible: true, puntos: adm.puntos, grupos: adm.grupos.join(','), orden: adm.orden };
  t.bad('admin.product', { producto: Object.assign({}, base, { modelo_3d: 'javascript:alert(1)' }) }, t.tk.admin, 'MODELO_INVALIDO');
  t.bad('admin.product', { producto: Object.assign({}, base, { modelo_3d: 'https://x.com/a.png' }) }, t.tk.admin, 'MODELO_INVALIDO');
  t.ok('admin.product', { producto: Object.assign({}, base, { modelo_3d: 'modelos/espresso.glb' }) }, t.tk.admin);
  // Editar el producto sin mandar el campo no borra el modelo
  t.ok('admin.product', { producto: Object.assign({}, base, { descripcion: 'Doble' }) }, t.tk.admin);
  const r = t.ok('public.resolve', { token: t.mesaTok(1) });
  assert.equal(r.menu.productos.find((p) => p.id === 'ESPRESSO').modelo_3d, undefined, 'el 3D se guarda pero el cliente lo ve recién en Premium');
  assert.deepEqual(r.modulos, ['FOTOS', 'RESENAS']);
  assert.equal(r.resenas.pregunta, '¿Cómo estuvo tu visita?');
  // El sello por encuesta es solo Premium
  t.bad('res.config', { config: { res_sello_encuesta: 'SI' } }, t.tk.admin, 'MODULO_NO_ACTIVO');
});

test('P03 reseñas: una por pedido, mozo atribuido, Google para todos y panel', () => {
  const t = fresh('GOLD');
  t.bad('res.config', { config: { res_google_url: 'g.page/andrade' } }, t.tk.admin, 'VALOR_INVALIDO');
  t.ok('res.config', { config: { res_google_url: 'https://search.google.com/local/writereview?placeid=TEST' } }, t.tk.admin);
  // Pedido del mozo en Mesa 4 → el cliente califica desde el QR de la mesa
  t.ok('order.create', { request_id: t.rid(), mesa_id: 'M04', items: [item('ESPRESSO', 1)] }, t.tk.mozo);
  t.bad('public.resena', { token: t.mesaTok(4), estrellas: 0 }, null, 'ESTRELLAS_INVALIDAS');
  const r1 = t.ok('public.resena', { token: t.mesaTok(4), estrellas: 2, comentario: 'Tardó mucho', request_id: t.rid() });
  assert.equal(r1.google_url, 'https://search.google.com/local/writereview?placeid=TEST'); // también con nota baja: no se filtra
  // Pedido QR con status_token: una sola encuesta por pedido
  const o = t.ok('public.order', { token: t.mesaTok(6), request_id: t.rid(), items: [item('ESPRESSO', 1)] });
  const info = t.ok('public.resenaInfo', { status_token: o.status_token });
  assert.equal(info.ya_respondio, false); assert.equal(info.mesa, 'Mesa 6');
  const r2 = t.ok('public.resena', { status_token: o.status_token, estrellas: 5, comentario: '<b>Excelente</b>', request_id: t.rid() });
  assert.equal(t.ok('public.resena', { status_token: o.status_token, estrellas: 1, request_id: t.rid() }).duplicado, true);
  assert.equal(t.ok('public.resenaInfo', { status_token: o.status_token }).ya_respondio, true);
  t.ok('public.resenaGoogle', { resena_id: r2.resena_id });
  t.ok('public.resenaGoogle', {}); // clic a Google sin encuesta: igual se cuenta
  const a = t.ok('res.admin', {}, t.tk.admin);
  assert.equal(a.stats.total, 2); assert.equal(a.stats.promedio, 3.5); assert.deepEqual(a.stats.distribucion, [0, 1, 0, 0, 1]);
  assert.equal(a.stats.clics_google, 2); assert.equal(a.stats.sin_leer_bajas, 1);
  assert.equal(a.por_mozo[0].nombre, 'Mozo Uno'); assert.equal(a.por_mozo[0].promedio, 2);
  assert.ok(!a.resenas[0].comentario.includes('<'), 'limpia HTML');
  assert.ok(!a.config.some((c) => c.clave === 'res_sello_encuesta'), 'opción Premium oculta en Gold');
  t.ok('res.marcar', { resena_id: a.resenas.find((x) => x.estrellas === 2).resena_id, leida: true, nota: 'Hablamos con cocina' }, t.tk.admin);
  assert.equal(t.ok('res.admin', {}, t.tk.admin).stats.sin_leer_bajas, 0);
  t.bad('res.marcar', { resena_id: 'x', leida: true }, t.tk.cajaa, 'SIN_PERMISO');
});

test('P04 Premium: todo junto; la encuesta interna puede sumar un sello extra por día (nunca Google)', () => {
  const t = fresh('PREMIUM');
  const pl = t.ok('sync', {}, t.tk.mozo).plan;
  assert.equal(pl.nombre, 'PREMIUM'); assert.deepEqual(pl.modulos, ['FOTOS', 'RESENAS', 'MENU3D', 'RECOMPENSAS']); assert.equal(pl.platos_3d, 5);
  const m3 = t.data.active.Productos.find((p) => p.producto_id === 'ESPRESSO'); m3.modelo_3d = 'modelos/espresso.glb';
  assert.equal(t.ok('public.resolve', { token: t.mesaTok(1) }).menu.productos.find((p) => p.id === 'ESPRESSO').modelo_3d, 'modelos/espresso.glb');
  t.ok('rec.config', { premios: [{ sellos: 2, nombre: '1 Espresso gratis', producto_id: 'ESPRESSO' }, { sellos: 5, nombre: 'Postre', valor_gs: 15000 }], config: { rec_activo: 'SI' } }, t.tk.admin);
  t.ok('res.config', { config: { res_sello_encuesta: 'SI' } }, t.tk.admin);
  const cli = t.ok('rec.registrar', { nombre: 'Ana', celular: '0981222333' }, t.tk.cajaa).cliente;
  const o = t.ok('public.order', { token: t.mesaTok(2), request_id: t.rid(), items: [item('ESPRESSO', 2)], rec_celular: '0981222333' });
  const r = t.ok('public.resena', { status_token: o.status_token, estrellas: 4, request_id: t.rid() });
  assert.equal(r.sello.sellos, 1);
  // Otra encuesta el mismo día (otro pedido): no suma de nuevo
  const o2 = t.ok('public.order', { token: t.mesaTok(2), request_id: t.rid(), items: [item('ESPRESSO', 1)] });
  assert.equal(t.ok('public.resena', { status_token: o2.status_token, estrellas: 5, request_id: t.rid() }).sello, undefined);
  // El sello de la visita al cobrar sigue funcionando aparte
  t.ok('caja.abrir', { caja_id: 'CAJA_A', monto_inicial_gs: 0 }, t.tk.cajaa);
  const cta = t.data.active.Cuentas.find((c) => c.cliente_id === cli.cliente_id);
  const cb = t.ok('caja.cobrar', { request_id: t.rid(), cuenta_id: cta.cuenta_id, pagos: [{ medio: 'EFECTIVO', monto_gs: 36000 }] }, t.tk.cajaa);
  assert.equal(cb.recompensa.sellos, 2); assert.equal(cb.recompensa.cupones_nuevos[0].nombre, '1 Espresso gratis');
  assert.ok(t.ok('res.admin', {}, t.tk.admin).config.some((c) => c.clave === 'res_sello_encuesta'));
  // El clic a Google nunca suma sellos
  t.ok('public.resenaGoogle', { resena_id: r.resena_id });
  assert.equal(t.data.active.RecClientes[0].sellos, 2);
});

test('P05 plataforma: Ser o Límites cambia el plan del local sin publicar; el local no puede', () => {
  const crypto = require('crypto');
  const sha = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
  const salt = 'saltdeprueba123';
  let h = salt + ':' + '987654'; for (let i = 0; i < 300; i++) h = sha(h + ':' + salt);
  const b = buildApp(null, { secret: 'test-secret', adminPin: PIN.admin, mesas: 5, log: () => {}, usuarios: USUARIOS, plan: '', modulos: '', plataforma: { usuario_id: 'sol', salt, hash: h } });
  const call = (a, p, t) => b.app.handle({ action: a, payload: p || {}, token: t });
  const ok = (a, p, t) => { const r = call(a, p, t); assert.equal(r.ok, true, a + ': ' + JSON.stringify(r.error)); return r.data; };
  const bad = (a, p, t, code) => { const r = call(a, p, t); assert.equal(r.ok, false); assert.equal(r.error.code, code, JSON.stringify(r.error)); };
  const adm = ok('auth.login', { usuario: 'admin', pin: PIN.admin }).token;
  const lg = ok('auth.login', { usuario: 'sol', pin: '987654' });
  assert.equal(lg.usuario.rol, 'ADMIN'); assert.equal(lg.usuario.plataforma, true);
  const sol = lg.token;
  // El encargado del local no ve ni toca al usuario de plataforma ni la licencia
  assert.ok(!ok('admin.data', {}, adm).usuarios.some((u) => u.usuario_id === 'sol'));
  bad('admin.user', { usuario: { usuario_id: 'sol', nombre: 'x', rol: 'ADMIN', activo: true, pin: '1111' } }, adm, 'USUARIO_PROTEGIDO');
  bad('auth.logoutAll', { usuario_id: 'sol' }, adm, 'USUARIO_PROTEGIDO');
  bad('plataforma.plan', { plan: 'PREMIUM' }, adm, 'SIN_PERMISO');
  bad('admin.config', { clave: '_licencia', valor: '{"plan":"PREMIUM"}' }, adm, 'CLAVE_INVALIDA');
  // Ser o Límites activa Gold, después Premium, después vuelve a Básico
  assert.equal(ok('plataforma.estado', {}, sol).plan, 'BASICO');
  assert.equal(ok('plataforma.plan', { plan: 'GOLD', nota: 'Pagó implementación' }, sol).plan, 'GOLD');
  assert.deepEqual(ok('sync', {}, adm).plan.modulos, ['FOTOS', 'RESENAS']);
  assert.equal(ok('rec.admin', {}, adm).licencia, false);
  const e = ok('plataforma.plan', { plan: 'PREMIUM', nota: 'Upgrade' }, sol);
  assert.equal(e.plan, 'PREMIUM'); assert.equal(e.origen, 'panel'); assert.equal(e.historial.length, 2);
  assert.equal(ok('rec.admin', {}, adm).licencia, true);
  ok('plataforma.plan', { plan: '' }, sol); // vuelve a lo que dice el despliegue (Básico)
  assert.equal(ok('health').plan, 'BASICO');
  bad('plataforma.plan', { plan: 'ORO' }, sol, 'PLAN_INVALIDO');
  // Upgrade e-Kuatia'i: aparte de los planes, sobre cualquier plan; solo Ser o Límites lo activa
  assert.ok(!Object.values(require('../core/core.js').PLANES).some((m) => m.includes('EKUATIAI')), 'e-Kuatia\'i no entra en ningún plan');
  bad('plataforma.upgrade', { modulo: 'EKUATIAI', activo: true }, adm, 'SIN_PERMISO');
  bad('admin.config', { clave: '_upgrades', valor: '["EKUATIAI"]' }, adm, 'CLAVE_INVALIDA');
  bad('plataforma.upgrade', { modulo: 'RECOMPENSAS', activo: true }, sol, 'MODULO_INVALIDO');
  let u = ok('plataforma.upgrade', { modulo: 'EKUATIAI', activo: true, nota: 'Pagó implementación' }, sol);
  assert.equal(u.plan, 'BASICO', 'el Upgrade no cambia el nombre del plan');
  assert.deepEqual(u.upgrades.find((x) => x.modulo === 'EKUATIAI'), { modulo: 'EKUATIAI', info: u.modulos_info.EKUATIAI, activo: true, origen: 'panel' });
  assert.deepEqual(ok('sync', {}, adm).plan.modulos, ['EKUATIAI']);
  ok('plataforma.plan', { plan: 'GOLD' }, sol);
  assert.deepEqual(ok('sync', {}, adm).plan.modulos, ['FOTOS', 'RESENAS', 'EKUATIAI'], 'cambiar de plan conserva el Upgrade');
  assert.equal(ok('health').plan, 'GOLD');
  u = ok('plataforma.upgrade', { modulo: 'EKUATIAI', activo: false }, sol);
  assert.equal(u.upgrades[0].activo, false);
  assert.ok(u.historial.some((h) => /EKUATIAI activo/.test(h.detalle)));
  assert.deepEqual(ok('sync', {}, adm).plan.modulos, ['FOTOS', 'RESENAS']);
  ok('plataforma.plan', { plan: '' }, sol);
  // El usuario de plataforma también funciona como encargado (autoriza, administra)
  ok('admin.data', {}, sol);
  assert.equal(MesaCoreParse('sol:' + salt + ':' + h).usuario_id, 'sol');
  assert.equal(MesaCoreParse('sol:corta:xx'), null);
});
function MesaCoreParse(v) { return require('../core/core.js').parsePlataforma(v); }

test('P06 fotos de productos (Gold y Premium): el encargado carga el link y el cliente la ve en la carta', () => {
  const t = fresh('GOLD');
  const prod = t.ok('admin.data', {}, t.tk.admin).menu.productos.find((p) => p.id === 'ESPRESSO');
  const base = { producto_id: 'ESPRESSO', categoria_id: prod.categoria, nombre: prod.nombre, descripcion: prod.descripcion, precio_gs: prod.precio, activo: true, disponible: true, grupos: prod.grupos.join(','), orden: prod.orden, puntos: prod.puntos };
  t.bad('admin.product', { producto: Object.assign({}, base, { imagen: 'javascript:alert(1)' }) }, t.tk.admin, 'IMAGEN_INVALIDA');
  t.bad('admin.product', { producto: Object.assign({}, base, { imagen: 'https://x.com/a.jpg" onerror="x' }) }, t.tk.admin, 'IMAGEN_INVALIDA');
  t.ok('admin.product', { producto: Object.assign({}, base, { imagen: 'https://images.example.com/espresso.jpg?w=720' }) }, t.tk.admin);
  const m = t.ok('public.resolve', { token: t.mesaTok(1) }).menu.productos;
  assert.equal(m.find((p) => p.id === 'ESPRESSO').imagen, 'https://images.example.com/espresso.jpg?w=720');
  assert.equal(m.filter((p) => p.imagen).length, 1, 'solo el Espresso tiene foto');
  // Guardar sin mandar la foto no la borra; mandarla vacía sí
  t.ok('admin.product', { producto: base }, t.tk.admin);
  assert.ok(t.ok('public.resolve', { token: t.mesaTok(1) }).menu.productos.find((p) => p.id === 'ESPRESSO').imagen);
  t.ok('admin.product', { producto: Object.assign({}, base, { imagen: '' }) }, t.tk.admin);
  assert.equal(t.ok('public.resolve', { token: t.mesaTok(1) }).menu.productos.find((p) => p.id === 'ESPRESSO').imagen, undefined);
});

test('P07 el sitio (netlify.toml) permite el visor 3D, sus texturas, la cámara para escanear y la realidad aumentada', () => {
  const fs = require('fs'), path = require('path');
  const toml = fs.readFileSync(path.join(__dirname, '..', 'netlify.toml'), 'utf8');
  const csp = (toml.match(/Content-Security-Policy = "([^"]+)"/) || [])[1] || '';
  const lib = (fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'menu3d.js'), 'utf8').match(/LIB = '(https:\/\/[^/']+)/) || [])[1];
  const dir = (k) => (csp.split(';').map((s) => s.trim()).find((s) => s.startsWith(k + ' ')) || '');
  assert.ok(lib && dir('script-src').includes(lib), 'script-src debe incluir ' + lib);
  assert.ok(dir('img-src').includes('blob:') && dir('connect-src').includes('blob:'), 'texturas del modelo (blob:)');
  assert.ok(dir('img-src').includes('https:'), 'fotos de platos con link https');
  const pp = (toml.match(/Permissions-Policy = "([^"]+)"/) || [])[1] || '';
  assert.ok(/camera=\(self\)/.test(pp) && /xr-spatial-tracking=\(self\)/.test(pp), 'cámara (escaneo de tarjetas) y AR habilitadas');
});

test('P08 Premium: platos en 3D limitados por plan (5 por defecto); Ser o Límites los amplía desde Licencia', () => {
  const crypto = require('crypto');
  const sha = (x) => crypto.createHash('sha256').update(String(x), 'utf8').digest('hex');
  const salt = 'salt3d'; let h = salt + ':' + '135791'; for (let i = 0; i < 300; i++) h = sha(h + ':' + salt);
  const b = buildApp(null, { secret: 'test-secret', adminPin: PIN.admin, mesas: 3, log: () => {}, usuarios: USUARIOS, plan: 'PREMIUM', modulos: '', plataforma: { usuario_id: 'sol', salt, hash: h } });
  const call = (a, p, t) => b.app.handle({ action: a, payload: p || {}, token: t });
  const ok = (a, p, t) => { const r = call(a, p, t); assert.equal(r.ok, true, a + ': ' + JSON.stringify(r.error)); return r.data; };
  const adm = ok('auth.login', { usuario: 'admin', pin: PIN.admin }).token, sol = ok('auth.login', { usuario: 'sol', pin: '135791' }).token;
  const prods = ok('admin.data', {}, adm).menu.productos.slice(0, 7);
  const con3d = (p, i) => ({ producto: { producto_id: p.id, categoria_id: p.categoria, nombre: p.nombre, precio_gs: p.precio, activo: true, disponible: true, puntos: p.puntos, grupos: p.grupos.join(','), orden: p.orden, modelo_3d: 'modelos/plato' + i + '.glb' } });
  for (let i = 0; i < 5; i++) ok('admin.product', con3d(prods[i], i), adm);
  const r = call('admin.product', con3d(prods[5], 5), adm);
  assert.equal(r.ok, false); assert.equal(r.error.code, 'LIMITE_3D'); assert.match(r.error.message, /5 platos en 3D/);
  ok('admin.product', con3d(prods[0], 9), adm);  // cambiar el modelo de un plato que ya tenía 3D sí se puede
  assert.equal(ok('admin.data', {}, adm).plan.platos_3d_usados, 5);
  assert.equal(ok('plataforma.plan', { plan: 'PREMIUM', nota: 'Pack 10 platos', platos_3d: 10 }, sol).platos_3d, 10);
  ok('admin.product', con3d(prods[5], 5), adm);
  assert.equal(call('plataforma.plan', { plan: 'PREMIUM', platos_3d: 999 }, sol).error.code, 'VALOR_INVALIDO');
});

test('P09 menú semanal: un plato con días se muestra y se pide solo ese día', () => {
  const t = fresh('');
  const hoy = ((new Date(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date()) + 'T12:00:00Z').getUTCDay() + 6) % 7) + 1;
  const otro = hoy === 1 ? 2 : 1;
  const base = { categoria_id: 'ALMUERZOS', precio_gs: 35000, activo: true, disponible: true, puntos: 'A_CAFE,B_TAKEAWAY', grupos: '', orden: 1 };
  t.ok('admin.category', { categoria: { categoria_id: 'ALMUERZOS', nombre: 'Almuerzos', orden: 15, activa: true } }, t.tk.admin);
  t.bad('admin.product', { producto: Object.assign({}, base, { producto_id: 'MALO', nombre: 'Malo', dias: '8' }) }, t.tk.admin, 'DIAS_INVALIDOS');
  t.ok('admin.product', { producto: Object.assign({}, base, { producto_id: 'DIA_HOY', nombre: 'Plato de hoy', dias: String(hoy) }) }, t.tk.admin);
  t.ok('admin.product', { producto: Object.assign({}, base, { producto_id: 'DIA_OTRO', nombre: 'Plato de otro día', dias: String(otro) }) }, t.tk.admin);
  t.ok('admin.product', { producto: Object.assign({}, base, { producto_id: 'SIEMPRE', nombre: 'Plato a la carta' }) }, t.tk.admin);
  const ids = t.ok('public.resolve', { token: t.mesaTok(1) }).menu.productos.map((p) => p.id);
  assert.ok(ids.includes('DIA_HOY') && ids.includes('SIEMPRE') && !ids.includes('DIA_OTRO'), ids.join(','));
  assert.ok(t.ok('public.resolve', { token: t.mesaTok(1) }).menu.productos.find((p) => p.id === 'DIA_HOY').dia);
  assert.equal(t.ok('admin.data', {}, t.tk.admin).menu.productos.find((p) => p.id === 'DIA_OTRO').dias, String(otro), 'el encargado ve todos');
  t.ok('public.order', { token: t.mesaTok(1), request_id: t.rid(), items: [item('DIA_HOY', 1)] });
  t.bad('public.order', { token: t.mesaTok(1), request_id: t.rid(), items: [item('DIA_OTRO', 1)] }, null, 'PRODUCTO_OTRO_DIA');
  // Editar sin mandar 'dias' no borra los días
  t.ok('admin.product', { producto: Object.assign({}, base, { producto_id: 'DIA_OTRO', nombre: 'Plato de otro día' }) }, t.tk.admin);
  assert.equal(t.ok('admin.data', {}, t.tk.admin).menu.productos.find((p) => p.id === 'DIA_OTRO').dias, String(otro));
});

test('P10 reinicio de datos de prueba: borra la operación y conserva carta, mesas, usuarios, plan y premios', () => {
  const crypto = require('crypto');
  const sha = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
  const salt = 'saltdeprueba123';
  let h = salt + ':' + '987654'; for (let i = 0; i < 300; i++) h = sha(h + ':' + salt);
  const b = buildApp(null, { secret: 'test-secret', adminPin: PIN.admin, mesas: 5, log: () => {}, usuarios: USUARIOS, plan: 'PREMIUM', modulos: '', plataforma: { usuario_id: 'sol', salt, hash: h } });
  const call = (a, p, t) => b.app.handle({ action: a, payload: p || {}, token: t });
  const ok = (a, p, t) => { const r = call(a, p, t); assert.equal(r.ok, true, a + ': ' + JSON.stringify(r.error)); return r.data; };
  const bad = (a, p, t, code) => { const r = call(a, p, t); assert.equal(r.ok, false, a + ' debía fallar'); assert.equal(r.error.code, code, JSON.stringify(r.error)); };
  const adm = ok('auth.login', { usuario: 'admin', pin: PIN.admin }).token;
  const sol = ok('auth.login', { usuario: 'sol', pin: '987654' }).token;
  const mozo = ok('auth.login', { usuario: 'mozo', pin: PIN.mozo }).token;
  const caja = ok('auth.login', { usuario: 'cajaa', pin: PIN.cajaa }).token;
  const antes = ok('admin.data', {}, adm);
  const mesa = antes.mesas[0];
  // Operación de prueba: pedido, cobro, cliente del club, reserva
  ok('rec.config', { premios: [{ tipo: 'SELLOS', sellos: 6, nombre: '1 Espresso gratis', producto_id: 'ESPRESSO', costo_gs: 4000 }], config: { rec_activo: 'SI' } }, adm);
  const premiosAntes = ok('rec.admin', {}, adm).premios.length;
  const cli = ok('rec.registrar', { celular: '0981123456', nombre: 'Cliente Prueba' }, caja);
  const p = ok('order.create', { request_id: 'reinicio-1', mesa_id: mesa.mesa_id, punto_id: 'A_CAFE', items: [{ producto_id: 'ESPRESSO', cantidad: 2, opciones: [] }] }, mozo).pedido;
  ok('caja.abrir', { caja_id: 'CAJA_A', monto_inicial_gs: 0 }, caja);
  // Con la caja abierta y una cuenta sin cobrar no deja reiniciar
  bad('plataforma.reiniciar', { confirmar: 'REINICIAR' }, sol, 'CAJA_ABIERTA');
  ok('caja.cobrar', { request_id: 'reinicio-c1', cuenta_id: p.cuenta_id, pagos: [{ medio: 'EFECTIVO', monto_gs: p.total_gs }] }, caja);
  ok('caja.cerrar', { caja_id: 'CAJA_A', efectivo_declarado_gs: p.total_gs }, caja);
  ok('order.create', { request_id: 'reinicio-2', mesa_id: antes.mesas[1].mesa_id, punto_id: 'A_CAFE', items: [{ producto_id: 'ESPRESSO', cantidad: 1, opciones: [] }] }, mozo);
  bad('plataforma.reiniciar', { confirmar: 'REINICIAR' }, sol, 'CUENTAS_ABIERTAS');
  const c2 = ok('sync', {}, mozo).cuentas.find((c) => c.estado === 'ABIERTA');
  ok('caja.abrir', { caja_id: 'CAJA_A', monto_inicial_gs: 0 }, caja);
  ok('caja.cobrar', { request_id: 'reinicio-c2', cuenta_id: c2.cuenta_id, pagos: [{ medio: 'EFECTIVO', monto_gs: c2.total_gs }] }, caja);
  ok('caja.cerrar', { caja_id: 'CAJA_A', efectivo_declarado_gs: c2.total_gs }, caja);
  // Solo Ser o Límites, y con confirmación escrita
  bad('plataforma.reiniciar', { confirmar: 'REINICIAR' }, adm, 'SIN_PERMISO');
  bad('plataforma.reiniciar', { confirmar: 'si' }, sol, 'CONFIRMACION');
  const r = ok('plataforma.reiniciar', { confirmar: 'REINICIAR', nota: 'Fin de capacitación' }, sol);
  assert.equal(r.borrados.Pedidos, 2); assert.equal(r.borrados.Cobros, 2); assert.equal(r.borrados.RecClientes, 1);
  // Queda en cero
  const s = ok('sync', {}, mozo);
  assert.equal(s.pedidos.length, 0); assert.equal(s.cuentas.length, 0);
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date());
  const rep = ok('admin.report', { desde: '2026-01-01', hasta: hoy }, adm);
  assert.equal(rep.pedidos.total, 0); assert.equal(rep.consolidado_gs, 0); assert.equal(rep.cierres.length, 0);
  const recD = ok('rec.admin', {}, adm);
  assert.equal((recD.clientes || []).length, 0, 'el club arranca sin clientes');
  assert.equal(recD.premios.length, premiosAntes, 'los premios del club se conservan');
  assert.ok(cli.cliente.cliente_id);
  // Se conserva todo lo del local
  const desp = ok('admin.data', {}, adm);
  assert.equal(desp.menu.productos.length, antes.menu.productos.length);
  assert.deepEqual(desp.mesas.map((m) => m.qr_token), antes.mesas.map((m) => m.qr_token));
  assert.equal(desp.usuarios.length, antes.usuarios.length);
  assert.equal(ok('health').plan, 'PREMIUM');
  assert.ok(ok('admin.audit', {}, adm).auditoria.some((a) => a.accion === 'REINICIO_DATOS' && a.usuario_id === 'sol'));
  // Se sigue operando normal y la numeración arranca de nuevo
  const n = ok('order.create', { request_id: 'reinicio-3', mesa_id: mesa.mesa_id, punto_id: 'A_CAFE', items: [{ producto_id: 'ESPRESSO', cantidad: 1, opciones: [] }] }, mozo).pedido;
  assert.equal(n.numero, 'A-001');
});
