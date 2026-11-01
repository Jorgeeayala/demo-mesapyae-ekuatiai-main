'use strict';
/* Estaciones de preparación (cocina, barra 1, barra 2…): cada estación ve y marca su parte del pedido.  node --test tests/estaciones.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../server/dev-server.js');

const PIN = { admin: '246810', mozo: '1111', cocina: '2222', cajaa: '3333' };
const USUARIOS = [
  { usuario_id: 'mozo', nombre: 'Mozo Uno', rol: 'MOZO', pin: PIN.mozo },
  { usuario_id: 'cocina', nombre: 'Cocina', rol: 'COCINA', pin: PIN.cocina },
  { usuario_id: 'cajaa', nombre: 'Cajera A', rol: 'CAJA', caja_id: 'CAJA_A', pin: PIN.cajaa }
];
function fresh(plan) {
  const b = buildApp(null, { secret: 'test-secret', adminPin: PIN.admin, mesas: 20, log: () => {}, usuarios: USUARIOS, plan: plan || '', modulos: '' });
  const call = (action, payload, token) => b.app.handle({ action, payload: payload || {}, token });
  const ok = (a, p, t) => { const r = call(a, p, t); assert.equal(r.ok, true, a + ' falló: ' + JSON.stringify(r.error)); return r.data; };
  const bad = (a, p, t, code) => { const r = call(a, p, t); assert.equal(r.ok, false, a + ' debía fallar'); if (code) assert.equal(r.error.code, code, JSON.stringify(r.error)); return r; };
  const tk = {}; for (const u of Object.keys(PIN)) tk[u] = ok('auth.login', { usuario: u, pin: PIN[u] }).token;
  const data = b.store._data();
  let seq = 0; const rid = () => 'req-es-' + (++seq) + '-' + Math.random().toString(36).slice(2);
  const pedir = (mesa, items) => ok('order.create', { request_id: rid(), mesa_id: 'M' + String(mesa).padStart(2, '0'), items }, tk.mozo).pedido;
  const catAdmin = (id) => ok('admin.data', {}, tk.admin).menu.categorias.find((c) => c.id === id);
  const setCat = (id, estacion) => { const c = catAdmin(id); return ok('admin.category', { categoria: { categoria_id: id, nombre: c.nombre, orden: c.orden, activa: c.activa, nota: c.nota, estacion } }, tk.admin); };
  return { b, call, ok, bad, tk, data, rid, pedir, setCat };
}
const item = (producto_id, cantidad, opciones) => ({ producto_id, cantidad: cantidad || 1, opciones: opciones || [] });
const est = (p, id) => p.estaciones.find((e) => e.id === id);

test('E01 un local con una sola estación funciona como siempre', () => {
  const t = fresh();
  assert.deepEqual(t.ok('sync', {}, t.tk.cocina).ajustes.estaciones, [{ id: 'COCINA', nombre: 'Cocina' }]);
  const p = t.pedir(1, [item('ESPRESSO'), item('MIXTO')]);
  assert.deepEqual(p.estaciones.map((e) => [e.id, e.estado]), [['COCINA', 'NUEVO']]);
  assert.ok(p.items.every((i) => i.estacion === 'COCINA'));
  // La pantalla de siempre (pedido entero) mueve también la estación
  let r = t.ok('order.state', { pedido_id: p.pedido_id, estado: 'EN_PREPARACION' }, t.tk.cocina).pedido;
  assert.equal(est(r, 'COCINA').estado, 'EN_PREPARACION');
  r = t.ok('order.station', { pedido_id: p.pedido_id, estacion: 'COCINA', estado: 'LISTO' }, t.tk.cocina).pedido;
  assert.equal(r.estado, 'LISTO'); assert.ok(r.listo_en);
});

test('E02 pedido partido: la barra hace el café, la cocina el mixto, y el pedido queda listo cuando terminan las dos', () => {
  const t = fresh();
  t.ok('admin.config', { clave: 'estaciones', valor: 'Cocina, Barra 1 ,Barra 2' }, t.tk.admin);
  assert.deepEqual(t.ok('sync', {}, t.tk.cocina).ajustes.estaciones.map((e) => e.id), ['COCINA', 'BARRA_1', 'BARRA_2']);
  t.setCat('CAF_CAL', 'BARRA_1');
  const p = t.pedir(2, [item('ESPRESSO', 2), item('MIXTO')]);
  assert.equal(p.items.find((i) => i.producto_id === 'ESPRESSO').estacion, 'BARRA_1');
  assert.equal(p.items.find((i) => i.producto_id === 'MIXTO').estacion, 'COCINA');
  assert.deepEqual(p.estaciones.map((e) => e.id), ['COCINA', 'BARRA_1'], 'en el orden de la configuración');
  // La barra termina primero: el pedido pasa a "en preparación", no a listo
  let r = t.ok('order.station', { pedido_id: p.pedido_id, estacion: 'BARRA_1', estado: 'LISTO', desde: 'NUEVO' }, t.tk.cocina).pedido;
  assert.equal(r.estado, 'EN_PREPARACION'); assert.equal(est(r, 'BARRA_1').estado, 'LISTO'); assert.equal(est(r, 'COCINA').estado, 'NUEVO');
  // Doble toque desde otra pantalla: conflicto claro, no se pisa
  t.bad('order.station', { pedido_id: p.pedido_id, estacion: 'BARRA_1', estado: 'LISTO', desde: 'NUEVO' }, t.tk.cocina, 'CONFLICTO');
  r = t.ok('order.station', { pedido_id: p.pedido_id, estacion: 'COCINA', estado: 'EN_PREPARACION' }, t.tk.cocina).pedido;
  assert.equal(r.estado, 'EN_PREPARACION'); assert.ok(est(r, 'COCINA').preparacion_en);
  r = t.ok('order.station', { pedido_id: p.pedido_id, estacion: 'COCINA', estado: 'LISTO' }, t.tk.cocina).pedido;
  assert.equal(r.estado, 'LISTO');
  // El mozo lo entrega como siempre
  r = t.ok('order.state', { pedido_id: p.pedido_id, estado: 'ENTREGADO' }, t.tk.mozo).pedido;
  assert.equal(r.estado, 'ENTREGADO');
  t.bad('order.station', { pedido_id: p.pedido_id, estacion: 'COCINA', estado: 'NUEVO' }, t.tk.cocina, 'ESTADO_INVALIDO');
  // Cambiar la categoría después no mueve los pedidos ya hechos
  t.setCat('CAF_CAL', 'BARRA_2');
  const hist = t.ok('sync', {}, t.tk.cocina).pedidos.find((x) => x.pedido_id === p.pedido_id);
  assert.equal(hist.items.find((i) => i.producto_id === 'ESPRESSO').estacion, 'BARRA_1');
  assert.equal(t.pedir(3, [item('ESPRESSO')]).items[0].estacion, 'BARRA_2');
});

test('E03 permisos y validaciones', () => {
  const t = fresh();
  t.bad('admin.config', { clave: 'estaciones', valor: '' }, t.tk.admin, 'VALOR_INVALIDO');
  t.bad('admin.config', { clave: 'estaciones', valor: 'Barra, barra' }, t.tk.admin, 'VALOR_INVALIDO');
  t.bad('admin.config', { clave: 'estaciones', valor: 'A1,B1,C1,D1,E1,F1,G1' }, t.tk.admin, 'VALOR_INVALIDO');
  t.bad('admin.config', { clave: 'estaciones', valor: 'Cocina,Barra' }, t.tk.mozo, 'SIN_PERMISO');
  t.ok('admin.config', { clave: 'estaciones', valor: 'Cocina,Barra' }, t.tk.admin);
  t.bad('admin.category', { categoria: { categoria_id: 'CAF_CAL', nombre: 'Cafés', orden: 1, activa: true, estacion: 'PARRILLA' } }, t.tk.admin, 'ESTACION_INVALIDA');
  // Un producto puede ir a otra estación que su categoría
  const adm = t.ok('admin.data', {}, t.tk.admin).menu.productos.find((p) => p.id === 'CHOCOLATE');
  t.ok('admin.product', { producto: { producto_id: 'CHOCOLATE', categoria_id: adm.categoria, nombre: adm.nombre, precio_gs: adm.precio, activo: true, disponible: true, puntos: adm.puntos, grupos: adm.grupos.join(','), orden: adm.orden, estacion: 'BARRA' } }, t.tk.admin);
  t.bad('admin.product', { producto: { producto_id: 'CHOCOLATE', categoria_id: adm.categoria, nombre: adm.nombre, precio_gs: adm.precio, activo: true, disponible: true, puntos: adm.puntos, grupos: adm.grupos.join(','), orden: adm.orden, estacion: 'X' } }, t.tk.admin, 'ESTACION_INVALIDA');
  const prodAdm = t.ok('admin.data', {}, t.tk.admin).menu.productos.find((p) => p.id === 'CHOCOLATE');
  assert.equal(prodAdm.estacion, 'BARRA'); assert.equal(prodAdm.estacion_efectiva, 'BARRA');
  const p = t.pedir(4, [item('CHOCOLATE'), item('MIXTO')]);
  assert.deepEqual(p.estaciones.map((e) => e.id), ['COCINA', 'BARRA']);
  t.bad('order.station', { pedido_id: p.pedido_id, estacion: 'BARRA', estado: 'LISTO' }, t.tk.mozo, 'SIN_PERMISO');
  t.bad('order.station', { pedido_id: p.pedido_id, estacion: 'PARRILLA', estado: 'LISTO' }, t.tk.cocina, 'ESTACION_INVALIDA');
  t.bad('order.station', { pedido_id: p.pedido_id, estacion: 'BARRA', estado: 'ENTREGADO' }, t.tk.cocina, 'ESTADO_INVALIDO');
  // Un pedido del QR que todavía no aceptó nadie no se puede marcar
  const mesa = t.data.active.Mesas.find((m) => m.numero === 9);
  const q = t.ok('public.order', { request_id: t.rid(), token: mesa.qr_token, items: [item('CHOCOLATE')] });
  assert.equal(q.estado, 'PENDIENTE');
  const qp = t.data.active.Pedidos.find((x) => x.numero === q.numero);
  t.bad('order.station', { pedido_id: qp.pedido_id, estacion: 'BARRA', estado: 'LISTO' }, t.tk.cocina, 'ESTADO_INVALIDO');
});

test('E04 anular lo único que faltaba en una estación deja el pedido listo', () => {
  const t = fresh();
  t.ok('admin.config', { clave: 'estaciones', valor: 'Cocina,Barra' }, t.tk.admin);
  t.setCat('CAF_CAL', 'BARRA');
  const p = t.pedir(5, [item('ESPRESSO'), item('MIXTO')]);
  t.ok('order.station', { pedido_id: p.pedido_id, estacion: 'COCINA', estado: 'LISTO' }, t.tk.cocina);
  const esp = p.items.find((i) => i.producto_id === 'ESPRESSO');
  const r = t.ok('order.voidItem', { item_id: esp.item_id, motivo: 'Se arrepintió' }, t.tk.admin).pedido;
  assert.equal(r.estado, 'LISTO');
  assert.deepEqual(r.estaciones.map((e) => e.id), ['COCINA']);
});

test('E05 "Listo" del pedido entero marca todas las estaciones; deshacer vuelve todo atrás', () => {
  const t = fresh();
  t.ok('admin.config', { clave: 'estaciones', valor: 'Cocina,Barra' }, t.tk.admin);
  t.setCat('CAF_CAL', 'BARRA');
  const p = t.pedir(6, [item('ESPRESSO'), item('MIXTO')]);
  let r = t.ok('order.state', { pedido_id: p.pedido_id, estado: 'LISTO' }, t.tk.cocina).pedido;
  assert.ok(r.estaciones.every((e) => e.estado === 'LISTO' && e.listo_en));
  r = t.ok('order.state', { pedido_id: p.pedido_id, estado: 'EN_PREPARACION' }, t.tk.cocina).pedido;
  assert.ok(r.estaciones.every((e) => e.estado === 'EN_PREPARACION'));
  r = t.ok('order.state', { pedido_id: p.pedido_id, estado: 'ACEPTADO' }, t.tk.cocina).pedido;
  assert.ok(r.estaciones.every((e) => e.estado === 'NUEVO'));
  // Tiempos por estación en el reporte
  t.ok('order.station', { pedido_id: p.pedido_id, estacion: 'BARRA', estado: 'LISTO' }, t.tk.cocina);
  t.ok('order.station', { pedido_id: p.pedido_id, estacion: 'COCINA', estado: 'LISTO' }, t.tk.cocina);
  const rep = t.ok('admin.report', {}, t.tk.admin);
  assert.deepEqual(rep.tiempos_por_estacion.map((x) => x.estacion).sort(), ['BARRA', 'COCINA']);
  assert.ok(rep.tiempos_por_estacion.every((x) => x.muestras === 1 && x.promedio >= 0));
});

test('E06 si se borra una estación de la configuración, sus comandas pasan a la primera (nunca se pierden)', () => {
  const t = fresh();
  t.ok('admin.config', { clave: 'estaciones', valor: 'Cocina,Barra' }, t.tk.admin);
  t.setCat('CAF_CAL', 'BARRA');
  const p = t.pedir(7, [item('ESPRESSO')]);
  assert.equal(p.estaciones[0].id, 'BARRA');
  t.ok('admin.config', { clave: 'estaciones', valor: 'Cocina' }, t.tk.admin);
  const v = t.ok('sync', {}, t.tk.cocina).pedidos.find((x) => x.pedido_id === p.pedido_id);
  assert.deepEqual(v.estaciones.map((e) => e.id), ['COCINA']);
  assert.equal(v.items[0].estacion, 'COCINA');
  const r = t.ok('order.station', { pedido_id: p.pedido_id, estacion: 'COCINA', estado: 'LISTO' }, t.tk.cocina).pedido;
  assert.equal(r.estado, 'LISTO');
});
