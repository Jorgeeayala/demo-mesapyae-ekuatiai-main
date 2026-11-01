'use strict';
/*
 * Plan Gold — prueba de punta a punta en navegador: Menú 3D + Reseñas.
 * El visor 3D (model-viewer) se carga de un CDN; en esta prueba se reemplaza por un visor mínimo local
 * para comprobar la integración sin depender de internet.
 * Uso: node tests/e2e-gold.js   (capturas en tests/capturas/gold-*.png)
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const assert = require('assert/strict');
let pw;
try { pw = require('playwright'); } catch (e) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const OUT = path.join(__dirname, 'capturas');
fs.mkdirSync(OUT, { recursive: true });
function step(msg) { console.log('✔ ' + msg); }
// Visor de reemplazo: registra <model-viewer> y comprueba que el .glb llega y es un glTF binario válido
const STUB = "customElements.define('model-viewer', class extends HTMLElement { connectedCallback() { const s = this.getAttribute('src'); fetch(s).then(r => r.arrayBuffer()).then(b => { const v = new DataView(b); this.dataset.ok = v.getUint32(0, true) === 0x46546C67 ? 'glb' : 'mal'; this.innerHTML = '<div style=\"padding:40px;text-align:center\">Modelo ' + s + ' (' + b.byteLength + ' bytes)</div>' + this.innerHTML; }); } });";

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, 'e2e-server.js')], { stdio: ['ignore', 'pipe', 'inherit'], env: Object.assign({}, process.env, { MESA_PLAN: 'GOLD', MESA_MODULOS: 'MENU3D' }) }); // Gold + 3D como módulo suelto (el 3D viene en Premium)
  const info = await new Promise((res) => srv.stdout.once('data', (d) => res(JSON.parse(String(d)))));
  const BASE = 'http://127.0.0.1:' + info.port;
  const browser = await pw.chromium.launch();
  const errors = [];
  async function ctx(name, viewport, opts) {
    const c = await browser.newContext(Object.assign({ viewport, locale: 'es-PY', timezoneId: 'America/Asuncion' }, opts || {}));
    await c.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await c.route(/cdn\.jsdelivr\.net\/npm\/@google\/model-viewer/, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: STUB }));
    await c.route(/\/modelos\/[a-z]+\.glb$/, (r) => r.fulfill({ status: 200, contentType: 'model/gltf-binary', body: fs.readFileSync(path.join(__dirname, '..', 'demo', 'modelos', r.request().url().split('/').pop())) }));
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
  const shot = (p, n) => p.screenshot({ path: path.join(OUT, 'gold-' + n + '.png'), fullPage: true });
  const api = (p, action, payload) => p.evaluate(([a, pl]) => Mesa.call(a, pl), [action, payload]);
  const PHONE = { width: 390, height: 844 }, DESK = { width: 1366, height: 900 };
  // Los modelos de ejemplo están en demo/modelos (no se publican en los locales)
  try {
    // 1. Encargado: carga el modelo 3D del Espresso y el link de Google
    const adm = await ctx('admin', DESK);
    await login(adm.p, '/admin', 'admin', '246810');
    await adm.p.waitForSelector('[data-tab="resenas"]');
    assert.equal(await adm.p.$('[data-tab="recompensas"]'), null, 'Gold no incluye Recompensas');
    await adm.p.click('[data-tab="catalogo"]');
    await adm.p.click('[data-edit="ESPRESSO"]');
    await adm.p.fill('[data-f="modelo_3d"]', 'modelos/espresso.glb');
    await adm.p.click('.sheet [data-save]');
    await adm.p.waitForSelector('.toast:has-text("Producto guardado")');
    await adm.p.click('[data-tab="resenas"]');
    await adm.p.fill('[data-resc="res_google_url"]', 'https://g.page/r/andrade-demo/review');
    await adm.p.click('[data-ressave]');
    await adm.p.waitForSelector('.toast:has-text("Guardado")');
    step('Encargado carga el modelo 3D del Espresso y el link de reseñas de Google');

    // 2. Cliente: ve el plato en 3D desde la carta y pide
    const cli = await ctx('cliente', PHONE, { isMobile: true, hasTouch: true });
    await cli.p.goto(BASE + '/menu?t=' + info.mesas[0]);
    await cli.p.fill('[data-search]', 'espresso');
    await cli.p.waitForSelector('.v3d-chip');
    await shot(cli.p, '01-carta-con-3d');
    await cli.p.click('.v3d-chip');
    await cli.p.waitForSelector('model-viewer[data-ok="glb"]');
    assert.equal(await cli.p.getAttribute('model-viewer', 'src'), 'modelos/espresso.glb');
    assert.ok(await cli.p.isVisible('.v3d-ar'));
    await shot(cli.p, '02-visor-3d');
    await cli.p.click('[data-add3d]');
    if (await cli.p.waitForSelector('.sheet [data-add]', { timeout: 2000 }).catch(() => null)) {
      assert.ok(await cli.p.isVisible('.sheet [data-ver3d]'), 'la ficha del producto también ofrece ver en 3D');
      await cli.p.click('.sheet [data-add]');
    }
    await cli.p.waitForSelector('.toast:has-text("Espresso agregado")');
    await cli.p.click('[data-open-cart]'); await cli.p.click('[data-send]');
    await cli.p.waitForSelector('text=A-001');
    step('Cliente abre el Espresso en 3D (modelo .glb válido, botón Ver en mi mesa) y lo agrega al pedido');

    // 3. El pedido sale y el cliente recibe la encuesta + Google
    const caja = await ctx('caja', DESK);
    await login(caja.p, '/caja', 'cajaa', '3333');
    await caja.p.waitForSelector('.topbar');
    const sync = await api(caja.p, 'sync', {});
    const ped = sync.pedidos.find((x) => x.numero === 'A-001');
    await api(caja.p, 'order.state', { pedido_id: ped.pedido_id, estado: 'ACEPTADO', desde: 'PENDIENTE' });
    const coc = await ctx('cocina', DESK); await login(coc.p, '/cocina', 'cocina', '2222'); await coc.p.waitForSelector('.topbar');
    await api(coc.p, 'order.state', { pedido_id: ped.pedido_id, estado: 'LISTO', desde: 'ACEPTADO' });
    await cli.p.waitForSelector('#resena', { timeout: 15000 });
    assert.ok(await cli.p.isVisible('#res-g'), 'Google visible antes de calificar (sin filtro)');
    await cli.p.click('[data-st="4"]');
    await cli.p.fill('#res-com', 'Muy rico, el espresso en 3D es genial');
    await shot(cli.p, '03-encuesta');
    await cli.p.click('#res-env');
    await cli.p.waitForSelector('text=¡Gracias por contarnos!');
    assert.equal(await cli.p.getAttribute('#res-g', 'href'), 'https://g.page/r/andrade-demo/review');
    await shot(cli.p, '04-gracias-google');
    step('Al estar listo, el cliente califica 4★ con comentario y ve el botón de Google (también antes de calificar)');

    // 4. Encuesta desde el QR de la mesa (cliente que pidió al mozo)
    const c2 = await ctx('cliente2', PHONE, { isMobile: true });
    await c2.p.goto(BASE + '/resena?t=' + info.mesas[1]);
    await c2.p.click('[data-st="2"]'); await c2.p.fill('#c', 'Tardó bastante');
    await c2.p.click('#ok');
    await c2.p.waitForSelector('text=¡Gracias!');
    step('Encuesta desde el QR de la Mesa 2 (2★)');

    // 5. Panel de reseñas
    await adm.p.click('[data-tab="resumen"]'); await adm.p.click('[data-tab="resenas"]');
    await adm.p.waitForSelector('.res-baja');
    assert.match(await adm.p.textContent('.kpis'), /3\.0 ★/);
    await shot(adm.p, '05-panel-resenas');
    await adm.p.click('[data-resleida]');
    await adm.p.waitForSelector('.chip:has-text("Todo revisado")');
    step('Panel: promedio 3.0★, distribución, opinión baja marcada como revisada');

    assert.deepEqual(errors, []);
    console.log('\nE2E Gold OK');
  } catch (e) {
    console.error('FALLÓ:', e.message); console.error(errors.join('\n')); process.exitCode = 1;
  } finally { await browser.close(); srv.kill(); }
})();
