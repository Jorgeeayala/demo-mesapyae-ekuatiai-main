'use strict';
/* Pruebas de aceptación a nivel API (núcleo + servidor HTTP).  node --test tests/ */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { buildApp, serve } = require('../server/dev-server.js');

const PIN = { admin: '246810', mozo: '1111', cocina: '2222', cajaa: '3333', cajab: '4444', mozo2: '5555' };
function fresh() {
  const b = buildApp(null, {
    secret: 'test-secret', adminPin: PIN.admin, mesas: 20, log: () => {},
    usuarios: [
      { usuario_id: 'mozo', nombre: 'Mozo Uno', rol: 'MOZO', pin: PIN.mozo },
      { usuario_id: 'mozo2', nombre: 'Mozo Dos', rol: 'MOZO', pin: PIN.mozo2 },
      { usuario_id: 'cocina', nombre: 'Cocina', rol: 'COCINA', pin: PIN.cocina },
      { usuario_id: 'cajaa', nombre: 'Cajera A', rol: 'CAJA', caja_id: 'CAJA_A', pin: PIN.cajaa },
      { usuario_id: 'cajab', nombre: 'Cajero B', rol: 'CAJA', caja_id: 'CAJA_B', pin: PIN.cajab }
    ]
  });
  const A = b.app;
  const call = (action, payload, token) => A.handle({ action, payload: payload || {}, token });
  const ok = (action, payload, token) => { const r = call(action, payload, token); assert.equal(r.ok, true, action + ' falló: ' + JSON.stringify(r.error)); return r.data; };
  const bad = (action, payload, token, code) => { const r = call(action, payload, token); assert.equal(r.ok, false, action + ' debía fallar'); if (code) assert.equal(r.error.code, code, JSON.stringify(r.error)); return r; };
  const tk = {};
  for (const u of Object.keys(PIN)) tk[u] = ok('auth.login', { usuario: u, pin: PIN[u] }).token;
  const data = b.store._data();
  const mesaTok = (n) => data.active.Mesas.find((m) => m.numero === n).qr_token;
  const tkTok = () => data.active.Puntos.find((p) => p.punto_id === 'B_TAKEAWAY').qr_token;
  let seq = 0;
  const rid = () => 'req-test-' + (++seq) + '-' + Math.random().toString(36).slice(2);
  return { b, A, call, ok, bad, tk, data, mesaTok, tkTok, rid };
}
const item = (producto_id, cantidad, opciones, observacion) => ({ producto_id, cantidad, opciones: opciones || [], observacion });

test('T01/T02 QR: mesa y takeaway se resuelven por token, no por número', () => {
  const t = fresh();
  const r1 = t.ok('public.resolve', { token: t.mesaTok(1) });
  assert.equal(r1.tipo, 'MESA'); assert.equal(r1.mesa, 'Mesa 1'); assert.equal(r1.punto_id, 'A_CAFE');
  const r2 = t.ok('public.resolve', { token: t.tkTok() });
  assert.equal(r2.tipo, 'PUNTO'); assert.equal(r2.punto_id, 'B_TAKEAWAY'); assert.equal(r2.mesa, undefined);
  t.bad('public.resolve', { token: 'M01' }, null, 'QR_INVALIDO');
  t.bad('public.resolve', { token: 'aaaaaaaaaaaa' }, null, 'QR_INVALIDO');
  assert.ok(r1.menu.productos.length > 60);
  assert.ok(!JSON.stringify(r1).includes('qr_token'), 'no expone tokens');
});

test('T03–T08 precios y opciones calculados en servidor', () => {
  const t = fresh();
  const p = (items) => t.ok('order.create', { request_id: t.rid(), mesa_id: 'M02', items }, t.tk.mozo).pedido;
  assert.equal(p([item('ESPRESSO', 1)]).total_gs, 12000);                                        // T03
  assert.equal(p([item('PANINI_CESAR', 1, ['PAN_LAC'])]).total_gs, 35000);                         // T04
  assert.equal(p([item('PANINI_CESAR', 1, ['PAN_CIA'])]).total_gs, 40000);
  const u = p([item('PANINI_URUGUAYO', 1, ['PAN_CIA', 'PU_POL'])]);                                // T05
  assert.equal(u.total_gs, 45000); assert.match(u.items[0].opciones, /Pan ciabatta.*Pollo/);
  t.bad('order.create', { request_id: t.rid(), mesa_id: 'M02', items: [item('PANINI_URUGUAYO', 1, ['PAN_CIA'])] }, t.tk.mozo, 'OPCION_REQUERIDA');
  assert.equal(p([item('JUGO_NATURAL', 2, ['JS_LIM', 'JT_500'])]).total_gs, 40000);                // T06
  assert.equal(p([item('JUGO_NATURAL', 1, ['JS_LIM', 'JT_250'])]).total_gs, 10000);
  t.bad('order.create', { request_id: t.rid(), mesa_id: 'M02', items: [item('JUGO_NATURAL', 1, ['JS_LIM', 'JT_250', 'JT_500'])] }, t.tk.mozo, 'OPCION_INVALIDA');
  assert.equal(p([item('PIZZA_PERSONAL', 1, ['PP_QUA'])]).total_gs, 30000);                        // T07
  t.bad('order.create', { request_id: t.rid(), mesa_id: 'M02', items: [item('PIZZA_PERSONAL', 1, [])] }, t.tk.mozo, 'OPCION_REQUERIDA');
  t.bad('order.create', { request_id: t.rid(), mesa_id: 'M02', items: [item('COMBO_ANDRADE', 1, ['CA1_0', 'CA2_0'])] }, t.tk.mozo, 'OPCION_REQUERIDA'); // T08
  assert.equal(p([item('COMBO_ANDRADE', 1, ['CA1_0', 'CA2_0', 'CAR_NUT'])]).total_gs, 80000);
  assert.equal(p([item('CAPUCHINO', 1, ['SY_CAR'])]).total_gs, 30000);                             // syrup +5000
  t.bad('order.create', { request_id: t.rid(), mesa_id: 'M02', items: [item('TE', 1, ['SY_CAR'])] }, t.tk.mozo, 'OPCION_INVALIDA'); // syrup no elegible
  t.bad('order.create', { request_id: t.rid(), mesa_id: 'M02', items: [item('ESPRESSO', 0)] }, t.tk.mozo, 'CANTIDAD_INVALIDA');
  t.bad('order.create', { request_id: t.rid(), mesa_id: 'M02', items: [item('ESPRESSO', 1.5)] }, t.tk.mozo, 'CANTIDAD_INVALIDA');
});

test('T19 el servidor ignora precios manipulados desde el navegador', () => {
  const t = fresh();
  const r = t.ok('public.order', { token: t.mesaTok(3), request_id: t.rid(), total_gs: 1, items: [{ producto_id: 'APEROL', cantidad: 1, precio: 1, precio_unit_gs: 1, total_gs: 1 }] });
  assert.equal(r.total_gs, 55000);
});

