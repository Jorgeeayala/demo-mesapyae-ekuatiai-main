'use strict';
/*
 * Upgrade "Stock y costos" en el navegador, como lo usa el encargado:
 * carga insumos → registra una compra (en kg y litros) → arma la receta del Latte (con syrup como opción) →
 * el mozo vende → el stock baja solo → conteo con diferencia valorizada → margen por plato y reporte.
 * Uso: node tests/e2e-stock.js
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
  const srv = spawn(process.execPath, [path.join(__dirname, 'e2e-server.js')], { stdio: ['ignore', 'pipe', 'inherit'], env: Object.assign({}, process.env, { MESA_PLAN: '', MESA_MODULOS: 'STOCK' }) });
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
  const shot = (p, n) => p.screenshot({ path: path.join(OUT, 'stock-' + n + '.png'), fullPage: true });
  const toast = (p, re) => p.waitForFunction((src) => [...document.querySelectorAll('.toast')].some((t) => new RegExp(src).test(t.textContent)), re.source, { timeout: 8000 });
  const modal = '.overlay:last-child';
  const DESK = { width: 1366, height: 900 }, PHONE = { width: 390, height: 844 };
  try {
    const adm = await ctx('admin', DESK);
    await login(adm.p, '/admin', 'admin', '246810');
    await adm.p.waitForSelector('[data-tab="stock"]');
    await adm.p.click('[data-tab="stock"]');
    await adm.p.waitForSelector('#stock-root [data-ins=""]');
    step('Con el Upgrade activo aparece la pestaña "💰 Mesa Viru" en Administración');

    async function nuevoInsumo(nombre, unidad, minimo, umin) {
      await adm.p.click('#stock-root [data-ins=""]');
      await adm.p.fill(modal + ' [data-i="nombre"]', nombre);
      await adm.p.selectOption(modal + ' [data-i="unidad"]', unidad);
      if (minimo) { await adm.p.fill(modal + ' [data-i="minimo"]', minimo); if (umin) await adm.p.selectOption(modal + ' select[data-i="umin"]', umin); }
      await adm.p.click(modal + ' [data-ok]');
      await toast(adm.p, /Insumo guardado/);
      await adm.p.waitForSelector('#stock-root td:has-text("' + nombre + '")');
    }
    await nuevoInsumo('Café en grano', 'G', '0,5', 'kg');
    await nuevoInsumo('Leche entera', 'ML', '2', 'l');
    await nuevoInsumo('Syrup vainilla', 'ML');
    step('Carga tres insumos: café (avisar con menos de 0,5 kg), leche (menos de 2 l) y syrup');

    // Compra: 2 kg de café por Gs. 260.000, 10 litros de leche por Gs. 85.000, 750 ml de syrup por Gs. 60.000
    await adm.p.click('#stock-root [data-compra]');
    await adm.p.fill(modal + ' [data-prov]', 'Distribuidora Central');
    const fila = async (ix, nombre, cant, u, costo) => {
      if (ix > 0) await adm.p.click(modal + ' [data-add]');
      const tr = modal + ' [data-fila="' + ix + '"]';
      const val = await adm.p.$eval(tr + ' [data-c="ins"]', (s, n) => [...s.options].find((o) => o.textContent.startsWith(n)).value, nombre);
      await adm.p.selectOption(tr + ' [data-c="ins"]', val);
      await adm.p.fill(tr + ' [data-c="cant"]', cant);
      if (u) await adm.p.selectOption(tr + ' select[data-c="u"]', u);
      await adm.p.fill(tr + ' [data-c="costo"]', costo);
    };
    await fila(0, 'Café en grano', '2', 'kg', '260.000');
    await fila(1, 'Leche entera', '10', 'l', '85000');
    await fila(2, 'Syrup vainilla', '750', 'ml', '60000');
    assert.match(await adm.p.textContent(modal + ' [data-total]'), /405\.000/);
    await shot(adm.p, 'compra');
    await adm.p.click(modal + ' [data-ok]');
    await toast(adm.p, /Compra registrada: Gs\. 405\.000/);
    await adm.p.waitForSelector('#stock-root tr:has-text("Café en grano") td:has-text("2 kg")');
    assert.match(await adm.p.textContent('#stock-root tr:has-text("Café en grano")'), /130\.000 \/ kg/);
    assert.match(await adm.p.textContent('#stock-root .kpis'), /405\.000/);
    step('Registra la compra en kg y litros: café 2 kg a Gs. 130.000/kg, valor del stock Gs. 405.000');

    // Receta del Latte: 9 g de café + 200 ml de leche; la opción Vainilla suma 15 ml de syrup
    await adm.p.click('#stock-root [data-stv="costos"]');
    await adm.p.click('#stock-root [data-receta="LATTE"]');
    const sel = async (rowSel, nombre) => {
      const v = await adm.p.$eval(rowSel + ' [data-r="ins"]', (s, n) => [...s.options].find((o) => o.textContent.startsWith(n)).value, nombre);
      await adm.p.selectOption(rowSel + ' [data-r="ins"]', v);
    };
    await sel(modal + ' [data-l="|0"]', 'Café en grano');
    await adm.p.fill(modal + ' [data-l="|0"] [data-r="cant"]', '9');
    await adm.p.click(modal + ' [data-mas=""]');
    await sel(modal + ' [data-l="|1"]', 'Leche entera');
    await adm.p.fill(modal + ' [data-l="|1"] [data-r="cant"]', '200');
    await adm.p.waitForFunction(() => /2\.870/.test(document.querySelector('.overlay:last-child [data-costo]').textContent));
    await adm.p.click(modal + ' details summary');
    await adm.p.click(modal + ' [data-mas="SY_VAI"]');
    await sel(modal + ' [data-l="SY_VAI|0"]', 'Syrup vainilla');
    await adm.p.fill(modal + ' [data-l="SY_VAI|0"] [data-r="cant"]', '15');
    await shot(adm.p, 'receta');
    await adm.p.click(modal + ' [data-ok]');
    await toast(adm.p, /Receta guardada/);
    await adm.p.waitForSelector('#stock-root [data-margen="LATTE"]');
    assert.match(await adm.p.textContent('#stock-root [data-margen="LATTE"]'), /86 %/);
    assert.match(await adm.p.textContent('#stock-root tr:has([data-receta="LATTE"])'), /Vainilla \+Gs\. 1\.200/);
    await shot(adm.p, 'margen');
    step('Arma la receta del Latte (9 g café + 200 ml leche; Vainilla suma 15 ml de syrup): costo Gs. 2.870, margen 86 %');

    // El mozo vende 3 Latte, uno con vainilla: el stock baja solo
    const mozo = await ctx('mozo', PHONE, { isMobile: true, hasTouch: true });
    await login(mozo.p, '/pedidos', 'mozo', '1111');
    await mozo.p.waitForSelector('.mesa');
    const m2 = (await api(mozo.p, 'sync', {})).mesas.find((m) => m.numero === 2);
    await api(mozo.p, 'order.create', { mesa_id: m2.mesa_id, request_id: 'req-e2e-stock-' + Date.now(), items: [{ producto_id: 'LATTE', cantidad: 2, opciones: [] }, { producto_id: 'LATTE', cantidad: 1, opciones: ['SY_VAI'] }] });
    await adm.p.click('[data-tab="catalogo"]'); await adm.p.click('[data-tab="stock"]');
    await adm.p.click('#stock-root [data-stv="insumos"]');
    await adm.p.waitForSelector('#stock-root tr:has-text("Café en grano") td:has-text("1,973 kg")');
    assert.match(await adm.p.textContent('#stock-root tr:has-text("Leche entera")'), /9,4 l/);
    assert.match(await adm.p.textContent('#stock-root tr:has-text("Syrup vainilla")'), /735 ml/);
    step('El mozo vende 3 Latte (uno con vainilla): café 1,973 kg, leche 9,4 l, syrup 735 ml, sin que nadie toque nada');

    // Conteo: hay 1,9 kg de café (faltan 73 g = Gs. 9.490)
    await adm.p.click('#stock-root [data-conteo]');
    await adm.p.fill(modal + ' [data-row]:has-text("Café en grano") [data-cont]', '1,9');
    await adm.p.click(modal + ' [data-ok]');
    await adm.p.waitForSelector('.overlay h2:has-text("Resultado del conteo"), .overlay :text("Resultado del conteo")');
    const res = await adm.p.textContent(modal);
    assert.match(res, /-73 g/); assert.match(res, /-Gs\. 9\.490/);
    await shot(adm.p, 'conteo');
    await adm.p.click(modal + ' [data-x]');
    step('Conteo: debían quedar 1,973 kg y hay 1,9 kg → faltan 73 g, Gs. 9.490 (queda registrado y valorizado)');

    // Merma de leche hasta quedar bajo el mínimo → "Para comprar"
    await adm.p.click('#stock-root tr:has-text("Leche entera") [data-merma]');
    await adm.p.fill(modal + ' [data-q]', '8');
    await adm.p.selectOption(modal + ' select[data-u]', 'l');
    await adm.p.fill(modal + ' [data-m]', 'Se cortó');
    await adm.p.click(modal + ' [data-ok]');
    await toast(adm.p, /Merma registrada/);
    await adm.p.waitForSelector('#stock-root .banner:has-text("Para comprar")');
    assert.match(await adm.p.textContent('#stock-root .banner:has-text("Para comprar")'), /Leche entera/);
    await adm.p.click('#stock-root [data-stv="movs"]');
    const movs = await adm.p.textContent('#stock-root #st-vista');
    for (const t of ['Compra', 'Venta', 'Conteo', 'Merma']) assert.match(movs, new RegExp(t));
    await shot(adm.p, 'insumos');
    step('Merma de 8 l de leche: queda bajo el mínimo y aparece en "Para comprar"; los movimientos quedan registrados');

    // Resumen: costo de insumos, ganancia bruta y margen por plato
    await adm.p.click('[data-tab="resumen"]');
    await adm.p.click('[data-rep]');
    await adm.p.waitForFunction(() => /65\.000/.test((document.querySelector('[data-stock-kpis]') || {}).textContent || ''), null, { timeout: 8000 });
    const k = await adm.p.textContent('[data-stock-kpis]');
    assert.match(k, /Gs\. 65\.000/); assert.match(k, /Gs\. 9\.810/); assert.match(k, /Gs\. 55\.190/); assert.match(k, /margen 85 %/);
    await shot(adm.p, 'resumen');
    step('Resumen: ventas con receta Gs. 65.000, costo de insumos Gs. 9.810, ganancia bruta Gs. 55.190 (85 %)');

    assert.deepEqual(errors, [], 'errores en el navegador: ' + errors.join('\n'));
    console.log('\nE2E stock y costos: OK');
    await browser.close(); srv.kill(); process.exit(0);
  } catch (e) {
    console.error(e); console.error(errors.join('\n'));
    await browser.close(); srv.kill(); process.exit(1);
  }
})();
