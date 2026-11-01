'use strict';
/*
 * Cargar la carta con IA en el navegador, como lo usa el encargado:
 * Catálogo → "📷 Cargar carta con IA" → sube una foto (se achica en el navegador) → revisa la propuesta
 * (el servidor de pruebas usa la carta de ejemplo en lugar de Vertex AI) → completa un precio que faltaba →
 * importa → los productos aparecen en el catálogo como "Por validar".
 * Uso: node tests/e2e-carta-ia.js
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
  const srv = spawn(process.execPath, [path.join(__dirname, 'e2e-server.js')], { stdio: ['ignore', 'pipe', 'inherit'], env: Object.assign({}, process.env, { MESA_PLAN: '', MESA_MODULOS: '' }) });
  const info = await new Promise((res) => srv.stdout.once('data', (d) => res(JSON.parse(String(d)))));
  const BASE = 'http://127.0.0.1:' + info.port;
  const browser = await pw.chromium.launch();
  const errors = [];
  const modal = '.overlay:has([data-ia-leer])';
  try {
    const c = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'es-PY', timezoneId: 'America/Asuncion' });
    await c.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const p = await c.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/fonts|ERR_FAILED|net::|status of 4[0-9][0-9]/.test(m.text())) errors.push('console: ' + m.text()); });
    const toast = (re) => p.waitForFunction((src) => [...document.querySelectorAll('.toast')].some((t) => new RegExp(src).test(t.textContent)), re.source, { timeout: 8000 });

    await p.goto(BASE + '/admin'); await p.fill('#lg-u', 'admin');
    for (const k of '246810') await p.click(`[data-k="${k}"]`);
    await p.click('[data-k="ok"]');
    await p.waitForSelector('[data-tab="catalogo"]');
    await p.click('[data-tab="catalogo"]');
    await p.click('[data-cartaia]');
    await p.waitForSelector(modal + ' [data-ia-files]');
    step('Catálogo → "📷 Cargar carta con IA" abre la subida de fotos o PDF');

    // Sin archivo: avisa y no llama al servidor
    await p.click(modal + ' [data-ia-leer]');
    await toast(/al menos una foto/);

    // Una "foto" grande (3000×2000) generada en el navegador: se achica antes de subir
    const png = await p.evaluate(() => { const cv = document.createElement('canvas'); cv.width = 3000; cv.height = 2000; const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 3000, 2000); g.fillStyle = '#000'; g.font = '120px sans-serif'; g.fillText('CARTA · Cortado 14.000', 100, 300); return cv.toDataURL('image/png').split(',')[1]; });
    await p.setInputFiles(modal + ' [data-ia-files]', { name: 'carta.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    const prep = await p.evaluate(() => CartaIAUI.prepararArchivos(document.querySelector('[data-ia-files]').files).then((a) => a.map((x) => ({ mime: x.mime, kb: Math.round(x.datos.length * 3 / 4 / 1024) }))));
    assert.equal(prep[0].mime, 'image/jpeg');
    assert.ok(prep[0].kb < 1500, 'la foto se achica: ' + prep[0].kb + ' KB');
    step('La foto se achica en el navegador (' + prep[0].kb + ' KB, JPG) antes de subir');

    await p.click(modal + ' [data-ia-leer]');
    await p.waitForSelector(modal + ' [data-ia-row]');
    const filas = await p.$$eval(modal + ' [data-ia-row]', (rs) => rs.length);
    assert.equal(filas, 9);
    assert.match(await p.textContent(modal), /carta de ejemplo/);
    assert.match(await p.textContent(modal), /sin precio legible/);
    // Lo que no tiene precio queda sin marcar
    const chipa = modal + ' [data-ia-row]:has(input[value="Chipa so\'o"])';
    assert.equal(await p.isChecked(chipa + ' [data-k="incluir"]'), false);
    assert.equal(await p.isChecked(modal + ' [data-ia-row]:has(input[value="Espresso"]) [data-k="incluir"]'), false, 'el Espresso ya está en la carta del local');
    assert.match(await p.textContent(modal + ' [data-ia-row]:has(input[value="Espresso"])'), /Ya está en tu carta/);
    assert.match(await p.textContent(modal + ' [data-ia-importar]'), /Importar 7 productos/);
    await p.screenshot({ path: path.join(OUT, 'carta-ia-revisar.png'), fullPage: true });
    step('Propuesta para revisar: 9 productos, avisos; lo que no tiene precio y lo que ya está quedan sin marcar (Importar 7)');

    // Si se marca sin precio, no deja importar
    await p.check(chipa + ' [data-k="incluir"]');
    await p.click(modal + ' [data-ia-importar]');
    await toast(/Falta el precio de: Chipa/);
    // Se completa el precio y se corrige un nombre
    await p.fill(chipa + ' [data-k="precio"]', '5.000');
    await p.fill(modal + ' [data-ia-row]:has(input[value="Cortado"]) [data-k="nombre"]', 'Cortado de la casa');
    // Un producto que no se quiere
    await p.uncheck(modal + ' [data-ia-row]:has(input[value="Jugo de naranja"]) [data-k="incluir"]');
    assert.match(await p.textContent(modal + ' [data-ia-importar]'), /Importar 7 productos/);
    await p.click(modal + ' [data-ia-importar]');
    await toast(/7 productos importados/);
    step('Se corrige lo que hace falta, se completa el precio que faltaba y se importan 7 productos');

    await p.waitForSelector('td:has-text("Cortado de la casa")');
    const fila = await p.textContent('tr:has-text("Cortado de la casa")');
    assert.match(fila, /Por validar/);
    assert.match(fila, /14\.000/);
    assert.match(await p.textContent('tr:has-text("Chipa so\'o")'), /5\.000/);
    assert.equal(await p.$('td strong:text-is("Jugo de naranja")'), null);
    const cats = await p.$$eval('#catf option', (o) => o.map((x) => x.textContent));
    assert.ok(cats.includes('Tostados y sándwiches'), 'categoría nueva: ' + cats.join(', '));
    await p.screenshot({ path: path.join(OUT, 'carta-ia-importada.png'), fullPage: true });
    step('Los productos aparecen en el catálogo, con su categoría, como "Por validar"');

    // Leer otra vez: lo ya importado queda marcado "Ya está en tu carta" y sin marcar
    await p.click('[data-cartaia]');
    await p.setInputFiles(modal + ' [data-ia-files]', { name: 'carta.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    await p.click(modal + ' [data-ia-leer]');
    await p.waitForSelector(modal + ' [data-ia-row]');
    assert.equal(await p.isChecked(modal + ' [data-ia-row]:has(input[value="Cappuccino"]) [data-k="incluir"]'), false);
    assert.match(await p.textContent(modal + ' [data-ia-row]:has(input[value="Cappuccino"])'), /Ya está en tu carta/);
    step('Al leer otra vez, lo que ya está en la carta queda sin marcar para no duplicarlo');

    assert.deepEqual(errors, []);
    console.log('\nE2E carta con IA: OK');
  } catch (e) {
    console.error('✘', e.message); console.error(errors.join('\n')); process.exitCode = 1;
  } finally { await browser.close(); srv.kill(); }
})();