test('T09/T12 disponibilidad: producto agotado o inactivo se rechaza aunque la página siga abierta', () => {
  const t = fresh();
  t.ok('product.availability', { producto_id: 'BROWNIE', disponible: false }, t.tk.cocina);
  t.bad('public.order', { token: t.mesaTok(4), request_id: t.rid(), items: [item('BROWNIE', 1)] }, null, 'PRODUCTO_AGOTADO');
  t.bad('order.create', { request_id: t.rid(), mesa_id: 'M04', items: [item('BROWNIE', 1)] }, t.tk.mozo, 'PRODUCTO_AGOTADO');
  t.bad('product.availability', { producto_id: 'BROWNIE', disponible: true }, t.tk.mozo, 'SIN_PERMISO');
  t.ok('product.availability', { producto_id: 'BROWNIE', disponible: true }, t.tk.admin);
  assert.equal(t.ok('order.create', { request_id: t.rid(), mesa_id: 'M04', items: [item('BROWNIE', 1)] }, t.tk.mozo).pedido.total_gs, 15000);
  const prod = t.ok('admin.data', {}, t.tk.admin).menu.productos.find((p) => p.id === 'APEROL');
  t.ok('admin.product', { producto: { producto_id: 'APEROL', categoria_id: prod.categoria, nombre: prod.nombre, descripcion: '', precio_gs: prod.precio, activo: false, disponible: true, puntos: prod.puntos, grupos: '', orden: prod.orden } }, t.tk.admin);
  t.bad('order.create', { request_id: t.rid(), mesa_id: 'M04', items: [item('APEROL', 1)] }, t.tk.mozo, 'PRODUCTO_INEXISTENTE');
});

test('T10/14 doble envío con el mismo request_id crea un único pedido', () => {
  const t = fresh();
  const req = t.rid();
  const pl = { token: t.mesaTok(5), request_id: req, items: [item('LATTE', 2)] };
  const a = t.ok('public.order', pl), b2 = t.ok('public.order', pl), c = t.ok('public.order', pl);
  assert.equal(a.numero, b2.numero); assert.equal(c.duplicado, true);
  assert.equal(t.data.active.Pedidos.filter((p) => p.request_id === req).length, 1);
  const m = { request_id: t.rid(), mesa_id: 'M06', items: [item('LATTE', 1)] };
  const x = t.ok('order.create', m, t.tk.mozo), y = t.ok('order.create', m, t.tk.mozo);
  assert.equal(x.pedido.pedido_id, y.pedido.pedido_id); assert.equal(y.duplicado, true);
});

test('Cuenta de mesa: varias comandas se suman a la cuenta abierta', () => {
  const t = fresh();
  const p1 = t.ok('order.create', { request_id: t.rid(), mesa_id: 'M07', items: [item('AMERICANO', 1)] }, t.tk.mozo).pedido;
  const p2 = t.ok('order.create', { request_id: t.rid(), mesa_id: 'M07', items: [item('CHIPA', 2)] }, t.tk.mozo2).pedido;
  assert.equal(p1.cuenta_id, p2.cuenta_id);
  const s = t.ok('sync', {}, t.tk.cajaa);
  assert.equal(s.cuentas.find((c) => c.cuenta_id === p1.cuenta_id).total_gs, 20000 + 16000);
  t.ok('cuenta.requestClose', { cuenta_id: p1.cuenta_id }, t.tk.mozo);
  assert.equal(t.ok('sync', {}, t.tk.cajaa).cuentas.find((c) => c.cuenta_id === p1.cuenta_id).estado, 'CIERRE_SOLICITADO');
  // Agregar otra comanda reabre la cuenta
  const p3 = t.ok('order.create', { request_id: t.rid(), mesa_id: 'M07', items: [item('COOKIES', 1)] }, t.tk.mozo).pedido;
  assert.equal(p3.cuenta_id, p1.cuenta_id);
  assert.equal(t.ok('sync', {}, t.tk.cajaa).cuentas.find((c) => c.cuenta_id === p1.cuenta_id).estado, 'ABIERTA');
  assert.equal(p1.numero, 'A-001'); assert.equal(p3.numero, 'A-003');
});

test('T13 estados del pedido: transiciones válidas por rol y auditadas', () => {
  const t = fresh();
  const q = t.ok('public.order', { token: t.mesaTok(8), request_id: t.rid(), items: [item('FRAPPE', 1)] });
  assert.equal(q.estado, 'PENDIENTE');
  const ped = t.data.active.Pedidos.find((p) => p.numero === q.numero);
  // Cocina no ve/acepta pendientes; no se puede saltar a LISTO
  t.bad('order.state', { pedido_id: ped.pedido_id, estado: 'ACEPTADO' }, t.tk.cocina, 'SIN_PERMISO');
  t.bad('order.state', { pedido_id: ped.pedido_id, estado: 'LISTO' }, t.tk.admin, 'TRANSICION_INVALIDA');
  t.ok('order.state', { pedido_id: ped.pedido_id, estado: 'ACEPTADO', desde: 'PENDIENTE' }, t.tk.mozo);
  t.bad('order.state', { pedido_id: ped.pedido_id, estado: 'EN_PREPARACION' }, t.tk.mozo, 'SIN_PERMISO');
  t.ok('order.state', { pedido_id: ped.pedido_id, estado: 'EN_PREPARACION' }, t.tk.cocina);
  t.bad('order.state', { pedido_id: ped.pedido_id, estado: 'LISTO', desde: 'ACEPTADO' }, t.tk.cocina, 'CONFLICTO'); // otro dispositivo ya lo movió
  t.ok('order.state', { pedido_id: ped.pedido_id, estado: 'LISTO' }, t.tk.cocina);
  t.bad('order.state', { pedido_id: ped.pedido_id, estado: 'ENTREGADO' }, t.tk.cocina, 'SIN_PERMISO');
  t.bad('order.state', { pedido_id: ped.pedido_id, estado: 'ENTREGADO' }, t.tk.cajab, 'SIN_PERMISO'); // caja de otro punto
  const r = t.ok('order.state', { pedido_id: ped.pedido_id, estado: 'ENTREGADO' }, t.tk.mozo).pedido;
  assert.ok(r.aceptado_en && r.preparacion_en && r.listo_en && r.entregado_en);
  const hist = t.data.active.Historial.filter((h) => h.pedido_id === ped.pedido_id).map((h) => h.a);
  assert.deepEqual(hist, ['PENDIENTE', 'ACEPTADO', 'EN_PREPARACION', 'LISTO', 'ENTREGADO']);
  // Entregado NO implica cobrado (estado y pago independientes)
  const c = t.ok('sync', {}, t.tk.cajaa).cuentas.find((x) => x.cuenta_id === r.cuenta_id);
  assert.equal(c.pago_estado, 'NO_COBRADO');
});

