'use strict';
/*
 * Carta del cliente en el celular: elegir categorías es fluido.
 * - La fila de categorías no vuelve al principio y la elegida queda a la vista.
 * - Si el cliente bajó en la lista, al cambiar de categoría queda al comienzo de la nueva (no arriba de todo).
 * - Al recargar o volver del estado del pedido, sigue en la misma categoría.
 * Uso: node tests/e2e-carta.js
 */
const { spawn } = require('child_process');
const path = require('path');
const assert = require('assert/strict');
let pw;
try { pw = require('playwright'); } catch (e) { pw = require('/opt/node22/lib/node_modules/playwright'); }
function step(msg) { console.log('✔ ' + msg); }

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, 'e2e-server.js')], { stdio: ['ignore', 'pipe', 'inherit'] });
  const info = await new Promise((res) => srv.stdout.once('data', (d) => res(JSON.parse(String(d)))));
  const BASE = 'http://127.0.0.1:' + info.port;
  const browser = await pw.chromium.launch();
  const errors = [];
  try {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await c.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const p = await c.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(BASE + '/menu?t=' + info.mesas[2]);
    await p.waitForSelector('.prod');
    const fila = '.tabs.cats';
    // 1. Elegir una categoría del final de la fila
    const pizzas = p.locator(fila + ' .tab', { hasText: /^Pizzas$/ });
    await pizzas.scrollIntoViewIfNeeded();
    const antes = await p.$eval(fila, (t) => t.scrollLeft);
    assert.ok(antes > 0, 'la fila se desplazó para llegar a Pizzas');
    await pizzas.click();
    await p.waitForSelector('.prod:has-text("Margarita")');
    await p.waitForTimeout(500);
    const vis = await p.$eval(fila, (t) => { const b = t.querySelector('.tab.on'); const r = b.getBoundingClientRect(), f = t.getBoundingClientRect(); return { on: b.textContent, dentro: r.left >= f.left - 1 && r.right <= f.right + 1, scroll: t.scrollLeft }; });
    assert.equal(vis.on, 'Pizzas');
    assert.ok(vis.dentro && vis.scroll > 0, 'la categoría elegida sigue a la vista en la fila: ' + JSON.stringify(vis));
    step('Elegir "Pizzas": la fila de categorías no vuelve al principio y Pizzas queda a la vista');
    // 2. Bajar en la lista y cambiar de categoría: queda al comienzo de la nueva lista, no arriba de todo
    await p.click(fila + ' .tab:text-is("Sándwiches")');
    await p.waitForSelector('.prod:has-text("Pollo al curry")');
    await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await p.waitForTimeout(300);
    const fija = await p.$eval(fila, (t) => Math.round(t.getBoundingClientRect().top));
    assert.ok(fija >= 0 && fija < 10, 'la barra de categorías queda fija arriba al bajar en la lista (top=' + fija + ')');
    step('Al bajar en la lista, las categorías quedan fijas arriba (no hay que volver al inicio para cambiar)');
    await p.click(fila + ' .tab:text-is("Pizzas")');
    await p.waitForTimeout(800);
    const pos = await p.evaluate(() => ({ y: window.scrollY, lista: document.querySelector('[data-list]').getBoundingClientRect().top, fila: document.querySelector('.tabs.cats').getBoundingClientRect().bottom }));
    assert.ok(Math.abs(pos.lista - pos.fila) < 30, 'la lista nueva empieza justo debajo de las categorías: ' + JSON.stringify(pos));
    step('Desde abajo de la lista, al cambiar a "Pizzas" queda al comienzo de la nueva categoría');
    // 3. Recargar: sigue en Lomitos
    await p.reload();
    await p.waitForSelector('.prod');
    assert.equal(await p.textContent(fila + ' .tab.on'), 'Pizzas');
    step('Al recargar la carta sigue en la categoría elegida');
    // 4. Escribir en el buscador letra por letra: el teclado no se cierra (el campo nunca se reemplaza ni pierde el foco)
    await p.tap('[data-search]');
    await p.evaluate(() => { window.__busc = document.querySelector('[data-search]'); });
    for (const ch of 'pizza') {
      await p.keyboard.type(ch, { delay: 60 });
      const ok = await p.evaluate(() => document.activeElement === window.__busc && window.__busc.isConnected);
      assert.ok(ok, 'el buscador sigue con el foco después de escribir "' + ch + '"');
    }
    assert.equal(await p.inputValue('[data-search]'), 'pizza');
    await p.waitForSelector('.prod:has-text("Margarita")');
    step('Buscar "pizza" letra por letra: el teclado no se cierra y los resultados aparecen mientras escribe');
    // 5. Buscar oculta las categorías y al borrar vuelven
    await p.fill('[data-search]', 'espresso');
    assert.equal(await p.isVisible(fila), false);
    await p.fill('[data-search]', '');
    assert.equal(await p.isVisible(fila), true);
    step('El buscador oculta las categorías mientras se busca');
    assert.deepEqual(errors, []);
    console.log('\nE2E Carta OK');
  } catch (e) {
    console.error('FALLÓ:', e.message); console.error(errors.join('\n')); process.exitCode = 1;
  } finally { await browser.close(); srv.kill(); }
})();
