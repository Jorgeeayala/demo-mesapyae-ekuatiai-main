'use strict';
/* Pedidos para llevar del QR atendidos por el EQUIPO (mozos marcados + caja del salón).  node --test tests/llevar.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../server/dev-server.js');

const PIN = { admin: '246810', barra: '5555', mozo: '1111', cajaa: '3333', cajab: '4444', cocina: '2222' };
const USUARIOS = [
  { usuario_id: 'barra', nombre: 'Mozo Barra', rol: 'MOZO', pin: PIN.barra, para_llevar: true },
  { usuario_id: 'mozo', nombre: 'Mozo Salón', rol: 'MOZO', pin: PIN.mozo },
  { usuario_id: 'cajaa', nombre: 'Caja Salón', rol: 'CAJA', caja_id: 'CAJA_A', pin: PIN.cajaa },
  { usuario_id: 'cajab', nombre: 'Caja Para llevar', rol: 'CAJA', caja_id: 'CAJA_B', pin: PIN.cajab },
  { usuario_id: 'cocina', nombre: 'Cocina', rol: 'COCINA', pin: PIN.cocina }
];
function fresh(modo) {
  const b = buildApp(null, { secret: 'test-secret', adminPin: PIN.admin, log: () => {}, usuarios: USUARIOS, plan: '', modulos: '' });
  const call = (action, payload, token) => b.app.handle({ action, payload: payload || {}, token });
  const ok = (a, p, t) => { const r = call(a, p, t); assert.equal(r.ok, true, a + ' falló: ' + JSON.stringify(r.error)); return r.data; };
  const bad = (a, p, t, code) => { const r = call(a, p, t); assert.equal(r.ok, false, a + ' debía fallar'); if (code) assert.equal(r.error.code, code, JSON.stringify(r.error)); return r; };
  const tk = {}; for (const u of Object.keys(PIN)) tk[u] = ok('auth.login', { usuario: u, pin: PIN[u] }).token;
  if (modo) ok('admin.config', { clave: 'para_llevar_qr_atiende', valor: modo }, tk.admin);
  const data = b.store._data();
  const tkQR = data.active.Puntos.find((p) => p.punto_id === 'B_TAKEAWAY').qr_token;
  let seq = 0;
  const pedirLlevar = () => ok('public.order', { token: tkQR, request_id: 'req-llevar-' + (++seq) + '-' + Math.random().toString(36).slice(2), alias: 'Ana', items: [{ producto_id: 'ESPRESSO', cantidad: 1, opciones: [] }] });
  const ped = (numero) => data.active.Pedidos.find((p) => p.numero === numero);
  return { b, call, ok, bad, tk, data, pedirLlevar, ped };
}

test('LL01 sin cambiar nada (CAJA): el pedido para llevar del QR sigue yendo a la caja de para llevar', () => {
  const t = fresh();
  const r = t.pedirLlevar();
  const p = t.ped(r.numero);
  assert.equal(p.caja_id, 'CAJA_B');
  assert.ok(t.ok('sync', {}, t.tk.cajab).pedidos.some((x) => x.numero === r.numero), 'Caja 02 lo ve');
  assert.ok(!t.ok('sync', {}, t.tk.cajaa).pedidos.some((x) => x.numero === r.numero), 'Caja 01 no lo ve');
  assert.deepEqual(t.ok('sync', {}, t.tk.mozo).avisos_llevar, []);
  assert.equal(t.ok('sync', {}, t.tk.barra).ajustes.para_llevar.modo, 'CAJA');
  t.ok('order.state', { pedido_id: p.pedido_id, estado: 'ACEPTADO' }, t.tk.cajab);
});

test('LL02 con EQUIPO: lo atiende la caja del salón y el mozo de barra; Caja 02 solo recibe el aviso', () => {
  const t = fresh('EQUIPO');
  const r = t.pedirLlevar();
  const p = t.ped(r.numero);
  assert.equal(p.caja_id, 'CAJA_A', 'el pedido pasa a la caja del salón');
  assert.equal(p.punto_id, 'B_TAKEAWAY', 'sigue siendo para llevar (numeración T- y su carta)');
  assert.equal(t.data.active.Cuentas.find((c) => c.cuenta_id === p.cuenta_id).caja_id, 'CAJA_A', 'la cuenta la cobra la caja del salón');
  // Quién lo ve
  assert.ok(t.ok('sync', {}, t.tk.cajaa).pedidos.some((x) => x.numero === r.numero), 'Caja 01 lo ve');
  const sb = t.ok('sync', {}, t.tk.cajab);
  assert.ok(!sb.pedidos.some((x) => x.numero === r.numero), 'Caja 02 no lo tiene para atender');
  assert.equal(sb.avisos_llevar.length, 1, 'pero recibe el aviso');
  assert.equal(sb.avisos_llevar[0].alias, 'Ana');
  assert.equal(t.ok('sync', {}, t.tk.mozo).avisos_llevar.length, 1, 'todo el equipo de atención recibe el aviso');
  assert.equal(t.ok('sync', {}, t.tk.cocina).avisos_llevar.length, 0, 'cocina no: todavía no fue aceptado');
  const aj = t.ok('sync', {}, t.tk.barra).ajustes.para_llevar;
  assert.deepEqual(aj, { modo: 'EQUIPO', alertas: [3, 5], caja: 'CAJA_A', atiendo: true });
  assert.equal(t.ok('sync', {}, t.tk.mozo).ajustes.para_llevar.atiendo, false);
  assert.equal(t.ok('sync', {}, t.tk.cajaa).ajustes.para_llevar.atiendo, true);
  assert.equal(t.ok('sync', {}, t.tk.cajab).ajustes.para_llevar.atiendo, false);
  // Quién puede aceptarlo
  t.bad('order.state', { pedido_id: p.pedido_id, estado: 'ACEPTADO' }, t.tk.cajab, 'SIN_PERMISO');
  t.bad('order.state', { pedido_id: p.pedido_id, estado: 'ACEPTADO' }, t.tk.mozo, 'SIN_PERMISO');
  t.ok('order.state', { pedido_id: p.pedido_id, estado: 'ACEPTADO' }, t.tk.barra);
  assert.equal(t.ok('sync', {}, t.tk.mozo).avisos_llevar.length, 0, 'aceptado: se apaga el aviso');
  // Cocina lo prepara, el mozo de barra lo entrega, la caja del salón lo cobra
  t.ok('order.state', { pedido_id: p.pedido_id, estado: 'LISTO' }, t.tk.cocina);
  t.bad('order.state', { pedido_id: p.pedido_id, estado: 'ENTREGADO' }, t.tk.mozo, 'SIN_PERMISO');
  t.ok('order.state', { pedido_id: p.pedido_id, estado: 'ENTREGADO' }, t.tk.barra);
  t.bad('caja.abrir', { caja_id: 'CAJA_A', monto_inicial_gs: 0 }, t.tk.cajab);
  t.ok('caja.abrir', { caja_id: 'CAJA_A', monto_inicial_gs: 0 }, t.tk.cajaa);
  t.bad('caja.cobrar', { request_id: 'cobro-ll02-b', cuenta_id: p.cuenta_id, pagos: [{ medio: 'EFECTIVO', monto_gs: p.total_gs }] }, t.tk.cajab);
  const c = t.ok('caja.cobrar', { request_id: 'cobro-ll02-a', cuenta_id: p.cuenta_id, pagos: [{ medio: 'EFECTIVO', monto_gs: p.total_gs }] }, t.tk.cajaa);
  assert.equal(c.cobro.caja_id, 'CAJA_A');
});

test('LL03 con EQUIPO: la caja del salón también puede aceptar; rechazar es del equipo, no de Caja 02', () => {
  const t = fresh('EQUIPO');
  const a = t.ped(t.pedirLlevar().numero);
  t.ok('order.state', { pedido_id: a.pedido_id, estado: 'ACEPTADO' }, t.tk.cajaa);
  const b = t.ped(t.pedirLlevar().numero);
  t.bad('order.cancel', { pedido_id: b.pedido_id, motivo: 'Sin stock' }, t.tk.cajab);
  t.bad('order.cancel', { pedido_id: b.pedido_id, motivo: 'Sin stock' }, t.tk.mozo);
  t.ok('order.cancel', { pedido_id: b.pedido_id, motivo: 'Sin stock' }, t.tk.barra);
  assert.equal(t.ped(b.numero).estado, 'CANCELADO');
});

test('LL04 con EQUIPO, las ventas propias de Caja 02 y los pedidos del salón no cambian', () => {
  const t = fresh('EQUIPO');
  t.ok('caja.abrir', { caja_id: 'CAJA_B', monto_inicial_gs: 0 }, t.tk.cajab);
  const v = t.ok('order.create', { request_id: 'venta-b-ll04', punto_id: 'B_TAKEAWAY', alias: 'Mostrador', items: [{ producto_id: 'ESPRESSO', cantidad: 1, opciones: [] }] }, t.tk.cajab);
  assert.equal(t.ped(v.pedido.numero).caja_id, 'CAJA_B');
  const mesa = t.data.active.Mesas.find((m) => m.numero === 1);
  const m = t.ok('public.order', { token: mesa.qr_token, request_id: 'mesa-ll04', items: [{ producto_id: 'ESPRESSO', cantidad: 1, opciones: [] }] });
  const pm = t.ped(m.numero);
  assert.equal(pm.caja_id, 'CAJA_A');
  t.ok('order.state', { pedido_id: pm.pedido_id, estado: 'ACEPTADO' }, t.tk.mozo, 'cualquier mozo acepta los pedidos del salón');
});

test('LL05 configuración y usuarios: valores válidos y marca "Atiende para llevar" solo para mozos', () => {
  const t = fresh();
  t.bad('admin.config', { clave: 'para_llevar_qr_atiende', valor: 'MOZOS' }, t.tk.admin, 'VALOR_INVALIDO');
  t.ok('admin.config', { clave: 'para_llevar_qr_atiende', valor: 'equipo' }, t.tk.admin);
  t.bad('admin.config', { clave: 'para_llevar_alerta_min', valor: '5,3' }, t.tk.admin, 'VALOR_INVALIDO');
  assert.equal(t.ok('admin.config', { clave: 'para_llevar_alerta_min', valor: '2, 4, 6' }, t.tk.admin).valor, '2,4,6');
  assert.deepEqual(t.ok('sync', {}, t.tk.barra).ajustes.para_llevar.alertas, [2, 4, 6]);
  t.ok('admin.user', { usuario: { usuario_id: 'cajab', nombre: 'Caja Para llevar', rol: 'CAJA', caja_id: 'CAJA_B', activo: true, para_llevar: true } }, t.tk.admin);
  t.ok('admin.user', { usuario: { usuario_id: 'mozo', nombre: 'Mozo Salón', rol: 'MOZO', activo: true, para_llevar: true } }, t.tk.admin);
  const us = t.ok('admin.data', {}, t.tk.admin).usuarios;
  assert.equal(us.find((u) => u.usuario_id === 'cajab').para_llevar, 'NO', 'la marca es solo para mozos');
  assert.equal(us.find((u) => u.usuario_id === 'mozo').para_llevar, 'SI');
});

// ---- WhatsApp del cliente en para llevar (pedido de Andrade, 20/10/2026)
function pedirConWa(t, extra) {
  const tkQR = t.data.active.Puntos.find((p) => p.punto_id === 'B_TAKEAWAY').qr_token;
  return t.call('public.order', Object.assign({ token: tkQR, request_id: 'req-wa-' + Math.random().toString(36).slice(2), alias: 'Ana', items: [{ producto_id: 'ESPRESSO', cantidad: 1, opciones: [] }] }, extra || {}));
}

test('LL06 WhatsApp apagado por defecto: no se pide ni se guarda', () => {
  const t = fresh();
  const tkQR = t.data.active.Puntos.find((p) => p.punto_id === 'B_TAKEAWAY').qr_token;
  assert.equal(t.ok('public.resolve', { token: tkQR }).whatsapp, undefined);
  const r = pedirConWa(t);
  assert.equal(r.ok, true);
});

test('LL07 WhatsApp OBLIGATORIO: se exige, se valida, se guarda normalizado y el equipo lo ve', () => {
  const t = fresh('EQUIPO');
  t.ok('admin.config', { clave: 'para_llevar_whatsapp', valor: 'obligatorio' }, t.tk.admin);
  const tkQR = t.data.active.Puntos.find((p) => p.punto_id === 'B_TAKEAWAY').qr_token;
  assert.equal(t.ok('public.resolve', { token: tkQR }).whatsapp, 'OBLIGATORIO');
  const mesa = t.data.active.Mesas.find((m) => m.numero === 1);
  assert.equal(t.ok('public.resolve', { token: mesa.qr_token }).whatsapp, undefined, 'en la mesa no se pide');
  assert.equal(pedirConWa(t).error.code, 'WHATSAPP_REQUERIDO');
  assert.equal(pedirConWa(t, { whatsapp: '123' }).error.code, 'WHATSAPP_INVALIDO');
  const r = pedirConWa(t, { whatsapp: '0981 123 456', acepta_promos: true });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const p = t.ped(r.data.numero);
  assert.equal(p.whatsapp, '595981123456');
  const c = t.data.active.Cuentas.find((x) => x.cuenta_id === p.cuenta_id);
  assert.equal(c.whatsapp, '595981123456');
  assert.equal(c.acepta_promos, 'SI');
  const vb = t.ok('sync', {}, t.tk.barra).pedidos.find((x) => x.numero === r.data.numero);
  assert.equal(vb.whatsapp, '595981123456', 'el mozo de barra ve el número');
  assert.equal(t.ok('sync', {}, t.tk.cajaa).cuentas.find((x) => x.cuenta_id === p.cuenta_id).acepta_promos, true);
  const st = t.ok('public.status', { status_token: p.status_token });
  assert.equal(st.whatsapp, undefined, 'el estado público del pedido no muestra el número');
  const r2 = pedirConWa(t, { whatsapp: '0971222333' });
  assert.equal(t.data.active.Cuentas.find((x) => x.cuenta_id === t.ped(r2.data.numero).cuenta_id).acepta_promos, 'NO', 'promociones solo con la casilla marcada');
});

test('LL08 WhatsApp OPCIONAL y validación de la configuración', () => {
  const t = fresh();
  t.bad('admin.config', { clave: 'para_llevar_whatsapp', valor: 'SIEMPRE' }, t.tk.admin, 'VALOR_INVALIDO');
  t.ok('admin.config', { clave: 'para_llevar_whatsapp', valor: 'OPCIONAL' }, t.tk.admin);
  assert.equal(pedirConWa(t).ok, true, 'sin número también se puede pedir');
  assert.equal(pedirConWa(t, { whatsapp: '12' }).error.code, 'WHATSAPP_INVALIDO');
  const r = pedirConWa(t, { whatsapp: '+595 991 000 111', acepta_promos: true });
  assert.equal(t.ped(r.data.numero).whatsapp, '595991000111');
});