test('Cancelaciones: mozo puede rechazar PENDIENTE; luego requiere encargado; cuenta vacía se anula', () => {
  const t = fresh();
  const q = t.ok('public.order', { token: t.mesaTok(9), request_id: t.rid(), items: [item('TE', 1)] });
  const ped = t.data.active.Pedidos.find((p) => p.numero === q.numero);
  t.bad('order.cancel', { pedido_id: ped.pedido_id, motivo: '' }, t.tk.mozo, 'MOTIVO_REQUERIDO');
  t.ok('order.cancel', { pedido_id: ped.pedido_id, motivo: 'Cliente se retiró' }, t.tk.mozo);
  assert.equal(t.data.active.Cuentas.find((c) => c.cuenta_id === ped.cuenta_id).estado, 'ANULADA');
  const p2 = t.ok('order.create', { request_id: t.rid(), mesa_id: 'M09', items: [item('TE', 1), item('COCIDO', 1)] }, t.tk.mozo).pedido;
  t.bad('order.cancel', { pedido_id: p2.pedido_id, motivo: 'error de carga' }, t.tk.mozo, 'REQUIERE_AUTORIZACION');
  t.bad('order.cancel', { pedido_id: p2.pedido_id, motivo: 'error de carga', autorizacion: { usuario: 'admin', pin: '000000' } }, t.tk.mozo, 'AUTORIZACION_INVALIDA');
  t.bad('order.cancel', { pedido_id: p2.pedido_id, motivo: 'error de carga', autorizacion: { usuario: 'mozo2', pin: PIN.mozo2 } }, t.tk.mozo, 'AUTORIZACION_INVALIDA');
  // Anular un ítem con autorización recalcula el total
  const it = p2.items.find((i) => i.producto_id === 'COCIDO');
  const r = t.ok('order.voidItem', { item_id: it.item_id, motivo: 'no lo pidió', autorizacion: { usuario: 'admin', pin: PIN.admin } }, t.tk.mozo).pedido;
  assert.equal(r.total_gs, 7000);
  t.ok('order.cancel', { pedido_id: p2.pedido_id, motivo: 'error de carga', autorizacion: { usuario: 'admin', pin: PIN.admin } }, t.tk.mozo);
  const aud = t.data.active.Auditoria.filter((a) => a.accion === 'PEDIDO_CANCELADO');
  assert.equal(aud.length, 2); assert.match(aud[1].detalle, /"autorizo":"admin"/);
});

test('T14/T15 cobros en Caja 01 y Caja 02 sin mezclar; cierres independientes; reporte consolidado', () => {
  const t = fresh();
  // Caja cerrada: no se puede cobrar
  const pa = t.ok('order.create', { request_id: t.rid(), mesa_id: 'M10', items: [item('PANINI_CESAR', 1, ['PAN_LAC']), item('JUGO_NATURAL', 1, ['JS_NAR', 'JT_250'])] }, t.tk.mozo).pedido;
  t.bad('caja.cobrar', { request_id: t.rid(), cuenta_id: pa.cuenta_id, pagos: [{ medio: 'EFECTIVO', monto_gs: 45000 }] }, t.tk.cajaa, 'CAJA_CERRADA');
  t.ok('caja.abrir', { caja_id: 'CAJA_A', monto_inicial_gs: 100000 }, t.tk.cajaa);
  t.bad('caja.abrir', { caja_id: 'CAJA_B', monto_inicial_gs: 0 }, t.tk.cajaa, 'SIN_PERMISO');
  t.ok('caja.abrir', { caja_id: 'CAJA_B', monto_inicial_gs: 50000 }, t.tk.cajab);
  // Takeaway en caja B (venta creada por el cajero B)
  const pb = t.ok('order.create', { request_id: t.rid(), punto_id: 'B_TAKEAWAY', alias: 'Lucía', items: [item('ICED_LATTE', 2)] }, t.tk.cajab).pedido;
  assert.equal(pb.numero, 'T-001'); assert.equal(pb.modo, 'TAKEAWAY'); assert.equal(pb.caja_id, 'CAJA_B');
  t.bad('order.create', { request_id: t.rid(), punto_id: 'A_CAFE', items: [item('TE', 1)] }, t.tk.cajab, 'SIN_PERMISO');
  // No mezclar: cajero A no cobra cuenta de B y viceversa
  t.bad('caja.cobrar', { request_id: t.rid(), cuenta_id: pb.cuenta_id, pagos: [{ medio: 'EFECTIVO', monto_gs: 60000 }] }, t.tk.cajaa, 'SIN_PERMISO');
  t.bad('caja.cobrar', { request_id: t.rid(), cuenta_id: pa.cuenta_id, pagos: [{ medio: 'EFECTIVO', monto_gs: 45000 }] }, t.tk.cajab, 'SIN_PERMISO');
  // Montos deben coincidir
  t.bad('caja.cobrar', { request_id: t.rid(), cuenta_id: pa.cuenta_id, pagos: [{ medio: 'EFECTIVO', monto_gs: 40000 }] }, t.tk.cajaa, 'MONTO_NO_COINCIDE');
  t.bad('caja.cobrar', { request_id: t.rid(), cuenta_id: pa.cuenta_id, pagos: [{ medio: 'BITCOIN', monto_gs: 45000 }] }, t.tk.cajaa, 'MEDIO_INVALIDO');
  t.bad('caja.cobrar', { request_id: t.rid(), cuenta_id: pa.cuenta_id, pagos: [{ medio: 'TARJETA', monto_gs: 45000 }] }, t.tk.cajaa, 'MEDIO_INVALIDO'); // reemplazado por TC/TD
  t.bad('caja.cobrar', { request_id: t.rid(), cuenta_id: pa.cuenta_id, total_esperado_gs: 44000, pagos: [{ medio: 'EFECTIVO', monto_gs: 45000 }] }, t.tk.cajaa, 'TOTAL_CAMBIO');
  // Cobro A: pago dividido efectivo + tarjeta
  const rq = t.rid();
  const ca = t.ok('caja.cobrar', { request_id: rq, cuenta_id: pa.cuenta_id, total_esperado_gs: 45000, pagos: [{ medio: 'EFECTIVO', monto_gs: 25000 }, { medio: 'TC', monto_gs: 20000 }] }, t.tk.cajaa);
  // Reintento idempotente y doble cobro
  assert.equal(t.ok('caja.cobrar', { request_id: rq, cuenta_id: pa.cuenta_id, pagos: [{ medio: 'EFECTIVO', monto_gs: 45000 }] }, t.tk.cajaa).duplicado, true);
  t.bad('caja.cobrar', { request_id: t.rid(), cuenta_id: pa.cuenta_id, pagos: [{ medio: 'EFECTIVO', monto_gs: 45000 }] }, t.tk.cajaa, 'YA_COBRADA');
  // Pagar NO cambia el estado de cocina
  assert.equal(t.data.active.Pedidos.find((p) => p.pedido_id === pa.pedido_id).estado, 'ACEPTADO');
  // Descuento requiere encargado
  t.bad('caja.cobrar', { request_id: t.rid(), cuenta_id: pb.cuenta_id, descuento_gs: 10000, motivo_descuento: 'cliente frecuente', pagos: [{ medio: 'EFECTIVO', monto_gs: 50000 }] }, t.tk.cajab, 'REQUIERE_AUTORIZACION');
  const cb = t.ok('caja.cobrar', { request_id: t.rid(), cuenta_id: pb.cuenta_id, descuento_gs: 10000, motivo_descuento: 'cliente frecuente', autorizacion: { usuario: 'admin', pin: PIN.admin }, pagos: [{ medio: 'EFECTIVO', monto_gs: 50000 }] }, t.tk.cajab);
  assert.equal(cb.cobro.autorizado_por, 'admin'); assert.equal(cb.cobro.total_gs, 50000);
  // Movimientos manuales
  t.ok('caja.movimiento', { request_id: t.rid(), caja_id: 'CAJA_A', tipo: 'INGRESO', monto_gs: 20000, motivo: 'cambio' }, t.tk.cajaa);
  t.bad('caja.movimiento', { request_id: t.rid(), caja_id: 'CAJA_A', tipo: 'EGRESO', monto_gs: 5000, motivo: 'hielo' }, t.tk.cajaa, 'REQUIERE_AUTORIZACION');
  t.ok('caja.movimiento', { request_id: t.rid(), caja_id: 'CAJA_A', tipo: 'EGRESO', monto_gs: 5000, motivo: 'hielo', autorizacion: { usuario: 'admin', pin: PIN.admin } }, t.tk.cajaa);
  // Estado de cada caja: totales separados
  const ea = t.ok('caja.estado', { caja_id: 'CAJA_A' }, t.tk.cajaa), eb = t.ok('caja.estado', { caja_id: 'CAJA_B' }, t.tk.cajab);
  assert.equal(ea.turno.totales.ventas_netas_gs, 45000); assert.equal(eb.turno.totales.ventas_netas_gs, 50000);
  assert.equal(ea.turno.totales.efectivo_esperado_gs, 100000 + 25000 + 20000 - 5000);
  assert.equal(eb.turno.totales.efectivo_esperado_gs, 50000 + 50000);
  t.bad('caja.estado', { caja_id: 'CAJA_A' }, t.tk.cajab, 'SIN_PERMISO');
  // Reverso: solo con encargado, en el turno abierto
  t.bad('caja.revertir', { cobro_id: ca.cobro.cobro_id, motivo: 'error' }, t.tk.cajaa, 'REQUIERE_AUTORIZACION');
  t.ok('caja.revertir', { cobro_id: ca.cobro.cobro_id, motivo: 'cobrado a mesa equivocada', autorizacion: { usuario: 'admin', pin: PIN.admin } }, t.tk.cajaa);
  const ea2 = t.ok('caja.estado', { caja_id: 'CAJA_A' }, t.tk.cajaa);
  assert.equal(ea2.turno.totales.ventas_netas_gs, 0);
  assert.equal(t.data.active.Cuentas.find((c) => c.cuenta_id === pa.cuenta_id).pago_estado, 'REVERTIDO');
  t.ok('caja.cobrar', { request_id: t.rid(), cuenta_id: pa.cuenta_id, pagos: [{ medio: 'TRANSFERENCIA', monto_gs: 45000 }] }, t.tk.cajaa);
  // Cierres independientes: diferencia exige observación
  t.bad('caja.cerrar', { caja_id: 'CAJA_A', efectivo_declarado_gs: 100000 }, t.tk.cajaa, 'OBSERVACION_REQUERIDA');
  const cierreA = t.ok('caja.cerrar', { caja_id: 'CAJA_A', efectivo_declarado_gs: 115000 }, t.tk.cajaa).turno;
  assert.equal(cierreA.esperado_efectivo_gs, 115000); assert.equal(cierreA.diferencia_gs, 0);
  // Caja B sigue abierta y operativa
  assert.ok(t.ok('caja.estado', { caja_id: 'CAJA_B' }, t.tk.cajab).turno);
  const cierreB = t.ok('caja.cerrar', { caja_id: 'CAJA_B', efectivo_declarado_gs: 95000, observacion: 'faltante de 5.000 en monedas' }, t.tk.cajab).turno;
  assert.equal(cierreB.diferencia_gs, -5000);
  // T16 Reporte: por caja y consolidado, sin duplicación
  const rep = t.ok('admin.report', {}, t.tk.admin);
  const A = rep.cajas.find((c) => c.caja_id === 'CAJA_A'), B = rep.cajas.find((c) => c.caja_id === 'CAJA_B');
  assert.equal(A.ventas_netas_gs, 45000); assert.equal(A.reversos_gs, -45000); assert.equal(A.por_medio.TRANSFERENCIA, 45000);
  assert.equal(B.ventas_netas_gs, 50000); assert.equal(B.descuentos_gs, 10000);
  assert.equal(rep.consolidado_gs, 95000);
  assert.equal(rep.cierres.length, 2); assert.equal(rep.cobros_revertidos.length, 1);
  t.bad('admin.report', {}, t.tk.cajaa, 'SIN_PERMISO');
});

