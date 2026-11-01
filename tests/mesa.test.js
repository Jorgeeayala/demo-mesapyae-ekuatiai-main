'use strict';
/* Cambiar de mesa: los clientes se mudan a una mesa libre y se llevan la cuenta entera.  node --test tests/mesa.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../server/dev-server.js');

const PIN = { admin: '246810', mozo: '1111', cajaa: '3333', cajab: '4444', cocina: '2222' };
const USUARIOS = [
  { usuario_id: 'mozo', nombre: 'Mozo Salón', rol: 'MOZO', pin: PIN.mozo },
  { usuario_id: 'cajaa', nombre: 'Caja Salón', rol: 'CAJA', caja_id: 'CAJA_A', pin: PIN.cajaa },
  { usuario_id: 'cajab', nombre: 'Caja Para llevar', rol: 'CAJA', caja_id: 'CAJA_B', pin: PIN.cajab },
  { usuario_id: 'cocina', nombre: 'Cocina', rol: 'COCINA', pin: PIN.cocina }
];
function fresh() {
  const b = buildApp(null, { secret: 'test-secret', adminPin: PIN.admin, log: () => {}, usuarios: USUARIOS, plan: '', modulos: '' });
  const call = (action, payload, token) => b.app.handle({ action, payload: payload || {}, token });
  const ok = (a, p, t) => { const r = call(a, p, t); assert.equal(r.ok, true, a + ' falló: ' + JSON.stringify(r.error)); return r.data; };
  const bad = (a, p, t, code) => { const r = call(a, p, t); assert.equal(r.ok, false, a + ' debía fallar'); if (code) assert.equal(r.error.code, code, JSON.stringify(r.error)); return r; };
  const tk = {}; for (const u of Object.keys(PIN)) tk[u] = ok('auth.login', { usuario: u, pin: PIN[u] }).token;
  const data = b.store._data();
  const mesa = (n) => data.active.Mesas.find((m) => m.punto_id === 'A_CAFE' && Number(m.numero) === n);
  const cuenta = (id) => data.active.Cuentas.find((c) => c.cuenta_id === id);
  let seq = 0;
  const pedir = (n) => ok('order.create', { mesa_id: mesa(n).mesa_id, request_id: 'req-mesa-' + (++seq) + '-' + Math.random().toString(36).slice(2), items: [{ producto_id: 'ESPRESSO', cantidad: 1, opciones: [] }] }, tk.mozo);
  return { b, call, ok, bad, tk, data, mesa, cuenta, pedir };
}

test('ME01 el mozo cambia la mesa: se mueven cuenta, pedidos (también en cocina) y personas; la vieja queda libre', () => {
  const t = fresh();
  const m3 = t.mesa(3), m7 = t.mesa(7);
  const p1 = t.pedir(3).pedido;
  t.ok('order.state', { pedido_id: p1.pedido_id, estado: 'EN_PREPARACION' }, t.tk.cocina);
  t.ok('cuenta.personas', { cuenta_id: p1.cuenta_id, agregar: 'Ana' }, t.tk.mozo);
  const r = t.ok('mesa.cambiar', { mesa_id: m3.mesa_id, destino_id: m7.mesa_id }, t.tk.mozo);
  assert.equal(r.de, m3.nombre); assert.equal(r.a, m7.nombre);
  const c = t.cuenta(p1.cuenta_id);
  assert.equal(c.mesa_id, m7.mesa_id);
  assert.equal(c.mesa_antes, m3.nombre);
  assert.equal(c.trasladada_por, 'mozo');
  assert.equal(t.data.active.Pedidos.find((x) => x.pedido_id === p1.pedido_id).mesa_id, m7.mesa_id);
  // Cocina ve el pedido en la mesa nueva, con "antes Mesa 3"
  const vc = t.ok('sync', {}, t.tk.cocina);
  const pc = vc.pedidos.find((x) => x.pedido_id === p1.pedido_id);
  assert.equal(pc.mesa, m7.nombre); assert.equal(pc.mesa_antes, m3.nombre);
  assert.deepEqual(vc.traslados.map((x) => [x.de, x.a]), [[m3.nombre, m7.nombre]], 'todo el personal recibe el aviso');
  // La caja ve la cuenta en la mesa nueva, con sus personas
  const cc = t.ok('sync', {}, t.tk.cajaa).cuentas.find((x) => x.cuenta_id === p1.cuenta_id);
  assert.equal(cc.mesa, m7.nombre);
  assert.equal(cc.personas.personas[0].nombre, 'Ana');
  // Un pedido nuevo en la mesa nueva se suma a la misma cuenta y no lleva "antes"
  const p2 = t.pedir(7).pedido;
  assert.equal(p2.cuenta_id, p1.cuenta_id);
  assert.equal(t.ok('sync', {}, t.tk.cocina).pedidos.find((x) => x.pedido_id === p2.pedido_id).mesa_antes, '');
  // La mesa vieja queda libre: un pedido ahí abre otra cuenta
  const p3 = t.pedir(3).pedido;
  assert.notEqual(p3.cuenta_id, p1.cuenta_id);
  // Queda en la auditoría
  assert.ok(t.data.active.Auditoria.some((a) => a.accion === 'MESA_CAMBIADA'));
});

test('ME02 el QR de la mesa nueva entra a la misma cuenta; el pedido de cuenta viaja con la mesa', () => {
  const t = fresh();
  const p1 = t.pedir(2).pedido;
  t.ok('cuenta.requestClose', { cuenta_id: p1.cuenta_id, comprobante: { tipo: 'TICKET' } }, t.tk.mozo);
  t.ok('mesa.cambiar', { mesa_id: t.mesa(2).mesa_id, destino_id: t.mesa(5).mesa_id }, t.tk.cajaa);
  assert.equal(t.cuenta(p1.cuenta_id).estado, 'CIERRE_SOLICITADO');
  const pub = t.ok('public.cuenta', { token: t.mesa(5).qr_token });
  assert.equal(pub.cuenta.total_gs, p1.total_gs, 'desde el QR de la mesa nueva ven su consumo');
});

test('ME03 solo a una mesa libre del mismo salón, y solo el personal de atención', () => {
  const t = fresh();
  const p1 = t.pedir(1).pedido, m1 = t.mesa(1).mesa_id;
  t.pedir(4);
  t.bad('mesa.cambiar', { mesa_id: m1, destino_id: t.mesa(4).mesa_id }, t.tk.mozo, 'MESA_OCUPADA');
  t.bad('mesa.cambiar', { mesa_id: m1, destino_id: m1 }, t.tk.mozo, 'MESA_INVALIDA');
  t.bad('mesa.cambiar', { mesa_id: m1, destino_id: 'NOEXISTE' }, t.tk.mozo, 'MESA_INVALIDA');
  t.bad('mesa.cambiar', { mesa_id: t.mesa(6).mesa_id, destino_id: t.mesa(8).mesa_id }, t.tk.mozo, 'SIN_CUENTA');
  t.bad('mesa.cambiar', { mesa_id: m1, destino_id: t.mesa(8).mesa_id }, t.tk.cocina, 'SIN_PERMISO');
  t.bad('mesa.cambiar', { mesa_id: m1, destino_id: t.mesa(8).mesa_id }, t.tk.cajab, 'SIN_PERMISO');
  t.bad('mesa.cambiar', { mesa_id: m1, destino_id: t.mesa(8).mesa_id }, undefined);
  // Reservada (dentro del bloqueo) no
  t.ok('mesa.reservar', { mesa_id: t.mesa(8).mesa_id, nombre: 'Familia Gómez', hora: new Date(Date.now() + 30 * 60000).toISOString() }, t.tk.mozo);
  t.bad('mesa.cambiar', { mesa_id: m1, destino_id: t.mesa(8).mesa_id }, t.tk.mozo, 'MESA_RESERVADA');
  // Pagada pero aún ocupada no
  t.data.active.Mesas.find((m) => m.mesa_id === t.mesa(9).mesa_id).pagada_en = new Date().toISOString();
  t.bad('mesa.cambiar', { mesa_id: m1, destino_id: t.mesa(9).mesa_id }, t.tk.mozo, 'MESA_OCUPADA');
  assert.equal(t.cuenta(p1.cuenta_id).mesa_id, m1, 'nada se movió');
});
