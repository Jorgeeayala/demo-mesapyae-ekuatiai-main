'use strict';
/* Upgrade "Atención Integrada": avisos automáticos por WhatsApp (Whaticket) al cliente de para llevar.
   node --test tests/atencion.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { buildApp } = require('../server/dev-server.js');
const AtencionWA = require('../core/atencion-wa.js');

const PIN = { admin: '246810', mozo: '1111', cocina: '2222', cajab: '4444' };
const USUARIOS = [
  { usuario_id: 'mozo', nombre: 'Mozo Uno', rol: 'MOZO', pin: PIN.mozo },
  { usuario_id: 'cocina', nombre: 'Cocina', rol: 'COCINA', pin: PIN.cocina },
  { usuario_id: 'cajab', nombre: 'Caja Para llevar', rol: 'CAJA', caja_id: 'CAJA_B', pin: PIN.cajab }
];
const SOL_PIN = '987654';
function plataforma() {
  const sha = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
  const salt = 'saltdeprueba123';
  let h = salt + ':' + SOL_PIN; for (let i = 0; i < 300; i++) h = sha(h + ':' + salt);
  return { usuario_id: 'sol', salt, hash: h };
}
function fresh(modulos, opts) {
  opts = opts || {};
  const b = buildApp(null, { secret: 'test-secret', adminPin: PIN.admin, mesas: 5, log: () => {}, usuarios: USUARIOS, plan: '', modulos: modulos === undefined ? 'ATENCION' : modulos, plataforma: plataforma() });
  const call = (action, payload, token) => b.app.handle({ action, payload: payload || {}, token });
  const ok = (a, p, t) => { const r = call(a, p, t); assert.equal(r.ok, true, a + ' falló: ' + JSON.stringify(r.error)); return r.data; };
  const bad = (a, p, t, code) => { const r = call(a, p, t); assert.equal(r.ok, false, a + ' debía fallar'); if (code) assert.equal(r.error.code, code, JSON.stringify(r.error)); return r; };
  const tk = {}; for (const u of Object.keys(PIN)) tk[u] = ok('auth.login', { usuario: u, pin: PIN[u] }).token;
  tk.sol = ok('auth.login', { usuario: 'sol', pin: SOL_PIN }).token;
  const data = b.store._data();
  const tkQR = data.active.Puntos.find((p) => p.punto_id === 'B_TAKEAWAY').qr_token;
  ok('admin.config', { clave: 'para_llevar_whatsapp', valor: 'OPCIONAL' }, tk.admin);
  if (opts.conectar !== false && modulos !== '') ok('wa.config', { config: { wa_conexion_id: 'conn-qr', wa_conexion_nombre: 'Atención QR' } }, tk.sol);
  if (opts.modo) ok('wa.config', { config: { wa_avisos: opts.modo } }, tk.admin);
  const pedirLlevar = (extra) => {
    const r = ok('public.order', Object.assign({ token: tkQR, request_id: 'req-wa-' + Math.random().toString(36).slice(2), alias: 'Ana', items: [{ producto_id: 'ESPRESSO', cantidad: 1, opciones: [] }] }, extra || {}));
    return data.active.Pedidos.find((x) => x.status_token === r.status_token);
  };
  const avisos = () => data.active.AvisosWA;
  const deps = (cliente) => ({ handle: (r) => b.app.handle(r), token: 'tk-real', cliente, firmar: (m) => b.env.hmac(b.env.secret, m) });
  return { b, call, ok, bad, tk, data, pedirLlevar, avisos, deps };
}

test('W01 sin el Upgrade: no hay cola, no hay pantalla y el plan no cambia', () => {
  const t = fresh('');
  t.bad('wa.estado', {}, t.tk.admin, 'MODULO_NO_ACTIVO');
  t.bad('wa.config', { config: { wa_avisos: 'AMBOS' } }, t.tk.admin, 'MODULO_NO_ACTIVO');
  const p = t.pedirLlevar({ whatsapp: '0981 123 456' });
  t.ok('order.state', { pedido_id: p.pedido_id, estado: 'ACEPTADO' }, t.tk.cajab);
  t.ok('order.state', { pedido_id: p.pedido_id, estado: 'LISTO' }, t.tk.cocina);
  assert.equal(t.avisos().length, 0);
  const u = fresh('ATENCION');
  assert.equal(u.ok('health').plan, 'BASICO', 'un Upgrade no cambia el nombre del plan');
});

test('W02 la conexión la elige Ser o Límites; el encargado no puede ni prender avisos sin conexión', () => {
  const t = fresh('ATENCION', { conectar: false });
  t.bad('wa.config', { config: { wa_conexion_id: 'conn-qr' } }, t.tk.admin, 'SIN_PERMISO');
  t.bad('wa.config', { config: { wa_avisos: 'AMBOS' } }, t.tk.admin, 'SIN_CONEXION');
  t.bad('wa.puedeProbar', {}, t.tk.admin, 'SIN_PERMISO');
  t.ok('wa.puedeProbar', {}, t.tk.sol);
  t.ok('wa.config', { config: { wa_conexion_id: 'conn-qr', wa_conexion_nombre: 'Atención QR' } }, t.tk.sol);
  const e = t.ok('wa.config', { config: { wa_avisos: 'listo', wa_aviso_listo: '{nombre}: tu pedido {numero} está listo en {local}.' } }, t.tk.admin);
  assert.equal(e.config.wa_avisos, 'LISTO');
  t.bad('wa.config', { config: { wa_avisos: 'SIEMPRE' } }, t.tk.admin, 'VALOR_INVALIDO');
  t.bad('wa.config', { config: { wa_aviso_listo: 'corto' } }, t.tk.admin, 'VALOR_INVALIDO');
  t.bad('wa.config', { config: { otra_cosa: 'x' } }, t.tk.admin, 'CLAVE_INVALIDA');
  t.bad('wa.estado', {}, t.tk.mozo, 'SIN_PERMISO');
});

test('W03 AMBOS: aviso al aceptar el pedido y cuando está listo; uno solo por tipo; sin WhatsApp no hay aviso', () => {
  const t = fresh('ATENCION', { modo: 'AMBOS' });
  const p = t.pedirLlevar({ whatsapp: '0981 123 456' });
  assert.equal(t.avisos().length, 0, 'mientras está PENDIENTE no se avisa');
  t.ok('order.state', { pedido_id: p.pedido_id, estado: 'ACEPTADO' }, t.tk.cajab);
  assert.deepEqual(t.avisos().map((a) => a.tipo), ['RECIBIDO']);
  const a = t.avisos()[0];
  assert.equal(a.numero, '595981123456');
  assert.match(a.texto, new RegExp('Ana.*' + p.numero));
  t.ok('order.state', { pedido_id: p.pedido_id, estado: 'LISTO' }, t.tk.cocina);
  t.ok('order.state', { pedido_id: p.pedido_id, estado: 'EN_PREPARACION' }, t.tk.cocina);
  t.ok('order.state', { pedido_id: p.pedido_id, estado: 'LISTO' }, t.tk.cocina);
  assert.deepEqual(t.avisos().map((x) => x.tipo).sort(), ['LISTO', 'RECIBIDO'], 'volver a LISTO no repite el aviso');
  const sinWa = t.pedirLlevar();
  t.ok('order.state', { pedido_id: sinWa.pedido_id, estado: 'ACEPTADO' }, t.tk.cajab);
  t.ok('order.state', { pedido_id: sinWa.pedido_id, estado: 'LISTO' }, t.tk.cocina);
  assert.equal(t.avisos().length, 2);
});

test('W04 LISTO: solo avisa cuando está listo (también si lo marcan las estaciones)', () => {
  const t = fresh('ATENCION', { modo: 'LISTO' });
  const p = t.pedirLlevar({ whatsapp: '0981 555 666' });
  t.ok('order.state', { pedido_id: p.pedido_id, estado: 'ACEPTADO' }, t.tk.cajab);
  assert.equal(t.avisos().length, 0);
  const ped = t.data.active.Pedidos.find((x) => x.pedido_id === p.pedido_id);
  const est = t.ok('sync', {}, t.tk.cocina).pedidos.find((x) => x.pedido_id === p.pedido_id).estaciones[0].id;
  t.ok('order.station', { pedido_id: ped.pedido_id, estacion: est, estado: 'LISTO' }, t.tk.cocina);
  assert.deepEqual(t.avisos().map((a) => a.tipo), ['LISTO']);
});

test('W05 el envío: sale por Whaticket, marca ENVIADO, reintenta hasta 3 veces y las llamadas internas van firmadas', async () => {
  const t = fresh('ATENCION', { modo: 'AMBOS' });
  const p = t.pedirLlevar({ whatsapp: '0981 123 456' });
  t.ok('order.state', { pedido_id: p.pedido_id, estado: 'ACEPTADO' }, t.tk.cajab);
  const enviados = [];
  const r = await AtencionWA.enviarPendientes(t.deps(AtencionWA.clienteSimulado(enviados)));
  assert.deepEqual(r, { enviados: 1, fallidos: 0 });
  assert.equal(enviados[0].conexionId, 'conn-qr');
  assert.deepEqual(enviados[0].mensajes.map((m) => m.number), ['595981123456']);
  assert.equal(t.avisos()[0].estado, 'ENVIADO');
  assert.deepEqual(await AtencionWA.enviarPendientes(t.deps(AtencionWA.clienteSimulado(enviados))), { enviados: 0, fallidos: 0 }, 'no se repite');
  // Whaticket falla: queda pendiente con el error y al tercer intento pasa a ERROR
  t.ok('order.state', { pedido_id: p.pedido_id, estado: 'LISTO' }, t.tk.cocina);
  const falla = { enviar: () => Promise.reject(new AtencionWA.WhaticketError(401, 'POST /messages', 'ERR_INSUFFICIENT_PERMISSION')) };
  for (let i = 0; i < 3; i++) await AtencionWA.enviarPendientes(t.deps(falla));
  const listo = t.avisos().find((a) => a.tipo === 'LISTO');
  assert.equal(listo.estado, 'ERROR'); assert.equal(listo.intentos, 3); assert.match(listo.error, /permiso/);
  const est = t.ok('wa.estado', {}, t.tk.admin);
  assert.equal(est.con_error, 1);
  // Sin firma o con firma vieja, nadie puede leer la cola
  t.bad('sistema.avisosWA', {}, undefined, 'NO_SESION');
  t.bad('sistema.avisosWA', { ts: Date.now(), firma: 'x' }, undefined, 'NO_SESION');
  const viejo = Date.now() - 10 * 60000;
  t.bad('sistema.avisosWA', { ts: viejo, firma: t.b.env.hmac(t.b.env.secret, 'sistema|' + viejo) }, undefined, 'NO_SESION');
  // Sin token cargado no se intenta nada
  assert.equal((await AtencionWA.enviarPendientes(Object.assign(t.deps(falla), { token: 'pendiente' }))).motivo, 'sin-token');
});

test('W06 probar conexión: solo Ser o Límites, con el Upgrade y con token', async () => {
  const t = fresh('ATENCION');
  const conCliente = (tk, token) => AtencionWA.probar({ token: tk }, Object.assign(t.deps(AtencionWA.clienteSimulado()), token ? { token } : {}));
  assert.equal((await conCliente(t.tk.admin)).error.code, 'SIN_PERMISO');
  assert.equal((await conCliente(t.tk.sol, 'pendiente')).error.code, 'SIN_TOKEN');
  const r = await conCliente(t.tk.sol);
  assert.equal(r.ok, true); assert.equal(r.data.conexiones[0].id, 'conn-demo');
  const caido = { me: () => Promise.reject(new AtencionWA.WhaticketError(401, 'GET /me', '')) };
  const e = await AtencionWA.probar({ token: t.tk.sol }, t.deps(caido));
  assert.equal(e.error.code, 'WHATICKET'); assert.match(e.error.message, /token/);
});

test('W07 cliente de Whaticket: ruta, encabezado y cuerpo correctos; el token nunca va en la ruta', async () => {
  const llamadas = [];
  const f = (url, init) => { llamadas.push({ url, init }); return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('"OK"') }); };
  const c = AtencionWA.crearCliente({ token: 'tk-secreto', fetch: f });
  await c.enviar('conn-1', [{ number: '595981123456', body: 'Hola' }]);
  assert.equal(llamadas[0].url, 'https://api.whaticket.com/api/v1/messages');
  assert.equal(llamadas[0].init.headers.Authorization, 'Bearer tk-secreto');
  const cuerpo = JSON.parse(llamadas[0].init.body);
  assert.equal(cuerpo.connectionId, 'conn-1'); assert.equal(cuerpo.messages[0].number, '595981123456');
  assert.equal(cuerpo.messages[0].ticketData, undefined, 'sin estado: el aviso queda en Resueltos y no llena la bandeja');
  assert.ok(!llamadas[0].url.includes('tk-secreto'));
  const f401 = () => Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve('{"error":"ERR_INSUFFICIENT_PERMISSION"}') });
  await assert.rejects(AtencionWA.crearCliente({ token: 't', fetch: f401 }).me(), (e) => e.codigo === 'ERR_INSUFFICIENT_PERMISSION' && e.status === 401);
});

test('W08 reiniciar datos de prueba vacía la cola de avisos', () => {
  const t = fresh('ATENCION', { modo: 'AMBOS' });
  const p = t.pedirLlevar({ whatsapp: '0981 123 456' });
  t.ok('order.state', { pedido_id: p.pedido_id, estado: 'ACEPTADO' }, t.tk.cajab);
  assert.equal(t.avisos().length, 1);
  t.ok('order.cancel', { pedido_id: p.pedido_id, motivo: 'Prueba de capacitación' }, t.tk.admin);
  t.ok('plataforma.reiniciar', { confirmar: 'REINICIAR' }, t.tk.sol);
  assert.equal(t.avisos().length, 0);
});