test('T15 roles sin permisos administrativos', () => {
  const t = fresh();
  const prod = { producto_id: 'ESPRESSO', categoria_id: 'CAF_CAL', nombre: 'Espresso', precio_gs: 1, activo: true, disponible: true, puntos: 'A_CAFE', grupos: '' };
  for (const u of ['mozo', 'cocina', 'cajaa', 'cajab']) {
    t.bad('admin.product', { producto: prod }, t.tk[u], 'SIN_PERMISO');
    t.bad('admin.user', { usuario: { usuario_id: 'hacker', nombre: 'x', rol: 'ADMIN', pin: '1234', activo: true } }, t.tk[u], 'SIN_PERMISO');
    t.bad('admin.config', { clave: 'medios_pago', valor: 'EFECTIVO' }, t.tk[u], 'SIN_PERMISO');
    t.bad('admin.data', {}, t.tk[u], 'SIN_PERMISO');
  }
  t.bad('order.create', { request_id: t.rid(), mesa_id: 'M01', items: [item('TE', 1)] }, t.tk.cocina, 'SIN_PERMISO');
  // Sin sesión o con sesión adulterada
  t.bad('sync', {}, undefined, 'NO_SESION');
  t.bad('sync', {}, t.tk.mozo.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')), 'NO_SESION');
  const [b64] = t.tk.mozo.split('.');
  const forged = Buffer.from(Buffer.from(b64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString().replace('mozo', 'admin')).toString('base64').replace(/=+$/, '') + '.' + t.tk.mozo.split('.')[1];
  t.bad('admin.data', {}, forged, 'NO_SESION');
  // Cocina solo ve pedidos, no cuentas
  assert.deepEqual(t.ok('sync', {}, t.tk.cocina).cuentas, []);
});

test('T18 cliente anónimo no lee pedidos ajenos ni registros de caja', () => {
  const t = fresh();
  const r = t.ok('public.order', { token: t.mesaTok(11), request_id: t.rid(), items: [item('CHIPA', 1)] });
  const st = t.ok('public.status', { status_token: r.status_token });
  assert.equal(st.numero, r.numero);
  assert.equal(st.pedido_id, undefined); assert.equal(st.cuenta_id, undefined);
  t.bad('public.status', { status_token: 'x'.repeat(24) }, null, 'NO_ENCONTRADO');
  t.bad('public.status', { status_token: r.numero }, null, 'NO_ENCONTRADO');
  for (const a of ['sync', 'caja.estado', 'admin.report', 'order.state', 'order.create']) t.bad(a, {}, undefined, 'NO_SESION');
  // QR takeaway exige nombre
  t.bad('public.order', { token: t.tkTok(), request_id: t.rid(), items: [item('CHIPA', 1)] }, null, 'ALIAS_REQUERIDO');
  const tk = t.ok('public.order', { token: t.tkTok(), request_id: t.rid(), alias: 'Ana', items: [item('CHIPA', 1)] });
  assert.match(tk.numero, /^T-/);
});

test('Límite de pedidos por QR y QR deshabilitado', () => {
  const t = fresh();
  const tok = t.mesaTok(12);
  for (let i = 0; i < 6; i++) t.ok('public.order', { token: tok, request_id: t.rid(), items: [item('TE', 1)] });
  t.bad('public.order', { token: tok, request_id: t.rid(), items: [item('TE', 1)] }, null, 'DEMASIADOS_PEDIDOS');
  t.ok('admin.config', { clave: 'qr_pedidos_habilitados', valor: 'NO' }, t.tk.admin);
  t.bad('public.order', { token: t.mesaTok(13), request_id: t.rid(), items: [item('TE', 1)] }, null, 'QR_DESHABILITADO');
  // Regenerar QR invalida el anterior
  t.ok('admin.config', { clave: 'qr_pedidos_habilitados', valor: 'SI' }, t.tk.admin);
  const old = t.mesaTok(14);
  t.ok('admin.rotateQr', { mesa_id: 'M14' }, t.tk.admin);
  t.bad('public.resolve', { token: old }, null, 'QR_INVALIDO');
});

test('Configuración: pedidos QR directos a cocina si se desactiva la aceptación', () => {
  const t = fresh();
  t.ok('admin.config', { clave: 'qr_requiere_aceptacion', valor: 'NO' }, t.tk.admin);
  assert.equal(t.ok('public.order', { token: t.mesaTok(15), request_id: t.rid(), items: [item('TE', 1)] }).estado, 'ACEPTADO');
});

test('Precios históricos: cambiar el catálogo no altera pedidos registrados', () => {
  const t = fresh();
  const p = t.ok('order.create', { request_id: t.rid(), mesa_id: 'M16', items: [item('CARROT_CAKE', 1)] }, t.tk.mozo).pedido;
  t.ok('admin.product', { producto: { producto_id: 'CARROT_CAKE', categoria_id: 'DULCES', nombre: 'Carrot cake', descripcion: '', precio_gs: 28000, activo: true, disponible: true, puntos: 'A_CAFE,B_TAKEAWAY', grupos: '', orden: 27 } }, t.tk.admin);
  const s = t.ok('sync', {}, t.tk.mozo).pedidos.find((x) => x.pedido_id === p.pedido_id);
  assert.equal(s.items[0].precio_unit_gs, 25000); assert.equal(s.total_gs, 25000);
  const p2 = t.ok('order.create', { request_id: t.rid(), mesa_id: 'M17', items: [item('CARROT_CAKE', 1)] }, t.tk.mozo).pedido;
  assert.equal(p2.total_gs, 28000);
  const aud = t.data.active.Auditoria.find((a) => a.accion === 'PRODUCTO_EDITADO');
  assert.match(aud.detalle, /"precio_gs":\[25000,28000\]/);
});

test('Almuerzos: se pueden cargar categoría, grupo y producto sin tocar código', () => {
  const t = fresh();
  t.ok('admin.category', { categoria: { categoria_id: 'ALMUERZOS', nombre: 'Almuerzos', orden: 15, activa: true } }, t.tk.admin);
  t.ok('admin.group', { grupo: { grupo_id: 'G_GUARNICION', nombre: 'Guarnición', min: 1, max: 1, activo: true, opciones: [{ opcion_id: 'GU_PURE', nombre: 'Puré', delta_gs: 0, activo: true }, { opcion_id: 'GU_ENS', nombre: 'Ensalada', delta_gs: 0, activo: true }] } }, t.tk.admin);
  t.ok('admin.product', { producto: { producto_id: 'menu_del_dia', categoria_id: 'ALMUERZOS', nombre: 'Menú del día (prueba)', descripcion: '', precio_gs: 1000, activo: true, disponible: true, puntos: 'A_CAFE', grupos: 'G_GUARNICION', orden: 100 } }, t.tk.admin);
  const menu = t.ok('public.resolve', { token: t.mesaTok(18) }).menu;
  assert.ok(menu.categorias.some((c) => c.id === 'ALMUERZOS'));
  assert.equal(t.ok('order.create', { request_id: t.rid(), mesa_id: 'M18', items: [item('MENU_DEL_DIA', 2, ['GU_ENS'])] }, t.tk.mozo).pedido.total_gs, 2000);
  // No habilitado en takeaway
  t.bad('public.order', { token: t.tkTok(), request_id: t.rid(), alias: 'x', items: [item('MENU_DEL_DIA', 1, ['GU_ENS'])] }, null, 'PRODUCTO_NO_HABILITADO');
});

test('Login: bloqueo tras 5 intentos fallidos y revocación de sesiones', () => {
  const t = fresh();
  for (let i = 0; i < 4; i++) t.bad('auth.login', { usuario: 'mozo2', pin: '9999' }, null, 'LOGIN_INVALIDO');
  t.bad('auth.login', { usuario: 'mozo2', pin: '9999' }, null, 'LOGIN_INVALIDO');
  t.bad('auth.login', { usuario: 'mozo2', pin: PIN.mozo2 }, null, 'USUARIO_BLOQUEADO');
  t.bad('auth.login', { usuario: 'noexiste', pin: '1234' }, null, 'LOGIN_INVALIDO');
  // Cambiar el rol invalida las sesiones abiertas
  t.ok('sync', {}, t.tk.mozo);
  t.ok('admin.user', { usuario: { usuario_id: 'mozo', nombre: 'Mozo Uno', rol: 'COCINA', activo: true } }, t.tk.admin);
  t.bad('sync', {}, t.tk.mozo, 'NO_SESION');
  t.bad('admin.user', { usuario: { usuario_id: 'admin', nombre: 'Encargado', rol: 'MOZO', activo: true } }, t.tk.admin, 'AUTO_BLOQUEO');
  // Ningún PIN guardado en texto plano
  assert.ok(!JSON.stringify(t.data.active.Usuarios).includes(PIN.admin));
});

test('Venta directa en caja B no pasa por cocina', () => {
  const t = fresh();
  const p = t.ok('order.create', { request_id: t.rid(), punto_id: 'B_TAKEAWAY', venta_directa: true, items: [item('GASEOSA', 1, ['GA_GUA'])] }, t.tk.cajab).pedido;
  assert.equal(p.estado, 'ENTREGADO');
  const k = t.ok('sync', {}, t.tk.cocina).pedidos.filter((x) => ['ACEPTADO', 'EN_PREPARACION'].includes(x.estado));
  assert.equal(k.length, 0);
});

test('Archivo: registros cerrados se archivan y siguen en reportes', () => {
  const t = fresh();
  let now = Date.parse('2026-10-01T15:00:00Z');
  t.b.env.setClock(() => now);
  t.ok('caja.abrir', { caja_id: 'CAJA_A', monto_inicial_gs: 0 }, t.ok('auth.login', { usuario: 'cajaa', pin: PIN.cajaa }).token);
  const tkA = t.ok('auth.login', { usuario: 'cajaa', pin: PIN.cajaa }).token, tkM = t.ok('auth.login', { usuario: 'mozo', pin: PIN.mozo }).token;
  const p = t.ok('order.create', { request_id: t.rid(), mesa_id: 'M19', venta_directa: true, items: [item('ESPRESSO', 2)] }, tkM).pedido;
  t.ok('caja.cobrar', { request_id: t.rid(), cuenta_id: p.cuenta_id, pagos: [{ medio: 'EFECTIVO', monto_gs: 24000 }] }, tkA);
  t.ok('caja.cerrar', { caja_id: 'CAJA_A', efectivo_declarado_gs: 24000 }, tkA);
  now = Date.parse('2026-10-09T15:00:00Z');
  const n = t.b.app.archive();
  assert.equal(n.Pedidos, 1); assert.equal(n.Cobros, 1); assert.equal(n.Turnos, 1);
  assert.equal(t.data.active.Pedidos.length, 0);
  const tkAdm = t.ok('auth.login', { usuario: 'admin', pin: PIN.admin }).token;
  const rep = t.ok('admin.report', { desde: '2026-10-01', hasta: '2026-10-01' }, tkAdm);
  assert.equal(rep.consolidado_gs, 24000); assert.equal(rep.top_productos[0].cantidad, 2);
});

test('HTTP: T11 pedidos simultáneos desde varios dispositivos sin mezcla ni duplicados', async (t) => {
  const b = buildApp(null, { secret: 's2', adminPin: PIN.admin, log: () => {} });
  const server = await serve(b, 0);
  t.after(() => server.close());
  const port = server.address().port;
  const post = (body) => new Promise((res, rej) => {
    const d = JSON.stringify(body);
    const r = http.request({ host: '127.0.0.1', port, path: '/api', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) } }, (s) => {
      let x = ''; s.on('data', (c) => (x += c)); s.on('end', () => res({ status: s.statusCode, body: JSON.parse(x) }));
    });
    r.on('error', rej); r.end(d);
  });
  const toks = b.store._data().active.Mesas.slice(0, 10).map((m) => m.qr_token);
  const reqs = [];
  for (let i = 0; i < 40; i++) {
    const rid = 'concurrente-' + i;
    const body = { action: 'public.order', payload: { token: toks[i % 10], request_id: rid, items: [{ producto_id: 'ESPRESSO', cantidad: (i % 3) + 1, opciones: [] }] } };
    reqs.push(post(body));
    if (i % 4 === 0) reqs.push(post(body)); // reintentos duplicados intercalados
  }
  const res = await Promise.all(reqs);
  assert.ok(res.every((r) => r.status === 200 && r.body.ok), JSON.stringify(res.find((r) => !r.body.ok)));
  const peds = b.store._data().active.Pedidos;
  assert.equal(peds.length, 40);
  assert.equal(new Set(peds.map((p) => p.numero)).size, 40);
  for (const p of peds) {
    const i = Number(p.request_id.split('-')[1]);
    const mesa = b.store._data().active.Mesas.find((m) => m.mesa_id === p.mesa_id);
    assert.equal(mesa.qr_token, toks[i % 10], 'pedido en la mesa correcta');
    assert.equal(p.total_gs, 12000 * ((i % 3) + 1));
  }
  // JSON inválido y acción desconocida
  const bad = await new Promise((res) => { const r = http.request({ host: '127.0.0.1', port, path: '/api', method: 'POST' }, (s) => { let x = ''; s.on('data', (c) => (x += c)); s.on('end', () => res(JSON.parse(x))); }); r.end('{no json'); });
  assert.equal(bad.error.code, 'JSON_INVALIDO');
  assert.equal((await post({ action: 'drop.tables' })).body.error.code, 'ACCION_DESCONOCIDA');
});

