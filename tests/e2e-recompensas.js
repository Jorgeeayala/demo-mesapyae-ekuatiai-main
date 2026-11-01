'use strict';
/*
 * Módulo Premium · Recompensas — prueba de punta a punta en navegador real.
 * Encargado configura premios → cliente saca su tarjeta → pide para llevar con su celular →
 * caja cobra y suma el sello → gana un premio → lo canjea en caja → mozo vincula tarjeta a una mesa.
 * Uso: node tests/e2e-recompensas.js   (capturas en tests/capturas/rec-*.png)
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

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, 'e2e-server.js')], { stdio: ['ignore', 'pipe', 'inherit'], env: Object.assign({}, process.env, { MESA_MODULOS: 'RECOMPENSAS' }) });
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
    await p.goto(BASE + url);
    await p.fill('#lg-u', user);
    for (const k of pin) await p.click(`[data-k="${k}"]`);
    await p.click('[data-k="ok"]');
  }
  const shot = (p, n) => p.screenshot({ path: path.join(OUT, 'rec-' + n + '.png'), fullPage: true });
  const api = (p, action, payload) => p.evaluate(([a, pl]) => Mesa.call(a, pl), [action, payload]);
  const PHONE = { width: 390, height: 844 }, DESK = { width: 1366, height: 900 }, TABLET = { width: 820, height: 1180 };

  try {
    // 1. Encargado: configura premios desde el panel y activa el programa
    const adm = await ctx('admin', DESK);
    await login(adm.p, '/admin', 'admin', '246810');
    await adm.p.click('[data-tab="recompensas"]');
    await adm.p.waitForSelector('[data-rpadd="SELLOS"]');
    await adm.p.click('[data-rpadd="SELLOS"]');
    await adm.p.fill('[data-rp="0"][data-k="sellos"]', '6');
    await adm.p.selectOption('[data-rp="0"][data-k="producto_id"]', 'ESPRESSO');
    await adm.p.fill('[data-rp="0"][data-k="costo_gs"]', '4000');
    await adm.p.click('[data-rpadd="SELLOS"]');
    await adm.p.fill('[data-rp="1"][data-k="sellos"]', '10');
    await adm.p.selectOption('[data-rp="1"][data-k="producto_id"]', 'PANINI_CESAR');
    await adm.p.click('[data-rpadd="CUMPLE"]');
    await adm.p.fill('[data-rp="2"][data-k="nombre"]', 'Postre de cumpleaños');
    await adm.p.fill('[data-rp="2"][data-k="valor_gs"]', '15000');
    await adm.p.click('[data-rpsave]');
    await adm.p.waitForSelector('.toast:has-text("Premios guardados")');
    await adm.p.fill('[data-rc="rec_nombre"]', 'Club Andrade');
    await adm.p.click('[data-rcsave]');
    await adm.p.waitForSelector('.toast:has-text("Reglas guardadas")');
    await adm.p.click('[data-recactivo="SI"]');
    await adm.p.waitForSelector('.chip:has-text("Programa activo")');
    const prog = await api(adm.p, 'rec.admin', {});
    assert.deepEqual(prog.programa.premios.map((x) => [x.sellos, x.nombre]), [[6, '1 Espresso gratis'], [10, '1 Panini César gratis']]);
    assert.equal(prog.programa.cumple, 'Postre de cumpleaños');
    step('Encargado carga premios (6 y 10 sellos + cumpleaños) y activa el programa');

    // 2. Cliente: saca su tarjeta desde el celular
    const cli = await ctx('cliente', PHONE, { isMobile: true, hasTouch: true });
    await cli.p.goto(BASE + '/tarjeta.html');
    await cli.p.waitForSelector('#ok');
    await shot(cli.p, '01-alta-celular');
    await cli.p.fill('#n', 'Lucía'); await cli.p.fill('#c', '0981 456 789'); await cli.p.fill('#b', '20/12');
    await cli.p.click('#ok');
    await cli.p.waitForSelector('.tj-err, #e:not(:empty)', { timeout: 1500 }).catch(() => {});
    assert.match(await cli.p.textContent('#e'), /aceptar/);
    await cli.p.check('#a'); await cli.p.click('#ok');
    await cli.p.waitForSelector('.tj-card');
    assert.match(await cli.p.textContent('.tj-cnt'), /0 \/ 10/);
    assert.match(await cli.p.textContent('.tj-prox'), /6 sellos.*Espresso/);
    const codigo = (await cli.p.textContent('.tj-cod')).trim();
    assert.match(codigo, /^[A-Z0-9]{6}$/);
    await shot(cli.p, '02-tarjeta-nueva');
    step('Cliente saca su tarjeta (0 de 10, código ' + codigo + ')');

    // 3. Pide para llevar con su celular desde la carta QR
    await cli.p.goto(BASE + '/menu?t=' + info.takeaway);
    await cli.p.waitForSelector('#rec-cel');
    assert.equal(await cli.p.inputValue('#rec-cel'), '');
    assert.ok(await cli.p.isVisible('a:has-text("Mi tarjeta")'));
    await cli.p.fill('#rec-cel', '0981456789');
    await cli.p.fill('[data-search]', 'espresso');
    await cli.p.click('.prod:has-text("Espresso")'); await cli.p.click('[data-q="1"]').catch(() => {}); await cli.p.click('[data-add]').catch(() => {});
    await cli.p.click('[data-open-cart]');
    await cli.p.fill('[data-alias]', 'Lucía');
    await cli.p.click('[data-send]');
    await cli.p.waitForSelector('text=tu sello se suma cuando pagues');
    await shot(cli.p, '03-pedido-con-tarjeta');
    step('Pedido para llevar vinculado a la tarjeta por celular');

    // 4. Caja 02 cobra: la tarjeta aparece sola y suma el sello
    const caja = await ctx('caja', DESK);
    await login(caja.p, '/caja', 'cajab', '4444');
    await caja.p.fill('#fondo', '0'); await caja.p.click('[data-abrir]'); await caja.p.click('.sheet [data-ok]');
    await caja.p.waitForSelector('.chip.rec:has-text("Lucía")');
    await caja.p.click('[data-cobrar]');
    await caja.p.waitForSelector('.rec-sellos');
    assert.match(await caja.p.textContent('[data-rec]'), /Lucía/);
    await shot(caja.p, '04-caja-cobro-con-tarjeta');
    await caja.p.click('.sheet [data-ok]');
    await caja.p.waitForSelector('.toast:has-text("+1 sello")');
    step('Caja 02 cobra y suma el sello (1 de 10)');
    await cli.p.goto(BASE + '/tarjeta.html');
    await cli.p.waitForSelector('.tj-card');
    assert.match(await cli.p.textContent('.tj-cnt'), /1 \/ 10/);

    // 5. Llega a 6 sellos (se permite más de uno por día para la prueba) y gana el premio
    await api(adm.p, 'rec.config', { config: { rec_un_sello_por_dia: 'NO' } });
    const caj1 = await ctx('caja1', DESK);
    await login(caj1.p, '/caja', 'cajaa', '3333');
    await caj1.p.fill('#fondo', '0'); await caj1.p.click('[data-abrir]'); await caj1.p.click('.sheet [data-ok]');
    await caj1.p.waitForSelector('text=No hay cuentas pendientes');
    const mozo = await ctx('mozo', TABLET);
    await login(mozo.p, '/pedidos', 'mozo', '1111');
    await mozo.p.waitForSelector('.mesa');
    const lucia = (await api(caj1.p, 'rec.buscar', { q: codigo })).cliente;
    for (let i = 0; i < 5; i++) {
      const ped = await api(mozo.p, 'order.create', { request_id: 'e2e-rec-p' + i + '-' + Date.now(), mesa_id: 'M1' + i, venta_directa: true, items: [{ producto_id: 'ESPRESSO', cantidad: 2, opciones: [] }] });
      const r = await api(caj1.p, 'caja.cobrar', { request_id: 'e2e-rec-c' + i + '-' + Date.now(), cuenta_id: ped.pedido.cuenta_id, pagos: [{ medio: 'EFECTIVO', monto_gs: 24000 }], recompensa: { cliente_id: lucia.cliente_id, sello: true } });
      assert.equal(r.recompensa.sello, true);
    }
    await cli.p.reload(); await cli.p.waitForSelector('.tj-cupon');
    assert.match(await cli.p.textContent('.tj-cnt'), /6 \/ 10/);
    assert.match(await cli.p.textContent('.tj-cupon'), /Espresso gratis/);
    await shot(cli.p, '05-tarjeta-con-premio');
    step('Al sexto sello gana "1 Espresso gratis" y lo ve en su tarjeta');

    // 6. Mozo vincula la tarjeta a la Mesa 1 escaneando/escribiendo el código
    await mozo.p.click('[data-mesa="M01"]');
    await mozo.p.click('[data-nuevo]');
    await mozo.p.waitForSelector('.prod');
    await mozo.p.fill('[data-search]', 'espresso');
    await mozo.p.click('.prod:has-text("Espresso")'); await mozo.p.click('[data-add]').catch(() => {});
    await mozo.p.fill('[data-search]', 'panini césar');
    await mozo.p.click('.prod:has-text("Panini César")'); await mozo.p.click('.opt:has-text("Pan lactal")'); await mozo.p.click('[data-add]');
    await mozo.p.click('[data-send]');
    await mozo.p.waitForSelector('[data-rectj]');
    await mozo.p.click('[data-rectj]');
    await mozo.p.fill('.sheet [data-q]', codigo.toLowerCase());
    await mozo.p.click('.sheet [data-ok]');
    await mozo.p.waitForSelector('[data-rectj]:has-text("Lucía")');
    await shot(mozo.p, '06-mozo-vincula-tarjeta');
    step('Mozo vincula la tarjeta a la Mesa 1 con el código');

    // 7. Caja 01 canjea el premio: descuenta el espresso sin pedir autorización
    await caj1.p.waitForSelector('.card:has-text("Mesa 1") .chip.rec');
    await caj1.p.click('.card:has-text("Mesa 1") [data-cobrar]');
    await caj1.p.waitForSelector('[data-rcu]');
    const antes = await caj1.p.textContent('[data-tot]');
    await caj1.p.check('[data-rcu]');
    await caj1.p.waitForSelector('[data-recdesc-row]:visible');
    const despues = await caj1.p.textContent('[data-tot]');
    assert.notEqual(antes, despues);
    assert.match(await caj1.p.textContent('[data-recdesc]'), /12\.000/);
    await shot(caj1.p, '07-caja-canje-premio');
    await caj1.p.click('.sheet [data-ok]');
    await caj1.p.waitForSelector('.toast:has-text("Lucía")');
    const c1 = await api(caj1.p, 'caja.estado', { caja_id: 'CAJA_A' });
    const ult = c1.cobros[c1.cobros.length - 1];
    assert.equal(ult.recompensa.descuento_gs, 12000); assert.equal(ult.total_gs, 35000);
    step('Caja 01 canjea el premio (−Gs. 12.000) y suma el séptimo sello');

    // 8. Panel del encargado con métricas y ficha del cliente
    await adm.p.click('[data-tab="resumen"]'); await adm.p.click('[data-tab="recompensas"]');
    await adm.p.waitForSelector('[data-reccli]');
    assert.match(await adm.p.textContent('.kpis'), /Premios canjeados\s*1/);
    await shot(adm.p, '08-admin-recompensas');
    await adm.p.click('[data-reccli]');
    await adm.p.waitForSelector('.sheet:has-text("Movimientos")');
    await shot(adm.p, '09-admin-ficha-cliente');
    step('Panel: clientes, retorno, ventas del club, premios canjeados y ficha con historial');

    // 9. Tarjeta final del cliente
    await cli.p.reload(); await cli.p.waitForSelector('.tj-card');
    assert.match(await cli.p.textContent('.tj-cnt'), /7 \/ 10/);
    await shot(cli.p, '10-tarjeta-final');

    assert.deepEqual(errors, []);
    console.log('\nE2E Recompensas OK');
  } catch (e) {
    console.error('FALLÓ:', e.message);
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } finally {
    await browser.close(); srv.kill();
  }
})();
