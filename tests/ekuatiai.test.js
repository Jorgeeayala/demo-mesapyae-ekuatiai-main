'use strict';
/*
 * Facturador e-Kuatia'i: armado del detalle de factura desde un cobro y validación de la extensión.
 * Uso: node --test tests/ekuatiai.test.js
 */
const test = require('node:test');
const assert = require('assert/strict');
const F = require('../public/assets/facturador.js');
const { validarFactura } = require('../extension/migrador-ekuatiai/factura.js');
const manifest = require('../extension/migrador-ekuatiai/manifest.json');
const crypto = require('crypto');

const FACT = { tipo: 'FACTURA', ruc: '80012345-6', razon: 'Comercial Ñandutí S.A.', email: 'admin@nandu.com.py' };
function item(nombre, cant, total, extra) { return Object.assign({ nombre, cantidad: cant, total_gs: total, precio_unit_gs: total / cant, opciones: '', anulado: false, persona: '' }, extra || {}); }
function cobro(extra) { return Object.assign({ cobro_id: 'COB_1', cuenta_id: 'CTA_1', estado: 'VALIDO', fecha: '2026-10-22T20:00:00Z', subtotal_gs: 0, descuento_gs: 0, total_gs: 0, pagos: [{ medio: 'EFECTIVO', monto_gs: 0 }], comprobante: FACT, detalle: null }, extra); }

test('el ID fijo de la extensión sale de la clave del manifest', () => {
  const der = Buffer.from(manifest.key, 'base64');
  const id = crypto.createHash('sha256').update(der).digest('hex').slice(0, 32).replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));
  assert.equal(id, F.EXT_ID);
});

test('cuenta entera: todos los ítems, RUC separado de su DV e IVA 10 % por defecto', () => {
  const pedidos = [
    { cuenta_id: 'CTA_1', estado: 'ENTREGADO', items: [item('Espresso', 2, 24000), item('Croissant', 1, 18000, { opciones: 'Con jamón' }), item('Anulado', 1, 9000, { anulado: true })] },
    { cuenta_id: 'CTA_1', estado: 'CANCELADO', items: [item('Cancelado', 1, 5000)] },
    { cuenta_id: 'OTRA', estado: 'ENTREGADO', items: [item('De otra mesa', 1, 7000)] }
  ];
  const f = F.armar({ cobro: cobro({ subtotal_gs: 42000, total_gs: 42000 }), pedidos, local: 'Local' });
  assert.equal(f.modo, 'COMPLETO');
  assert.deepEqual(f.receptor, { tipo: 'RUC', ruc: '80012345', dv: '6', documento: '80012345-6', razon: 'Comercial Ñandutí S.A.', email: 'admin@nandu.com.py' });
  assert.deepEqual(f.items.map((i) => [i.descripcion, i.cantidad, i.precio_unit_gs, i.iva]), [['Espresso', 2, 12000, 10], ['Croissant · Con jamón', 1, 18000, 10]]);
  assert.deepEqual(validarFactura(f), []);
});

test('el descuento se reparte entre los ítems y el total coincide con lo cobrado', () => {
  const pedidos = [{ cuenta_id: 'CTA_1', estado: 'ENTREGADO', items: [item('Pizza', 1, 70000), item('Gaseosa', 3, 30000)] }];
  const f = F.armar({ cobro: cobro({ subtotal_gs: 100000, descuento_gs: 10001, total_gs: 89999 }), pedidos });
  assert.equal(f.items.reduce((a, i) => a + i.descuento_gs, 0), 10001);
  assert.equal(f.items.reduce((a, i) => a + i.cantidad * i.precio_unit_gs - i.descuento_gs, 0), 89999);
  assert.deepEqual(validarFactura(f), []);
});

test('cobro por personas: los ítems de esas personas y lo compartido', () => {
  const pedidos = [{ cuenta_id: 'CTA_1', estado: 'ENTREGADO', items: [item('Lomito', 1, 45000, { persona: 'P1' }), item('Hamburguesa', 1, 40000, { persona: 'P2' }), item('Papas para compartir', 1, 20000)] }];
  const f = F.armar({ cobro: cobro({ subtotal_gs: 55000, total_gs: 55000, detalle: { personas: { P1: 45000 }, compartido: 10000 } }), pedidos });
  assert.equal(f.modo, 'PERSONAS');
  assert.deepEqual(f.items.map((i) => [i.descripcion, i.precio_unit_gs]), [['Lomito', 45000], ['Parte del consumo compartido', 10000]]);
  assert.deepEqual(validarFactura(f), []);
});

test('si no cuadra, va en una sola línea con el importe cobrado (no inventa precios)', () => {
  const pedidos = [{ cuenta_id: 'CTA_1', estado: 'ENTREGADO', items: [item('Algo', 1, 10000)] }];
  const f = F.armar({ cobro: cobro({ subtotal_gs: 25000, total_gs: 25000 }), pedidos });
  assert.equal(f.modo, 'RESUMIDO');
  assert.deepEqual(f.items.map((i) => [i.descripcion, i.cantidad, i.precio_unit_gs]), [['Consumo en el local', 1, 25000]]);
});

