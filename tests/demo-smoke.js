'use strict';
// Humo de la demo estática (dist-demo): login, pedido de mozo, cocina lo ve, QR cliente.
const http = require('http'), fs = require('fs'), path = require('path'), assert = require('assert/strict');
let pw; try { pw = require('playwright'); } catch (e) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const ROOT = path.join(__dirname, '..', 'dist-demo');
const srv = http.createServer((q, r) => { let p = decodeURIComponent(new URL(q.url, 'http://x').pathname); if (p === '/') p = '/index.html'; const f = path.join(ROOT, p); if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' }[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
srv.listen(0, '127.0.0.1', async () => {
  const B = 'http://127.0.0.1:' + srv.address().port;
  const br = await pw.chromium.launch(); const c = await br.newContext({ viewport: { width: 1280, height: 860 } });
  await c.route(/fonts\./, (r) => r.abort());
  const errs = []; const p = await c.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
  const login = async (url, u, pin) => { await p.goto(B + url); await p.evaluate(() => localStorage.removeItem('mesapyae.sesion')); await p.goto(B + url); await p.fill('#lg-u', u); for (const k of pin) await p.click(`[data-k="${k}"]`); await p.click('[data-k="ok"]'); };
  try {
    await login('/pedidos.html', 'mozo', '1111');
    await p.click('.mesa:has(.n:text-is("4"))'); await p.click('[data-nuevo]');
    await p.fill('[data-search]', 'peceto'); await p.click('.prod:has-text("Peceto")'); await p.click('.opt:has-text("ciabatta")'); await p.click('[data-add]');
    await p.click('[data-send]'); await p.waitForSelector('.ticket:has-text("A-001")');
    const cat = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'demo', 'catalogo-demo.json'), 'utf8'));
    const pec = cat.productos.find((x) => x.producto_id === 'PECETO').precio_gs + (cat.opciones.find((o) => /ciabatta/i.test(o.nombre)) || { delta_gs: 0 }).delta_gs;
    assert.match(await p.textContent('main'), new RegExp('Gs\\. ' + pec.toLocaleString('de-DE').replace('.', '\\.')));
    await login('/cocina.html', 'cocina', '2222');
    await p.waitForSelector('.kcol.nuevos .ticket:has-text("Peceto")');
    await p.screenshot({ path: path.join(__dirname, 'capturas', '20-demo-cocina.png') });
    await p.click('text=QR Mesa 1'); await p.waitForSelector('.prod'); assert.match(await p.textContent('.pub-head'), /Mesa 1/);
    await login('/admin.html', 'admin', '1234'); await p.waitForSelector('.kpi');
    await p.click('[data-tab="mesas"]'); const href = await p.getAttribute('td a[href*="menu.html?t="]', 'href'); assert.ok(href.startsWith(B + '/menu.html?t='));
    // Estaciones: la demo trabaja con Cocina y Barra
    await login('/cocina.html', 'cocina', '2222');
    await p.waitForSelector('#estrow:not([hidden]) [data-est="BARRA"]');
    // Upgrade Stock y costos: se prende desde la barra de la demo y trae insumos y recetas de ejemplo
    await login('/admin.html', 'admin', '1234'); await p.waitForSelector('.kpi');
    await p.click('#demo-stock'); await p.waitForSelector('[data-tab="stock"]');
    await p.click('[data-tab="stock"]'); await p.waitForSelector('#stock-root td:has-text("Café en grano")');
    await p.click('[data-stv="costos"]'); await p.waitForSelector('[data-margen="LATTE"]');
    await p.screenshot({ path: path.join(__dirname, 'capturas', '21-demo-stock.png') });
    // Upgrade Atención Integrada: se prende desde la barra; un pedido para llevar con WhatsApp deja los avisos «enviados» (simulados)
    await p.click('#demo-wa'); await p.waitForSelector('[data-tab="whatsapp"]');
    await p.evaluate(() => {
      const d = (x) => window.MesaDemo.handle(x);
      const tk = d({ action: 'auth.login', payload: { usuario: 'admin', pin: '1234' } }).data.token;
      const r = d({ action: 'public.order', payload: { token: window.MesaDemo.qr().takeaway, request_id: 'demo-wa-' + Date.now(), alias: 'Ana', whatsapp: '0981 123 456', items: [{ producto_id: 'ESPRESSO', cantidad: 1, opciones: [] }] } }).data;
      const ped = d({ action: 'sync', token: tk, payload: {} }).data.pedidos.find((x) => x.numero === r.numero);
      d({ action: 'order.state', token: tk, payload: { pedido_id: ped.pedido_id, estado: 'ACEPTADO' } });
      d({ action: 'order.state', token: tk, payload: { pedido_id: ped.pedido_id, estado: 'LISTO' } });
    });
    await p.waitForTimeout(300);
    await p.click('[data-tab="whatsapp"]'); await p.waitForSelector('#wa-root tr[data-aviso]');
    assert.equal((await p.$$eval('#wa-root tr[data-aviso]', (rs) => rs.filter((x) => /Enviado/.test(x.textContent)).length)), 2);
    await p.screenshot({ path: path.join(__dirname, 'capturas', '22-demo-atencion.png') });
    // Carta con IA: en la demo muestra la carta de ejemplo para revisar
    await p.click('[data-tab="catalogo"]'); await p.click('[data-cartaia]');
    await p.setInputFiles('[data-ia-files]', { name: 'carta.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') });
    await p.click('[data-ia-leer]'); await p.waitForSelector('[data-ia-row]');
    assert.match(await p.textContent('.overlay:has([data-ia-leer])'), /Demo: se muestra una carta de ejemplo/);
    await p.click('.overlay:has([data-ia-leer]) [data-x]');
    // QR fijos: el QR de para llevar abre en otro navegador (celular) y pide WhatsApp (opcional)
    const c2 = await br.newContext({ viewport: { width: 390, height: 800 } }); await c2.route(/fonts\./, (r) => r.abort());
    const p2 = await c2.newPage(); p2.on('pageerror', (e) => errs.push(e.message));
    await p2.goto(B + '/menu.html?t=demotakeaway'); await p2.waitForSelector('.prod');
    assert.doesNotMatch(await p2.textContent('body'), /ya no es válido/);
    const res = await p2.evaluate(() => window.MesaDemo.handle({ action: 'public.resolve', payload: { token: 'demotakeaway' } }));
    assert.equal(res.ok, true); assert.equal(res.data.tipo, 'PUNTO'); assert.equal(res.data.whatsapp, 'OPCIONAL');
    assert.equal((await p2.evaluate(() => window.MesaDemo.handle({ action: 'public.resolve', payload: { token: 'demomesa01' } }))).data.mesa, 'Mesa 1');
    await c2.close();
    // Upgrade "Armá tu pedido": se prende desde la barra; la carta trae pizza y hamburguesa armables de ejemplo
    await p.goto(B + '/menu.html?t=demomesa01'); await p.waitForSelector('.prod');
    await p.click('#demo-armador'); await p.waitForSelector('#demo-armador:has-text("✓")'); await p.waitForSelector('.prod');
    await p.click('.tab:has-text("Hamburguesas")'); await p.waitForSelector('.prod:has-text("Hamburguesa a tu gusto") .arma-chip');
    await p.click('.prod:has-text("Hamburguesa a tu gusto")');
    await p.waitForSelector('.ar.hamburguesa'); await p.click('[data-mas="HBE_CAR"]'); await p.click('[data-mas="HBE_CHE"]');
    assert.match(await p.textContent('[data-pt]'), /50\.000/); // 30.000 + carne 15.000 + cheddar 5.000
    await p.click('[data-arx]');
    assert.deepEqual(errs, []);
    console.log('DEMO OK');
  } catch (e) { console.error('DEMO FALLÓ', e.message, errs); process.exitCode = 1; } finally { await br.close(); srv.close(); }
});
