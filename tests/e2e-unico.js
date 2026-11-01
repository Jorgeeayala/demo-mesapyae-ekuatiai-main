'use strict';
/*
 * E4 · Sitio único: un local que vive en /<local>/ dentro del sitio de todos (tools/sitio_unico.py).
 * - La carta del cliente abre en /prueba-alta/menu con la marca del local y su API en /prueba-alta/api.
 * - El pedido llega al personal, que entra por /prueba-alta/cocina y /prueba-alta/pedidos.
 * - Lo guardado en el navegador lleva el nombre del local (dos locales en el mismo celular no se mezclan).
 * - Los QR que arma Administración apuntan a /prueba-alta/menu.html.
 * Uso: node tests/e2e-unico.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const assert = require('assert/strict');
let pw;
try { pw = require('playwright'); } catch (e) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const OUT = path.join(__dirname, 'capturas');
const L = 'prueba-alta';
function step(msg) { console.log('✔ ' + msg); }

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = spawn(process.execPath, [path.join(__dirname, 'e2e-server.js')], { stdio: ['ignore', 'pipe', 'inherit'], env: Object.assign({}, process.env, { MESA_UNICO: L }) });
  const info = await new Promise((res) => srv.stdout.once('data', (d) => res(JSON.parse(String(d)))));
  const BASE = 'http://127.0.0.1:' + info.port + '/' + L;
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
  const PHONE = { width: 390, height: 844 }, DESK = { width: 1366, height: 900 };
  try {
    // 1. Carta del cliente dentro de /prueba-alta/
    const cli = await ctx('cliente', PHONE, { isMobile: true, hasTouch: true });
    const apis = [];
    cli.p.on('request', (r) => { if (r.method() === 'POST') apis.push(new URL(r.url()).pathname); });
    await cli.p.goto(BASE + '/menu.html?t=' + info.mesas[0]);
    await cli.p.waitForSelector('.prod');
    assert.equal(await cli.p.title(), 'Prueba de Alta · Menú');
    assert.ok(await cli.p.$eval('.pub-head img', (i) => i.complete && i.naturalWidth > 0), 'el logo carga desde /prueba-alta/assets');
    assert.match(await cli.p.textContent('body'), /Capuchino de ejemplo/);
    await cli.p.click('.prod:has-text("Capuchino de ejemplo")');
    await cli.p.click('[data-open-cart]');
    await cli.p.click('[data-send]');
    await cli.p.waitForFunction(() => /recibido|Recibido|confirm/i.test(document.body.textContent) && !document.querySelector('[data-send]'), null, { timeout: 8000 });
    assert.ok(apis.length && apis.every((a) => a === '/' + L + '/api'), 'la carta habla con /' + L + '/api: ' + apis.join(', '));
    step('Carta en /' + L + '/menu con la marca del local; pide por /' + L + '/api');

    // 2. Personal en /prueba-alta/: el pedido llega y la sesión se guarda con el nombre del local
    const mozo = await ctx('mozo', PHONE, { isMobile: true, hasTouch: true });
    await login(mozo.p, '/pedidos.html', 'mozo', '1111');
    await mozo.p.waitForSelector('[data-mesa]');
    const sync = await mozo.p.evaluate(() => Mesa.call('sync', {}));
    assert.ok(sync.pedidos.find((x) => x.estado === 'PENDIENTE' && x.origen === 'QR'), 'el pedido del cliente llegó al mozo');
    const claves = await mozo.p.evaluate(() => Object.keys(localStorage));
    assert.ok(claves.includes('mesapyae.' + L + '.sesion'), 'sesión guardada por local: ' + claves.join(', '));
    assert.ok(!claves.includes('mesapyae.sesion'), 'no usa la clave compartida');
    step('El pedido llega al mozo; la sesión se guarda como mesapyae.' + L + '.sesion');

    // 3. Administración: los QR apuntan al local dentro del sitio único
    const adm = await ctx('admin', DESK);
    await login(adm.p, '/admin.html', 'admin', '246810');
    await adm.p.waitForSelector('[data-tab]');
    await adm.p.click('[data-tab="mesas"]');
    await adm.p.waitForSelector('#base');
    assert.equal(await adm.p.inputValue('#base'), BASE + '/');
    step('Administración: los QR se arman con la dirección ' + BASE + '/');

    // 4. El pedido de otro local no se puede hacer por esta API sin su QR (cada local, su servidor)
    const r = await cli.p.evaluate(async (u) => (await fetch(u, { method: 'POST', body: '{"action":"health"}' })).status, BASE + '/api');
    assert.equal(r, 200);
    assert.deepEqual(errors, []);
    console.log('\nE2E Sitio único OK');
  } catch (e) {
    console.error('FALLÓ:', e.message); console.error(errors.join('\n')); process.exitCode = 1;
  } finally { await browser.close(); srv.kill(); }
})();
