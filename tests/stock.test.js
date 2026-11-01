'use strict';
/* Upgrade "Stock y costos": insumos, compras con costo promedio, recetas, descuento con cada venta, conteos,
   mermas, margen por plato y reporte.  node --test tests/stock.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { buildApp } = require('../server/dev-server.js');

const PIN = { admin: '246810', mozo: '1111', cocina: '2222', cajaa: '3333' };
const USUARIOS = [
  { usuario_id: 'mozo', nombre: 'Mozo Uno', rol: 'MOZO', pin: PIN.mozo },
  { usuario_id: 'cocina', nombre: 'Cocina', rol: 'COCINA', pin: PIN.cocina },
  { usuario_id: 'cajaa', nombre: 'Cajera A', rol: 'CAJA', caja_id: 'CAJA_A', pin: PIN.cajaa }
];
function fresh(modulos, extra) {
  const b = buildApp(null, Object.assign({ secret: 'test-secret', adminPin: PIN.admin, mesas: 20, log: () => {}, usuarios: USUARIOS, plan: '', modulos: modulos === undefined ? 'STOCK' : modulos }, extra || {}));
  const call = (action, payload, token) => b.app.handle({ action, payload: payload || {}, token });
  const ok = (a, p, t) => { const r = call(a, p, t); assert.equal(r.ok, true, a + ' falló: ' + JSON.stringify(r.error)); return r.data; };
  const bad = (a, p, t, code) => { const r = call(a, p, t); assert.equal(r.ok, false, a + ' debía fallar'); if (code) assert.equal(r.error.code, code, JSON.stringify(r.error)); return r; };
  const tk = {}; for (const u of Object.keys(PIN)) tk[u] = ok('auth.login', { usuario: u, pin: PIN[u] }).token;
  const data = b.store._data();
  let seq = 0; const rid = () => 'req-st-' + (++seq) + '-' + Math.random().toString(36).slice(2);
  const pedir = (mesa, items) => ok('order.create', { request_id: rid(), mesa_id: 'M' + String(mesa).padStart(2, '0'), items }, tk.mozo).pedido;
  const ins = (id) => ok('stock.data', {}, tk.admin).insumos.find((i) => i.insumo_id === id);
  const insumo = (nombre, unidad, minimo) => ok('stock.insumo', { insumo: { nombre, unidad, minimo: minimo || 0 } }, tk.admin).insumo.insumo_id;
  const movs = (tipo) => data.active.MovStock.filter((m) => !tipo || m.tipo === tipo);
  return { b, call, ok, bad, tk, data, rid, pedir, ins, insumo, movs };
}
const item = (producto_id, cantidad, opciones) => ({ producto_id, cantidad: cantidad || 1, opciones: opciones || [] });

// Café: 2 compras de 1 kg (Gs. 120.000 y 140.000) → costo promedio Gs. 130.000 por kg. Espresso: 9 g de café.
function cafeteria(t) {
  const cafe = t.insumo('Café en grano', 'G', 500), leche = t.insumo('Leche entera', 'ML', 2000), syrup = t.insumo('Syrup vainilla', 'ML');
  t.ok('stock.compra', { request_id: t.rid(), proveedor: 'Tostadora Sur', items: [{ insumo_id: cafe, cantidad: 1000, costo_total_gs: 120000 }, { insumo_id: leche, cantidad: 10000, costo_total_gs: 85000 }] }, t.tk.admin);
  t.ok('stock.compra', { request_id: t.rid(), proveedor: 'Tostadora Sur', items: [{ insumo_id: cafe, cantidad: 1000, costo_total_gs: 140000 }, { insumo_id: syrup, cantidad: 750, costo_total_gs: 60000 }] }, t.tk.admin);
  t.ok('stock.receta', { producto_id: 'ESPRESSO', lineas: [{ insumo_id: cafe, cantidad: 9 }] }, t.tk.admin);
  t.ok('stock.receta', { producto_id: 'LATTE', lineas: [{ insumo_id: cafe, cantidad: 9 }, { insumo_id: leche, cantidad: 200 }] }, t.tk.admin);
  t.ok('stock.receta', { producto_id: 'LATTE', opcion_id: 'SY_VAI', lineas: [{ insumo_id: syrup, cantidad: 15 }] }, t.tk.admin);
  return { cafe, leche, syrup };
}

test('S01 sin el Upgrade: no hay stock, las ventas no tocan nada y el plan no cambia', () => {
  const t = fresh('');
  t.bad('stock.data', {}, t.tk.admin, 'MODULO_NO_ACTIVO');
  t.bad('stock.insumo', { insumo: { nombre: 'Café', unidad: 'G' } }, t.tk.admin, 'MODULO_NO_ACTIVO');
  t.pedir(1, [item('ESPRESSO')]);
  assert.equal(t.movs().length, 0);
  assert.equal(t.ok('admin.report', {}, t.tk.admin).stock, null);
  const u = fresh('STOCK');
  assert.equal(u.ok('health').plan, 'BASICO', 'un Upgrade no cambia el nombre del plan');
  assert.ok(u.ok('sync', {}, u.tk.mozo).plan.modulos.includes('STOCK'));
});

test('S02 compras con costo promedio ponderado, en guaraníes enteros', () => {
  const t = fresh();
  const { cafe, leche } = cafeteria(t);
  const c = t.ins(cafe);
  assert.equal(c.stock, 2000); assert.equal(c.costo_mil_gs, 130000); assert.equal(c.valor_gs, 260000); assert.equal(c.unidad, 'G');
  assert.equal(t.ins(leche).costo_mil_gs, 8500);
  // Costo y margen por plato (receta base) y lo que suma la opción
  const d = t.ok('stock.data', {}, t.tk.admin);
  const esp = d.costos.find((x) => x.producto_id === 'ESPRESSO');
  assert.equal(esp.costo_gs, 1170); assert.equal(esp.margen_gs, 12000 - 1170); assert.equal(esp.margen_pct, 90);
  const lat = d.costos.find((x) => x.producto_id === 'LATTE');
  assert.equal(lat.costo_gs, 1170 + 1700); assert.deepEqual(lat.opciones.map((o) => [o.opcion_id, o.costo_gs]), [['SY_VAI', 1200]]);
  assert.equal(d.costos.find((x) => x.producto_id === 'MIXTO').tiene_receta, false);
  assert.equal(d.valor_total_gs, 260000 + 85000 + 60000);
  // Reintento de la misma compra: no duplica
  const rq = t.rid();
  t.ok('stock.compra', { request_id: rq, items: [{ insumo_id: leche, cantidad: 1000, costo_total_gs: 9000 }] }, t.tk.admin);
  assert.equal(t.ok('stock.compra', { request_id: rq, items: [{ insumo_id: leche, cantidad: 1000, costo_total_gs: 9000 }] }, t.tk.admin).duplicado, true);
  assert.equal(t.ins(leche).stock, 11000);
});

test('S03 cada venta descuenta su receta (y la de las opciones) y guarda el costo de la línea', () => {
  const t = fresh();
  const { cafe, leche, syrup } = cafeteria(t);
  const p = t.pedir(2, [item('ESPRESSO', 2), item('LATTE', 1, ['SY_VAI']), item('MIXTO')]);
  assert.equal(t.ins(cafe).stock, 2000 - 27);
  assert.equal(t.ins(leche).stock, 10000 - 200);
  assert.equal(t.ins(syrup).stock, 750 - 15);
  const its = t.data.active.PedidoItems.filter((i) => i.pedido_id === p.pedido_id);
  assert.equal(its.find((i) => i.producto_id === 'ESPRESSO').costo_gs, 2340);
  assert.equal(its.find((i) => i.producto_id === 'LATTE').costo_gs, 1170 + 1700 + 1200);
  assert.equal(its.find((i) => i.producto_id === 'MIXTO').stock_ok, 'SR', 'sin receta: se vende igual, margen desconocido');
  assert.deepEqual(t.movs('VENTA').map((m) => [m.insumo_id, m.cantidad]).sort(), [[cafe, -27], [leche, -200], [syrup, -15]].sort(), 'un movimiento por insumo y pedido');
  assert.deepEqual(JSON.parse(its.find((i) => i.producto_id === 'LATTE').consumo), { [cafe]: [9, 1170], [leche]: [200, 1700], [syrup]: [15, 1200] });
  // El costo no se muestra al personal
  assert.equal(p.items[0].costo_gs, undefined);
  // Una compra más cara después no cambia el costo de lo ya vendido
  t.ok('stock.compra', { request_id: t.rid(), items: [{ insumo_id: cafe, cantidad: 1000, costo_total_gs: 400000 }] }, t.tk.admin);
  assert.equal(t.data.active.PedidoItems.find((i) => i.pedido_id === p.pedido_id && i.producto_id === 'ESPRESSO').costo_gs, 2340);
});

test('S04 QR: el stock sale recién cuando se acepta; cancelar antes de empezar lo devuelve, después ya se consumió', () => {
  const t = fresh();
  const { cafe } = cafeteria(t);
  const mesa = t.data.active.Mesas.find((m) => m.numero === 5);
  const q = t.ok('public.order', { request_id: t.rid(), token: mesa.qr_token, items: [item('ESPRESSO', 3)] });
  const qp = t.data.active.Pedidos.find((x) => x.numero === q.numero);
  assert.equal(t.ins(cafe).stock, 2000, 'pendiente: todavía no sale');
  t.ok('order.state', { pedido_id: qp.pedido_id, estado: 'ACEPTADO' }, t.tk.mozo);
  assert.equal(t.ins(cafe).stock, 2000 - 27);
  t.ok('order.state', { pedido_id: qp.pedido_id, estado: 'ACEPTADO' }, t.tk.mozo); // sin cambios: no descuenta dos veces
  assert.equal(t.ins(cafe).stock, 2000 - 27);
  t.ok('order.cancel', { pedido_id: qp.pedido_id, motivo: 'Se fueron' }, t.tk.admin);
  assert.equal(t.ins(cafe).stock, 2000, 'cancelado antes de empezar: vuelve');
  assert.equal(t.movs('DEVOLUCION').length, 1);
  // Pedido que la cocina ya empezó: al cancelar no vuelve (consumo sin venta)
  const p = t.pedir(6, [item('ESPRESSO', 2)]);
  t.ok('order.state', { pedido_id: p.pedido_id, estado: 'EN_PREPARACION' }, t.tk.cocina);
  t.ok('order.cancel', { pedido_id: p.pedido_id, motivo: 'Lo pidieron por error' }, t.tk.admin);
  assert.equal(t.ins(cafe).stock, 2000 - 18);
  // Anular una línea de un pedido sin empezar: vuelve
  const p2 = t.pedir(7, [item('ESPRESSO'), item('ESPRESSO', 2)]);
  t.ok('order.voidItem', { item_id: p2.items[1].item_id, motivo: 'Cambió de idea' }, t.tk.admin);
  assert.equal(t.ins(cafe).stock, 2000 - 18 - 9);
  const rep = t.ok('admin.report', {}, t.tk.admin).stock;
  assert.equal(rep.consumo_sin_venta_gs, 2340);
});

test('S05 conteo: compara lo contado con lo que debería haber y valoriza la diferencia', () => {
  const t = fresh();
  const { cafe, leche } = cafeteria(t);
  t.pedir(8, [item('ESPRESSO', 10)]); // 90 g
  const rq = t.rid();
  const r = t.ok('stock.conteo', { request_id: rq, nota: 'Cierre semanal', items: [{ insumo_id: cafe, contado: 1850 }, { insumo_id: leche, contado: 10000 }] }, t.tk.admin);
  const dc = r.detalle.find((x) => x.insumo_id === cafe);
  assert.equal(dc.esperado, 1910); assert.equal(dc.contado, 1850); assert.equal(dc.diferencia, -60); assert.equal(dc.valor_gs, -7800);
  assert.equal(r.detalle.find((x) => x.insumo_id === leche).diferencia, 0);
  assert.equal(r.diferencia_gs, -7800);
  assert.equal(t.ins(cafe).stock, 1850);
  assert.equal(t.ok('stock.conteo', { request_id: rq, items: [{ insumo_id: cafe, contado: 1 }] }, t.tk.admin).duplicado, true);
  assert.equal(t.ins(cafe).stock, 1850);
  assert.equal(t.movs('CONTEO').length, 1, 'sin diferencia no se registra movimiento');
  t.bad('stock.conteo', { request_id: t.rid(), items: [{ insumo_id: cafe, contado: 10 }, { insumo_id: cafe, contado: 12 }] }, t.tk.admin, 'INSUMO_REPETIDO');
  t.bad('stock.conteo', { request_id: t.rid(), items: [{ insumo_id: cafe, contado: 1.5 }] }, t.tk.admin, 'CANTIDAD_INVALIDA');
  t.bad('stock.conteo', { request_id: t.rid(), items: [{ insumo_id: cafe, contado: -1 }] }, t.tk.admin, 'CANTIDAD_INVALIDA');
});

test('S06 mermas, insumos bajo el mínimo ("qué comprar") y validaciones', () => {
  const t = fresh();
  const { cafe, leche } = cafeteria(t);
  t.bad('stock.merma', { request_id: t.rid(), insumo_id: leche, cantidad: 1000 }, t.tk.admin, 'MOTIVO_REQUERIDO');
  const m = t.ok('stock.merma', { request_id: t.rid(), insumo_id: leche, cantidad: 8500, motivo: 'Se cortó la leche' }, t.tk.admin);
  assert.equal(m.costo_gs, 72250); assert.equal(m.insumo.stock, 1500); assert.equal(m.insumo.bajo_minimo, true);
  const d = t.ok('stock.data', {}, t.tk.admin);
  assert.deepEqual(d.para_comprar.map((i) => i.insumo_id), [leche]);
  assert.equal(t.ok('admin.report', {}, t.tk.admin).stock.mermas_gs, 72250);
  // Validaciones
  t.bad('stock.insumo', { insumo: { nombre: 'Azúcar', unidad: 'KG' } }, t.tk.admin, 'UNIDAD_INVALIDA');
  t.bad('stock.insumo', { insumo: { nombre: 'A', unidad: 'G' } }, t.tk.admin, 'NOMBRE_INVALIDO');
  t.bad('stock.insumo', { insumo: { insumo_id: cafe, nombre: 'Café', unidad: 'UN' } }, t.tk.admin, 'UNIDAD_FIJA');
  t.bad('stock.compra', { request_id: t.rid(), items: [{ insumo_id: cafe, cantidad: 0, costo_total_gs: 1000 }] }, t.tk.admin, 'CANTIDAD_INVALIDA');
  t.bad('stock.compra', { request_id: t.rid(), items: [{ insumo_id: cafe, cantidad: 100, costo_total_gs: 10.5 }] }, t.tk.admin, 'MONTO_INVALIDO');
  t.bad('stock.compra', { request_id: t.rid(), items: [{ insumo_id: 'I_NADA', cantidad: 100, costo_total_gs: 100 }] }, t.tk.admin, 'INSUMO_INEXISTENTE');
  t.bad('stock.receta', { producto_id: 'ESPRESSO', lineas: [{ insumo_id: cafe, cantidad: 9 }, { insumo_id: cafe, cantidad: 2 }] }, t.tk.admin, 'INSUMO_REPETIDO');
  t.bad('stock.receta', { producto_id: 'ESPRESSO', lineas: [{ insumo_id: cafe, cantidad: 0.5 }] }, t.tk.admin, 'CANTIDAD_INVALIDA');
  t.bad('stock.receta', { producto_id: 'MIXTO', opcion_id: 'SY_VAI', lineas: [] }, t.tk.admin, 'OPCION_INVALIDA');
  // Mismo nombre: queda otro código, no pisa
  const otro = t.insumo('Café en grano', 'G');
  assert.notEqual(otro, cafe);
  // Permisos: solo el encargado
  for (const u of ['mozo', 'cocina', 'cajaa']) t.bad('stock.data', {}, t.tk[u], 'SIN_PERMISO');
  t.bad('stock.merma', { request_id: t.rid(), insumo_id: cafe, cantidad: 1, motivo: 'x x x' }, t.tk.cocina, 'SIN_PERMISO');
});

test('S07 vender sin stock cargado no frena la venta; la compra siguiente fija el costo', () => {
  const t = fresh();
  const pan = t.insumo('Pan de miga', 'UN');
  t.ok('stock.receta', { producto_id: 'MIXTO', lineas: [{ insumo_id: pan, cantidad: 2 }] }, t.tk.admin);
  t.pedir(9, [item('MIXTO', 3)]);
  assert.equal(t.ins(pan).stock, -6);
  t.ok('stock.compra', { request_id: t.rid(), items: [{ insumo_id: pan, cantidad: 40, costo_total_gs: 60000 }] }, t.tk.admin);
  const p = t.ins(pan);
  assert.equal(p.stock, 34); assert.equal(p.costo_mil_gs, 1500000, 'Gs. 1.500 por unidad'); assert.equal(p.valor_gs, 51000);
});

test('S08 editar una receta: lo quitado deja de descontarse y no se pierde el historial', () => {
  const t = fresh();
  const { cafe, leche } = cafeteria(t);
  t.ok('stock.receta', { producto_id: 'LATTE', lineas: [{ insumo_id: leche, cantidad: 250 }] }, t.tk.admin);
  const d = t.ok('stock.data', {}, t.tk.admin);
  assert.deepEqual(d.recetas.LATTE.filter((l) => !l.opcion_id).map((l) => [l.insumo_id, l.cantidad]), [[leche, 250]]);
  t.pedir(10, [item('LATTE')]);
  assert.equal(t.ins(cafe).stock, 2000); assert.equal(t.ins(leche).stock, 10000 - 250);
  t.ok('stock.receta', { producto_id: 'LATTE', lineas: [{ insumo_id: leche, cantidad: 200 }, { insumo_id: cafe, cantidad: 9 }] }, t.tk.admin);
  assert.equal(t.data.active.Recetas.filter((r) => r.producto_id === 'LATTE' && !r.opcion_id).length, 2, 'las filas se reutilizan');
});

test('S09 reporte: costo de ventas, ganancia bruta, margen por plato y consumo por insumo', () => {
  const t = fresh();
  const { cafe, leche } = cafeteria(t);
  t.pedir(11, [item('ESPRESSO', 4), item('LATTE', 2), item('MIXTO')]);
  const r = t.ok('admin.report', {}, t.tk.admin).stock;
  assert.equal(r.ventas_con_costo_gs, 4 * 12000 + 2 * 20000);
  assert.equal(r.costo_ventas_gs, 4 * 1170 + 2 * 2870);
  assert.equal(r.ganancia_bruta_gs, 88000 - 10420);
  assert.equal(r.margen_pct, 88);
  assert.equal(r.lineas_sin_receta, 1);
  const esp = r.productos.find((x) => x.producto_id === 'ESPRESSO');
  assert.deepEqual([esp.cantidad, esp.importe_gs, esp.costo_gs, esp.margen_pct], [4, 48000, 4680, 90]);
  assert.equal(r.productos.find((x) => x.producto_id === 'MIXTO').margen_pct, null);
  assert.deepEqual(r.consumo.map((c) => [c.insumo_id, c.cantidad]).sort(), [[cafe, 54], [leche, 400]].sort());
  assert.equal(r.compras_gs, 120000 + 85000 + 140000 + 60000);
});

test('S10 Ser o Límites activa el Upgrade desde ⚙ Licencia; el reinicio deja el stock en cero y conserva recetas', () => {
  const sha = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
  const salt = 'saltdeprueba123';
  let h = salt + ':' + '987654'; for (let i = 0; i < 300; i++) h = sha(h + ':' + salt);
  const t = fresh('', { plataforma: { usuario_id: 'sol', salt, hash: h } });
  const sol = t.ok('auth.login', { usuario: 'sol', pin: '987654' }).token;
  t.bad('stock.data', {}, t.tk.admin, 'MODULO_NO_ACTIVO');
  t.bad('plataforma.upgrade', { modulo: 'STOCK', activo: true }, t.tk.admin, 'SIN_PERMISO');
  const e = t.ok('plataforma.upgrade', { modulo: 'STOCK', activo: true, nota: 'Contrató stock' }, sol);
  assert.ok(e.upgrades.find((u) => u.modulo === 'STOCK').activo);
  const { cafe } = cafeteria(t);
  t.pedir(12, [item('ESPRESSO')]);
  assert.equal(t.ins(cafe).stock, 1991);
  // Reinicio después de la capacitación (la cuenta de prueba se cancela antes)
  const ped = t.data.active.Pedidos[0];
  t.ok('order.cancel', { pedido_id: ped.pedido_id, motivo: 'Capacitación' }, t.tk.admin);
  t.ok('plataforma.reiniciar', { confirmar: 'REINICIAR' }, sol);
  const c = t.ins(cafe);
  assert.equal(c.stock, 0); assert.equal(c.costo_mil_gs, 130000);
  assert.equal(t.movs().length, 0);
  assert.ok(t.ok('stock.data', {}, t.tk.admin).recetas.ESPRESSO.length);
});

test('S11 Firebase (Firestore): el stock se guarda y otra instancia lo ve; la venta grande entra en una sola operación', async () => {
  const fs = require('fs'), path = require('path');
  const MesaCore = require('../core/core.js');
  const { createNodeEnv } = require('../server/env-node.js');
  const { createFirestoreBackend } = require('../firebase/firestore-backend.js');
  const { FakeFirestore } = require('./fake-firestore.js');
  const catalogo = JSON.parse(fs.readFileSync(path.join(__dirname, '../locales/andrade/catalogo.json'), 'utf8'));
  const db = new FakeFirestore({});
  const logs = [];
  const mk = () => {
    const env = createNodeEnv({ secret: 'secreto-compartido', log: () => {}, modulos: 'STOCK' });
    const b = createFirestoreBackend({ firestore: db, MesaCore, env, log: (m) => logs.push(m), pulseTtlMs: 0 });
    return (action, payload, token) => b.handle({ action, payload: payload || {}, token }, { catalogo, mesas: 20 });
  };
  const ok = async (p) => { const r = await p; assert.equal(r.ok, true, JSON.stringify(r.error)); return r.data; };
  const A = mk(), B = mk();
  await ok(A('health'));
  const pin = (logs.join('\n').match(/PIN inicial: (\d+)/) || [])[1];
  const T = (await ok(A('auth.login', { usuario: 'admin', pin }))).token;
  const ids = [];
  for (let i = 0; i < 25; i++) ids.push((await ok(A('stock.insumo', { insumo: { nombre: 'Insumo ' + i, unidad: 'G' } }, T))).insumo.insumo_id);
  await ok(A('stock.compra', { request_id: 'compra-fb-0001', items: ids.map((id) => ({ insumo_id: id, cantidad: 5000, costo_total_gs: 50000 })) }, T));
  // Receta larga (25 insumos) en 10 productos y un pedido con 10 líneas: 250 consumos, 25 movimientos de venta
  const prods = catalogo.productos.filter((p) => !p.grupos).slice(0, 10).map((p) => p.producto_id);
  for (const pid of prods) await ok(A('stock.receta', { producto_id: pid, lineas: ids.map((id) => ({ insumo_id: id, cantidad: 3 })) }, T));
  const mesa = (await ok(A('sync', {}, T))).mesas[0];
  await ok(A('order.create', { request_id: 'pedido-fb-0001', mesa_id: mesa.mesa_id, items: prods.map((pid) => ({ producto_id: pid, cantidad: 2, opciones: [] })) }, T));
  const d = await ok(B('stock.data', {}, T));
  assert.equal(d.insumos.length, 25);
  assert.ok(d.insumos.every((i) => i.stock === 5000 - 10 * 2 * 3 && i.costo_mil_gs === 10000));
  assert.equal(d.movimientos.filter((m) => m.tipo === 'VENTA').length, 25);
});
