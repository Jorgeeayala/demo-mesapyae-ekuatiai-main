'use strict';
/*
 * Cambiar de mesa (pedido de Andrade, 20/10/2026): los clientes se mudan y el mozo pasa la cuenta
 * entera a una mesa libre. Cocina y caja reciben el aviso; el ticket dice "antes Mesa 3".
 * Uso: node tests/e2e-mesa.js
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
  const shot = (p, n) => p.screenshot({ path: path.join(OUT, 'mesa-' + n + '.png'), fullPage: true });
  const PHONE = { width: 390, height: 844 }, DESK = { width: 1366, height: 900 };
  try {
    const mozo = await ctx('mozo', PHONE, { isMobile: true, hasTouch: true });
    await login(mozo.p, '/pedidos', 'mozo', '1111');
    await mozo.p.waitForSelector('.mesa');
    const sync = await api(mozo.p, 'sync', {});
    const m3 = sync.mesas.find((m) => m.numero === 3), m7 = sync.mesas.find((m) => m.numero === 7);
    const r = await api(mozo.p, 'order.create', { mesa_id: m3.mesa_id, request_id: 'req-e2e-mesa-' + Date.now(), items: [{ producto_id: 'ESPRESSO', cantidad: 2, opciones: [] }] });
    const coc = await ctx('cocina', DESK);
    await login(coc.p, '/cocina', 'cocina', '2222');
    await coc.p.waitForSelector('#filtros');
    await api(coc.p, 'order.state', { pedido_id: r.pedido.pedido_id, estado: 'EN_PREPARACION' });
    const caja = await ctx('caja', DESK);
    await login(caja.p, '/caja?caja=CAJA_A', 'cajaa', '3333');
    await caja.p.waitForSelector('[data-tab="pedidos"]');
    await caja.p.waitForTimeout(4500);
    step('Mesa 3 con un pedido en cocina; mozo, cocina y caja conectados');

    await mozo.p.click('[data-mesa="' + m3.mesa_id + '"]');
    await mozo.p.click('[data-cambiar]');
    await mozo.p.waitForSelector('[data-destinos]');
    const destinos = await mozo.p.$$eval('[data-destino]', (b) => b.map((x) => x.getAttribute('data-destino')));
    assert.ok(destinos.includes(m7.mesa_id) && !destinos.includes(m3.mesa_id), 'ofrece solo mesas libres');
    await shot(mozo.p, 'elegir');
    await mozo.p.click('[data-destino="' + m7.mesa_id + '"]');
    await mozo.p.click('.overlay:last-child [data-ok]');
    await mozo.p.waitForFunction((n) => [...document.querySelectorAll('h1')].some((h) => h.textContent === n), m7.nombre, { timeout: 8000 });
    assert.match(await mozo.p.textContent('#main'), /Espresso/);
    step('El mozo toca "🔀 Cambiar de mesa", ve solo las mesas libres, elige la 7 y confirma: la cuenta ya está en la 7');

    await coc.p.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /se cambió a/.test(t.textContent)), null, { timeout: 9000 });
    await coc.p.waitForSelector('[data-antes]', { timeout: 9000 });
    assert.match(await coc.p.textContent('.ticket:has([data-antes])'), new RegExp(m7.nombre + '[\\s\\S]*antes ' + m3.nombre));
    await shot(coc.p, 'cocina');
    step('Cocina recibe el aviso y el ticket dice "' + m7.nombre + ' · antes ' + m3.nombre + '"');

    await caja.p.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /se cambió a/.test(t.textContent)), null, { timeout: 9000 });
    step('La caja recibe el aviso');

    await mozo.p.click('[data-back]');
    const est3 = await mozo.p.textContent('[data-mesa="' + m3.mesa_id + '"]');
    const est7 = await mozo.p.textContent('[data-mesa="' + m7.mesa_id + '"]');
    assert.match(est3, /Libre/); assert.match(est7, /Ocupada/);
    await shot(mozo.p, 'mesas');
    step('En el salón, la 3 quedó libre y la 7 ocupada');

    assert.deepEqual(errors, []);
    console.log('\nE2E Cambiar de mesa OK');
  } catch (e) {
    console.error('FALLÓ:', e.message); console.error(errors.join('\n')); process.exitCode = 1;
  } finally { await browser.close(); srv.kill(); }
})();