test('CI sin DV y total que no se divide exacto por la cantidad', () => {
  const pedidos = [{ cuenta_id: 'CTA_1', estado: 'ENTREGADO', items: [item('Chipa', 3, 10000)] }];
  const f = F.armar({ cobro: cobro({ subtotal_gs: 10000, total_gs: 10000, comprobante: { tipo: 'FACTURA', ruc: '1.234.567', razon: 'Juan Pérez' } }), pedidos });
  assert.equal(f.receptor.tipo, 'CI'); assert.equal(f.receptor.ruc, '1234567'); assert.equal(f.receptor.dv, '');
  assert.deepEqual(f.items.map((i) => [i.descripcion, i.cantidad, i.precio_unit_gs]), [['3 × Chipa', 1, 10000]]);
  assert.deepEqual(validarFactura(f), []);
});

test('no factura tickets ni cobros revertidos', () => {
  assert.throws(() => F.armar({ cobro: cobro({ comprobante: { tipo: 'TICKET' } }), pedidos: [] }), /ticket/);
  assert.throws(() => F.armar({ cobro: cobro({ estado: 'REVERTIDO' }), pedidos: [] }), /válido/);
});

test('la extensión rechaza paquetes incoherentes', () => {
  const base = { version: 1, cobro_id: 'X', receptor: { tipo: 'RUC', ruc: '80012345', dv: '6', razon: 'A' }, items: [{ descripcion: 'X', cantidad: 1, precio_unit_gs: 1000, descuento_gs: 0, iva: 10 }], total_gs: 1000 };
  assert.deepEqual(validarFactura(base), []);
  assert.match(validarFactura(Object.assign({}, base, { total_gs: 2000 })).join(), /no coincide/);
  assert.match(validarFactura(Object.assign({}, base, { receptor: { tipo: 'RUC', ruc: '80012345', razon: 'A' } })).join(), /verificador/);
  assert.match(validarFactura(Object.assign({}, base, { items: [Object.assign({}, base.items[0], { iva: 7 })] })).join(), /IVA/);
  assert.match(validarFactura(Object.assign({}, base, { items: [] })).join(), /ítems/);
});

test('el manifest solo acepta mensajes de sitios de Mesa Pya\'e y nunca pide inicio de sesión ni red a la DNIT', () => {
  const m = manifest.externally_connectable.matches;
  assert.ok(m.length > 0 && m.every((x) => !/\*\.\w+\/$|<all_urls>|^\*/.test(x)));
  assert.deepEqual(manifest.permissions.sort(), ['storage', 'tabs']);
  const fs = require('fs'), path = require('path');
  const dir = path.join(__dirname, '..', 'extension', 'migrador-ekuatiai');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.doesNotMatch(src, /\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket/, f + ' no hace peticiones de red');
    assert.doesNotMatch(src, /password|contrase|clave_?acceso/i, f + ' no toca credenciales');
  }
});

test('campos de ítem con los nombres reales de e-Kuatia\'i (SIFEN) y calibración por fila', () => {
  const C = require('../extension/migrador-ekuatiai/campos.js');
  const pista = (id, txt) => C.CAMPOS.find((c) => c.id === id).pistas.some((r) => r.test(txt));
  assert.ok(pista('precio', 'row.dPUniProSerModel formItem.dPUniProSer0 Ingrese el precio'));
  assert.ok(pista('cantidad', 'row.dCantProSerModel formItem.dCantProSer0'));
  assert.ok(pista('descripcion', 'row.dDesProSerModel'));
  assert.ok(!pista('precio', 'row.dTotBruOpeItemModel Precio total'), 'el total del ítem no es el precio');
  assert.equal(C.normalizarSelector('#formItem\\.dPUniProSer0'), '[id^="formItem.dPUniProSer"]');
  assert.equal(C.normalizarSelector('#rruc'), '#rruc');
});

test('medio de pago de la caja → "Tipo de pago" de e-Kuatia\'i', () => {
  const C = require('../extension/migrador-ekuatiai/campos.js');
  const m = (x) => C.medioEkuatia(x);
  assert.equal(m('EFECTIVO').txt, 'Efectivo'); assert.ok(m('EFECTIVO').re.test(' Efectivo '));
  assert.ok(m('TC').re.test('Tarjeta de crédito')); assert.ok(!m('TC').re.test('Tarjeta de débito'));
  assert.ok(m('TD').re.test('Tarjeta de débito'));
  assert.ok(m('TRANSFERENCIA').re.test('Transferencia'));
  assert.equal(m('VALE_RARO').txt, 'Otro');
});

test('el "Agregar" de pagos no se confunde con el de ítems, ni la obligación con el IVA', () => {
  const C = require('../extension/migrador-ekuatiai/campos.js');
  const pista = (id, txt) => C.CAMPOS.find((c) => c.id === id).pistas.some((r) => r.test(txt));
  assert.ok(pista('agregarPago', 'Agregar emitir.agregarPago()'));
  assert.ok(pista('obligacion', 'tipoObligacionAfectadaRG90 emitir.datos.selectedObligacionRG90'));
});
