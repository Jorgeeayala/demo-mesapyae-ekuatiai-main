'use strict';
/*
 * Prueba de punta a punta en navegador real (Chromium/Playwright):
 * cliente QR (celular) → mozo (tablet) → cocina (escritorio) → cajas 01 y 02 → cierre → admin.
 * Uso: node tests/e2e.js   (guarda capturas en tests/capturas/)
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const assert = require('assert/strict');
let pw;
try { pw = require('playwright'); } catch (e) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const OUT = path.join(__dirname, 'capturas');
fs.mkdirSync(OUT, { recursive: true });
const log = [];
function step(msg) { log.push(msg); console.log('✔ ' + msg); }

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, 'e2e-server.js')], { stdio: ['ignore', 'pipe', 'inherit'] });
  const info = await new Promise((res) => srv.stdout.once('data', (d) => res(JSON.parse(String(d)))));
  const BASE = 'http://127.0.0.1:' + info.port;
  const browser = await pw.chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? undefined : undefined });
  const errors = [];
  async function ctx(name, viewport, opts) {
    const c = await browser.newContext(Object.assign({ viewport, locale: 'es-PY', timezoneId: 'America/Asuncion' }, opts || {}));
    await c.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const p = await c.newPage();
    p.on('pageerror', (e) => errors.push(name + ': ' + e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/fonts|ERR_FAILED|net::|status of 4[0-9][0-9]|Could not reach Cloud Firestore backend/.test(m.text())) errors.push(name + ' console: ' + m.text()); });
    p.on('dialog', (d) => d.accept());
    return { c, p };
  }
  async function login(p, url, user, pin) {
    await p.goto(BASE + url);
    await p.fill('#lg-u', user);
    for (const k of pin) await p.click(`[data-k="${k}"]`);
    await p.click('[data-k="ok"]');
  }
  const shot = (p, n) => p.screenshot({ path: path.join(OUT, n + '.png'), fullPage: true });
  const PHONE = { width: 390, height: 844 }, TABLET = { width: 820, height: 1180 }, DESK = { width: 1440, height: 900 };

  try {
    // 1. Cliente en Mesa 3 pide desde el celular
    const cli = await ctx('cliente', PHONE, { isMobile: true, hasTouch: true });
    await cli.p.goto(BASE + '/menu?t=' + info.mesas[2]);
    await cli.p.waitForSelector('.prod');
    assert.match(await cli.p.textContent('.pub-head'), /Mesa 3/);
    await shot(cli.p, '01-cliente-menu-celular');
    await cli.p.click('.tab[data-c="SAND"]');
    await cli.p.click('.prod:has-text("Panini César")');
    await cli.p.click('.opt:has-text("Pan ciabatta")');
    await cli.p.fill('[data-nota]', 'sin tomate');
    await shot(cli.p, '02-cliente-opciones');
    await cli.p.click('[data-add]');
    await cli.p.click('.tab[data-c="JUGOS"]');
    await cli.p.click('.prod:has-text("Jugo natural")');
    await cli.p.click('[data-add]'); // sin elegir: debe pedir opción
    await cli.p.waitForSelector('.toast.error');
    await cli.p.click('.opt:has-text("Naranja")'); await cli.p.click('.opt:has-text("500 ml")');
    await cli.p.click('[data-add]');
    await cli.p.click('[data-open-cart]');
    assert.match(await cli.p.textContent('.sheet'), /Gs\. 60\.000/);
    await shot(cli.p, '03-cliente-carrito');
    await cli.p.click('[data-send]');
    await cli.p.waitForSelector('text=A-001');
    assert.match(await cli.p.textContent('main'), /un integrante del equipo lo va a confirmar/i);
    await shot(cli.p, '04-cliente-estado-pendiente');
    step('Cliente QR Mesa 3 (celular): pedido A-001 con variantes y nota, total Gs. 60.000, queda PENDIENTE');

    // 2. Mozo en tablet: ve el QR pendiente, lo acepta y carga un pedido para Mesa 5
    const mozo = await ctx('mozo', TABLET, { hasTouch: true });
    await login(mozo.p, '/pedidos.html', 'mozo', '1111');
    await mozo.p.waitForSelector('.mesa');
    await mozo.p.waitForSelector('.mesa.pend');
    await shot(mozo.p, '05-mozo-mesas-tablet');
    await mozo.p.click('.tab:has-text("Por aceptar")');
    await mozo.p.click('[data-act="aceptar"]');
    await mozo.p.waitForSelector('text=No hay pedidos QR esperando');
    await mozo.p.click('.tab:has-text("Mesas")');
    await mozo.p.click('.mesa:has(.n:text-is("5"))');
    await mozo.p.click('[data-nuevo]');
    await mozo.p.fill('[data-search]', 'curry');
    await mozo.p.click('.prod:has-text("Pollo al curry")');
    await mozo.p.click('.opt:has-text("Pan lactal")');
    await mozo.p.click('[data-q="1"]');
    await mozo.p.click('[data-add]');
    await mozo.p.fill('[data-search]', 'capuchino andrade');
    await mozo.p.click('.prod:has-text("Capuchino Andrade")');
    await mozo.p.click('.opt:has-text("Caramelo")');
    await mozo.p.click('[data-add]');
    await mozo.p.fill('[data-obs]', 'Traer todo junto');
    await shot(mozo.p, '06-mozo-componer-tablet');
    await mozo.p.click('[data-send]');
    await mozo.p.waitForSelector('.ticket:has-text("A-002")');
    assert.match(await mozo.p.textContent('main'), /Gs\. 105\.000/); // 2×35.000 + 30.000 + 5.000
    step('Mozo (tablet): acepta A-001 y carga A-002 en Mesa 5 (2× Pollo al curry lactal + Capuchino Andrade con syrup) = Gs. 105.000');

    // 3. Cocina en escritorio: recibe, prepara, marca listo
    const coc = await ctx('cocina', DESK);
    await login(coc.p, '/cocina.html', 'cocina', '2222');
    await coc.p.waitForSelector('.kcol.nuevos .ticket:has-text("A-001")');
    await coc.p.waitForSelector('.kcol.nuevos .ticket:has-text("A-002")');
    assert.match(await coc.p.textContent('.kcol.nuevos'), /sin tomate/);
    assert.match(await coc.p.textContent('.kcol.nuevos'), /Traer todo junto/);
    assert.doesNotMatch(await coc.p.textContent('.kcol.nuevos'), /Gs\./, 'cocina no ve precios');
    await coc.p.mouse.click(5, 300);
    await shot(coc.p, '07-cocina-nuevos');
    await coc.p.click('.kcol.nuevos .ticket:has-text("A-001") [data-act="empezar"]');
    await coc.p.waitForSelector('.kcol.prep .ticket:has-text("A-001")');
    await coc.p.click('.kcol.prep .ticket:has-text("A-001") [data-act="listo"]');
    await coc.p.click('.kcol.nuevos .ticket:has-text("A-002") [data-act="listo"]');
    await coc.p.waitForSelector('.kcol.listos .ticket:has-text("A-002")');
    await shot(coc.p, '08-cocina-listos');
    // Disponibilidad: marcar Brownie agotado
    await coc.p.click('#disp');
    await coc.p.fill('.sheet [data-q]', 'brownie con');
    await coc.p.click('.sheet [data-t="BROWNIE_HELADO"]');
    await coc.p.waitForSelector('.sheet [data-t="BROWNIE_HELADO"]:has-text("Agotado")');
    await coc.p.click('.sheet [data-x]');
    step('Cocina (escritorio): ve variantes y notas sin precios; A-001 Empezar→Listo, A-002 directo a Listo; marca Brownie con helado agotado');

    // 4. Cliente ve el estado actualizado; mozo recibe "listo" y entrega
    await cli.p.waitForSelector('.estado-steps .on:has-text("Listo")', { timeout: 15000 });
    step('Cliente ve su pedido en estado Listo (actualización automática)');
    await mozo.p.click('[data-back]');
    await mozo.p.click('.tab:has-text("Listos")');
    await mozo.p.waitForSelector('.ticket:has-text("A-001") [data-act="entregar"]');
    await mozo.p.click('.ticket:has-text("A-001") [data-act="entregar"]');
    await mozo.p.click('.ticket:has-text("A-002") [data-act="entregar"]');
    await mozo.p.waitForSelector('text=No hay pedidos listos');
    await mozo.p.click('.tab:has-text("Mesas")');
    await mozo.p.click('.mesa:has(.n:text-is("3"))');
    await mozo.p.click('[data-cierre]');
    await mozo.p.click('.sheet [data-ok]');
    await mozo.p.waitForSelector('text=Cuenta solicitada');
    step('Mozo entrega A-001 y A-002; Mesa 3 solicita la cuenta');

    // 5. Caja 01 (Cafetería): abre turno, cobra Mesa 3 en efectivo con vuelto y Mesa 5 dividido
    const ca = await ctx('cajaA', DESK);
    await login(ca.p, '/caja.html', 'cajaa', '3333');
    await ca.p.waitForSelector('#fondo');
    await ca.p.fill('#fondo', '100.000');
    await ca.p.click('[data-abrir]'); await ca.p.click('.sheet [data-ok]');
    await ca.p.waitForSelector('.card:has-text("Mesa 3") [data-cobrar]');
    assert.match(await ca.p.textContent('main'), /Pidió la cuenta/);
    await shot(ca.p, '09-caja01-por-cobrar');
    await ca.p.click('.card:has-text("Mesa 3") [data-cobrar]');
    await ca.p.fill('.sheet [data-rec]', '100000');
    assert.match(await ca.p.textContent('.sheet [data-vuelto]'), /Gs\. 40\.000/);
    await shot(ca.p, '10-caja01-cobro');
    await ca.p.click('.sheet [data-ok]');
    await ca.p.waitForSelector('.toast.ok:has-text("Cobrado")');
    await ca.p.click('.card:has-text("Mesa 5") [data-cobrar]');
    await ca.p.click('.sheet [data-addline]');
    await ca.p.fill('.sheet [data-lv="0"]', '60.000');
    await ca.p.selectOption('.sheet [data-lm="1"]', 'TD');
    await ca.p.fill('.sheet [data-lv="1"]', '45.000');
    await ca.p.click('.sheet [data-ok]');
    await ca.p.waitForSelector('text=No hay cuentas pendientes');
    step('Caja 01: turno abierto con Gs. 100.000; Mesa 3 cobrada en efectivo (vuelto Gs. 40.000); Mesa 5 dividida efectivo 60.000 + TD 45.000');

    // Cajero A no puede operar Caja 02
    await ca.p.goto(BASE + '/caja.html?caja=CAJA_B');
    await ca.p.waitForSelector('.topbar .modulo');
    assert.match(await ca.p.textContent('.topbar .modulo'), /Caja 01/);
    step('Cajera de Caja 01 que abre la URL de Caja 02 queda en Caja 01 (permiso verificado también en servidor)');

    // 6. Caja 02 (Takeaway): venta directa + prepedido QR de la casita
    const cb = await ctx('cajaB', TABLET, { hasTouch: true });
    await login(cb.p, '/caja.html', 'cajab', '4444');
    await cb.p.fill('#fondo', '50000');
    await cb.p.click('[data-abrir]'); await cb.p.click('.sheet [data-ok]');
    await cb.p.waitForSelector('text=No hay cuentas pendientes');
    await cb.p.click('[data-tab="venta"]');
    await cb.p.fill('[data-search]', 'iced');
    await cb.p.click('.prod:has-text("Iced Latte")');
    await cb.p.fill('[data-alias]', 'Lucía');
    await cb.p.click('[data-send]');
    await cb.p.waitForSelector('.sheet:has-text("Cobrar")', { timeout: 15000 });
    await cb.p.selectOption('.sheet [data-lm="0"]', 'TRANSFERENCIA');
    await cb.p.click('.sheet [data-ok]');
    await cb.p.waitForSelector('.toast.ok:has-text("Cobrado")');
    step('Caja 02 (tablet): venta para llevar T-001 a nombre de Lucía, cobrada por transferencia');
    const cli2 = await ctx('clienteTK', PHONE, { isMobile: true, hasTouch: true });
    await cli2.p.goto(BASE + '/menu?t=' + info.takeaway);
    await cli2.p.waitForSelector('.prod');
    await cli2.p.click('.tab[data-c="SALADOS"]');
    await cli2.p.click('.prod:has-text("Chipa tradicional")');
    await cli2.p.click('.prod:has-text("Chipa tradicional")');
    await cli2.p.click('[data-open-cart]');
    await cli2.p.click('[data-send]');
    await cli2.p.waitForSelector('.toast.error'); // falta nombre
    await cli2.p.fill('.sheet [data-alias]', 'Ana');
    await cli2.p.click('[data-send]');
    await cli2.p.waitForSelector('text=T-002');
    await cb.p.click('[data-tab="pedidos"]');
    await cb.p.waitForSelector('.ticket:has-text("T-002") [data-act="aceptar"]');
    await shot(cb.p, '11-caja02-pedidos-tablet');
    await cb.p.click('.ticket:has-text("T-002") [data-act="aceptar"]');
    await cb.p.waitForSelector('.ticket:has-text("T-002"):has-text("Aceptado")');
    await coc.p.waitForSelector('.kcol.nuevos .ticket:has-text("T-002")');
    step('Cliente en la casita pide T-002 por QR (nombre obligatorio); Caja 02 lo acepta y aparece en Cocina');

    // 7. Prueba de fallo de conexión: el mozo pierde internet al enviar
    await mozo.p.click('[data-back]').catch(() => {});
    await mozo.p.goto(BASE + '/pedidos.html');
    await mozo.p.waitForSelector('.mesa');
    await mozo.p.click('.mesa:has(.n:text-is("8"))');
    await mozo.p.click('[data-nuevo]');
    await mozo.p.click('.tab[data-c="SALADOS"]');
    await mozo.p.click('.prod:has-text("Mbejú tradicional")');
    await mozo.c.setOffline(true);
    await mozo.p.click('[data-send]');
    await mozo.p.waitForSelector('[data-err]:has-text("Sin conexión")', { timeout: 20000 });
    assert.match(await mozo.p.textContent('[data-cart]'), /Mbejú tradicional/);
    await shot(mozo.p, '12-mozo-sin-conexion');
    await mozo.c.setOffline(false);
    await mozo.p.click('[data-send]');
    await mozo.p.waitForSelector('.ticket:has-text("Mbejú")', { timeout: 15000 });
    step('Fallo de conexión: el mozo ve el aviso, el pedido queda en pantalla y al reintentar se registra una sola vez');

    // 8. Cierre de Caja 01 con diferencia
    await ca.p.goto(BASE + '/caja.html');
    await ca.p.click('[data-tab="turno"]');
    await ca.p.waitForSelector('#decl');
    assert.match(await ca.p.textContent('main'), /Gs\. 220\.000/); // 100.000 + 60.000 + 60.000 efectivo
    await ca.p.fill('#decl', '219000');
    assert.match(await ca.p.textContent('#dif'), /-Gs\. 1\.000/);
    await ca.p.click('[data-cerrar]'); await ca.p.click('.sheet [data-ok]');
    await ca.p.waitForSelector('.toast.error:has-text("explicá")');
    await ca.p.fill('#obs', 'Faltante de 1.000 en monedas');
    await ca.p.click('[data-cerrar]'); await ca.p.click('.sheet [data-ok]');
    await ca.p.waitForSelector('text=Faltante de 1.000');
    await shot(ca.p, '13-caja01-cierre');
    step('Caja 01 cerrada: esperado Gs. 220.000, contado Gs. 219.000, diferencia -1.000 con observación obligatoria; Caja 02 sigue abierta');

    // 9. Admin: reportes y QR
    const adm = await ctx('admin', DESK);
    await login(adm.p, '/admin.html', 'admin', '246810');
    await adm.p.waitForSelector('.kpi');
    const kp = await adm.p.textContent('.kpis');
    assert.match(kp, /Consolidado\s*Gs\. 195\.000/);
    assert.match(kp, /Caja 01 · Cafetería\s*Gs\. 165\.000/);
    assert.match(kp, /Caja 02 · Takeaway\s*Gs\. 30\.000/);
    await shot(adm.p, '14-admin-resumen');
    await adm.p.click('[data-tab="mesas"]');
    await adm.p.click('[data-qr="M01"]');
    await adm.p.waitForSelector('.sheet svg');
    await shot(adm.p, '15-admin-qr');
    await adm.p.click('.sheet [data-x]');
    await adm.p.click('[data-tab="catalogo"]');
    await adm.p.waitForSelector('text=POR VALIDAR');
    await shot(adm.p, '16-admin-catalogo');
    step('Admin: resumen con ventas por caja y consolidado; QR por mesa generado; catálogo con estado de validación');

    // Revisión final de cifras por API (fuente de verdad)
    const r = await adm.p.evaluate(async () => (await (await fetch('/api', { method: 'POST', body: JSON.stringify({ action: 'admin.report', token: Mesa.session.token, payload: {} }) })).json()).data);
    const A = r.cajas.find((c) => c.caja_id === 'CAJA_A'), B = r.cajas.find((c) => c.caja_id === 'CAJA_B');
    assert.equal(A.ventas_netas_gs, 165000); assert.equal(B.ventas_netas_gs, 30000); assert.equal(r.consolidado_gs, 195000);
    assert.equal(A.por_medio.EFECTIVO, 120000); assert.equal(A.por_medio.TD, 45000); assert.equal(B.por_medio.TRANSFERENCIA, 30000);
    assert.equal(r.pedidos.total, 5); // A-001, A-002, A-003 (reintento sin duplicar), T-001, T-002
    step('Reporte: Caja 01 Gs. 165.000 (efectivo 120.000 + TD 45.000), Caja 02 Gs. 30.000 (transferencia), consolidado Gs. 195.000, 5 pedidos (el reintento offline no duplicó)');

    assert.deepEqual(errors, [], 'errores de JavaScript en páginas');
    step('Sin errores de JavaScript en ninguna página');
    console.log('\nE2E OK — ' + log.length + ' pasos');
    fs.writeFileSync(path.join(OUT, 'resultado.json'), JSON.stringify({ ok: true, pasos: log, fecha: new Date().toISOString() }, null, 1));
  } catch (e) {
    console.error('\nE2E FALLÓ: ' + (e.stack || e));
    console.error('Errores de página:', errors);
    fs.writeFileSync(path.join(OUT, 'resultado.json'), JSON.stringify({ ok: false, pasos: log, error: String(e.message), errores: errors }, null, 1));
    process.exitCode = 1;
  } finally {
    await browser.close(); srv.kill();
  }
})();
