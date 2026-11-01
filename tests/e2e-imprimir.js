'use strict';
/*
 * Imprimir comanda (pedido de Andrade, 20/10/2026): cada ticket tiene "🖨" y se imprime la comanda
 * en formato de impresora de tickets. En cocina sale sin precios; en mozo y caja, con precios y total.
 * Uso: node tests/e2e-imprimir.js
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
  // Con Recompensas (Premium) para probar el pie del club; el club arranca pausado.
  const srv = spawn(process.execPath, [path.join(__dirname, 'e2e-server.js')], { stdio: ['ignore', 'pipe', 'inherit'], env: Object.assign({}, process.env, { MESA_MODULOS: 'RECOMPENSAS' }) });
  const info = await new Promise((res) => srv.stdout.once('data', (d) => res(JSON.parse(String(d)))));
  const BASE = 'http://127.0.0.1:' + info.port;
  const browser = await pw.chromium.launch();
  const errors = [];
  async function ctx(name, viewport, opts) {
    const c = await browser.newContext(Object.assign({ viewport, locale: 'es-PY', timezoneId: 'America/Asuncion' }, opts || {}));
    await c.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    // window.print abre el diálogo del sistema: en la prueba se reemplaza y se guarda lo que se iba a imprimir.
    await c.addInitScript(() => { window.__impresos = []; window.print = () => { const el = document.getElementById('comanda-print') || document.querySelector('.print-only'); window.__impresos.push(el ? el.innerText + (el.querySelector('.cp-qr svg') ? ' [QR]' : '') : ''); }; });
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
  const PHONE = { width: 390, height: 844 }, DESK = { width: 1366, height: 900 };
  try {
    const mozo = await ctx('mozo', PHONE, { isMobile: true, hasTouch: true });
    await login(mozo.p, '/pedidos', 'mozo', '1111');
    await mozo.p.waitForSelector('.mesa');
    const m2 = (await api(mozo.p, 'sync', {})).mesas.find((m) => m.numero === 2);
    const r = await api(mozo.p, 'order.create', { mesa_id: m2.mesa_id, request_id: 'req-e2e-imp-' + Date.now(), observacion: 'Traer todo junto', items: [{ producto_id: 'ESPRESSO', cantidad: 2, opciones: [], observacion: 'Bien cargado' }] });
    const num = r.pedido.numero;

    const coc = await ctx('cocina', DESK);
    await login(coc.p, '/cocina', 'cocina', '2222');
    await coc.p.waitForSelector('.ticket:has-text("' + num + '") [data-imprimir]', { timeout: 9000 });
    await coc.p.mouse.click(5, 300); // el primer toque en cocina activa el sonido
    await coc.p.waitForTimeout(300);
    await coc.p.click('.ticket:has-text("' + num + '") [data-imprimir]');
    await coc.p.waitForFunction(() => window.__impresos.length > 0, null, { timeout: 5000 }).catch(() => {});
    const tc = (await coc.p.evaluate(() => window.__impresos))[0];
    assert.match(tc, new RegExp(num)); assert.match(tc, new RegExp(m2.nombre)); assert.match(tc, /2 × Espresso/);
    assert.match(tc, /Bien cargado/); assert.match(tc, /Traer todo junto/);
    assert.doesNotMatch(tc, /Gs\.|TOTAL/, 'en cocina la comanda sale sin precios');
    // Así se ve en papel
    await coc.p.click('.ticket:has-text("' + num + '") [data-imprimir]');
    await coc.p.evaluate(() => { const el = document.getElementById('comanda-print'); document.body.classList.add('imprimiendo'); return !!el; });
    await coc.p.emulateMedia({ media: 'print' });
    await coc.p.setViewportSize({ width: 302, height: 600 });
    assert.equal(await coc.p.isVisible('.topbar'), false, 'al imprimir solo sale la comanda');
    await coc.p.screenshot({ path: path.join(OUT, 'imprimir-comanda-cocina.png'), fullPage: true });
    step('Cocina: 🖨 imprime la comanda ' + num + ' (' + m2.nombre + ', 2 × Espresso, observaciones) sin precios');

    await mozo.p.click('[data-mesa="' + m2.mesa_id + '"]');
    await mozo.p.click('.ticket:has-text("' + num + '") [data-imprimir]');
    await mozo.p.screenshot({ path: path.join(OUT, 'imprimir-mozo.png') });
    const tm = (await mozo.p.evaluate(() => window.__impresos))[0];
    assert.match(tm, /TOTAL/); assert.match(tm, /24\.000/);
    assert.equal(await mozo.p.isVisible('#main'), true, 'la pantalla sigue igual después de imprimir');
    step('Mozo: imprime la misma comanda con precios y total');

    assert.doesNotMatch(tm, /Escaneá|\[QR\]/, 'la comanda de una mesa no lleva el pie del club');

    // Premium: el encargado activa el club y escribe su mensaje para los tickets
    const adm = await ctx('admin', DESK);
    await login(adm.p, '/admin', 'admin', '246810');
    await adm.p.waitForSelector('.topbar');
    await api(adm.p, 'rec.config', { config: { rec_activo: 'SI', rec_nombre: 'Club Andrade', rec_ticket_mensaje: '¡Gracias! Seguinos en @andradecasacafe' }, premios: [{ tipo: 'SELLOS', sellos: 10, nombre: 'Café gratis', producto_id: 'ESPRESSO' }] });
    step('Encargado: activa el club y pone el mensaje "¡Gracias! Seguinos en @andradecasacafe"');

    // Ticket para llevar (desde la caja): con QR del club y mensaje
    const caja = await ctx('caja', DESK);
    await login(caja.p, '/caja?caja=CAJA_B', 'cajab', '4444');
    await caja.p.waitForSelector('[data-tab="pedidos"]');
    await api(caja.p, 'caja.abrir', { caja_id: 'CAJA_B', monto_inicial_gs: 0 });
    const tkQR = info.takeaway;
    const rl = await caja.p.evaluate((t) => Mesa.call('public.order', { token: t, request_id: 'req-e2e-tk-' + Date.now(), alias: 'Ana', items: [{ producto_id: 'ESPRESSO', cantidad: 1, opciones: [] }] }), tkQR);
    await caja.p.click('[data-tab="pedidos"]');
    await caja.p.waitForSelector('.ticket:has-text("' + rl.numero + '") [data-imprimir]', { timeout: 9000 });
    await caja.p.click('.ticket:has-text("' + rl.numero + '") [data-imprimir]');
    const tl = (await caja.p.evaluate(() => window.__impresos)).pop();
    assert.match(tl, /PARA LLEVAR · Ana/); assert.match(tl, /Club Andrade/); assert.match(tl, /\[QR\]/);
    assert.match(tl, /10 sellos: Café gratis/); assert.match(tl, /Seguinos en @andradecasacafe/);
    assert.doesNotMatch(tl, /Comanda interna/);
    await caja.p.click('.ticket:has-text("' + rl.numero + '") [data-imprimir]');
    await caja.p.evaluate(() => document.body.classList.add('imprimiendo'));
    await caja.p.emulateMedia({ media: 'print' });
    await caja.p.setViewportSize({ width: 302, height: 800 });
    await caja.p.screenshot({ path: path.join(OUT, 'imprimir-ticket-llevar-premium.png'), fullPage: true });
    await caja.p.emulateMedia({ media: 'screen' }); await caja.p.setViewportSize(DESK);
    await caja.p.evaluate(() => { document.body.classList.remove('imprimiendo'); const x = document.getElementById('comanda-print'); if (x) x.remove(); });
    step('Caja: el ticket para llevar de "Ana" sale con el QR del club, "10 sellos: Café gratis" y el mensaje del local');

    // Cocina: la comanda de ese pedido sigue siendo interna, sin pie
    await api(caja.p, 'order.state', { pedido_id: (await api(caja.p, 'sync', {})).pedidos.find((x) => x.numero === rl.numero).pedido_id, estado: 'ACEPTADO' });
    await coc.p.emulateMedia({ media: 'screen' }); await coc.p.setViewportSize(DESK);
    await coc.p.evaluate(() => { document.body.classList.remove('imprimiendo'); const x = document.getElementById('comanda-print'); if (x) x.remove(); });
    await coc.p.waitForSelector('.ticket:has-text("' + rl.numero + '") [data-imprimir]', { timeout: 9000 });
    await coc.p.click('.ticket:has-text("' + rl.numero + '") [data-imprimir]');
    const tcl = (await coc.p.evaluate(() => window.__impresos)).pop();
    assert.doesNotMatch(tcl, /Club|\[QR\]|Seguinos/);
    step('Cocina: la comanda del mismo pedido sale sin QR ni mensaje');

    // Comprobante del cobro: con QR y mensaje si el cliente no está en el club
    const ped = (await api(caja.p, 'sync', {})).pedidos.find((x) => x.numero === rl.numero);
    await api(caja.p, 'caja.cobrar', { request_id: 'e2e-tk-cobro-' + Date.now(), cuenta_id: ped.cuenta_id, pagos: [{ medio: 'EFECTIVO', monto_gs: ped.total_gs }] });
    await caja.p.click('[data-tab="turno"]');
    await caja.p.waitForSelector('[data-print]', { timeout: 9000 });
    await caja.p.click('[data-print]');
    const cp = (await caja.p.evaluate(() => window.__impresos)).pop();
    assert.match(cp, /COMPROBANTE INTERNO/); assert.match(cp, /\[QR\]/); assert.match(cp, /Seguinos en @andradecasacafe/);
    step('Caja: el comprobante del cobro sale con el QR del club y el mensaje');

    assert.deepEqual(errors, []);
    console.log('\nE2E Imprimir comanda OK');
  } catch (e) {
    console.error('FALLÓ:', e.message); console.error(errors.join('\n')); process.exitCode = 1;
  } finally { await browser.close(); srv.kill(); }
})();
