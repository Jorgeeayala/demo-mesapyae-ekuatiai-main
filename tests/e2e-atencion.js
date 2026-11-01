'use strict';
/*
 * Upgrade "Atención Integrada" en el navegador (Whaticket simulado por el servidor de desarrollo):
 * Ser o Límites prueba la conexión y elige el número → el encargado prende los avisos →
 * un cliente pide para llevar con su WhatsApp → la caja acepta y la cocina lo marca listo →
 * los dos avisos salen solos y quedan en «Últimos avisos».
 * Uso: node tests/e2e-atencion.js
 */
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), crypto = require('crypto'), assert = require('assert/strict');
let pw; try { pw = require('playwright'); } catch (e) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const OUT = path.join(__dirname, 'capturas'); fs.mkdirSync(OUT, { recursive: true });
const sha = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
const SALT = 'e2esaltatencion1'; let H = SALT + ':' + '135790'; for (let i = 0; i < 300; i++) H = sha(H + ':' + SALT);
function step(msg) { console.log('✔ ' + msg); }

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, 'e2e-server.js')], { stdio: ['ignore', 'pipe', 'inherit'], env: Object.assign({}, process.env, { MESA_PLAN: '', MESA_MODULOS: 'ATENCION', MESA_PLATAFORMA: 'sol:' + SALT + ':' + H }) });
  const info = await new Promise((res) => srv.stdout.once('data', (d) => res(JSON.parse(String(d)))));
  const BASE = 'http://127.0.0.1:' + info.port;
  const br = await pw.chromium.launch(); const errors = [];
  async function page(viewport) {
    const c = await br.newContext({ viewport: viewport || { width: 1366, height: 900 }, locale: 'es-PY', timezoneId: 'America/Asuncion' });
    await c.route(/fonts\./, (r) => r.abort());
    const p = await c.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/fonts|ERR_FAILED|net::|status of 4[0-9][0-9]/.test(m.text())) errors.push('console: ' + m.text()); });
    return p;
  }
  async function login(p, url, u, pin) { await p.goto(BASE + url); await p.fill('#lg-u', u); for (const k of pin) await p.click(`[data-k="${k}"]`); await p.click('[data-k="ok"]'); }
  const api = (p, action, payload) => p.evaluate(([a, pl]) => Mesa.call(a, pl), [action, payload]);
  const toast = (p, re) => p.waitForFunction((src) => [...document.querySelectorAll('.toast')].some((t) => new RegExp(src).test(t.textContent)), re.source, { timeout: 8000 });
  const shot = (p, n) => p.screenshot({ path: path.join(OUT, 'atencion-' + n + '.png'), fullPage: true });
  try {
    // Ser o Límites: prueba la conexión y elige el número
    const sol = await page();
    await login(sol, '/admin', 'sol', '135790');
    await sol.waitForSelector('[data-tab="whatsapp"]');
    await sol.click('[data-tab="whatsapp"]');
    await sol.waitForSelector('#wa-root [data-probar]');
    assert.match(await sol.textContent('#wa-root [data-conexion]'), /sin conectar/);
    assert.ok(await sol.$('#wa-root [data-sinwa]'), 'avisa que la carta para llevar no pide WhatsApp');
    await sol.click('#wa-root [data-probar]');
    await toast(sol, /Conexión con Whaticket OK/);
    await sol.waitForSelector('#wa-root #wa-conexion');
    await sol.click('#wa-root [data-conectar]');
    await toast(sol, /Número guardado/);
    await sol.waitForSelector('#wa-root [data-conexion]:has-text("WhatsApp del local (prueba)")');
    step('Ser o Límites prueba la conexión con Whaticket y elige el número del local');

    // El encargado: pide WhatsApp en para llevar y prende los dos avisos
    const adm = await page();
    await login(adm, '/admin', 'admin', '246810');
    await adm.waitForSelector('[data-tab="whatsapp"]');
    await api(adm, 'admin.config', { clave: 'para_llevar_whatsapp', valor: 'OPCIONAL' });
    await adm.click('[data-tab="whatsapp"]');
    await adm.waitForSelector('#wa-root #wa-modo');
    assert.equal(await adm.$('#wa-root [data-probar]'), null, 'el encargado no ve «Probar conexión»');
    assert.equal(await adm.$('#wa-root [data-sinwa]'), null);
    await adm.selectOption('#wa-root #wa-modo', 'AMBOS');
    await adm.click('#wa-root [data-guardar]');
    await toast(adm, /Avisos guardados/);
    await shot(adm, 'config');
    step('El encargado prende los avisos «recibido» y «listo» (con sus mensajes)');

    // Un cliente pide para llevar desde el QR con su WhatsApp; la caja acepta y la cocina lo marca listo
    const cli = await page({ width: 390, height: 844 });
    await cli.goto(BASE + '/menu?t=' + info.takeaway);
    await cli.waitForSelector('body');
    const r = await cli.evaluate((tk) => Mesa.call('public.order', { token: tk, request_id: 'req-e2e-wa-' + Date.now(), alias: 'Ana', whatsapp: '0981 123 456', items: [{ producto_id: 'ESPRESSO', cantidad: 1, opciones: [] }] }), info.takeaway);
    const caja = await page();
    await login(caja, '/caja', 'cajab', '4444');
    await caja.waitForSelector('body');
    const pend = (await api(caja, 'sync', {})).pedidos.find((x) => x.numero === r.numero);
    await api(caja, 'order.state', { pedido_id: pend.pedido_id, estado: 'ACEPTADO' });
    const coc = await page();
    await login(coc, '/cocina', 'cocina', '2222');
    await coc.waitForSelector('body');
    await api(coc, 'order.state', { pedido_id: pend.pedido_id, estado: 'LISTO' });
    step('Cliente «Ana» pide para llevar con su WhatsApp; la caja lo acepta y la cocina lo marca listo');

    // Los dos avisos salieron solos
    await adm.click('[data-tab="resumen"]'); await adm.click('[data-tab="whatsapp"]');
    await adm.waitForSelector('#wa-root tr[data-aviso]');
    const filas = await adm.$$eval('#wa-root tr[data-aviso]', (rs) => rs.map((x) => x.textContent));
    assert.equal(filas.length, 2, filas.join(' | '));
    for (const f of filas) { assert.match(f, new RegExp(r.numero)); assert.match(f, /Enviado/); assert.match(f, /0981 ••• 456/); }
    assert.ok(filas.some((f) => /Recibido/.test(f)) && filas.some((f) => /Listo/.test(f)));
    await shot(adm, 'avisos');
    step('Salen los dos avisos por WhatsApp (recibido y listo) y quedan en «Últimos avisos», con el número tapado');

    assert.deepEqual(errors, [], 'errores en el navegador: ' + errors.join('\n'));
    console.log('\nE2E Atención Integrada: OK');
    await br.close(); srv.kill(); process.exit(0);
  } catch (e) {
    console.error(e); console.error(errors.join('\n'));
    await br.close(); srv.kill(); process.exit(1);
  }
})();
