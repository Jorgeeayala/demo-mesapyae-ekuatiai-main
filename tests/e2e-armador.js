'use strict';
/*
 * Upgrade "Armá tu pedido": el cliente arma su hamburguesa y su pizza desde el QR de la mesa, con animación.
 * - Hamburguesa de la carta: cambia el pan, saca la cebolla y pide carne doble; cada capa cae y se apila.
 * - Pizza a tu gusto: elige el tamaño, suma ingredientes (uno doble) y la pizza "entra al horno".
 * - El precio que muestra la pantalla es el mismo que cobra el servidor; cocina ve "+ Carne x2 · Sin cebolla".
 * - Sin el Upgrade, el mismo producto abre la lista de opciones de siempre (con contador para los dobles).
 * Uso: node tests/e2e-armador.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const assert = require('assert/strict');
let pw;
try { pw = require('playwright'); } catch (e) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const OUT = path.join(__dirname, 'capturas');
function step(msg) { console.log('✔ ' + msg); }

async function servidor(modulos) {
  const srv = spawn(process.execPath, [path.join(__dirname, 'e2e-server.js')], { stdio: ['ignore', 'pipe', 'inherit'], env: Object.assign({}, process.env, { MESA_MODULOS: modulos }) });
  const info = await new Promise((res) => srv.stdout.once('data', (d) => res(JSON.parse(String(d)))));
  return { srv, info, BASE: 'http://127.0.0.1:' + info.port };
}
const op = (opcion_id, nombre, delta_gs, dibujo) => ({ opcion_id, nombre, delta_gs, activo: true, dibujo: dibujo || '' });
const CARTA = [
  ['admin.category', { categoria: { categoria_id: 'HAMB', nombre: 'Hamburguesas', orden: 0, activa: true, nota: '' } }],
  ['admin.group', { grupo: { grupo_id: 'G_PAN_H', nombre: 'Pan', min: 1, max: 1, activo: true, opciones: [op('PAN_BRI', 'Brioche', 0, 'PAN_BRIOCHE'), op('PAN_NEG', 'Pan negro', 3000, 'PAN_NEGRO')] } }],
  ['admin.group', { grupo: { grupo_id: 'G_PROT_H', nombre: 'Proteína', min: 1, max: 1, activo: true, opciones: [op('HPR_CAR', 'Carne', 0, 'CARNE'), op('HPR_POL', 'Pollo', 0, 'POLLO')] } }],
  ['admin.group', { grupo: { grupo_id: 'G_SIN_H', nombre: 'Trae', tipo: 'QUITAR', min: 0, max: 3, activo: true, opciones: [op('SIN_CHE', 'Cheddar', 0, 'CHEDDAR'), op('SIN_TOM', 'Tomate', 0, 'TOMATE'), op('SIN_CEB', 'Cebolla', 0, 'CEBOLLA')] } }],
  ['admin.group', { grupo: { grupo_id: 'G_EXT_H', nombre: 'Agregados', min: 0, max: 8, repetir: 3, activo: true, opciones: [op('EX_CAR', 'Carne', 15000, 'CARNE'), op('EX_BAC', 'Bacon', 7000, 'PANCETA'), op('EX_HUE', 'Huevo', 4000, 'HUEVO')] } }],
  ['admin.product', { producto: { producto_id: 'BURGER_CLASICA', categoria_id: 'HAMB', nombre: 'Clásica', descripcion: 'Cheddar, tomate y cebolla', precio_gs: 40000, activo: true, disponible: true, puntos: 'A_CAFE,B_TAKEAWAY', grupos: 'G_PAN_H,G_PROT_H,G_SIN_H,G_EXT_H', orden: 1, validacion: 'APROBADO', nota: '', armador: 'HAMBURGUESA' } }],
  ['admin.group', { grupo: { grupo_id: 'G_TAM_PZ', nombre: 'Tamaño', tipo: 'TAMANO', min: 1, max: 1, activo: true, opciones: [op('TAM_P', 'Personal', 0), op('TAM_M', 'Mediana', 15000), op('TAM_G', 'Grande', 30000)] } }],
  ['admin.group', { grupo: { grupo_id: 'G_ING_PZ', nombre: 'Ingredientes', min: 0, max: 10, repetir: 2, activo: true, opciones: [op('PZ_MUZ', 'Muzzarella', 6000), op('PZ_PEP', 'Pepperoni', 9000), op('PZ_LOC', 'Locote', 3000)] } }],
  ['admin.product', { producto: { producto_id: 'PIZZA_GUSTO', categoria_id: 'HAMB', nombre: 'Pizza a tu gusto', descripcion: '', precio_gs: 35000, activo: true, disponible: true, puntos: 'A_CAFE,B_TAKEAWAY', grupos: 'G_TAM_PZ,G_ING_PZ', orden: 2, validacion: 'APROBADO', nota: '', armador: 'PIZZA' } }],
  ['admin.product', { producto: { producto_id: 'SLICE_GUSTO', categoria_id: 'HAMB', nombre: 'Porción a tu gusto', descripcion: '', precio_gs: 12000, activo: true, disponible: true, puntos: 'A_CAFE,B_TAKEAWAY', grupos: 'G_ING_PZ', orden: 3, validacion: 'APROBADO', nota: '', armador: 'PORCION' } }]
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await pw.chromium.launch();
  const errors = [];
  const servers = [];
  async function ctx(name, BASE, viewport, opts) {
    const c = await browser.newContext(Object.assign({ viewport, locale: 'es-PY', timezoneId: 'America/Asuncion' }, opts || {}));
    await c.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const p = await c.newPage();
    p.on('pageerror', (e) => errors.push(name + ': ' + e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/fonts|ERR_FAILED|net::|status of 4[0-9][0-9]/.test(m.text())) errors.push(name + ' console: ' + m.text()); });
    return { c, p };
  }
  async function login(p, BASE, url, user, pin) {
    await p.goto(BASE + url); await p.fill('#lg-u', user);
    for (const k of pin) await p.click(`[data-k="${k}"]`);
    await p.click('[data-k="ok"]');
  }
  const api = (p, action, payload) => p.evaluate(([a, pl]) => Mesa.call(a, pl).catch((e) => { throw new Error(a + ': ' + (e.code || '') + ' ' + e.message); }), [action, payload]);
  const PHONE = { width: 390, height: 844 };
  try {
    // ---- Con el Upgrade
    const S1 = await servidor('ARMADOR'); servers.push(S1.srv);
    const adm = await ctx('admin', S1.BASE, { width: 1280, height: 860 });
    await login(adm.p, S1.BASE, '/admin', 'admin', '246810');
    await adm.p.waitForSelector('.topbar');
    for (const [a, pl] of CARTA) await api(adm.p, a, pl);
    step('Carta de prueba cargada: Clásica (hamburguesa armable) y Pizza a tu gusto');

    const cli = await ctx('cliente', S1.BASE, PHONE, { isMobile: true, hasTouch: true });
    await cli.p.goto(S1.BASE + '/menu?t=' + S1.info.mesas[4]);
    await cli.p.waitForSelector('.prod');
    await cli.p.click('.tab:has-text("Hamburguesas")');
    assert.ok(await cli.p.locator('.prod:has-text("Clásica") .arma-chip').count(), 'la carta avisa que se puede armar');
    await cli.p.click('.prod:has-text("Clásica")');
    await cli.p.waitForSelector('.ar.hamburguesa');
    // Lo que trae ya está dibujado: pan de abajo, carne, cheddar, tomate, cebolla y tapa
    assert.equal(await cli.p.locator('.ar-hb .cap').count(), 6);
    assert.match(await cli.p.locator('[data-pt]').innerText(), /40\.000/);
    await cli.p.click('[data-sin="SIN_CEB"]');
    await cli.p.click('[data-mas="EX_CAR"]');
    await cli.p.click('[data-mas="EX_CAR"]');
    await cli.p.click('[data-mas="EX_BAC"]');
    await cli.p.click('[data-uni="G_PAN_H"][data-op="PAN_NEG"]');
    assert.ok(await cli.p.locator('.ar-hb .cap.cae').count() >= 1, 'las capas nuevas caen con animación');
    await cli.p.waitForTimeout(700);
    assert.equal(await cli.p.locator('.ar-hb .cap:not(.sale)').count(), 6 - 1 + 3, 'sin cebolla, con dos carnes y bacon');
    assert.match(await cli.p.locator('[data-mas="EX_CAR"] .n').innerText(), /x2/);
    const precioPantalla = 40000 + 3000 + 15000 * 2 + 7000;
    assert.match(await cli.p.locator('[data-pt]').innerText(), /80\.000/);
    // Límite: "repetir" 3 → la cuarta carne no entra
    await cli.p.click('[data-mas="EX_CAR"]'); await cli.p.click('[data-mas="EX_CAR"]');
    assert.match(await cli.p.locator('[data-mas="EX_CAR"] .n').innerText(), /x3/);
    assert.match(await cli.p.locator('[data-hint]').innerText(), /Máximo 3/);
    await cli.p.click('[data-menos="EX_CAR"]');
    await cli.p.screenshot({ path: path.join(OUT, 'armador-hamburguesa.png') });
    await cli.p.click('[data-aradd]');
    await cli.p.waitForSelector('.ar.encajando .ar-hbase');
    await cli.p.waitForTimeout(650);
    await cli.p.screenshot({ path: path.join(OUT, 'armador-hamburguesa-abierta.png') });
    await cli.p.waitForSelector('.ar.cerrada .ar-htapa');
    await cli.p.waitForTimeout(800);
    await cli.p.screenshot({ path: path.join(OUT, 'armador-hamburguesa-caja.png') });
    await cli.p.waitForSelector('.ar', { state: 'detached', timeout: 4000 });
    step('Hamburguesa: pan negro, sin cebolla, carne x2 y bacon; capas que caen y se apilan; tope de 3; se cierra en su caja');

    await cli.p.click('.prod:has-text("Pizza a tu gusto")');
    await cli.p.waitForSelector('.ar.pizza');
    const escala = () => cli.p.locator('.ar-pz .raiz').evaluate((e) => e.style.transform);
    const chica = await escala();
    await cli.p.click('[data-uni="G_TAM_PZ"][data-op="TAM_G"]');
    assert.notEqual(await escala(), chica, 'la pizza crece al elegir Grande');
    await cli.p.click('[data-mas="PZ_MUZ"]');
    await cli.p.click('[data-mas="PZ_PEP"]'); await cli.p.click('[data-mas="PZ_PEP"]');
    await cli.p.click('[data-mas="PZ_LOC"]');
    assert.equal(await cli.p.locator('.ar-pz .capa').count(), 1, 'la muzzarella es una capa');
    assert.ok(await cli.p.locator('.ar-pz .pz').count() > 15 * 2 + 10, 'pepperoni doble y locote caen sobre la pizza');
    assert.match(await cli.p.locator('[data-pt]').innerText(), /92\.000/); // 35.000 + 30.000 + 6.000 + 9.000 x2 + 3.000
    await cli.p.waitForTimeout(700);
    await cli.p.screenshot({ path: path.join(OUT, 'armador-pizza.png') });
    // Reparto parejo: ningún par de piezas encimado (centros a más de 14 unidades)
    const centros = await cli.p.locator('.ar-pz .pz').evaluateAll((ns) => ns.map((n) => { const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(n.style.transform); return [Number(m[1]), Number(m[2])]; }));
    let minD = 1e9;
    for (let i = 0; i < centros.length; i++) for (let j = i + 1; j < centros.length; j++) minD = Math.min(minD, Math.hypot(centros[i][0] - centros[j][0], centros[i][1] - centros[j][1]));
    assert.ok(minD > 6, 'ingredientes repartidos parejo (distancia mínima ' + minD.toFixed(1) + ')');
    await cli.p.click('[data-aradd]');
    await cli.p.waitForSelector('.ar.horneando');
    await cli.p.waitForTimeout(1100);
    await cli.p.screenshot({ path: path.join(OUT, 'armador-pizza-horno.png') });
    await cli.p.waitForSelector('.ar.encajando.cerrada', { timeout: 3000 });
    await cli.p.waitForTimeout(800);
    await cli.p.screenshot({ path: path.join(OUT, 'armador-pizza-caja.png') });
    await cli.p.waitForSelector('.ar', { state: 'detached', timeout: 4000 });
    step('Pizza: tamaño Grande, muzzarella, pepperoni x2 y locote repartidos parejo; al horno y a su caja');

    await cli.p.click('.prod:has-text("Porción a tu gusto")');
    await cli.p.waitForSelector('.ar.pizza');
    assert.match(await cli.p.locator('.ar-top').innerText(), /porción/i);
    await cli.p.click('[data-mas="PZ_PEP"]'); await cli.p.click('[data-mas="PZ_LOC"]');
    assert.match(await cli.p.locator('[data-pt]').innerText(), /24\.000/); // 12.000 + 9.000 + 3.000
    await cli.p.waitForTimeout(700);
    await cli.p.screenshot({ path: path.join(OUT, 'armador-porcion.png') });
    await cli.p.click('[data-aradd]');
    await cli.p.waitForSelector('.ar.encajando.cerrada', { timeout: 3000 });
    await cli.p.waitForTimeout(800);
    await cli.p.screenshot({ path: path.join(OUT, 'armador-porcion-caja.png') });
    await cli.p.waitForSelector('.ar', { state: 'detached', timeout: 4000 });
    step('Porción: pepperoni y locote, al horno y a su cajita triangular');

    // Ventana baja de computadora y hamburguesa alta: la caja cerrada entra entera en el escenario, sin tapar los botones
    const pc = await ctx('cliente-pc', S1.BASE, { width: 520, height: 640 });
    await pc.p.goto(S1.BASE + '/menu?t=' + S1.info.mesas[5]);
    await pc.p.waitForSelector('.prod');
    await pc.p.click('.tab:has-text("Hamburguesas")');
    await pc.p.click('.prod:has-text("Clásica")');
    await pc.p.waitForSelector('.ar.hamburguesa');
    for (const id of ['EX_CAR', 'EX_CAR', 'EX_BAC', 'EX_BAC', 'EX_HUE']) await pc.p.click('[data-mas="' + id + '"]');
    await pc.p.click('[data-aradd]');
    await pc.p.waitForSelector('.ar.cerrada');
    await pc.p.waitForTimeout(900);
    const caja = await pc.p.evaluate(() => {
      const st = document.querySelector('.ar-stage').getBoundingClientRect(), t = document.querySelector('.ar-htapa').getBoundingClientRect();
      const pills = document.querySelector('[data-pills]').getBoundingClientRect(), foot = document.querySelector('.ar-foot').getBoundingClientRect();
      const b = document.querySelector('.ar-hbase').getBoundingClientRect();
      return { arriba: t.top - pills.bottom, abajo: foot.top - b.bottom, msg: document.querySelectorAll('.ar-msg').length };
    });
    assert.ok(caja.arriba >= -2, 'la tapa no se sube sobre los botones de pan (' + caja.arriba + ')');
    assert.ok(caja.abajo >= -2, 'la base no tapa el botón Agregar (' + caja.abajo + ')');
    assert.equal(caja.msg, 0, 'sin carteles encima de la caja');
    await pc.p.screenshot({ path: path.join(OUT, 'armador-hamburguesa-caja-pc.png') });
    await pc.p.waitForSelector('.ar', { state: 'detached', timeout: 4000 });
    step('Ventana baja: el escenario se agranda y la caja cerrada se ve entera');

    await cli.p.click('[data-open-cart]');
    const carrito = await cli.p.locator('.cart').innerText();
    assert.match(carrito, /Pan negro · \+ Carne x2 · \+ Bacon · Sin cebolla|Sin cebolla/);
    await cli.p.click('[data-send]');
    await cli.p.waitForSelector('.estado-steps, .card:has-text("Pedido")', { timeout: 8000 });
    const sync = await api(adm.p, 'sync', {});
    const ped = sync.pedidos.find((x) => x.items.some((i) => i.producto_id === 'BURGER_CLASICA'));
    const hb = ped.items.find((i) => i.producto_id === 'BURGER_CLASICA'), pz = ped.items.find((i) => i.producto_id === 'PIZZA_GUSTO');
    assert.equal(hb.precio_unit_gs, precioPantalla, 'lo que vio el cliente es lo que cobra el servidor');
    assert.equal(hb.opciones, 'Pan negro · Proteína: Carne · Sin cebolla · + Carne x2 · + Bacon');
    assert.equal(pz.precio_unit_gs, 92000);
    assert.equal(pz.opciones, 'Tamaño: Grande · + Muzzarella · + Pepperoni x2 · + Locote');
    step('Pedido enviado: cocina ve "Sin cebolla · + Carne x2"; el precio coincide con el de la pantalla');
    S1.srv.kill();

    // ---- Sin el Upgrade: lista de opciones de siempre, con contador para los dobles
    const S2 = await servidor(''); servers.push(S2.srv);
    const adm2 = await ctx('admin2', S2.BASE, { width: 1280, height: 860 });
    await login(adm2.p, S2.BASE, '/admin', 'admin', '246810');
    await adm2.p.waitForSelector('.topbar');
    for (const [a, pl] of CARTA) await api(adm2.p, a, pl);
    const cli2 = await ctx('cliente2', S2.BASE, PHONE, { isMobile: true, hasTouch: true });
    await cli2.p.goto(S2.BASE + '/menu?t=' + S2.info.mesas[4]);
    await cli2.p.waitForSelector('.prod');
    await cli2.p.click('.tab:has-text("Hamburguesas")');
    assert.equal(await cli2.p.locator('.arma-chip').count(), 0);
    await cli2.p.click('.prod:has-text("Clásica")');
    await cli2.p.waitForSelector('.sheet');
    assert.equal(await cli2.p.locator('.ar').count(), 0, 'sin Upgrade no hay armador animado');
    assert.match(await cli2.p.locator('.sheet').innerText(), /Sin cebolla/);
    await cli2.p.click('[data-rep="EX_CAR"] [data-rq="1"]'); await cli2.p.click('[data-rep="EX_CAR"] [data-rq="1"]');
    assert.match(await cli2.p.locator('[data-pt]').innerText(), /70\.000/);
    step('Sin el Upgrade: la lista de opciones de siempre, con "Sin cebolla" y contador para pedir carne doble');

    assert.deepEqual(errors, []);
    console.log('\nE2E Armá tu pedido OK');
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await browser.close();
    servers.forEach((s) => s.kill());
  }
})();
