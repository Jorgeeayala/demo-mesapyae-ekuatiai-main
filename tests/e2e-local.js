'use strict';
/*
 * Matriz de locales: un local nuevo (locales/ejemplo, ficticio) en el navegador.
 * - La carta del cliente muestra su nombre, logo, dirección y su carta (nada de Andrade).
 * - El cliente pide desde la mesa y el pedido llega a cocina.
 * - El para llevar dice dónde se retira.
 * - El personal ve sus cajas y puntos con los nombres del local.
 * Uso: node tests/e2e-local.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const assert = require('assert/strict');
let pw;
try { pw = require('playwright'); } catch (e) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const OUT = path.join(__dirname, 'capturas');
function step(msg) { console.log('✔ ' + msg); }

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = spawn(process.execPath, [path.join(__dirname, 'e2e-server.js')], { stdio: ['ignore', 'pipe', 'inherit'], env: Object.assign({}, process.env, { MESA_LOCAL: 'ejemplo' }) });
  const info = await new Promise((res) => srv.stdout.once('data', (d) => res(JSON.parse(String(d)))));
  const BASE = 'http://127.0.0.1:' + info.port;
  const browser = await pw.chromium.launch();
  const errors = [];
  async function ctx(name, viewport, opts) {
    const c = await browser.newContext(Object.assign({ viewport, locale: 'es-PY', timezoneId: 'America/Asuncion' }, opts || {}));
    await c.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const p = await c.newPage();
    p.on('pageerror', (e) => errors.push(name + ': ' + e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/fonts|ERR_FAILED|net::|status of 4[0-9][0-9]|Could not reach Cloud Firestore backend/.test(m.text())) errors.push(name + ' console: ' + m.text()); });
    return { c, p };
  }
  async function login(p, url, user, pin) {
    await p.goto(BASE + url); await p.fill('#lg-u', user);
    for (const k of pin) await p.click(`[data-k="${k}"]`);
    await p.click('[data-k="ok"]');
  }
  const shot = (p, n) => p.screenshot({ path: path.join(OUT, 'local-' + n + '.png'), fullPage: true });
  const PHONE = { width: 390, height: 844 }, DESK = { width: 1366, height: 900 };
  try {
    assert.equal(info.mesas.length, 12, 'el local de ejemplo tiene 12 mesas');
    // 1. Carta del cliente con la marca del local
    const cli = await ctx('cliente', PHONE, { isMobile: true, hasTouch: true });
    await cli.p.goto(BASE + '/menu?t=' + info.mesas[0]);
    await cli.p.waitForSelector('.prod');
    assert.equal(await cli.p.title(), 'Bistró del Ejemplo · Menú');
    const logo = await cli.p.$eval('.pub-head img', (i) => ({ alt: i.alt, ok: i.complete && i.naturalWidth > 0 }));
    assert.deepEqual(logo, { alt: 'Bistró del Ejemplo', ok: true });
    const texto = await cli.p.textContent('body');
    assert.match(texto, /Av\. de los Ejemplos 1234/);
    assert.match(texto, /Capuchino de ejemplo/);
    assert.doesNotMatch(texto, /Andrade|Espresso|casita/);
    const color = await cli.p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--tierra').trim());
    assert.equal(color.toUpperCase(), '#2F5D62');
    await shot(cli.p, 'carta');
    step('Carta del cliente: nombre, logo, dirección, colores y carta propios del local; nada de Andrade');

    // 2. El cliente pide y el pedido llega a cocina
    await cli.p.click('.prod:has-text("Capuchino de ejemplo")');  // sin opciones: se agrega directo
    await cli.p.click('[data-open-cart]');
    await cli.p.click('[data-send]');
    await cli.p.waitForFunction(() => /recibido|Recibido|confirm/i.test(document.body.textContent) && !document.querySelector('[data-send]'), null, { timeout: 8000 });
    const coc = await ctx('cocina', DESK);
    await login(coc.p, '/cocina', 'admin', '246810');
    await coc.p.waitForSelector('#filtros');
    const tabs = await coc.p.$$eval('#filtros .tab', (b) => b.map((x) => x.textContent));
    assert.deepEqual(tabs, ['Todo', 'Salón', 'Para llevar']);
    const mozo = await ctx('mozo', PHONE, { isMobile: true, hasTouch: true });
    await login(mozo.p, '/pedidos', 'mozo', '1111');
    await mozo.p.waitForSelector('[data-mesa]');
    const sync = await mozo.p.evaluate(() => Mesa.call('sync', {}));
    const ped = sync.pedidos.find((x) => x.estado === 'PENDIENTE' && x.origen === 'QR');
    assert.ok(ped, 'el pedido del cliente llegó al personal');
    step('El cliente pide desde la mesa y el pedido llega al personal; cocina filtra por "Salón" y "Para llevar"');

    // 3. Para llevar: dice dónde se retira
    const tk = await ctx('takeaway', PHONE, { isMobile: true, hasTouch: true });
    await tk.p.goto(BASE + '/menu?t=' + info.takeaway);
    await tk.p.waitForSelector('.prod');
    const carta = await tk.p.textContent('[data-menu]');
    await tk.p.click('.tabs.cats .tab:text-is("Bebidas")');
    await tk.p.click('.prod:has-text("Agua de ejemplo")');
    await tk.p.click('[data-open-cart]');
    const ctxTxt = await tk.p.textContent('.modal, [role=dialog], body');
    assert.match(ctxTxt, /retirar en el mostrador/);
    assert.doesNotMatch(carta + ctxTxt, /Pasta de ejemplo/, 'la pasta es solo para el salón');
    step('Para llevar: "Pedido para retirar en el mostrador" y solo los productos de ese punto');

    // 4. Personal: inicio y caja con los nombres del local
    const adm = await ctx('admin', DESK);
    await login(adm.p, '/index?nostay', 'admin', '246810');
    await adm.p.waitForSelector('.portal');
    const portal = await adm.p.textContent('.portal');
    assert.match(portal, /Salón principal: cobros/);
    assert.match(portal, /Para llevar \(mostrador\): ventas/);
    assert.match(await adm.p.title(), /Bistró Ejemplo/);
    await adm.p.goto(BASE + '/caja?caja=CAJA_A');
    await adm.p.waitForSelector('.topbar');
    assert.match(await adm.p.textContent('.topbar'), /Caja 01 — Salón/);
    await shot(adm.p, 'caja');
    step('Personal: inicio y caja con los nombres de puntos y cajas del local');

    assert.deepEqual(errors, []);
    console.log('\nE2E Local de la matriz OK');
  } catch (e) {
    console.error('FALLÓ:', e.message); console.error(errors.join('\n')); process.exitCode = 1;
  } finally { await browser.close(); srv.kill(); }
})();
