'use strict';
/* Módulo Premium · Recompensas (tarjeta de sellos integrada a la caja).  node --test tests/recompensas.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp, buildFirebaseApp } = require('../server/dev-server.js');

const PIN = { admin: '246810', mozo: '1111', cajaa: '3333', cajab: '4444' };
const USUARIOS = [
  { usuario_id: 'mozo', nombre: 'Mozo Uno', rol: 'MOZO', pin: PIN.mozo },
  { usuario_id: 'cajaa', nombre: 'Cajera A', rol: 'CAJA', caja_id: 'CAJA_A', pin: PIN.cajaa },
  { usuario_id: 'cajab', nombre: 'Cajero B', rol: 'CAJA', caja_id: 'CAJA_B', pin: PIN.cajab }
];
const DIA = 86400000;

function fresh(modulos) {
  const b = buildApp(null, { secret: 'test-secret', adminPin: PIN.admin, mesas: 20, log: () => {}, usuarios: USUARIOS, modulos });
  let now = Date.parse('2026-10-05T14:00:00Z');
  b.env.setClock(() => now);
  const call = (action, payload, token) => b.app.handle({ action, payload: payload || {}, token });
  const ok = (action, payload, token) => { const r = call(action, payload, token); assert.equal(r.ok, true, action + ' falló: ' + JSON.stringify(r.error)); return r.data; };
  const bad = (action, payload, token, code) => { const r = call(action, payload, token); assert.equal(r.ok, false, action + ' debía fallar'); if (code) assert.equal(r.error.code, code, JSON.stringify(r.error)); return r; };
  const tk = {};
  const login = () => { for (const u of Object.keys(PIN)) tk[u] = ok('auth.login', { usuario: u, pin: PIN[u] }).token; };
  login();
  const data = b.store._data();
  let seq = 0;
  const rid = () => 'req-rec-' + (++seq) + '-' + Math.random().toString(36).slice(2);
  const nextDay = () => { now += DIA; login(); };
  const tkTok = () => data.active.Puntos.find((p) => p.punto_id === 'B_TAKEAWAY').qr_token;
  // Pedido de mesa (venta directa) y su cobro, con o sin tarjeta
  const pedido = (mesa, items) => ok('order.create', { request_id: rid(), mesa_id: mesa, venta_directa: true, items }, tk.mozo).pedido;
  const cobrar = (cuenta_id, monto, recompensa, extra) => ok('caja.cobrar', Object.assign({ request_id: rid(), cuenta_id, pagos: monto ? [{ medio: 'EFECTIVO', monto_gs: monto }] : [], recompensa }, extra || {}), tk.cajaa);
  return { b, call, ok, bad, tk, data, rid, nextDay, tkTok, pedido, cobrar, setNow: (ms) => { now = ms; login(); } };
}
const item = (producto_id, cantidad, opciones) => ({ producto_id, cantidad, opciones: opciones || [] });
const PREMIOS = [
  { tipo: 'SELLOS', sellos: 6, nombre: '1 Espresso gratis', producto_id: 'ESPRESSO', costo_gs: 4000 },
  { tipo: 'SELLOS', sellos: 10, nombre: '1 Panini gratis', producto_id: 'PANINI_CESAR', costo_gs: 15000 },
  { tipo: 'CUMPLE', nombre: 'Postre de cumpleaños', valor_gs: 15000, costo_gs: 6000 }
];
function conPrograma(t) {
  t.ok('rec.config', { premios: PREMIOS, config: { rec_activo: 'SI', rec_nombre: 'Club Andrade', rec_minimo_gs: '20000' } }, t.tk.admin);
  t.ok('caja.abrir', { caja_id: 'CAJA_A', monto_inicial_gs: 0 }, t.tk.cajaa);
}

test('R01 sin licencia el módulo no existe para el local', () => {
  const t = fresh();
  assert.deepEqual(t.ok('rec.admin', {}, t.tk.admin), { licencia: false });
  t.bad('rec.config', { config: { rec_activo: 'SI' } }, t.tk.admin, 'MODULO_NO_ACTIVO');
  t.bad('rec.buscar', { q: '0981123456' }, t.tk.cajaa, 'MODULO_NO_ACTIVO');
  t.bad('public.recInfo', {}, null, 'NO_DISPONIBLE');
  t.bad('public.recJoin', { nombre: 'Ana', celular: '0981123456', acepta: true }, null, 'NO_DISPONIBLE');
  assert.equal(t.ok('public.resolve', { token: t.tkTok() }).recompensas, undefined);
  assert.equal(t.ok('sync', {}, t.tk.cajaa).recompensas, null);
  // Un cobro normal no cambia
  t.ok('caja.abrir', { caja_id: 'CAJA_A', monto_inicial_gs: 0 }, t.tk.cajaa);
  const p = t.pedido('M01', [item('ESPRESSO', 2)]);
  const r = t.cobrar(p.cuenta_id, 24000);
  assert.equal(r.recompensa, undefined); assert.equal(r.cobro.recompensa, null);
});

test('R02 activar exige premios; la configuración se valida', () => {
  const t = fresh('RECOMPENSAS');
  assert.equal(t.ok('rec.admin', {}, t.tk.admin).licencia, true);
  t.bad('rec.config', { config: { rec_activo: 'SI' } }, t.tk.admin, 'SIN_PREMIOS');
  t.bad('rec.config', { premios: [{ sellos: 6, nombre: 'Algo' }] }, t.tk.admin, 'VALOR_INVALIDO');           // sin producto ni valor
  t.bad('rec.config', { premios: [{ sellos: 6, nombre: 'Café', producto_id: 'NO_EXISTE' }] }, t.tk.admin, 'PRODUCTO_INVALIDO');
  t.bad('rec.config', { premios: [PREMIOS[0], PREMIOS[0]] }, t.tk.admin, 'VALOR_INVALIDO');                  // dos premios con 6 sellos
  t.bad('rec.config', { config: { rec_minimo_gs: 'mil' } }, t.tk.admin, 'VALOR_INVALIDO');
  t.bad('rec.config', { config: { rec_activo: 'SI' } }, t.tk.cajaa, 'SIN_PERMISO');
  const r = t.ok('rec.config', { premios: PREMIOS, config: { rec_activo: 'SI', rec_nombre: 'Club Andrade' } }, t.tk.admin);
  assert.equal(r.programa.meta, 10);
  assert.deepEqual(r.programa.premios.map((x) => x.sellos), [6, 10]);
  assert.equal(r.programa.cumple, 'Postre de cumpleaños');
  // Reenviar la lista sin un premio lo desactiva (no lo borra)
  const adm = t.ok('rec.admin', {}, t.tk.admin);
  const sinPanini = adm.premios.filter((x) => x.sellos !== 10).map((x) => ({ premio_id: x.premio_id, tipo: x.tipo, sellos: x.sellos, nombre: x.nombre, producto_id: x.producto_id, valor_gs: x.valor_gs, costo_gs: x.costo_gs }));
  assert.equal(t.ok('rec.config', { premios: sinPanini }, t.tk.admin).programa.meta, 6);
  assert.equal(t.data.active.RecPremios.length, 3);
  const res = t.ok('public.resolve', { token: t.tkTok() });
  assert.equal(res.recompensas.nombre, 'Club Andrade');
});

test('R03 alta pública: valida, no duplica y protege la tarjeta ajena', () => {
  const t = fresh('RECOMPENSAS'); conPrograma(t);
  t.bad('public.recJoin', { nombre: 'Ana', celular: '0981123456' }, null, 'ACEPTA_REQUERIDO');
  t.bad('public.recJoin', { nombre: 'Ana', celular: '123', acepta: true }, null, 'CELULAR_INVALIDO');
  t.bad('public.recJoin', { nombre: 'Ana', celular: '0981123456', cumple: '31/13', acepta: true }, null, 'CUMPLE_INVALIDO');
  const a = t.ok('public.recJoin', { nombre: 'Ana López', celular: '0981 123-456', cumple: '15/10', acepta: true });
  assert.equal(a.existente, false); assert.equal(a.tarjeta.sellos, 0); assert.equal(a.tarjeta.meta, 10);
  assert.equal(a.tarjeta.celular, '0981 *** 456'); assert.ok(a.tarjeta.token.length === 20); assert.match(a.tarjeta.codigo, /^[A-Z0-9]{6}$/);
  assert.equal(t.data.active.RecClientes[0].celular, '595981123456');
  assert.equal(t.data.active.RecClientes[0].cumple, '10-15');
  // Mismo número y mismo nombre: recupera la tarjeta. Otro nombre: no la muestra.
  assert.equal(t.ok('public.recJoin', { nombre: 'ana', celular: '+595 981 123456', acepta: true }).tarjeta.token, a.tarjeta.token);
  t.bad('public.recJoin', { nombre: 'Pedro', celular: '0981123456', acepta: true }, null, 'YA_REGISTRADO');
  const info = t.ok('public.recInfo', { token: a.tarjeta.token });
  assert.equal(info.tarjeta.nombre, 'Ana López'); assert.equal(info.programa.premios.length, 2);
  t.bad('public.recInfo', { token: 'x'.repeat(20) }, null, 'TARJETA_INVALIDA');
  assert.ok(!JSON.stringify(info).includes('595981123456'), 'no expone el celular completo');
});

test('R04 sellos al cobrar: mínimo, uno por día, premio al llegar al umbral y canje en caja', () => {
  const t = fresh('RECOMPENSAS'); conPrograma(t);
  const cli = t.ok('rec.registrar', { nombre: 'Beto', celular: '0971555444' }, t.tk.cajaa).cliente;
  // La caja lo encuentra por celular o por código
  assert.equal(t.ok('rec.buscar', { q: '0971 555 444' }, t.tk.cajaa).cliente.cliente_id, cli.cliente_id);
  assert.equal(t.ok('rec.buscar', { q: cli.codigo.toLowerCase() }, t.tk.cajaa).cliente.cliente_id, cli.cliente_id);
  assert.equal(t.ok('rec.buscar', { q: '0999000000' }, t.tk.cajaa).encontrado, false);
  // Día 1: 24.000 → sello
  let p = t.pedido('M01', [item('ESPRESSO', 2)]);
  let r = t.cobrar(p.cuenta_id, 24000, { cliente_id: cli.cliente_id, sello: true });
  assert.equal(r.recompensa.sello, true); assert.equal(r.recompensa.sellos, 1); assert.equal(r.cobro.recompensa.nombre, 'Beto');
  // Mismo día: no suma otro
  p = t.pedido('M02', [item('ESPRESSO', 2)]);
  r = t.cobrar(p.cuenta_id, 24000, { cliente_id: cli.cliente_id, sello: true });
  assert.equal(r.recompensa.sello, false); assert.match(r.recompensa.motivo, /hoy/);
  // Otro día, debajo del mínimo: no suma
  t.nextDay();
  p = t.pedido('M03', [item('ESPRESSO', 1)]);
  r = t.cobrar(p.cuenta_id, 12000, { cliente_id: cli.cliente_id, sello: true });
  assert.equal(r.recompensa.sello, false); assert.match(r.recompensa.motivo, /mínima/);
  // Llegar a 6 sellos → premio "1 Espresso gratis"
  let ultimo;
  for (let i = 0; i < 5; i++) {
    if (i) t.nextDay();
    p = t.pedido('M04', [item('ESPRESSO', 2)]);
    ultimo = t.cobrar(p.cuenta_id, 24000, { cliente_id: cli.cliente_id });
  }
  assert.equal(ultimo.recompensa.sellos, 6);
  assert.equal(ultimo.recompensa.cupones_nuevos.length, 1); assert.equal(ultimo.recompensa.cupones_nuevos[0].nombre, '1 Espresso gratis');
  const busc = t.ok('rec.buscar', { q: cli.codigo }, t.tk.cajaa).cliente;
  assert.equal(busc.cupones.length, 1); assert.equal(busc.sello_hoy, true);
  const cup = busc.cupones[0].cupon_id;
  // Canje sin el producto en la cuenta: rechazado
  t.nextDay();
  p = t.pedido('M05', [item('PANINI_CESAR', 1, ['PAN_LAC'])]);
  t.bad('caja.cobrar', { request_id: t.rid(), cuenta_id: p.cuenta_id, pagos: [{ medio: 'EFECTIVO', monto_gs: 35000 }], recompensa: { cliente_id: cli.cliente_id, cupones: [cup] } }, t.tk.cajaa, 'PREMIO_SIN_PRODUCTO');
  // Con el producto: descuenta su precio, sin pedir autorización
  t.ok('order.create', { request_id: t.rid(), cuenta_id: p.cuenta_id, mesa_id: 'M05', venta_directa: true, items: [item('ESPRESSO', 1)] }, t.tk.mozo);
  t.bad('caja.cobrar', { request_id: t.rid(), cuenta_id: p.cuenta_id, pagos: [{ medio: 'EFECTIVO', monto_gs: 47000 }], recompensa: { cliente_id: cli.cliente_id, cupones: [cup] } }, t.tk.cajaa, 'MONTO_NO_COINCIDE');
  r = t.cobrar(p.cuenta_id, 35000, { cliente_id: cli.cliente_id, cupones: [cup] });
  assert.equal(r.cobro.descuento_gs, 12000); assert.equal(r.cobro.total_gs, 35000); assert.equal(r.cobro.autorizado_por, '');
  assert.deepEqual(r.recompensa.cupones_canjeados, [cup]); assert.equal(r.recompensa.sellos, 7);
  assert.equal(t.data.active.RecCupones.find((c) => c.cupon_id === cup).estado, 'CANJEADO');
  // Un premio usado no se vuelve a canjear
  t.nextDay();
  p = t.pedido('M06', [item('ESPRESSO', 2)]);
  t.bad('caja.cobrar', { request_id: t.rid(), cuenta_id: p.cuenta_id, pagos: [{ medio: 'EFECTIVO', monto_gs: 12000 }], recompensa: { cliente_id: cli.cliente_id, cupones: [cup] } }, t.tk.cajaa, 'CUPON_INVALIDO');
});

test('R05 completar la tarjeta: segundo premio, vuelve a 0; reverso deshace sello y canje', () => {
  const t = fresh('RECOMPENSAS'); conPrograma(t);
  const cli = t.ok('rec.registrar', { nombre: 'Caro', celular: '0982111222' }, t.tk.cajaa).cliente;
  let r;
  for (let i = 0; i < 10; i++) {
    if (i) t.nextDay();
    const p = t.pedido('M07', [item('ESPRESSO', 2)]);
    r = t.cobrar(p.cuenta_id, 24000, { cliente_id: cli.cliente_id });
  }
  assert.equal(r.recompensa.sellos, 10); assert.equal(r.recompensa.ciclo_completo, true);
  const c = t.data.active.RecClientes[0];
  assert.equal(c.sellos, 0); assert.equal(c.ciclos, 1); assert.equal(c.visitas, 10);
  assert.equal(t.data.active.RecCupones.filter((x) => x.estado === 'DISPONIBLE').length, 2);
  // Revertir el cobro que completó la tarjeta: vuelve a 9 y el premio de 10 se anula
  t.ok('caja.revertir', { cobro_id: r.cobro.cobro_id, motivo: 'error de carga', autorizacion: { usuario: 'admin', pin: PIN.admin } }, t.tk.cajaa);
  const c2 = t.data.active.RecClientes[0];
  assert.equal(c2.sellos, 9); assert.equal(c2.ciclos, 0); assert.equal(c2.visitas, 9); assert.equal(c2.ultimo_sello_dia, '');
  const panini = t.data.active.RecCupones.find((x) => x.nombre === '1 Panini gratis');
  assert.equal(panini.estado, 'ANULADO');
  // Premio que cubre todo el cobro: total 0, sin pagos
  t.nextDay();
  const esp = t.data.active.RecCupones.find((x) => x.nombre === '1 Espresso gratis').cupon_id;
  const p = t.pedido('M08', [item('ESPRESSO', 1)]);
  const r0 = t.cobrar(p.cuenta_id, 0, { cliente_id: cli.cliente_id, cupones: [esp], sello: true });
  assert.equal(r0.cobro.total_gs, 0); assert.equal(r0.recompensa.sello, false);
  assert.equal(t.data.active.Cuentas.find((x) => x.cuenta_id === p.cuenta_id).pago_estado, 'COBRADO');
  // Revertir ese cobro devuelve el premio
  t.ok('caja.revertir', { cobro_id: r0.cobro.cobro_id, motivo: 'cliente se arrepintió', autorizacion: { usuario: 'admin', pin: PIN.admin } }, t.tk.cajaa);
  assert.equal(t.data.active.RecCupones.find((x) => x.cupon_id === esp).estado, 'DISPONIBLE');
});

test('R06 pedido por QR con celular: queda vinculado y suma solo al cobrar', () => {
  const t = fresh('RECOMPENSAS'); conPrograma(t);
  t.ok('caja.abrir', { caja_id: 'CAJA_B', monto_inicial_gs: 0 }, t.tk.cajab);
  const o = t.ok('public.order', { token: t.tkTok(), request_id: t.rid(), alias: 'Dani', items: [item('ESPRESSO', 2)], rec_celular: '0983444555', rec_unirse: true });
  assert.equal(o.recompensa.nombre, 'Dani'); assert.equal(o.recompensa.sellos, 0); assert.ok(o.recompensa.token);
  const cta = t.ok('sync', {}, t.tk.cajab).cuentas[0];
  assert.equal(cta.cliente.nombre, 'Dani');
  // Sin "unirse" y sin tarjeta: no se crea nada
  const o2 = t.ok('public.order', { token: t.tkTok(), request_id: t.rid(), alias: 'Eva', items: [item('ESPRESSO', 2)], rec_celular: '0983000111' });
  assert.equal(o2.recompensa, null); assert.equal(t.data.active.RecClientes.length, 1);
  // El cobro no indica tarjeta: se usa la vinculada
  const r = t.ok('caja.cobrar', { request_id: t.rid(), cuenta_id: cta.cuenta_id, pagos: [{ medio: 'EFECTIVO', monto_gs: 24000 }] }, t.tk.cajab);
  assert.equal(r.recompensa.sello, true); assert.equal(r.recompensa.sellos, 1);
  // El mozo puede vincular y desvincular una cuenta
  const p = t.pedido('M09', [item('ESPRESSO', 2)]);
  t.ok('rec.vincular', { cuenta_id: p.cuenta_id, cliente_id: t.data.active.RecClientes[0].cliente_id }, t.tk.mozo);
  t.ok('rec.vincular', { cuenta_id: p.cuenta_id, cliente_id: '' }, t.tk.mozo);
  assert.equal(t.data.active.Cuentas.find((x) => x.cuenta_id === p.cuenta_id).cliente_id, '');
});

test('R07 cumpleaños, panel y ajustes del encargado', () => {
  const t = fresh('RECOMPENSAS'); conPrograma(t);
  t.setNow(Date.parse('2026-10-12T15:00:00Z'));
  const cli = t.ok('rec.registrar', { nombre: 'Fede', celular: '0984777888', cumple: '15/10' }, t.tk.cajaa).cliente;
  const b1 = t.ok('rec.buscar', { q: '0984777888' }, t.tk.cajaa);
  assert.equal(b1.cumple_nuevo, true); assert.equal(b1.cliente.cupones[0].nombre, 'Postre de cumpleaños');
  assert.equal(t.ok('rec.buscar', { q: '0984777888' }, t.tk.cajaa).cumple_nuevo, false); // una vez por año
  // Premio con valor fijo (sin producto): descuenta el valor
  const p = t.pedido('M10', [item('PANINI_CESAR', 1, ['PAN_LAC'])]);
  const r = t.cobrar(p.cuenta_id, 20000, { cliente_id: cli.cliente_id, cupones: [b1.cliente.cupones[0].cupon_id] });
  assert.equal(r.cobro.descuento_gs, 15000); assert.equal(r.recompensa.sello, true);
  const adm = t.ok('rec.admin', {}, t.tk.admin);
  assert.equal(adm.stats.clientes, 1); assert.equal(adm.stats.cupones_canjeados, 1); assert.equal(adm.stats.costo_premios_gs, 6000);
  assert.equal(adm.stats.ventas_club_30d_gs, 20000); assert.equal(adm.cumples_mes.length, 1);
  assert.equal(adm.clientes[0].celular, '0984777888');
  // Ajuste manual con motivo, auditado; no supera la meta
  t.bad('rec.cliente', { cliente_id: cli.cliente_id, ajuste_sellos: 3 }, t.tk.admin, 'MOTIVO_REQUERIDO');
  const aj = t.ok('rec.cliente', { cliente_id: cli.cliente_id, ajuste_sellos: 30, motivo: 'migración de tarjeta de papel' }, t.tk.admin);
  assert.equal(aj.cliente.sellos, 9);
  t.bad('rec.cliente', { cliente_id: cli.cliente_id, ajuste_sellos: 1, motivo: 'x' }, t.tk.cajaa, 'SIN_PERMISO');
  // Nueva tarjeta (por pérdida del celular): cambian token y código
  const det0 = t.ok('rec.clienteDetalle', { cliente_id: cli.cliente_id }, t.tk.admin);
  t.ok('rec.cliente', { cliente_id: cli.cliente_id, nuevo_token: true }, t.tk.admin);
  const det1 = t.ok('rec.clienteDetalle', { cliente_id: cli.cliente_id }, t.tk.admin);
  assert.notEqual(det0.cliente.token, det1.cliente.token);
  assert.ok(det1.movimientos.some((m) => m.tipo === 'AJUSTE'));
  // Programa pausado: la caja ya no opera tarjetas
  t.ok('rec.config', { config: { rec_activo: 'NO' } }, t.tk.admin);
  t.bad('rec.buscar', { q: cli.codigo }, t.tk.cajaa, 'REC_INACTIVO');
  assert.equal(t.ok('sync', {}, t.tk.cajaa).recompensas, null);
});

test('R08 funciona igual sobre el backend Firebase', async () => {
  const f = await buildFirebaseApp({ adminPin: PIN.admin, log: () => {}, usuarios: USUARIOS, modulos: 'RECOMPENSAS', latency: 0 });
  const call = async (action, payload, token) => f.app.handle({ action, payload: payload || {}, token });
  const ok = async (a, p, t) => { const r = await call(a, p, t); assert.equal(r.ok, true, a + ': ' + JSON.stringify(r.error)); return r.data; };
  const adm = (await ok('auth.login', { usuario: 'admin', pin: PIN.admin })).token;
  const caja = (await ok('auth.login', { usuario: 'cajaa', pin: PIN.cajaa })).token;
  const mozo = (await ok('auth.login', { usuario: 'mozo', pin: PIN.mozo })).token;
  await ok('rec.config', { premios: PREMIOS, config: { rec_activo: 'SI' } }, adm);
  await ok('caja.abrir', { caja_id: 'CAJA_A', monto_inicial_gs: 0 }, caja);
  const j = await ok('public.recJoin', { nombre: 'Gabi', celular: '0985123123', acepta: true });
  const p = (await ok('order.create', { request_id: 'fb-rec-1-xxxxxxxx', mesa_id: 'M01', venta_directa: true, items: [item('ESPRESSO', 2)] }, mozo)).pedido;
  const r = await ok('caja.cobrar', { request_id: 'fb-rec-2-xxxxxxxx', cuenta_id: p.cuenta_id, pagos: [{ medio: 'EFECTIVO', monto_gs: 24000 }], recompensa: { cliente_id: j.tarjeta.cliente_id } }, caja);
  assert.equal(r.recompensa.sellos, 1);
  const info = await ok('public.recInfo', { token: j.tarjeta.token });
  assert.equal(info.tarjeta.sellos, 1); assert.equal(info.historial[0].tipo, 'SELLO');
});
