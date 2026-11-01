'use strict';
/*
 * Facturar en e-Kuatia'i desde la caja, con la extensión Migrador cargada en Chromium y un formulario
 * SIMULADO de e-Kuatia'i (tests/fixtures/ekuatiai-simulado.html, servido en la URL real del portal).
 * Recorre el bucle completo: cobro con factura → botón 🧾 → la extensión abre e-Kuatia'i, espera "Nueva factura",
 * consulta el RUC y carga los ítems → la persona pone el PIN y emite → la extensión vuelve a escuchar.
 * Uso: node tests/e2e-ekuatiai.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert/strict');
let pw;
try { pw = require('playwright'); } catch (e) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const F = require('../public/assets/facturador.js');
const EXT = path.join(__dirname, '..', 'extension', 'migrador-ekuatiai');
const FORM = fs.readFileSync(path.join(__dirname, 'fixtures', 'ekuatiai-simulado.html'), 'utf8');
const OUT = path.join(__dirname, 'capturas');
function step(msg) { console.log('✔ ' + msg); }

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const crypto = require('crypto'); const sha = (x) => crypto.createHash('sha256').update(String(x), 'utf8').digest('hex');
  const SALT = 'e2esaltekuatiai'; let H = SALT + ':' + '135790'; for (let i = 0; i < 300; i++) H = sha(H + ':' + SALT);
  const srv = spawn(process.execPath, [path.join(__dirname, 'e2e-server.js')], { stdio: ['ignore', 'pipe', 'inherit'], env: Object.assign({}, process.env, { MESA_PLAN: '', MESA_MODULOS: '', MESA_PLATAFORMA: 'sol:' + SALT + ':' + H }) });
  const info = await new Promise((res) => srv.stdout.once('data', (d) => res(JSON.parse(String(d)))));
  const BASE = 'http://127.0.0.1:' + info.port;
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ekuatiai-'));
  const ctx = await pw.chromium.launchPersistentContext(perfil, {
    channel: 'chromium', headless: true, viewport: { width: 1366, height: 900 }, locale: 'es-PY', timezoneId: 'America/Asuncion',
    args: ['--disable-extensions-except=' + EXT, '--load-extension=' + EXT]
  });
  const errors = [];
  try {
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    // Nada sale hacia la DNIT: el portal se reemplaza por el formulario simulado.
    await ctx.route(/^https:\/\/(desa-)?ekuatia\.set\.gov\.py\//, (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: FORM }));
    let [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent('serviceworker');
    assert.equal(new URL(sw.url()).host, F.EXT_ID, 'la extensión tiene el ID fijo que espera la caja');
    step('Extensión cargada con ID ' + F.EXT_ID);

    const caja = ctx.pages()[0] || await ctx.newPage();
    caja.on('pageerror', (e) => errors.push('caja: ' + e.message));
    await caja.goto(BASE + '/caja');
    await caja.fill('#lg-u', 'cajaa');
    for (const k of '3333') await caja.click(`[data-k="${k}"]`);
    await caja.click('[data-k="ok"]');
    await caja.waitForSelector('.tabs, [data-abrir]');
    const api = (a, pl) => caja.evaluate(([x, y]) => Mesa.call(x, y).catch((e) => { throw new Error(x + ': ' + (e.code || '') + ' ' + e.message); }), [a, pl]);
    await api('caja.abrir', { caja_id: 'CAJA_A', monto_inicial_gs: 0 });
    const ped = (await api('order.create', { punto_id: 'A_CAFE', request_id: 'e2e-ek-' + Date.now(), alias: 'Mostrador', items: [
      { producto_id: 'ESPRESSO', cantidad: 2, opciones: [], observacion: '' }, { producto_id: 'LATTE', cantidad: 1, opciones: [], observacion: '' }] })).pedido;
    assert.equal(ped.total_gs, 44000);
    const cob = (await api('caja.cobrar', { request_id: 'e2e-ek-cobro-' + Date.now(), cuenta_id: ped.cuenta_id, descuento_gs: 4000, motivo_descuento: 'Cliente frecuente',
      autorizacion: { usuario: 'admin', pin: '246810' }, comprobante: { tipo: 'FACTURA', ruc: '80012345-6', razon: 'Comercial Ñandutí S.A.', email: 'admin@nandu.com.py' },
      pagos: [{ medio: 'EFECTIVO', monto_gs: 25000 }, { medio: 'TC', monto_gs: 15000 }] })).cobro;
    assert.equal(cob.total_gs, 40000);
    step('Cobro con factura registrado (Gs. 44.000 − 4.000 de descuento)');

    // Sin el Upgrade contratado, la caja no muestra el botón aunque el navegador tenga la extensión.
    await caja.click('[data-tab="turno"]');
    await caja.waitForSelector('[data-print="' + cob.cobro_id + '"]');
    await caja.waitForTimeout(1500);
    assert.equal(await caja.locator('[data-ekuatiai]').count(), 0, 'sin el Upgrade no aparece el botón');
    step('Sin el Upgrade e-Kuatia\'i, la caja no muestra el botón');
    // Ser o Límites activa el Upgrade desde su usuario de plataforma.
    const directo = (action, payload, token) => caja.evaluate(([a, p, t]) => fetch('/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: a, payload: p, token: t }) }).then((r) => r.json()), [action, payload, token]);
    const lgSol = await directo('auth.login', { usuario: 'sol', pin: '135790' });
    assert.ok(lgSol.ok, JSON.stringify(lgSol.error));
    const up = await directo('plataforma.upgrade', { modulo: 'EKUATIAI', activo: true, nota: 'e2e' }, lgSol.data.token);
    assert.ok(up.ok, JSON.stringify(up.error));
    step('Ser o Límites activa el Upgrade e-Kuatia\'i');
    // La caja detecta la extensión y muestra el botón solo en cobros con factura.
    const btn = caja.locator('[data-ekuatiai="' + cob.cobro_id + '"]');
    await btn.waitFor({ timeout: 8000 });
    step('La caja muestra "🧾 e-Kuatia\'i" en el cobro con factura');
    assert.equal(await caja.locator('#ekuatiai-instalar').count(), 0, 'con la extensión no aparece el aviso de instalar');
    // Otra computadora SIN la extensión: la caja avisa y ofrece "Instalar extensión" (en vez de no mostrar nada).
    const sinExt = await pw.chromium.launch();
    try {
      const p2 = await (await sinExt.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
      await p2.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
      await p2.goto(BASE + '/caja'); await p2.fill('#lg-u', 'cajaa');
      for (const k of '3333') await p2.click(`[data-k="${k}"]`);
      await p2.click('[data-k="ok"]');
      await p2.waitForSelector('[data-tab="turno"]'); await p2.click('[data-tab="turno"]');
      const aviso = p2.locator('#ekuatiai-instalar');
      await aviso.waitFor({ timeout: 8000 });
      assert.match(await aviso.innerText(), /Instalar extensión/);
      assert.match(await aviso.locator('a').getAttribute("href"), /^\/extension\/instalar\.html$|chromewebstore\.google\.com\/detail\//);
      assert.equal(await p2.locator('[data-ekuatiai]').count(), 0);
    } finally { await sinExt.close(); }
    step('En una caja sin la extensión aparece el aviso "Instalar extensión" (y no el botón)');

    // Calibración vieja guardada con el id de la PRIMERA fila (formItem.dPUniProSer0): tiene que servir para todas.
    await sw.evaluate(() => chrome.storage.local.set({ mapa: { precio: '#formItem\\.dPUniProSer0', cantidad: '#formItem\\.dCantProSer0' } }));
    const nueva = ctx.waitForEvent('page');
    await btn.click();
    const ek = await nueva;
    let abiertas = [];
    for (let i = 0; i < 20; i++) { // la pestaña nueva puede tardar un instante en tener su URL
      abiertas = await sw.evaluate(() => chrome.tabs.query({}).then((ts) => ts.map((t) => t.pendingUrl || t.url)));
      if (abiertas.some((u) => /^https:\/\/ekuatia\.set\.gov\.py\/ekuatiai\//.test(u))) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    assert.ok(abiertas.some((u) => /^https:\/\/ekuatia\.set\.gov\.py\/ekuatiai\//.test(u)), 'abrió e-Kuatia\'i de producción: ' + abiertas.join(' '));
    // Playwright no alcanza a interceptar la primera carga de una pestaña abierta por la extensión: se recarga la misma URL.
    if (!/^https:\/\/ekuatia/.test(ek.url())) await ek.goto('https://ekuatia.set.gov.py/ekuatiai/');
    await ek.waitForSelector('#migrador-ekuatiai.mg-espera');
    step('Sin pestaña de e-Kuatia\'i: la extensión la abrió y espera el formulario "Nueva factura"');

    await ek.click('#ir-nueva'); // la persona entra a "Nueva factura" (el inicio de sesión siempre es manual)
    await ek.waitForSelector('#migrador-ekuatiai.mg-listo, #migrador-ekuatiai.mg-aviso, #migrador-ekuatiai.mg-error', { timeout: 20000 });
    const banner = await ek.locator('#migrador-ekuatiai').innerText();
    const modelo = await ek.evaluate(() => JSON.parse(JSON.stringify(window.modelo)));
    await ek.screenshot({ path: path.join(OUT, 'ekuatiai-relleno.png'), fullPage: true });
    assert.doesNotMatch(banner, /No pude/, banner);
    assert.equal(modelo.receptor.ruc, '80012345');
    assert.equal(modelo.receptor.dv, '6');
    assert.equal(modelo.receptor.razonSocial, 'COMERCIAL ÑANDUTÍ S.A.', 'la razón social la trae la consulta del RUC');
    assert.equal(modelo.receptor.email, 'admin@nandu.com.py');
    assert.equal(modelo.emisor.ruc, '80099999', 'los datos del emisor no se tocan');
    assert.equal(await ek.evaluate(() => window.consultasRuc), 1);
    assert.deepEqual(modelo.items.map((i) => [i.descripcion, i.cantidad, i.precioUnitario, i.iva]), [['Espresso', '2', '12000', 'IVA 10%'], ['Latte', '1', '20000', 'IVA 10%']]);
    const desc = modelo.items.reduce((a, i) => a + Number(i.descuento || 0), 0);
    assert.equal(desc, 4000);
    assert.deepEqual(modelo.pagos, [{ tipo: 'Efectivo' }, { tipo: 'Tarjeta de crédito' }], 'una fila de pago por cada medio cobrado ("Agregar" crea la segunda)');
    assert.doesNotMatch(banner, /No encontré|No pude/, 'sin avisos de campos: ' + banner);
    assert.deepEqual(modelo.obligaciones, ['211 - IMPUESTO AL VALOR AGREGADO - GRAVADAS Y EXONERADAS - EXPORTADORES'], 'obligación 211');
    assert.deepEqual(await ek.$$eval('[ng-model="row.dTotOpeItemModel"]', (l) => l.map((x) => x.value)), ['21818', '18182'], 'total por producto calculado por el formulario');
    assert.equal(await ek.locator('#total').innerText(), '40000', 'el total del formulario coincide con lo cobrado');
    assert.equal(await ek.evaluate(() => window.emitidas || 0), 0, 'la extensión nunca emite sola');
    assert.equal(await ek.locator('#pin').inputValue(), '', 'el PIN queda vacío para la persona');
    assert.match(banner, /tu PIN/);
    step('Formulario cargado: RUC + DV, razón social consultada, 2 ítems con IVA 10 %, descuento, pagos Efectivo 25.000 + Tarjeta de crédito 15.000, obligación 211 y total Gs. 40.000; PIN vacío');

    // La persona firma y emite: la extensión lo detecta y vuelve a escuchar.
    await ek.fill('#pin', '1234');
    await ek.click('#btn-emitir');
    await ek.waitForFunction(() => /emitida/i.test((document.getElementById('migrador-ekuatiai') || {}).innerText || ''), null, { timeout: 8000 });
    const st = await sw.evaluate(() => chrome.storage.local.get(['pendiente', 'historial']));
    assert.equal(st.pendiente, null);
    const cobId = cob.cobro_id;
    assert.equal(st.historial[cobId].estado, 'EMITIDA');
    step('Emitida por la persona → la extensión lo registra y queda escuchando la próxima');

    // Segundo envío del mismo cobro: la caja avisa antes de duplicar.
    await caja.bringToFront();
    await btn.click();
    await caja.waitForSelector('text=ya se facturó', { timeout: 8000 });
    await caja.screenshot({ path: path.join(OUT, 'ekuatiai-duplicado.png') });
    step('Volver a mandar el mismo cobro pide confirmación (evita facturas duplicadas)');

    // Con la pestaña ya abierta, un cobro nuevo la trae al frente en vez de abrir otra.
    await caja.keyboard.press('Escape').catch(() => {});
    await caja.goto(BASE + '/caja');
    await caja.waitForSelector('.tabs');
    const ped2 = (await api('order.create', { punto_id: 'A_CAFE', request_id: 'e2e-ek2-' + Date.now(), alias: 'Mostrador 2', items: [{ producto_id: 'AMERICANO', cantidad: 1, opciones: [], observacion: '' }] })).pedido;
    const cob2 = (await api('caja.cobrar', { request_id: 'e2e-ek2-cobro-' + Date.now(), cuenta_id: ped2.cuenta_id, comprobante: { tipo: 'FACTURA', ruc: '1234567', razon: 'Juan Pérez' }, pagos: [{ medio: 'TD', monto_gs: ped2.total_gs }] })).cobro;
    await ek.evaluate(() => { location.hash = '#!/'; }); await ek.evaluate(() => { location.hash = '#!/factura/nueva'; }); // formulario limpio
    await caja.click('[data-tab="turno"]');
    const paginasAntes = ctx.pages().length;
    const btn2 = caja.locator('[data-ekuatiai="' + cob2.cobro_id + '"]');
    await btn2.waitFor({ timeout: 10000 });
    await btn2.click();
    await caja.waitForTimeout(1500);
    assert.equal(ctx.pages().length, paginasAntes, 'no abre otra pestaña');
    await ek.waitForFunction(() => window.modelo.items.length >= 1 && window.modelo.items[0].descripcion === 'Americano', null, { timeout: 15000 });
    const m2 = await ek.evaluate(() => window.modelo);
    assert.equal(m2.receptor.ruc, '1234567'); assert.equal(m2.receptor.razonSocial, 'JUAN PÉREZ', 'la completa el portal (campo de solo lectura)');
    await ek.waitForFunction(() => window.modelo.pagos.length === 1 && window.modelo.pagos[0].tipo, null, { timeout: 10000 });
    const m3 = await ek.evaluate(() => window.modelo);
    assert.deepEqual(m3.pagos, [{ tipo: 'Tarjeta de débito' }]);
    assert.equal(m3.obligaciones.length, 1, 'no duplica la obligación');
    step('Segundo cliente (CI sin DV, pagó con tarjeta de débito): reutiliza la pestaña y elige "Tarjeta de débito" en Tipo de pago');

    assert.deepEqual(errors, []);
    console.log('\nE2E e-Kuatia\'i OK');
  } catch (e) {
    console.error(e);
    for (const pg of ctx.pages()) console.error('· ' + pg.url() + ' → ' + (await pg.locator('#migrador-ekuatiai').innerText().catch(() => '(sin banner)')) + ' · ' + (await pg.evaluate(() => JSON.stringify(window.modelo || null)).catch(() => '')));
    const ps = ctx.pages();
    for (let i = 0; i < ps.length; i++) await ps[i].screenshot({ path: path.join(OUT, 'ekuatiai-fallo-' + i + '.png'), fullPage: true }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await ctx.close(); srv.kill();
    fs.rmSync(perfil, { recursive: true, force: true });
  }
})();