test('Pizza mitad y mitad: se cobra el sabor más caro; personal admite segunda mitad sin recargo', () => {
  const t = fresh();
  const p = (items) => t.ok('order.create', { request_id: t.rid(), mesa_id: 'M02', items }, t.tk.mozo).pedido;
  assert.equal(p([item('PIZZA_MITAD', 1, ['M1_MOZ', 'M2_MOZ'])]).total_gs, 45000);
  assert.equal(p([item('PIZZA_MITAD', 1, ['M1_MOZ', 'M2_PEP'])]).total_gs, 60000);
  const x = p([item('PIZZA_MITAD', 2, ['M1_QUA', 'M2_PEP'])]);
  assert.equal(x.total_gs, 130000);
  assert.match(x.items[0].opciones, /1ª mitad: Quattro Formaggi · 2ª mitad: Peperoni/);
  t.bad('order.create', { request_id: t.rid(), mesa_id: 'M02', items: [item('PIZZA_MITAD', 1, ['M1_MOZ'])] }, t.tk.mozo, 'OPCION_REQUERIDA');
  t.bad('order.create', { request_id: t.rid(), mesa_id: 'M02', items: [item('PIZZA_MITAD', 1, ['M1_MOZ', 'M1_PEP', 'M2_MAR'])] }, t.tk.mozo, 'OPCION_INVALIDA');
  assert.equal(p([item('PIZZA_PERSONAL', 1, ['PP_MOZ', 'PX_PEP'])]).total_gs, 30000);
  assert.equal(p([item('PIZZA_PERSONAL', 1, ['PP_QUA'])]).total_gs, 30000);
  const r = t.ok('public.order', { token: t.mesaTok(5), request_id: t.rid(), items: [item('PIZZA_MITAD', 1, ['M1_MAR', 'M2_MOZ'])] });
  assert.equal(r.total_gs, 65000);
});

