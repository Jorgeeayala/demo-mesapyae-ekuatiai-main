'use strict';
// Tiempo real: con el pulso activo, la consulta periódica pasa a 30 s y un aviso de pulso
// hace que la cocina muestre el pedido nuevo en menos de 2 s. (El pulso de Firestore se
// simula llamando a Mesa.onPulse, que es lo que hace realtime.js al recibir el cambio.)
const { spawn } = require('child_process'); const path = require('path'); const assert = require('assert/strict');
const pw = (() => { try { return require('playwright'); } catch (e) { return require('/opt/node22/lib/node_modules/playwright'); } })();
(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, 'e2e-server.js')], { stdio: ['ignore', 'pipe', 'inherit'], env: Object.assign({}, process.env, { BACKEND: 'firebase' }) });
  const info = await new Promise((r) => srv.stdout.once('data', (d) => r(JSON.parse(String(d)))));
  const B = 'http://127.0.0.1:' + info.port;
  const api = async (action, payload, token) => (await fetch(B + '/api', { method: 'POST', body: JSON.stringify({ action, payload, token }) })).json();
  const br = await pw.chromium.launch();
  try {
    const c = await br.newContext({ viewport: { width: 1280, height: 800 } }); await c.route(/fonts\./, (r) => r.abort());
    const p = await c.newPage();
    await p.goto(B + '/cocina.html'); await p.fill('#lg-u', 'cocina'); for (const k of '2222') await p.click(`[data-k="${k}"]`); await p.click('[data-k="ok"]');
    await p.waitForSelector('.kcol');
    await p.evaluate(() => Mesa.onPulse(1)); // tiempo real "conectado": la consulta periódica pasa a 30 s
    await p.waitForTimeout(1500);
    const moz = (await api('auth.login', { usuario: 'mozo', pin: '1111' })).data.token;
    const r1 = await api('order.create', { request_id: 'rt-test-0001', mesa_id: 'M06', items: [{ producto_id: 'COCIDO', cantidad: 1 }] }, moz);
    await p.waitForTimeout(5000);
    assert.equal(await p.locator('.ticket:has-text("Cocido")').count(), 0, 'sin pulso no se entera antes de la consulta de 30 s');
    const t0 = Date.now();
    await p.evaluate((rev) => Mesa.onPulse(rev), r1.pulse);
    await p.waitForSelector('.ticket:has-text("Cocido")', { timeout: 3000 });
    const ms = Date.now() - t0;
    assert.ok(ms < 2000, 'apareció en ' + ms + ' ms');
    console.log('TIEMPO REAL OK — pedido visible ' + ms + ' ms después del pulso');
  } catch (e) { console.error('TIEMPO REAL FALLÓ', e.message); process.exitCode = 1; } finally { await br.close(); srv.kill(); }
})();
