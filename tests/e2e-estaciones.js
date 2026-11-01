'use strict';
/*
 * Estaciones de preparación: un pedido con café y mixto se reparte. La pantalla de la Barra ve solo el café,
 * la de la Cocina solo el mixto; cada una marca su parte y el mozo ve cómo va cada estación.
 * Uso: node tests/e2e-estaciones.js
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
  const shot = (p, n) => p.screenshot({ path: path.join(OUT, 'estaciones-' + n + '.png'), fullPage: true });
  const DESK = { width: 1366, height: 900 }, PHONE = { width: 390, height: 844 };
  try {
    // El encargado define las estaciones y manda los cafés calientes a la barra
    const adm = await ctx('admin', DESK);
    await login(adm.p, '/admin', 'admin', '246810');
    await adm.p.waitForSelector('[data-tab="config"]');
    await adm.p.click('[data-tab="config"]');
    await adm.p.fill('[data-cfg="estaciones"]', 'Cocina, Barra');
    await adm.p.click('[data-savecfg="estaciones"]');
    await adm.p.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /guard/i.test(t.textContent)), null, { timeout: 8000 });
    await adm.p.click('[data-tab="catalogo"]');
    await adm.p.click('[data-cats]');
    const fila = adm.p.locator('tr:has(input[data-c="id"][value="CAF_CAL"])');
    await fila.locator('select[data-c="estacion"]').selectOption('BARRA');
    await fila.locator('[data-savecat]').click();
    await adm.p.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /Categoría guardada/.test(t.textContent)), null, { timeout: 8000 });
    await adm.p.waitForSelector('td .chip:text("Barra")');
    await shot(adm.p, 'catalogo');
    step('Admin: estaciones "Cocina, Barra" y la categoría Cafés calientes va a la Barra (se ve en el catálogo)');

    const barra = await ctx('barra', DESK), cocina = await ctx('cocina', DESK);
    await login(barra.p, '/cocina', 'cocina', '2222');
    await login(cocina.p, '/cocina', 'cocina', '2222');
    await barra.p.waitForSelector('#estrow:not([hidden]) #estsel [data-est="BARRA"]', { timeout: 9000 });
    await barra.p.click('#estsel [data-est="BARRA"]');
    await cocina.p.waitForSelector('#estrow:not([hidden]) #estsel [data-est="COCINA"]', { timeout: 9000 });
    await cocina.p.click('#estsel [data-est="COCINA"]');
    step('Dos pantallas de cocina: una elige "Barra" y la otra "Cocina" (queda guardado en cada equipo)');

    const mozo = await ctx('mozo', PHONE, { isMobile: true, hasTouch: true });
    await login(mozo.p, '/pedidos', 'mozo', '1111');
    await mozo.p.waitForSelector('.mesa');
    const sync = await api(mozo.p, 'sync', {});
    const m4 = sync.mesas.find((m) => m.numero === 4);
    const r = await api(mozo.p, 'order.create', { mesa_id: m4.mesa_id, request_id: 'req-e2e-est-' + Date.now(), items: [{ producto_id: 'ESPRESSO', cantidad: 2, opciones: [] }, { producto_id: 'MIXTO', cantidad: 1, opciones: [] }] });
    const sel = '[data-ticket="' + r.pedido.pedido_id + '"]';
    await barra.p.waitForSelector('.kcol.nuevos ' + sel, { timeout: 9000 });
    await cocina.p.waitForSelector('.kcol.nuevos ' + sel, { timeout: 9000 });
    const tb = await barra.p.textContent(sel), tc = await cocina.p.textContent(sel);
    assert.match(tb, /Espresso/); assert.doesNotMatch(tb, /Mixto/);
    assert.match(tc, /Mixto/); assert.doesNotMatch(tc, /Espresso/);
    await shot(barra.p, 'barra-nuevo');
    step('El pedido llega partido: la Barra ve solo los 2 Espresso y la Cocina solo el Mixto');

    await barra.p.click(sel + ' [data-act="listo"]');
    await barra.p.waitForSelector('.kcol.listos ' + sel, { timeout: 9000 });
    await cocina.p.waitForTimeout(3500);
    assert.equal(await cocina.p.$('.kcol.nuevos ' + sel) !== null, true, 'la cocina sigue con su parte pendiente');
    let p1 = (await api(mozo.p, 'sync', {})).pedidos.find((x) => x.pedido_id === r.pedido.pedido_id);
    assert.equal(p1.estado, 'EN_PREPARACION');
    step('La Barra toca "¡Listo!": su parte pasa a listos; el pedido sigue en preparación porque falta la Cocina');

    // En "Todas las estaciones" se ve cómo va cada parte
    await cocina.p.click('#estsel [data-est="TODAS"]');
    await cocina.p.waitForSelector(sel + ' [data-est-chip="BARRA"]', { timeout: 9000 });
    assert.match(await cocina.p.textContent(sel + ' [data-est-chip="BARRA"]'), /✓/);
    await shot(cocina.p, 'todas');
    await cocina.p.click('#estsel [data-est="COCINA"]');
    await cocina.p.click(sel + ' [data-act="empezar"]');
    await cocina.p.waitForSelector('.kcol.prep ' + sel, { timeout: 9000 });
    await cocina.p.click(sel + ' [data-act="listo"]');
    await cocina.p.waitForSelector('.kcol.listos ' + sel, { timeout: 9000 });
    p1 = (await api(mozo.p, 'sync', {})).pedidos.find((x) => x.pedido_id === r.pedido.pedido_id);
    assert.equal(p1.estado, 'LISTO');
    assert.ok(p1.estaciones.every((e) => e.estado === 'LISTO'));
    await shot(cocina.p, 'cocina-listo');
    step('La Cocina empieza y termina el Mixto: el pedido queda LISTO para el mozo');

    // Imprimir la comanda de una estación: solo sus platos y el nombre de la estación
    const html = await barra.p.evaluate((id) => { var v = Comandas.comandaHtml; var t = document.querySelector('[data-ticket="' + id + '"]'); return t ? t.textContent : ''; }, r.pedido.pedido_id);
    assert.match(html, /Espresso/);
    await barra.p.evaluate(() => { window.print = function () { window.__impreso = document.getElementById('comanda-print').textContent; }; });
    await barra.p.click(sel + ' [data-imprimir]');
    const impreso = await barra.p.evaluate(() => window.__impreso || '');
    assert.match(impreso, /BARRA/); assert.match(impreso, /Espresso/); assert.doesNotMatch(impreso, /Mixto/);
    step('La comanda impresa en la Barra dice "BARRA" y trae solo los Espresso');

    assert.deepEqual(errors, [], 'errores en el navegador: ' + errors.join('\n'));
    console.log('\nE2E estaciones: OK');
    await browser.close(); srv.kill(); process.exit(0);
  } catch (e) {
    console.error(e); console.error(errors.join('\n'));
    await browser.close(); srv.kill(); process.exit(1);
  }
})();