test('Comprobante: el mozo pide ticket o factura al solicitar la cuenta; caja lo ve, lo corrige y queda en el cobro', () => {
  const t = fresh();
  const pa = t.ok('order.create', { request_id: t.rid(), mesa_id: 'M11', items: [item('ESPRESSO', 1)] }, t.tk.mozo).pedido;
  t.bad('cuenta.requestClose', { cuenta_id: pa.cuenta_id, comprobante: { tipo: 'FACTURA', ruc: 'abc', razon: 'X SA' } }, t.tk.mozo, 'RUC_INVALIDO');
  t.bad('cuenta.requestClose', { cuenta_id: pa.cuenta_id, comprobante: { tipo: 'FACTURA', ruc: '80012345-6', razon: '' } }, t.tk.mozo, 'RAZON_REQUERIDA');
  t.ok('cuenta.requestClose', { cuenta_id: pa.cuenta_id, comprobante: { tipo: 'FACTURA', ruc: '80.012.345-6', razon: 'Andrade SA', email: 'pagos@ejemplo.com' } }, t.tk.mozo);
  const cu = t.ok('sync', {}, t.tk.cajaa).cuentas.find((c) => c.cuenta_id === pa.cuenta_id);
  assert.deepEqual(cu.comprobante, { tipo: 'FACTURA', ruc: '80012345-6', razon: 'Andrade SA', email: 'pagos@ejemplo.com' });
  assert.equal(cu.estado, 'CIERRE_SOLICITADO');
  t.bad('cuenta.comprobante', { cuenta_id: pa.cuenta_id, comprobante: { tipo: 'TICKET' } }, t.tk.cajab, 'SIN_PERMISO');
  t.ok('caja.abrir', { caja_id: 'CAJA_A', monto_inicial_gs: 0 }, t.tk.cajaa);
  const co = t.ok('caja.cobrar', { request_id: t.rid(), cuenta_id: pa.cuenta_id, comprobante: { tipo: 'FACTURA', ruc: '1234567', razon: 'Juan Pérez' }, pagos: [{ medio: 'EFECTIVO', monto_gs: 12000 }] }, t.tk.cajaa).cobro;
  assert.equal(co.comprobante.tipo, 'FACTURA'); assert.equal(co.comprobante.ruc, '1234567'); assert.equal(co.comprobante.razon, 'Juan Pérez');
  // Sin elegir nada: ticket
  const pb = t.ok('order.create', { request_id: t.rid(), mesa_id: 'M12', items: [item('ESPRESSO', 1)] }, t.tk.mozo).pedido;
  t.ok('cuenta.requestClose', { cuenta_id: pb.cuenta_id }, t.tk.mozo);
  const cb = t.ok('caja.cobrar', { request_id: t.rid(), cuenta_id: pb.cuenta_id, pagos: [{ medio: 'TD', monto_gs: 12000 }] }, t.tk.cajaa).cobro;
  assert.equal(cb.comprobante.tipo, 'TICKET');
});

