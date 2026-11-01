'use strict';
/*
 * Pedidos para llevar del QR atendidos por el EQUIPO (pedido de Andrade, 20/10/2026).
 * - Con para_llevar_qr_atiende = EQUIPO, el pedido para llevar que el cliente hace desde la web
 *   le aparece al mozo de barra (usuario marcado "Atiende para llevar") y a la caja del salón.
 * - Todo el equipo recibe el aviso con sonido; a los 3 y 5 minutos sin aceptar, una alerta más.
 * - Caja 02 solo recibe el aviso: ni lo acepta ni lo cobra.
 * - El mozo de barra lo acepta (pasa a cocina) y lo entrega; la caja del salón lo cobra.
 * Uso: node tests/e2e-llevar.js
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
  const shot = (p, n) => p.screenshot({ path: path.join(OUT, 'llevar-' + n + '.png'), fullPage: true });
  const toasts = (p) => p.$$eval('.toast', (t) => t.map((x) => x.textContent));
  const PHONE = { width: 390, height: 844 }, DESK = { width: 1366, height: 900 };
  try {
    // 0. El encargado activa EQUIPO y marca al mozo de barra
    const adm = await ctx('admin', DESK);
    await login(adm.p, '/admin', 'admin', '246810');
    await adm.p.waitForSelector('.topbar');
    await api(adm.p, 'admin.config', { clave: 'para_llevar_qr_atiende', valor: 'EQUIPO' });
    await api(adm.p, 'admin.config', { clave: 'para_llevar_whatsapp', valor: 'OBLIGATORIO' });
    await api(adm.p, 'admin.user', { usuario: { usuario_id: 'barra', nombre: 'Mozo Barra', rol: 'MOZO', pin: '5555', activo: true, para_llevar: true } });
    const us = (await api(adm.p, 'admin.data', {})).usuarios;
    assert.equal(us.find((u) => u.usuario_id === 'barra').para_llevar, 'SI');
    step('Configuración: para llevar del QR lo atiende el EQUIPO; "barra" marcado como mozo de para llevar');

    // 1. Equipo conectado: mozo de barra, otro mozo, Caja 01 (salón) y Caja 02 (para llevar)
    const barra = await ctx('barra', PHONE, { isMobile: true, hasTouch: true });
    await barra.p.clock.install();
    await barra.p.clock.resume();
    await login(barra.p, '/pedidos', 'barra', '5555');
    await barra.p.waitForSelector('[data-tab="llevar"]');
    const mozo = await ctx('mozo', PHONE, { isMobile: true, hasTouch: true });
    await login(mozo.p, '/pedidos', 'mozo', '1111');
    await mozo.p.waitForSelector('[data-tab="llevar"]');
    const cajaA = await ctx('cajaA', DESK);
    await login(cajaA.p, '/caja?caja=CAJA_A', 'cajaa', '3333');
    await cajaA.p.waitForSelector('[data-tab="pedidos"]');
    await api(cajaA.p, 'caja.abrir', { caja_id: 'CAJA_A', monto_inicial_gs: 0 });
    const cajaB = await ctx('cajaB', DESK);
    await login(cajaB.p, '/caja?caja=CAJA_B', 'cajab', '4444');
    await cajaB.p.waitForSelector('[data-tab="pedidos"]');
    await barra.p.waitForTimeout(4500);
    step('Mozo de barra, otro mozo, Caja 01 y Caja 02 con la sesión abierta; los mozos ven la pestaña "🥡 Para llevar"');

    // 2. El cliente pide para llevar desde la web
    const cli = await ctx('cliente', PHONE, { isMobile: true, hasTouch: true });
    await cli.p.goto(BASE + '/menu?t=' + info.takeaway);
    await cli.p.waitForSelector('.prod');
    await cli.p.fill('[data-search]', 'espresso');
    await cli.p.click('.prod:has-text("Espresso")');
    if (await cli.p.isVisible('[data-add]')) await cli.p.click('[data-add]');
    await cli.p.click('[data-open-cart]');
    await cli.p.fill('[data-alias]', 'H Galeano');
    assert.equal(await cli.p.isChecked('[data-promos]'), false, 'la casilla de promociones arranca sin marcar');
    await cli.p.click('[data-send]');
    await cli.p.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /WhatsApp/.test(t.textContent)), null, { timeout: 5000 });
    assert.ok(await cli.p.isVisible('[data-send]'), 'sin WhatsApp no se envía');
    await cli.p.fill('[data-wa]', '0981 123 456');
    await cli.p.check('[data-promos]');
    await shot(cli.p, 'cliente-whatsapp');
    await cli.p.click('[data-send]');
    await cli.p.waitForFunction(() => !document.querySelector('[data-send]'), null, { timeout: 8000 });
    step('Cliente: sin WhatsApp no puede enviar; con su WhatsApp (y promociones marcadas aparte) pide un Espresso para llevar a nombre de "H Galeano"');

    // 3. Aviso a todo el equipo
    await barra.p.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /Pedido para llevar T-\d+ · H Galeano: aceptalo/.test(t.textContent)), null, { timeout: 9000 });
    await mozo.p.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /Pedido para llevar .* lo acepta el mozo de barra/.test(t.textContent)), null, { timeout: 9000 });
    await cajaB.p.waitForSelector('[data-banner-llevar]', { timeout: 9000 });
    assert.match(await cajaB.p.textContent('[data-banner-llevar]'), /1 pedido para llevar por aceptar.*H Galeano.*Lo acepta el mozo de barra/);
    await cajaB.p.click('[data-tab="pedidos"]');
    assert.match(await cajaB.p.textContent('#main'), /Sin pedidos QR por aceptar/, 'Caja 02 no lo tiene para aceptar');
    await cajaA.p.click('[data-tab="pedidos"]');
    await cajaA.p.waitForSelector('.ticket:has-text("H Galeano") [data-act="aceptar"]', { timeout: 9000 });
    await shot(cajaB.p, 'caja02-aviso');
    step('Aviso con sonido a todo el equipo; Caja 02 solo ve el aviso; Caja 01 lo tiene para aceptar');

    // 4. Alerta a los 3 minutos sin aceptar
    await barra.p.clock.fastForward('03:05');
    await barra.p.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /hace 3 min que el pedido para llevar espera/.test(t.textContent)), null, { timeout: 20000 });
    step('A los 3 minutos sin aceptar: alerta "⏰ hace 3 min que el pedido para llevar espera ser aceptado"');

    // 5. El otro mozo lo ve pero no puede aceptarlo; el mozo de barra lo acepta
    await mozo.p.click('[data-tab="llevar"]');
    await mozo.p.waitForSelector('.ticket:has-text("H Galeano")');
    assert.equal(await mozo.p.$$eval('.ticket:has-text("H Galeano") [data-act]', (b) => b.length), 0, 'el mozo del salón no tiene botones');
    await barra.p.click('[data-tab="llevar"]');
    await barra.p.waitForSelector('.ticket:has-text("H Galeano") [data-act="aceptar"]');
    await shot(barra.p, 'barra-por-aceptar');
    await barra.p.click('.ticket:has-text("H Galeano") [data-act="aceptar"]');
    await barra.p.waitForSelector('.section-h:has-text("En cocina") + .grid2 .ticket:has-text("H Galeano")', { timeout: 9000 });
    step('El mozo del salón lo ve sin botones; el mozo de barra lo acepta y pasa a cocina');

    // 6. Cocina lo termina; el mozo de barra lo entrega
    const coc = await ctx('cocina', DESK);
    await login(coc.p, '/cocina', 'cocina', '2222');
    await coc.p.waitForSelector('#filtros');
    const sync = await api(coc.p, 'sync', {});
    const ped = sync.pedidos.find((p) => p.alias === 'H Galeano');
    assert.equal(ped.estado, 'ACEPTADO');
    await api(coc.p, 'order.state', { pedido_id: ped.pedido_id, estado: 'LISTO' });
    await barra.p.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /H Galeano está listo para entregar/.test(t.textContent)), null, { timeout: 9000 });
    const wa = await barra.p.getAttribute('.ticket:has-text("H Galeano") [data-wa-link]', 'href');
    assert.match(wa, /^https:\/\/wa\.me\/595981123456\?text=/);
    assert.match(decodeURIComponent(wa), /H Galeano.*ya está listo para retirar/);
    assert.match(await barra.p.textContent('.ticket:has-text("H Galeano")'), /0981 123 456/);
    await shot(barra.p, 'barra-avisar-wa');
    step('El ticket del mozo de barra muestra el WhatsApp y el botón "Avisar por WhatsApp" con el mensaje de pedido listo');
    await barra.p.click('.ticket:has-text("H Galeano") [data-act="entregar"]');
    await barra.p.waitForSelector('.section-h:has-text("Entregados") + .grid2 .ticket:has-text("H Galeano")', { timeout: 9000 });
    step('Cocina lo marca listo: aviso al mozo de barra, que lo entrega');

    // 7. La caja del salón lo cobra
    await cajaA.p.click('[data-tab="cobrar"]');
    await cajaA.p.waitForSelector('.card:has-text("Para llevar · H Galeano") [data-cobrar]', { timeout: 9000 });
    assert.match(await cajaA.p.textContent('.card:has-text("Para llevar · H Galeano")'), /0981 123 456[\s\S]*Acepta promociones/);
    await shot(cajaA.p, 'caja01-cobrar');
    await cajaB.p.click('[data-tab="cobrar"]');
    assert.doesNotMatch(await cajaB.p.textContent('#main'), /H Galeano/, 'Caja 02 no lo cobra');
    step('Caja 01 tiene la cuenta "Para llevar · H Galeano" para cobrar; Caja 02 no');

    assert.deepEqual(errors, []);
    console.log('\nE2E Para llevar atendido por el equipo OK');
  } catch (e) {
    console.error('FALLÓ:', e.message); console.error(errors.join('\n')); process.exitCode = 1;
  } finally { await browser.close(); srv.kill(); }
})();
