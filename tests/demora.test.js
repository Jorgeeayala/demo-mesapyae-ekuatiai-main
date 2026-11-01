'use strict';
// Verifica la alerta de demora en cocina: tarjeta amarilla, aviso y alarma sonora al superar cocina_alerta_min.
const { spawn } = require('child_process'); const path = require('path'); const assert = require('assert/strict');
const pw = (() => { try { return require('playwright'); } catch (e) { return require('/opt/node22/lib/node_modules/playwright'); } })();
(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, 'e2e-server.js')], { stdio: ['ignore', 'pipe', 'inherit'] });
  const info = await new Promise((r) => srv.stdout.once('data', (d) => r(JSON.parse(String(d)))));
  const B = 'http://127.0.0.1:' + info.port;
  const api = async (action, payload, token) => (await fetch(B + '/api', { method: 'POST', body: JSON.stringify({ action, payload, token }) })).json();
  const br = await pw.chromium.launch();
  try {
    const adm = (await api('auth.login', { usuario: 'admin', pin: '246810' })).data.token;
    for (const bad of ['0', '10,5', '1,2,3,4', 'x']) assert.equal((await api('admin.config', { clave: 'cocina_alerta_min', valor: bad }, adm)).error.code, 'VALOR_INVALIDO', bad);
    assert.ok((await api('admin.config', { clave: 'cocina_alerta_min', valor: '1, 2, 3' }, adm)).ok);
    const moz = (await api('auth.login', { usuario: 'mozo', pin: '1111' })).data.token;
    await api('order.create', { request_id: 'demora-test-1', mesa_id: 'M02', items: [{ producto_id: 'PECETO', cantidad: 1, opciones: ['PAN_CIA'] }] }, moz);
    const c = await br.newContext({ viewport: { width: 1440, height: 900 } }); await c.route(/fonts\./, (r) => r.abort());
    const p = await c.newPage();
    await p.addInitScript(() => { window.__alarmas = 0; });
    await p.goto(B + '/cocina.html'); await p.fill('#lg-u', 'cocina'); for (const k of '2222') await p.click(`[data-k="${k}"]`); await p.click('[data-k="ok"]');
    await p.waitForSelector('.kcol.nuevos .ticket:has-text("A-001")');
    await p.mouse.click(5, 300); // primer toque: el sonido (activado por defecto) queda listo
    assert.match(await p.textContent('#snd'), /Sonido activado/);
    await p.evaluate(() => { const a = Mesa.alarm; Mesa.alarm = function () { window.__alarmas++; return a.apply(this, arguments); }; });
    assert.equal(await p.locator('.ticket.dem1, .ticket.dem2, .ticket.dem3').count(), 0, 'todavía en tiempo');
    const alarmas = () => p.evaluate(() => window.__alarmas);
    console.log('nivel 1 (1 min)…');
    await p.waitForSelector('.ticket.dem1:has-text("A-001")', { timeout: 90000 });
    await p.waitForSelector('.dem-tag:has-text("+1 MIN")'); await p.waitForSelector('.banner.demora .n1');
    assert.equal(await alarmas(), 1);
    await p.screenshot({ path: path.join(__dirname, 'capturas', '21-cocina-demora-nivel1.png') });
    console.log('nivel 2 (2 min)…');
    await p.waitForSelector('.ticket.dem2:has-text("A-001")', { timeout: 90000 });
    await p.waitForSelector('.dem-tag:has-text("+2 MIN")');
    assert.equal(await alarmas(), 2);
    await p.screenshot({ path: path.join(__dirname, 'capturas', '22-cocina-demora-nivel2.png') });
    console.log('nivel 3 (3 min)…');
    await p.waitForSelector('.ticket.dem3:has-text("A-001")', { timeout: 90000 });
    await p.waitForSelector('.banner.demora .n3');
    assert.equal(await alarmas(), 3);
    await p.screenshot({ path: path.join(__dirname, 'capturas', '23-cocina-demora-nivel3.png') });
    await p.waitForTimeout(12000);
    assert.equal(await alarmas(), 3, 'no repite dentro del mismo nivel');
    await p.click('.ticket.dem3 [data-act="listo"]');
    await p.waitForSelector('.kcol.listos .ticket:has-text("A-001")');
    assert.equal(await p.locator('.kcol.listos .ticket.dem3, .kcol.listos .ticket.dem1').count(), 0, 'listo ya no figura demorado');
    console.log('DEMORA OK');
  } catch (e) { console.error('DEMORA FALLÓ', e.message); process.exitCode = 1; } finally { await br.close(); srv.kill(); }
})();