test('Reservas: bloquean la mesa (mozo y QR), se habilitan al llegar, vencen solas a los 30 min', () => {
  const t = fresh();
  const hora = (min) => new Date(Date.now() + min * 60000).toISOString();
  t.bad('mesa.reservar', { mesa_id: 'M13', nombre: 'Juan', hora: hora(60) }, t.tk.cocina, 'SIN_PERMISO');
  t.bad('mesa.reservar', { mesa_id: 'M13', nombre: '', hora: hora(60) }, t.tk.mozo, 'NOMBRE_INVALIDO');
  t.ok('mesa.reservar', { mesa_id: 'M13', nombre: 'Juan', hora: hora(60), personas: 4, nota: 'cumpleaños' }, t.tk.mozo);
  const m = t.ok('sync', {}, t.tk.mozo).mesas.find((x) => x.mesa_id === 'M13');
  assert.equal(m.reserva.nombre, 'Juan'); assert.equal(m.reserva.bloquea, true); assert.equal(m.reserva.personas, 4);
  t.bad('mesa.reservar', { mesa_id: 'M13', nombre: 'Otro', hora: hora(90) }, t.tk.mozo, 'MESA_RESERVADA');
  t.bad('order.create', { request_id: t.rid(), mesa_id: 'M13', items: [item('ESPRESSO', 1)] }, t.tk.mozo, 'MESA_RESERVADA');
  assert.equal(t.ok('public.resolve', { token: t.mesaTok(13) }).reservada, true);
  t.bad('public.order', { token: t.mesaTok(13), request_id: t.rid(), items: [item('ESPRESSO', 1)] }, null, 'MESA_RESERVADA');
  t.ok('mesa.reservaFin', { mesa_id: 'M13', motivo: 'LLEGO' }, t.tk.mozo);
  t.ok('order.create', { request_id: t.rid(), mesa_id: 'M13', items: [item('ESPRESSO', 1)] }, t.tk.mozo);
  // reserva lejana: no bloquea todavía
  t.ok('mesa.reservar', { mesa_id: 'M14', nombre: 'Ana', hora: hora(24 * 60) }, t.tk.admin);
  t.ok('order.create', { request_id: t.rid(), mesa_id: 'M14', items: [item('ESPRESSO', 1)] }, t.tk.mozo);
  // reserva vencida (hora pasada hace 31 min): la mesa queda libre sola
  t.b.store._data().active.Mesas.find((x) => x.mesa_id === 'M15').reserva_hora = hora(-31);
  t.b.store._data().active.Mesas.find((x) => x.mesa_id === 'M15').reserva_nombre = 'Tarde';
  assert.equal(t.ok('sync', {}, t.tk.mozo).mesas.find((x) => x.mesa_id === 'M15').reserva, null);
  t.ok('order.create', { request_id: t.rid(), mesa_id: 'M15', items: [item('ESPRESSO', 1)] }, t.tk.mozo);
  // mesa ocupada no se puede reservar para dentro de 1 h
  t.bad('mesa.reservar', { mesa_id: 'M15', nombre: 'Xavier', hora: hora(60) }, t.tk.mozo, 'MESA_OCUPADA');
});

test('Cuenta pedida que se cancela; mesa cobrada queda "pagada · aún ocupada" hasta que el mozo la libera', () => {
  const t = fresh();
  const pa = t.ok('order.create', { request_id: t.rid(), mesa_id: 'M16', items: [item('ESPRESSO', 1)] }, t.tk.mozo).pedido;
  t.ok('cuenta.requestClose', { cuenta_id: pa.cuenta_id }, t.tk.mozo);
  t.ok('cuenta.cancelClose', { cuenta_id: pa.cuenta_id }, t.tk.mozo);
  assert.equal(t.ok('sync', {}, t.tk.cajaa).cuentas.find((c) => c.cuenta_id === pa.cuenta_id).estado, 'ABIERTA');
  t.bad('cuenta.cancelClose', { cuenta_id: pa.cuenta_id }, t.tk.mozo, 'CUENTA_INVALIDA');
  t.bad('mesa.liberar', { mesa_id: 'M16' }, t.tk.mozo, 'CUENTA_ABIERTA');
  t.ok('caja.abrir', { caja_id: 'CAJA_A', monto_inicial_gs: 0 }, t.tk.cajaa);
  t.ok('caja.cobrar', { request_id: t.rid(), cuenta_id: pa.cuenta_id, pagos: [{ medio: 'EFECTIVO', monto_gs: 12000 }] }, t.tk.cajaa);
  assert.ok(t.ok('sync', {}, t.tk.mozo).mesas.find((x) => x.mesa_id === 'M16').pagada_en);
  t.ok('mesa.liberar', { mesa_id: 'M16' }, t.tk.mozo);
  assert.equal(t.ok('sync', {}, t.tk.mozo).mesas.find((x) => x.mesa_id === 'M16').pagada_en, '');
  // si piden algo más estando "pagada", se abre una cuenta nueva y deja de figurar pagada
  const pb = t.ok('order.create', { request_id: t.rid(), mesa_id: 'M17', items: [item('ESPRESSO', 1)] }, t.tk.mozo).pedido;
  t.ok('caja.cobrar', { request_id: t.rid(), cuenta_id: pb.cuenta_id, pagos: [{ medio: 'EFECTIVO', monto_gs: 12000 }] }, t.tk.cajaa);
  const pc = t.ok('order.create', { request_id: t.rid(), mesa_id: 'M17', items: [item('CHIPA', 1)] }, t.tk.mozo).pedido;
  assert.notEqual(pc.cuenta_id, pb.cuenta_id);
  assert.equal(t.ok('sync', {}, t.tk.mozo).mesas.find((x) => x.mesa_id === 'M17').pagada_en, '');
});

