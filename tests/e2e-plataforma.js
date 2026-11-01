'use strict';
/* Panel de licencias de Ser o Límites en navegador: activar planes por local sin publicar.  node tests/e2e-plataforma.js */
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), crypto = require('crypto'), assert = require('assert/strict');
let pw; try { pw = require('playwright'); } catch (e) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const OUT = path.join(__dirname, 'capturas'); fs.mkdirSync(OUT, { recursive: true });
const sha = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
const SALT = 'e2esaltplataforma'; let H = SALT + ':' + '135790'; for (let i = 0; i < 300; i++) H = sha(H + ':' + SALT);
(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, 'e2e-server.js')], { stdio: ['ignore', 'pipe', 'inherit'], env: Object.assign({}, process.env, { MESA_PLAN: '', MESA_MODULOS: '', MESA_PLATAFORMA: 'sol:' + SALT + ':' + H }) });
  const info = await new Promise((res) => srv.stdout.once('data', (d) => res(JSON.parse(String(d)))));
  const BASE = 'http://127.0.0.1:' + info.port;
  const br = await pw.chromium.launch(); const errors = [];
  async function page() { const c = await br.newContext({ viewport: { width: 1366, height: 900 } }); await c.route(/fonts\./, (r) => r.abort()); const p = await c.newPage(); p.on('pageerror', (e) => errors.push(e.message)); return p; }
  async function login(p, u, pin) { await p.goto(BASE + '/admin'); await p.fill('#lg-u', u); for (const k of pin) await p.click(`[data-k="${k}"]`); await p.click('[data-k="ok"]'); await p.waitForSelector('[data-tab="resumen"]'); }
  const tabs = (p) => p.$$eval('.tabs [data-tab]', (x) => x.map((e) => e.getAttribute('data-tab')));
  try {
    const sol = await page(); await login(sol, 'sol', '135790');
    assert.ok((await tabs(sol)).includes('licencia'));
    await sol.click('[data-tab="licencia"]'); await sol.waitForSelector('[data-lic="PREMIUM"]');
    await sol.fill('#licnota', 'Prueba de activación'); await sol.click('[data-lic="PREMIUM"]'); await sol.click('.sheet [data-ok]');
    await sol.waitForSelector('.toast:has-text("Plan actualizado: Premium")');
    await sol.screenshot({ path: path.join(OUT, 'plataforma-licencia.png'), fullPage: true });
    const t = await tabs(sol); assert.ok(t.includes('recompensas') && t.includes('resenas'), String(t));
    console.log('✔ Ser o Límites activa Premium desde su panel');
    const adm = await page(); await login(adm, 'admin', '246810');
    const ta = await tabs(adm); assert.ok(!ta.includes('licencia') && ta.includes('recompensas'), String(ta));
    await adm.click('[data-tab="config"]'); await adm.waitForSelector('text=Mesa Pya\'e Premium');
    await adm.click('[data-tab="usuarios"]'); assert.ok(!(await adm.textContent('main')).includes('Ser o Límites'));
    console.log('✔ El encargado del local ve su plan Premium, pero no la pestaña de licencia ni el usuario de plataforma');
    await sol.click('[data-lic="BASICO"]'); await sol.click('.sheet [data-ok]'); await sol.waitForSelector('.toast:has-text("Plan actualizado: Básico")');
    await adm.reload(); await adm.waitForSelector('[data-tab="resumen"]');
    assert.ok(!(await tabs(adm)).includes('recompensas'));
    console.log('✔ Al volver a Básico, el local deja de ver Gold y Premium');
    // Upgrade e-Kuatia'i: se contrata aparte sobre cualquier plan (acá, sobre Básico)
    await sol.waitForSelector('[data-upg="EKUATIAI"][data-upg-on="SI"]');
    await sol.fill('#licnota', 'Pagó implementación e-Kuatia\'i'); await sol.click('[data-upg="EKUATIAI"]'); await sol.click('.sheet [data-ok]');
    await sol.waitForSelector('.toast:has-text("e-Kuatia\'i activado")');
    await sol.waitForSelector('[data-upg-card="EKUATIAI"] .chip:has-text("Activo")');
    const apiU = (p, a, pl) => p.evaluate(([x, y]) => Mesa.call(x, y), [a, pl]);
    let pl = (await apiU(adm, 'sync', {})).plan;
    assert.ok(pl.modulos.includes('EKUATIAI'), JSON.stringify(pl)); assert.equal(pl.nombre, 'BASICO');
    assert.ok((await adm.textContent('body')) !== null);
    assert.equal((await adm.evaluate(() => Mesa.call('plataforma.upgrade', { modulo: 'EKUATIAI', activo: false }).then(() => 'ok', (e) => e.code))), 'SIN_PERMISO');
    await sol.click('[data-upg="EKUATIAI"][data-upg-on="NO"]'); await sol.click('.sheet [data-ok]');
    await sol.waitForSelector('.toast:has-text("e-Kuatia\'i desactivado")');
    pl = (await apiU(adm, 'sync', {})).plan; assert.ok(!pl.modulos.includes('EKUATIAI'));
    console.log('✔ Ser o Límites activa y desactiva el Upgrade e-Kuatia\'i sin cambiar el plan; el encargado no puede');
    // Empezar de cero después de la capacitación: un pedido de prueba cobrado y la caja cerrada
    const api = (p, a, pl) => p.evaluate(([x, y]) => Mesa.call(x, y), [a, pl]);
    const ad0 = await api(adm, 'admin.data', {});
    const ped = (await api(adm, 'order.create', { request_id: 'e2e-rei-1', mesa_id: ad0.mesas[0].mesa_id, punto_id: 'A_CAFE', items: [{ producto_id: 'ESPRESSO', cantidad: 1, opciones: [] }] })).pedido;
    await api(adm, 'caja.abrir', { caja_id: 'CAJA_A', monto_inicial_gs: 0 });
    await api(adm, 'caja.cobrar', { request_id: 'e2e-rei-c1', cuenta_id: ped.cuenta_id, pagos: [{ medio: 'EFECTIVO', monto_gs: ped.total_gs }] });
    await api(adm, 'caja.cerrar', { caja_id: 'CAJA_A', efectivo_declarado_gs: ped.total_gs });
    await sol.reload(); await sol.waitForSelector('[data-tab="licencia"]'); await sol.click('[data-tab="licencia"]');
    await sol.click('[data-reiniciar]'); await sol.waitForSelector('.sheet [data-conf]');
    await sol.click('.sheet [data-ok]'); await sol.waitForSelector('.sheet [data-err]:has-text("REINICIAR")');
    await sol.fill('.sheet [data-conf]', 'reiniciar'); await sol.click('.sheet [data-ok]');
    await sol.waitForSelector('.toast:has-text("empieza de cero")');
    assert.equal((await api(adm, 'sync', {})).pedidos.length, 0);
    assert.equal((await api(adm, 'admin.data', {})).menu.productos.length, ad0.menu.productos.length);
    console.log('✔ Ser o Límites reinicia los datos de prueba con confirmación escrita; la carta se conserva');
    assert.deepEqual(errors, []); console.log('\nE2E Plataforma OK');
  } catch (e) { console.error('FALLÓ:', e.message, errors); process.exitCode = 1; } finally { await br.close(); srv.kill(); }
})();
