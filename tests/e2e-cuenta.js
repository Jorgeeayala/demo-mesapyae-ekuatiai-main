'use strict';
/*
 * Pedir la cuenta desde el celular del cliente.
 * - El cliente ve su consumo, pide factura (RUC y razón social), elige cómo paga y con cuánto (vuelto).
 * - El mozo recibe el aviso y ve la mesa como "📱 Pidió la cuenta" con los datos.
 * - La caja ve la factura y el medio; al cobrar, el medio y el efectivo recibido ya vienen cargados.
 * - Cuando la caja cobra, el celular del cliente agradece solo.
 * Uso: node tests/e2e-cuenta.js
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
  const srv = spawn(process.execPath, [path.join(__dirname, 'e2e-server.js')], { stdio: ['ignore', 'pipe', 'inherit'] });
  const info = await new Promise((res) => srv.stdout.once('data', (d) => res(JSON.parse(String(d)))));
  const BASE = 'http://127.0.0.1:' + info.port;
  const browser = await pw.chromium.launch();
  const errors = [];
  async function ctx(name, viewport, opts) {
    const c = await browser.newContext(Object.assign({ viewport, locale: 'es-PY', timezoneId: 'America/Asuncion' }, opts || {}));
    await c.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const p = await c.newPage();
    p.on('pageerror', (e) => errors.push(name + ': ' + e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/fonts|ERR_FAILED|net::|status of 4[0-9][0-9]/.test(m.text())) errors.push(name + ' console: ' + m.text()); });
    return { c, p };
  }
  async function login(p, url, user, pin) {
    await p.goto(BASE + url); await p.fill('#lg-u', user);
    for (const k of pin) await p.click(`[data-k="${k}"]`);
    await p.click('[data-k="ok"]');
  }
  const api = (p, action, payload) => p.evaluate(([a, pl]) => Mesa.call(a, pl), [action, payload]);
  const shot = (p, n) => p.screenshot({ path: path.join(OUT, 'cuenta-' + n + '.png'), fullPage: true });
  const PHONE = { width: 390, height: 844 }, DESK = { width: 1366, height: 900 };
  try {
    // Personal conectado antes de que el cliente pida la cuenta
    const mozo = await ctx('mozo', PHONE, { isMobile: true, hasTouch: true });
    await login(mozo.p, '/pedidos', 'mozo', '1111');
    await mozo.p.waitForSelector('[data-mesa]');
    const sync = await api(mozo.p, 'sync', {});
    const mesa3 = sync.mesas.find((m) => m.numero === 3);
    await api(mozo.p, 'order.create', { request_id: 'e2e-cu-1', mesa_id: mesa3.mesa_id, punto_id: 'A_CAFE', items: [{ producto_id: 'ESPRESSO', cantidad: 2, opciones: [] }] });
    const caja = await ctx('caja', DESK);
    await login(caja.p, '/caja', 'cajaa', '3333');
    await caja.p.waitForSelector('.topbar');
    await api(caja.p, 'caja.abrir', { caja_id: 'CAJA_A', monto_inicial_gs: 0 });
    await mozo.p.waitForTimeout(4500); // el mozo ya conoce la mesa ocupada

    // 1. Cliente: carta → Pedir la cuenta
    const cli = await ctx('cliente', PHONE, { isMobile: true, hasTouch: true });
    await cli.p.goto(BASE + '/menu?t=' + info.mesas[2]);
    await cli.p.waitForSelector('.prod');
    await cli.p.click('.cta-cuenta-pie [data-pedir-cuenta]');
    await cli.p.waitForSelector('#cuenta-form');
    const items = await cli.p.textContent('.cuenta-items');
    assert.match(items, /2×\s*Espresso/i, 'muestra lo consumido: ' + items);
    step('El cliente ve su cuenta desde el celular (lo que consumió la mesa y el total)');
    await cli.p.check('input[name="cpte_tipo"][value="FACTURA"]');
    await cli.p.fill('[data-cpte-ruc]', '80012345-6');
    await cli.p.fill('[data-cpte-razon]', 'Comercial Ejemplo SA');
    await cli.p.check('input[name="medio"][value="EFECTIVO"]');
    await cli.p.fill('#paga-con', '100000');
    await shot(cli.p, '1-formulario');
    await cli.p.click('#enviar-cuenta');
    await cli.p.waitForSelector('.banner.ok:has-text("Pediste la cuenta")');
    const resumen = await cli.p.textContent('.banner.ok');
    assert.match(resumen, /Comercial Ejemplo SA/); assert.match(resumen, /Efectivo/); assert.match(resumen, /vuelto/);
    await shot(cli.p, '2-pedida');
    step('Pide la cuenta con factura, en efectivo y con cuánto paga (le confirma que avisó al mozo y a la caja)');

    // 2. Mozo: aviso y mesa marcada
    await mozo.p.waitForSelector('.toast:has-text("Mesa 3 pidió la cuenta")', { timeout: 9000 });
    await mozo.p.waitForSelector('[data-mesa="' + mesa3.mesa_id + '"]:has-text("📱 Pidió la cuenta")');
    await mozo.p.click('[data-mesa="' + mesa3.mesa_id + '"]');
    await mozo.p.waitForSelector('.banner.warn:has-text("Comercial Ejemplo SA")');
    await shot(mozo.p, '3-mozo');
    step('El mozo recibe el aviso (sonido + mensaje) y ve la mesa con la factura y el medio de pago');

    // 3. Caja: tarjeta con los datos y cobro precargado
    await caja.p.waitForSelector('.cierre-cli:has-text("Efectivo")', { timeout: 9000 });
    await caja.p.click('[data-cobrar]');
    await caja.p.waitForSelector('[data-lm="0"]');
    assert.equal(await caja.p.inputValue('[data-lm="0"]'), 'EFECTIVO');
    assert.equal(await caja.p.inputValue('input[data-rec]'), '100.000');
    assert.equal(await caja.p.inputValue('[data-cpte-ruc]'), '80012345-6');
    assert.match(await caja.p.textContent('[data-vuelto]'), /Gs\./);
    await shot(caja.p, '4-caja');
    step('La caja abre el cobro con la factura, el efectivo y el vuelto ya cargados');
    await caja.p.click('[data-ok]');
    await caja.p.waitForSelector('.toast');

    // 4. El celular del cliente agradece solo
    await cli.p.waitForSelector('h2:has-text("¡Gracias por tu visita!")', { timeout: 16000 });
    await shot(cli.p, '5-gracias');
    step('Cuando la caja cobra, el celular del cliente muestra el agradecimiento');
    assert.deepEqual(errors, []);
    console.log('OK e2e cuenta desde el celular');
  } catch (e) {
    console.error(e); console.error(errors); process.exitCode = 1;
  } finally {
    await browser.close(); srv.kill();
  }
})();