test('Sub-cuentas: personas en la mesa, cobro por persona con lo compartido en partes iguales', () => {
  const t = fresh();
  // Mesa común: igual que siempre
  assert.equal(t.ok('order.create', { request_id: t.rid(), mesa_id: 'M18', items: [item('ESPRESSO', 1)] }, t.tk.mozo).pedido.items[0].persona, '');
  // El mozo agrega personas (abre la cuenta)
  let r = t.ok('cuenta.personas', { mesa_id: 'M19', agregar: 'Ana' }, t.tk.mozo);
  const cid = r.cuenta.cuenta_id, ana = r.persona.id;
  const juan = t.ok('cuenta.personas', { cuenta_id: cid, agregar: 'Juan' }, t.tk.mozo).persona.id;
  const luz = t.ok('cuenta.personas', { cuenta_id: cid, agregar: 'Luz' }, t.tk.mozo).persona.id;
  assert.equal(t.ok('cuenta.personas', { cuenta_id: cid, agregar: 'ana' }, t.tk.mozo).persona.id, ana, 'no duplica nombres');
  t.bad('cuenta.personas', { cuenta_id: cid, agregar: 'X' }, t.tk.cocina, 'SIN_PERMISO');
  const p1 = t.ok('order.create', { request_id: t.rid(), mesa_id: 'M19', cuenta_id: cid, items: [Object.assign(item('CAPUCHINO', 1), { persona: ana }), Object.assign(item('LATTE', 1), { persona: juan }), item('CHIPA', 3)] }, t.tk.mozo).pedido;
  assert.equal(p1.items[0].persona_nombre, 'Ana'); assert.equal(p1.items[2].persona, '');
  // por QR: el cliente dice su nombre -> su sub-cuenta (nueva persona si no existe)
  const res = t.ok('public.resolve', { token: t.mesaTok(19) });
  assert.deepEqual(res.personas, ['Ana', 'Juan', 'Luz']);
  t.ok('public.order', { token: t.mesaTok(19), request_id: t.rid(), persona_nombre: 'Luz', items: [item('TE', 1)] });
  t.ok('public.order', { token: t.mesaTok(19), request_id: t.rid(), persona_nombre: 'Pedro', items: [item('ESPRESSO', 1)] });
  let cu = t.ok('sync', {}, t.tk.cajaa).cuentas.find((c) => c.cuenta_id === cid);
  const per = (n) => cu.personas.personas.find((x) => x.nombre === n);
  assert.equal(per('Ana').consumo_gs, 25000); assert.equal(per('Juan').consumo_gs, 20000); assert.equal(per('Luz').consumo_gs, 7000); assert.equal(per('Pedro').consumo_gs, 12000);
  assert.equal(cu.personas.compartido.consumo_gs, 24000); assert.equal(cu.total_gs, 25000 + 20000 + 7000 + 12000 + 24000);
  t.ok('caja.abrir', { caja_id: 'CAJA_A', monto_inicial_gs: 0 }, t.tk.cajaa);
  // Ana paga: su consumo + 1/4 de lo compartido (24000/4 = 6000) = 31000
  t.bad('caja.cobrar', { request_id: t.rid(), cuenta_id: cid, personas: [ana], compartido: 'IGUALES', total_esperado_gs: 30000, pagos: [{ medio: 'EFECTIVO', monto_gs: 30000 }] }, t.tk.cajaa, 'TOTAL_CAMBIO');
  const ca = t.ok('caja.cobrar', { request_id: t.rid(), cuenta_id: cid, personas: [ana], compartido: 'IGUALES', total_esperado_gs: 31000, comprobante: { tipo: 'FACTURA', ruc: '1234567', razon: 'Ana López' }, pagos: [{ medio: 'TD', monto_gs: 31000 }] }, t.tk.cajaa).cobro;
  assert.equal(ca.comprobante.razon, 'Ana López'); assert.deepEqual(ca.detalle, { personas: { [ana]: 25000 }, compartido: 6000 });
  cu = t.ok('sync', {}, t.tk.cajaa).cuentas.find((c) => c.cuenta_id === cid);
  assert.equal(cu.pago_estado, 'PARCIAL'); assert.equal(cu.pagado_gs, 31000); assert.equal(per('Ana').pendiente_gs, 0);
  // no se puede anular lo que Ana ya pagó
  t.bad('order.voidItem', { item_id: p1.items[0].item_id, motivo: 'error de carga', autorizacion: { usuario: 'admin', pin: PIN.admin } }, t.tk.mozo, 'CUENTA_COBRADA');
  // Juan sin compartido; Luz y Pedro juntos con el resto de lo compartido (3 que faltan: Juan, Luz, Pedro -> 2/3 de 18000 = 12000)
  t.ok('caja.cobrar', { request_id: t.rid(), cuenta_id: cid, personas: [juan], compartido: 'NADA', pagos: [{ medio: 'EFECTIVO', monto_gs: 20000 }] }, t.tk.cajaa);
  cu = t.ok('sync', {}, t.tk.cajaa).cuentas.find((c) => c.cuenta_id === cid);
  const lp = [per('Luz').id, per('Pedro').id];
  t.ok('caja.cobrar', { request_id: t.rid(), cuenta_id: cid, personas: lp, compartido: 'IGUALES', total_esperado_gs: 7000 + 12000 + 18000, pagos: [{ medio: 'TC', monto_gs: 37000 }] }, t.tk.cajaa);
  // pagaron todos y lo compartido ya está saldado: la cuenta se cierra y la mesa queda "pagada"
  const fin = t.data.active.Cuentas.find((c) => c.cuenta_id === cid);
  assert.equal(fin.pago_estado, 'COBRADO'); assert.equal(fin.estado, 'CERRADA');
  assert.ok(t.ok('sync', {}, t.tk.mozo).mesas.find((m) => m.mesa_id === 'M19').pagada_en);
  // reporte: suma 31000 + 20000 + 37000
  const rep = t.ok('admin.report', {}, t.tk.admin).cajas.find((c) => c.caja_id === 'CAJA_A');
  assert.equal(rep.ventas_netas_gs, 88000);
});

test('Sub-cuentas: cobrar todo lo pendiente de una vez y revertir un cobro parcial', () => {
  const t = fresh();
  const cid = t.ok('cuenta.personas', { mesa_id: 'M20', agregar: 'Ana' }, t.tk.mozo).cuenta.cuenta_id;
  const bea = t.ok('cuenta.personas', { cuenta_id: cid, agregar: 'Bea' }, t.tk.mozo).persona.id;
  const ana = t.data.active.Cuentas.find((c) => c.cuenta_id === cid) && JSON.parse(t.data.active.Cuentas.find((c) => c.cuenta_id === cid).personas)[0].id;
  t.ok('order.create', { request_id: t.rid(), mesa_id: 'M20', cuenta_id: cid, items: [Object.assign(item('ESPRESSO', 1), { persona: ana }), Object.assign(item('TE', 1), { persona: bea }), item('CHIPA', 1)] }, t.tk.mozo);
  t.ok('caja.abrir', { caja_id: 'CAJA_A', monto_inicial_gs: 0 }, t.tk.cajaa);
  const c1 = t.ok('caja.cobrar', { request_id: t.rid(), cuenta_id: cid, personas: [ana], compartido: 'IGUALES', pagos: [{ medio: 'EFECTIVO', monto_gs: 12000 + 4000 }] }, t.tk.cajaa).cobro;
  t.ok('caja.revertir', { cobro_id: c1.cobro_id, motivo: 'se equivocó de persona', autorizacion: { usuario: 'admin', pin: PIN.admin } }, t.tk.cajaa);
  assert.equal(t.data.active.Cuentas.find((c) => c.cuenta_id === cid).pago_estado, 'REVERTIDO');
  // sin elegir personas: cobra todo lo pendiente
  t.ok('caja.cobrar', { request_id: t.rid(), cuenta_id: cid, total_esperado_gs: 12000 + 7000 + 8000, pagos: [{ medio: 'EFECTIVO', monto_gs: 27000 }] }, t.tk.cajaa);
  assert.equal(t.data.active.Cuentas.find((c) => c.cuenta_id === cid).pago_estado, 'COBRADO');
});
