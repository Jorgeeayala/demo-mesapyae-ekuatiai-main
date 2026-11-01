'use strict';
/* Upgrade "Armá tu pedido": pizza y hamburguesa armables, ingredientes dobles, sacar ingredientes y tamaño.
   node --test tests/armador.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../server/dev-server.js');

const PIN = { admin: '246810', mozo: '1111' };
const USUARIOS = [{ usuario_id: 'mozo', nombre: 'Mozo Uno', rol: 'MOZO', pin: PIN.mozo }];
function fresh(modulos) {
  const b = buildApp(null, { secret: 'test-secret', adminPin: PIN.admin, mesas: 20, log: () => {}, usuarios: USUARIOS, plan: '', modulos: modulos || '' });
  const call = (action, payload, token) => b.app.handle({ action, payload: payload || {}, token });
  const ok = (a, p, t) => { const r = call(a, p, t); assert.equal(r.ok, true, a + ' falló: ' + JSON.stringify(r.error)); return r.data; };
  const bad = (a, p, t, code) => { const r = call(a, p, t); assert.equal(r.ok, false, a + ' debía fallar'); if (code) assert.equal(r.error.code, code, JSON.stringify(r.error)); return r; };
  const tk = {}; for (const u of Object.keys(PIN)) tk[u] = ok('auth.login', { usuario: u, pin: PIN[u] }).token;
  let seq = 0; const rid = () => 'req-ar-' + (++seq) + '-' + Math.random().toString(36).slice(2);
  return { b, call, ok, bad, tk, rid };
}
const op = (opcion_id, nombre, delta_gs, dibujo) => ({ opcion_id, nombre, delta_gs, activo: true, dibujo: dibujo || '' });

// Carta de prueba: una hamburguesa de la carta (trae cebolla y tomate, se pueden sacar) y una pizza a tu gusto con tamaño.
function cargarCarta(t) {
  const a = t.tk.admin;
  t.ok('admin.category', { categoria: { categoria_id: 'HAMB', nombre: 'Hamburguesas', orden: 1, activa: true, nota: '' } }, a);
  t.ok('admin.group', { grupo: { grupo_id: 'G_PAN_H', nombre: 'Pan', min: 1, max: 1, activo: true, opciones: [op('PAN_BRI', 'Brioche', 0, 'PAN_BRIOCHE'), op('PAN_NEG', 'Pan negro', 3000, 'PAN_NEGRO')] } }, a);
  t.ok('admin.group', { grupo: { grupo_id: 'G_EXTRA_H', nombre: 'Agregados', min: 0, max: 8, repetir: 3, activo: true, opciones: [op('EX_CARNE', 'Carne', 15000, 'CARNE'), op('EX_CHED', 'Cheddar', 5000, 'CHEDDAR'), op('EX_BACON', 'Bacon', 7000, 'PANCETA')] } }, a);
  t.ok('admin.group', { grupo: { grupo_id: 'G_SIN_H', nombre: 'Quitar', tipo: 'QUITAR', min: 0, max: 3, activo: true, opciones: [op('SIN_CEB', 'Cebolla', 0, 'CEBOLLA'), op('SIN_TOM', 'Tomate', 0, 'TOMATE')] } }, a);
  t.ok('admin.product', { producto: { producto_id: 'BURGER_CLASICA', categoria_id: 'HAMB', nombre: 'Clásica', descripcion: 'Carne, cheddar, tomate y cebolla', precio_gs: 40000, activo: true, disponible: true, puntos: 'A_CAFE,B_TAKEAWAY', grupos: 'G_PAN_H,G_EXTRA_H,G_SIN_H', orden: 1, validacion: 'APROBADO', nota: '', armador: 'HAMBURGUESA' } }, a);
  t.ok('admin.group', { grupo: { grupo_id: 'G_TAM_PZ', nombre: 'Tamaño', tipo: 'TAMANO', min: 1, max: 1, activo: true, opciones: [op('TAM_P', 'Personal', 0), op('TAM_M', 'Mediana', 15000), op('TAM_G', 'Grande', 30000)] } }, a);
  t.ok('admin.group', { grupo: { grupo_id: 'G_ING_PZ', nombre: 'Ingredientes', min: 0, max: 12, repetir: 2, activo: true, opciones: [op('PZ_QUESO', 'Muzzarella', 6000, 'QUESO'), op('PZ_PEP', 'Pepperoni', 9000, 'PEPPERONI')] } }, a);
  t.ok('admin.product', { producto: { producto_id: 'PIZZA_GUSTO', categoria_id: 'HAMB', nombre: 'Pizza a tu gusto', descripcion: '', precio_gs: 35000, activo: true, disponible: true, puntos: 'A_CAFE,B_TAKEAWAY', grupos: 'G_TAM_PZ,G_ING_PZ', orden: 2, validacion: 'APROBADO', nota: '', armador: 'PIZZA' } }, a);
}

test('AR01 doble carne, sin cebolla y pan negro: precio del servidor y comanda clara', () => {
  const t = fresh();
  cargarCarta(t);
  const p = t.ok('order.create', { request_id: t.rid(), mesa_id: 'M01', items: [{ producto_id: 'BURGER_CLASICA', cantidad: 2, opciones: ['PAN_NEG', 'EX_CARNE', 'EX_CARNE', 'EX_CHED', 'SIN_CEB'] }] }, t.tk.mozo).pedido;
  const it = p.items[0];
  assert.equal(it.precio_unit_gs, 40000 + 3000 + 15000 * 2 + 5000, 'cada carne se cobra');
  assert.equal(it.total_gs, it.precio_unit_gs * 2);
  assert.equal(it.opciones, 'Pan negro · + Carne x2 · + Cheddar · Sin cebolla');
});

test('AR02 límites: repetir, máximo del grupo y opciones que no son del producto', () => {
  const t = fresh();
  cargarCarta(t);
  const pedir = (opciones) => t.call('order.create', { request_id: t.rid(), mesa_id: 'M02', items: [{ producto_id: 'BURGER_CLASICA', cantidad: 1, opciones: ['PAN_BRI'].concat(opciones) }] }, t.tk.mozo);
  assert.equal(pedir(['EX_CARNE', 'EX_CARNE', 'EX_CARNE']).ok, true, 'triple carne permitido (repetir 3)');
  assert.equal(pedir(['EX_CARNE', 'EX_CARNE', 'EX_CARNE', 'EX_CARNE']).error.code, 'OPCION_INVALIDA', 'cuádruple no');
  assert.equal(pedir(['SIN_CEB', 'SIN_CEB']).error.code, 'OPCION_INVALIDA', 'sacar dos veces lo mismo no');
  assert.equal(pedir(['PZ_QUESO']).error.code, 'OPCION_INVALIDA', 'ingrediente de otro producto');
  assert.equal(t.call('order.create', { request_id: t.rid(), mesa_id: 'M02', items: [{ producto_id: 'BURGER_CLASICA', cantidad: 1, opciones: ['EX_CHED'] }] }, t.tk.mozo).error.code, 'OPCION_REQUERIDA', 'el pan es obligatorio');
});

test('AR03 pizza: el tamaño es obligatorio y suma su diferencia; doble queso', () => {
  const t = fresh();
  cargarCarta(t);
  const p = t.ok('order.create', { request_id: t.rid(), mesa_id: 'M03', items: [{ producto_id: 'PIZZA_GUSTO', cantidad: 1, opciones: ['TAM_G', 'PZ_QUESO', 'PZ_QUESO', 'PZ_PEP'] }] }, t.tk.mozo).pedido;
  assert.equal(p.items[0].precio_unit_gs, 35000 + 30000 + 6000 * 2 + 9000);
  assert.equal(p.items[0].opciones, 'Tamaño: Grande · + Muzzarella x2 · + Pepperoni');
  t.bad('order.create', { request_id: t.rid(), mesa_id: 'M03', items: [{ producto_id: 'PIZZA_GUSTO', cantidad: 1, opciones: ['PZ_QUESO'] }] }, t.tk.mozo, 'OPCION_REQUERIDA');
});

test('AR04 la carta QR muestra el armador solo con el Upgrade; los dibujos y tipos viajan siempre', () => {
  const sin = fresh();
  cargarCarta(sin);
  const tok = sin.b.store._data().active.Mesas[0].qr_token;
  let menu = sin.ok('public.resolve', { token: tok }).menu;
  assert.equal(menu.productos.find((p) => p.id === 'BURGER_CLASICA').armador, undefined, 'sin Upgrade: lista de opciones de siempre');
  const g = menu.grupos.find((x) => x.id === 'G_EXTRA_H');
  assert.equal(g.repetir, 3);
  assert.equal(menu.grupos.find((x) => x.id === 'G_SIN_H').tipo, 'QUITAR');
  assert.equal(g.opciones.find((o) => o.id === 'EX_BACON').dibujo, 'PANCETA');
  // Administración siempre ve el campo (para dejarlo listo antes de activar el Upgrade)
  assert.equal(sin.ok('admin.data', {}, sin.tk.admin).menu.productos.find((p) => p.id === 'BURGER_CLASICA').armador, 'HAMBURGUESA');

  const con = fresh('ARMADOR');
  cargarCarta(con);
  const tok2 = con.b.store._data().active.Mesas[0].qr_token;
  menu = con.ok('public.resolve', { token: tok2 }).menu;
  assert.equal(menu.productos.find((p) => p.id === 'BURGER_CLASICA').armador, 'HAMBURGUESA');
  assert.equal(menu.productos.find((p) => p.id === 'PIZZA_GUSTO').armador, 'PIZZA');
  // El pedido del cliente desde el QR, con doble y sin
  const r = con.ok('public.order', { token: tok2, request_id: con.rid(), items: [{ producto_id: 'BURGER_CLASICA', cantidad: 1, opciones: ['PAN_BRI', 'EX_BACON', 'EX_BACON', 'SIN_TOM'] }] });
  assert.equal(r.total_gs, 40000 + 7000 * 2);
});

test('AR05 validaciones de administración', () => {
  const t = fresh();
  const a = t.tk.admin;
  t.bad('admin.group', { grupo: { grupo_id: 'G_X', nombre: 'Quitar', tipo: 'QUITAR', min: 0, max: 2, activo: true, opciones: [op('X1', 'Cebolla', 1000)] } }, a, 'PRECIO_INVALIDO');
  t.bad('admin.group', { grupo: { grupo_id: 'G_Y', nombre: 'Tamaño', tipo: 'TAMANO', repetir: 2, min: 1, max: 1, activo: true, opciones: [op('Y1', 'Chica', 0)] } }, a, 'GRUPO_INVALIDO');
  t.bad('admin.group', { grupo: { grupo_id: 'G_Z', nombre: 'Cosas', tipo: 'RARO', min: 0, max: 2, activo: true, opciones: [] } }, a, 'GRUPO_INVALIDO');
  t.bad('admin.group', { grupo: { grupo_id: 'G_W', nombre: 'Cosas', repetir: 9, min: 0, max: 2, activo: true, opciones: [] } }, a, 'GRUPO_INVALIDO');
  t.bad('admin.product', { producto: { producto_id: 'TACO', categoria_id: 'PIZZAS', nombre: 'Taco', descripcion: '', precio_gs: 1000, activo: true, disponible: true, puntos: 'A_CAFE', grupos: '', orden: 1, validacion: 'APROBADO', nota: '', armador: 'TACO' } }, a, 'ARMADOR_INVALIDO');
  // Guardar el grupo sin mandar tipo/repetir (pantalla vieja) conserva lo que tenía
  cargarCarta(t);
  t.ok('admin.product', { producto: { producto_id: 'SLICE', categoria_id: 'HAMB', nombre: 'Porción', descripcion: '', precio_gs: 12000, activo: true, disponible: true, puntos: 'A_CAFE', grupos: '', orden: 3, validacion: 'APROBADO', nota: '', armador: 'PORCION' } }, a);
  assert.equal(t.ok('admin.data', {}, a).menu.productos.find((p) => p.id === 'SLICE').armador, 'PORCION');
  t.ok('admin.group', { grupo: { grupo_id: 'G_EXTRA_H', nombre: 'Agregados', min: 0, max: 8, activo: true, opciones: [op('EX_CARNE', 'Carne', 16000, 'CARNE')] } }, a);
  assert.equal(t.ok('admin.data', {}, a).menu.grupos.find((x) => x.id === 'G_EXTRA_H').repetir, 3);
});

test('AR06 Mesa Viru: una opción doble descuenta su receta dos veces', () => {
  const t = fresh('ARMADOR,STOCK');
  cargarCarta(t);
  const a = t.tk.admin;
  const ins = t.ok('stock.insumo', { insumo: { nombre: 'Medallón de carne', unidad: 'UN', minimo: 0 } }, a).insumo.insumo_id;
  t.ok('stock.compra', { request_id: t.rid(), proveedor: 'X', items: [{ insumo_id: ins, cantidad: 50, costo_total_gs: 250000 }] }, a);
  t.ok('stock.receta', { producto_id: 'BURGER_CLASICA', opcion_id: '', lineas: [{ insumo_id: ins, cantidad: 1 }] }, a);
  t.ok('stock.receta', { producto_id: 'BURGER_CLASICA', opcion_id: 'EX_CARNE', lineas: [{ insumo_id: ins, cantidad: 1 }] }, a);
  t.ok('order.create', { request_id: t.rid(), mesa_id: 'M04', items: [{ producto_id: 'BURGER_CLASICA', cantidad: 1, opciones: ['PAN_BRI', 'EX_CARNE', 'EX_CARNE'] }] }, t.tk.mozo);
  const stock = t.ok('stock.data', {}, a).insumos.find((x) => x.insumo_id === ins).stock;
  assert.equal(stock, 50 - 3, 'medallón base + 2 extras');
});
