'use strict';
/* Pedir la cuenta desde el celular del cliente (QR de la mesa).  node --test tests/cuenta.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../server/dev-server.js');

const PIN = { admin: '246810', mozo: '1111', cajaa: '3333' };
const USUARIOS = [
  { usuario_id: 'mozo', nombre: 'Mozo Uno', rol: 'MOZO', pin: PIN.mozo },
  { usuario_id: 'cajaa', nombre: 'Cajera A', rol: 'CAJA', caja_id: 'CAJA_A', pin: PIN.cajaa }
];
function fresh() {
  const b = buildApp(null, { secret: 'test-secret', adminPin: PIN.admin, mesas: 20, log: () => {}, usuarios: USUARIOS, plan: '', modulos: '' });
  const call = (action, payload, token) => b.app.handle({ action, payload: payload || {}, token });
  const ok = (a, p, t) => { const r = call(a, p, t); assert.equal(r.ok, true, a + ' falló: ' + JSON.stringify(r.error)); return r.data; };
  const bad = (a, p, t, code) => { const r = call(a, p, t); assert.equal(r.ok, false, a + ' debía fallar'); if (code) assert.equal(r.error.code, code, JSON.stringify(r.error)); return r; };
  const tk = {}; for (const u of Object.keys(PIN)) tk[u] = ok('auth.login', { usuario: u, pin: PIN[u] }).token;
  const data = b.store._data();
  const mesaTok = (n) => data.active.Mesas.find((m) => m.numero === n).qr_token;
  const mesaId = (n) => data.active.Mesas.find((m) => m.numero === n).mesa_id;
  let seq = 0; const rid = () => 'req-cu-' + (++seq) + '-' + Math.random().toString(36).slice(2);
  return { b, call, ok, bad, tk, data, mesaTok, mesaId, rid };
}
const item = (producto_id, cantidad) => ({ producto_id, cantidad, opciones: [] });
const FACT = { tipo: 'FACTURA', ruc: '80012345-6', razon: 'Comercial Ejemplo SA', email: 'pagos@ejemplo.com' };

test('C01 el cliente ve su cuenta y la pide con factura, medio de pago y vuelto', () => {
  const t = fresh();
  const tok = t.mesaTok(3);
  assert.equal(t.ok('public.resolve', { token: tok }).cuenta_qr, true);
  // Sin consumos: no hay cuenta para pedir
  assert.equal(t.ok('public.cuenta', { token: tok }).cuenta, null);
  t.bad('public.pedirCuenta', { token: tok, comprobante: { tipo: 'TICKET' }, medio: 'EFECTIVO' }, null, 'SIN_CONSUMOS');
  // El mozo carga el pedido; el cliente lo ve agrupado
  t.ok('order.create', { request_id: t.rid(), mesa_id: t.mesaId(3), punto_id: 'A_CAFE', items: [item('ESPRESSO', 2)] }, t.tk.mozo);
  t.ok('order.create', { request_id: t.rid(), mesa_id: t.mesaId(3), punto_id: 'A_CAFE', items: [item('ESPRESSO', 1)] }, t.tk.mozo);
  const v = t.ok('public.cuenta', { token: tok });
  assert.equal(v.cuenta.estado, 'ABIERTA');
  assert.equal(v.cuenta.items.length, 1, 'mismos productos se agrupan');
  assert.equal(v.cuenta.items[0].cantidad, 3);
  assert.ok(v.cuenta.total_gs > 0);
  assert.ok(v.medios.includes('EFECTIVO'));
  // Validaciones
  t.bad('public.pedirCuenta', { token: tok, comprobante: { tipo: 'FACTURA', ruc: 'abc', razon: 'X SA' }, medio: 'EFECTIVO' }, null, 'RUC_INVALIDO');
  t.bad('public.pedirCuenta', { token: tok, comprobante: { tipo: 'TICKET' }, medio: 'BITCOIN' }, null, 'MEDIO_INVALIDO');
  t.bad('public.pedirCuenta', { token: tok, medio: 'EFECTIVO' }, null, 'COMPROBANTE_INVALIDO');
  // Pide la cuenta
  const r = t.ok('public.pedirCuenta', { token: tok, comprobante: FACT, medio: 'EFECTIVO', paga_con: 100000, separado: true });
  assert.equal(r.cuenta.estado, 'CIERRE_SOLICITADO');
  assert.equal(r.cuenta.comprobante.ruc, '80012345-6');
  assert.equal(r.cuenta.comprobante.email, undefined, 'el correo no se muestra en la mesa compartida');
  assert.deepEqual([r.cuenta.pedido.origen, r.cuenta.pedido.medio, r.cuenta.pedido.paga_con, r.cuenta.pedido.separado], ['CLIENTE', 'EFECTIVO', 100000, true]);
  // Mozo y caja lo ven en su sincronización, con la factura completa
  for (const u of ['mozo', 'cajaa']) {
    const c = t.ok('sync', {}, t.tk[u]).cuentas.find((x) => x.mesa_id === t.mesaId(3));
    assert.equal(c.estado, 'CIERRE_SOLICITADO');
    assert.equal(c.comprobante.razon, 'Comercial Ejemplo SA');
    assert.equal(c.comprobante.email, 'pagos@ejemplo.com');
    assert.equal(c.cierre_pedido.medio, 'EFECTIVO');
  }
  // Queda en auditoría como pedido del cliente
  const aud = t.ok('admin.audit', {}, t.tk.admin); const lista = aud.auditoria;
  assert.ok(lista.some((a) => a.accion === 'CIERRE_SOLICITADO_QR' && a.usuario_id === 'PUBLICO'));
  // Puede cambiar los datos sin perder la hora original
  const hora = r.cuenta.cierre_solicitado_en;
  const r2 = t.ok('public.pedirCuenta', { token: tok, comprobante: { tipo: 'TICKET' }, medio: 'TD' });
  assert.equal(r2.cuenta.cierre_solicitado_en, hora);
  assert.equal(r2.cuenta.comprobante.tipo, 'TICKET');
  assert.equal(r2.cuenta.pedido.paga_con, 0, 'con tarjeta no hay vuelto');
});

test('C02 la caja cobra con lo que pidió el cliente; si sigue pidiendo, el pedido de cuenta se anula', () => {
  const t = fresh();
  const tok = t.mesaTok(4);
  const o = t.ok('order.create', { request_id: t.rid(), mesa_id: t.mesaId(4), punto_id: 'A_CAFE', items: [item('ESPRESSO', 1)] }, t.tk.mozo);
  t.ok('public.pedirCuenta', { token: tok, comprobante: FACT, medio: 'TC' });
  // Pide algo más: la cuenta vuelve a abierta y se borra el pedido de cobro
  t.ok('order.create', { request_id: t.rid(), mesa_id: t.mesaId(4), punto_id: 'A_CAFE', items: [item('ESPRESSO', 1)] }, t.tk.mozo);
  let c = t.ok('public.cuenta', { token: tok }).cuenta;
  assert.equal(c.estado, 'ABIERTA'); assert.equal(c.pedido, null);
  assert.equal(c.comprobante.tipo, 'FACTURA', 'los datos de factura se conservan');
  // Lo vuelve a pedir; el mozo lo cancela
  t.ok('public.pedirCuenta', { token: tok, comprobante: FACT, medio: 'TC' });
  const cid = t.ok('sync', {}, t.tk.mozo).cuentas.find((x) => x.mesa_id === t.mesaId(4)).cuenta_id;
  t.ok('cuenta.cancelClose', { cuenta_id: cid }, t.tk.mozo);
  assert.equal(t.ok('public.cuenta', { token: tok }).cuenta.pedido, null);
  // Cobro en caja: después la mesa ya no tiene cuenta abierta
  t.ok('public.pedirCuenta', { token: tok, comprobante: FACT, medio: 'TC' });
  const total = t.ok('public.cuenta', { token: tok }).cuenta.total_gs;
  t.ok('caja.abrir', { caja_id: 'CAJA_A', monto_inicial_gs: 0 }, t.tk.cajaa);
  const cobro = t.ok('caja.cobrar', { request_id: t.rid(), cuenta_id: cid, pagos: [{ medio: 'TC', monto_gs: total }], comprobante: FACT }, t.tk.cajaa);
  assert.ok(cobro);
  assert.equal(t.ok('public.cuenta', { token: tok }).cuenta, null);
  t.bad('public.pedirCuenta', { token: tok, comprobante: FACT, medio: 'TC' }, null, 'SIN_CONSUMOS');
  assert.ok(o);
});

test('C03 el local puede apagarlo; la casita (para llevar) no pide cuenta', () => {
  const t = fresh();
  const casita = t.data.active.Puntos.find((p) => p.punto_id === 'B_TAKEAWAY').qr_token;
  t.bad('public.cuenta', { token: casita }, null, 'SOLO_MESA');
  assert.equal(t.ok('public.resolve', { token: casita }).cuenta_qr, false);
  t.ok('admin.config', { clave: 'cuenta_qr_habilitada', valor: 'NO' }, t.tk.admin);
  assert.equal(t.ok('public.resolve', { token: t.mesaTok(1) }).cuenta_qr, false);
  t.bad('public.cuenta', { token: t.mesaTok(1) }, null, 'CUENTA_QR_DESHABILITADA');
  t.bad('public.cuenta', { token: 'token-inexistente-123' }, null);
});
