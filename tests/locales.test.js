'use strict';
/* Matriz de locales: un local nuevo se arma desde locales/<local> sin tocar a Andrade.  node --test tests/locales.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { buildApp } = require('../server/dev-server.js');
const { validar } = require('../tools/validar_local.js');
const { armar } = require('../tools/nuevo_local.js');

const ROOT = path.join(__dirname, '..');
const PIN = '246810';

function app(local) {
  const b = buildApp(null, { secret: 'test-secret', adminPin: PIN, log: () => {}, plan: '', modulos: '', local });
  const call = (action, payload, token) => b.app.handle({ action, payload: payload || {}, token });
  const ok = (a, p, t) => { const r = call(a, p, t); assert.equal(r.ok, true, a + ' falló: ' + JSON.stringify(r.error)); return r.data; };
  const tk = ok('auth.login', { usuario: 'admin', pin: PIN }).token;
  return { b, call, ok, tk, data: b.store._data() };
}
// Copia temporal de un local (para probar variantes sin tocar locales/ejemplo)
function localTemporal(slug, cambiar) {
  const dir = path.join(ROOT, 'locales', slug);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, 'locales', 'ejemplo'), dir, { recursive: true });
  const l = JSON.parse(fs.readFileSync(path.join(dir, 'local.json'), 'utf8'));
  l.slug = slug; cambiar(l);
  fs.writeFileSync(path.join(dir, 'local.json'), JSON.stringify(l, null, 2));
  return { dir, borrar: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
function marcar(slug) {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'mesa-local-'));
  const sitio = path.join(t, 'site');
  fs.cpSync(path.join(ROOT, 'public'), sitio, { recursive: true });
  const r = spawnSync('python3', [path.join(ROOT, 'tools', 'marca_local.py'), sitio, slug], { encoding: 'utf8' });
  return { sitio, r, leer: (f) => fs.readFileSync(path.join(sitio, f), 'utf8'), borrar: () => fs.rmSync(t, { recursive: true, force: true }) };
}

test('L01 el local de ejemplo está completo y válido', () => {
  const r = validar('ejemplo');
  assert.deepEqual(r.errores, []);
  assert.equal(r.catalogo.productos.length, 6);
});

test('L02 el validador frena PIN, precios inventados en cero y referencias rotas', () => {
  const t = localTemporal('zz-malo', (l) => { l.equipo[0].pin = '1234'; l.plan = 'ORO'; });
  try {
    const cat = JSON.parse(fs.readFileSync(path.join(t.dir, 'catalogo.json'), 'utf8'));
    cat.productos[0].precio_gs = 0; cat.productos[1].grupos = 'G_NO_EXISTE'; cat.productos[2].dias = '8';
    fs.writeFileSync(path.join(t.dir, 'catalogo.json'), JSON.stringify(cat));
    const e = validar('zz-malo').errores.join('\n');
    assert.match(e, /no puede guardar PIN/);
    assert.match(e, /plan debe ser/);
    assert.match(e, /precio inválido/);
    assert.match(e, /grupo inexistente G_NO_EXISTE/);
    assert.match(e, /días inválidos/);
  } finally { t.borrar(); }
});

test('L03 las pantallas del local quedan con su marca y sin rastros de Andrade', () => {
  const m = marcar('ejemplo');
  try {
    assert.equal(m.r.status, 0, m.r.stdout + m.r.stderr);
    assert.doesNotMatch(m.r.stdout, /aviso: textos de Andrade/, 'la tabla de reemplazos quedó vieja: ' + m.r.stdout);
    for (const f of fs.readdirSync(m.sitio).filter((x) => /\.(html|webmanifest)$/.test(x))) {
      assert.doesNotMatch(m.leer(f), /Andrade|casita|Pablo|Tu Local|Dirección del local/, f);
    }
    assert.match(m.leer('menu.html'), /<title>Bistró del Ejemplo · Menú/);
    assert.match(m.leer('menu.html'), /Av\. de los Ejemplos 1234 · Asunción/);
    assert.match(m.leer('menu.html'), /retirar en el mostrador/);
    assert.match(m.leer('caja.html'), /Caja 01 — Salón/);
    assert.match(m.leer('index.html'), /Para llevar \(mostrador\): ventas/);
    assert.match(m.leer('assets/app.css'), /--tierra: #2F5D62;/);
    assert.match(m.leer('assets/config.js'), /"sinTakeaway": false/);
    assert.match(m.leer('_redirects'), /ejemplo-mesapyae\.cloudfunctions\.net\/api/);
    assert.ok(!fs.existsSync(path.join(m.sitio, 'prueba.html')), 'la página de prueba de Andrade no va en otros locales');
    assert.deepEqual(fs.readFileSync(path.join(m.sitio, 'assets/logo-local.png')), fs.readFileSync(path.join(ROOT, 'locales/ejemplo/logo.png')));
    // La base (public/) es neutra: no tiene datos de ningún local
    for (const f of fs.readdirSync(path.join(ROOT, 'public')).filter((x) => /\.(html|webmanifest)$/.test(x))) {
      assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'public', f), 'utf8'), /Andrade|casita|Olegario/, 'public/' + f);
    }
  } finally { m.borrar(); }
});

test('L04 servidor de un local nuevo: nombre, puntos, cajas, mesas y carta propios', () => {
  const t = app('ejemplo');
  const d = t.ok('admin.data', {}, t.tk);
  const cfg = Object.fromEntries(d.config.map((c) => [c.clave, c.valor]));
  assert.equal(cfg.nombre_negocio, 'Bistró del Ejemplo');
  assert.equal(d.mesas.length, 12);
  assert.equal(d.puntos.find((p) => p.punto_id === 'A_CAFE').nombre, 'Salón principal');
  assert.equal(d.puntos.find((p) => p.punto_id === 'B_TAKEAWAY').nombre, 'Para llevar (mostrador)');
  assert.equal(d.cajas.find((c) => c.caja_id === 'CAJA_A').nombre, 'Caja 01 — Salón');
  assert.equal(d.menu.productos.length, 6);
  assert.ok(!d.menu.productos.some((p) => p.id === 'ESPRESSO'), 'no se cuela la carta de Andrade');
  assert.equal(d.menu.productos.find((p) => p.id === 'MENU_LUN_EJ').dias, '1', 'platos por día desde el catálogo');
  const tk = t.data.active.Puntos.find((p) => p.punto_id === 'B_TAKEAWAY').qr_token;
  assert.equal(t.ok('public.resolve', { token: tk }).negocio, 'Bistró del Ejemplo');
});

test('L05 local sin para llevar: el punto y su caja quedan apagados', () => {
  const tmp = localTemporal('zz-sin-tk', (l) => { l.puntos.para_llevar = { activo: false }; delete l.cajas.B; });
  try {
    assert.deepEqual(validar('zz-sin-tk').errores, []);
    const t = app('zz-sin-tk');
    const pt = t.data.active.Puntos.find((p) => p.punto_id === 'B_TAKEAWAY');
    assert.equal(pt.activo, 'NO');
    assert.equal(t.call('public.resolve', { token: pt.qr_token }).ok, false);
    const cfg = Object.fromEntries(t.ok('admin.data', {}, t.tk).config.map((c) => [c.clave, c.valor]));
    assert.equal(cfg.takeaway_qr_habilitado, 'NO');
    const m = marcar('zz-sin-tk');
    try { assert.equal(m.r.status, 0, m.r.stdout); assert.match(m.leer('assets/config.js'), /"sinTakeaway": true/); } finally { m.borrar(); }
  } finally { tmp.borrar(); }
});

test('L06 Andrade como local de la matriz: su servidor arranca con sus datos y su carta', () => {
  const t = app('andrade');
  const d = t.ok('admin.data', {}, t.tk);
  const cfg = Object.fromEntries(d.config.map((c) => [c.clave, c.valor]));
  assert.equal(cfg.nombre_negocio, 'Andrade Casa Café y Arte');
  assert.equal(d.cajas.find((c) => c.caja_id === 'CAJA_B').nombre, 'Caja 02 — Takeaway');
  assert.equal(d.puntos.find((p) => p.punto_id === 'B_TAKEAWAY').nombre, 'Andrade Takeaway (casita)');
  assert.equal(d.mesas.length, 20);
  assert.ok(d.menu.productos.some((p) => p.id === 'ESPRESSO'));
});

test('L07 de la Ficha de alta al borrador del local', () => {
  const ficha = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/ficha-ejemplo.json'), 'utf8'));
  const { local, pendientes } = armar(ficha, 'pizzeria-ficticia');
  assert.equal(local.nombre, 'Pizzería Ficticia');
  assert.equal(local.plan, 'PREMIUM');
  assert.equal(local.direccion, 'Calle Inventada 100 · Luque');
  assert.equal(local.mesas, 14);
  assert.equal(local.colores.principal, '#8B1E1E');
  assert.equal(local.puntos.para_llevar.activo, true);
  assert.equal(local.cajas.A, 'Caja única');
  assert.equal(local.config.medios_pago, 'EFECTIVO,TRANSFERENCIA,TD');
  assert.equal(local.config.cuenta_qr_habilitada, 'SI');
  // Aunque en la ficha respondan que no, pedir la cuenta desde el celular viene activado y queda como pendiente.
  const fichaNo = JSON.parse(JSON.stringify(ficha)); fichaNo.respuestas['¿Querés que el cliente pueda pedir la cuenta desde el celular?'] = 'No';
  const r2 = armar(fichaNo, 'pizzeria-ficticia');
  assert.equal(r2.local.config.cuenta_qr_habilitada, 'SI');
  assert.ok(r2.pendientes.some((p) => /pedir la cuenta/.test(p)));
  assert.deepEqual(local.equipo.map((u) => u.rol), ['ADMIN', 'MOZO', 'COCINA', 'CAJA']);
  assert.ok(!JSON.stringify(local).match(/"pin"/i));
  const p = pendientes.join('\n');
  assert.match(p, /color secundario "amarillo mostaza"/);
  assert.match(p, /Pagopar/);
  assert.match(p, /Repartidor/);
  assert.match(p, /writereview/);
  assert.match(p, /Nunca inventar productos ni precios/);
  assert.match(p, /10 sellos = 1 pizza muzzarella/);
});

test('L08 el paquete del servidor de un local no deja rastros en el de Andrade', () => {
  const lib = path.join(ROOT, 'firebase/functions/lib');
  execFileSync('sh', [path.join(ROOT, 'tools/build_firebase.sh'), 'ejemplo'], { stdio: 'pipe' });
  try {
    assert.equal(JSON.parse(fs.readFileSync(path.join(lib, 'local.json'), 'utf8')).nombre, 'Bistró del Ejemplo');
    assert.equal(JSON.parse(fs.readFileSync(path.join(lib, 'catalogo.json'), 'utf8')).version, 'ejemplo-catalogo-v1');
    assert.ok(!/equipo|empresa/.test(fs.readFileSync(path.join(lib, 'local.json'), 'utf8')), 'al servidor van solo los datos que usa');
  } finally {
    execFileSync('sh', [path.join(ROOT, 'tools/build_firebase.sh')], { stdio: 'pipe' });
  }
  assert.ok(!fs.existsSync(path.join(lib, 'local.json')));
  assert.deepEqual(fs.readFileSync(path.join(lib, 'catalogo.json')), fs.readFileSync(path.join(ROOT, 'data/catalogo-base.json')), 'sin local queda la base sin carta');
});

test('L09 base neutra de Mesa Pya\'e: sin local no hay carta ni datos de nadie', () => {
  const t = app('');
  const d = t.ok('admin.data', {}, t.tk);
  const cfg = Object.fromEntries(d.config.map((c) => [c.clave, c.valor]));
  assert.equal(cfg.nombre_negocio, 'Mi local');
  assert.equal(d.menu.productos.length, 0);
  assert.equal(d.cajas.find((c) => c.caja_id === 'CAJA_A').nombre, 'Caja 01 — Salón');
  assert.equal(d.puntos.find((p) => p.punto_id === 'B_TAKEAWAY').nombre, 'Para llevar');
  assert.doesNotMatch(JSON.stringify(d), /Andrade|casita/);
});

test('L10 el sitio de Andrade sale igual que antes: su logo, íconos, colores, servidor y página de prueba', () => {
  const m = marcar('andrade');
  try {
    assert.equal(m.r.status, 0, m.r.stdout + m.r.stderr);
    assert.doesNotMatch(m.r.stdout, /aviso/, m.r.stdout);
    for (const f of ['logo.png', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'hoja.png']) {
      const dest = f === 'logo.png' ? 'logo-local.png' : f;
      assert.deepEqual(fs.readFileSync(path.join(m.sitio, 'assets', dest)), fs.readFileSync(path.join(ROOT, 'locales/andrade', f)), f);
    }
    assert.match(m.leer('menu.html'), /<title>Andrade Casa Café · Menú/);
    assert.match(m.leer('menu.html'), /Olegario Víctor Andrade 2690 · Asunción/);
    assert.match(m.leer('menu.html'), /retirar en la casita/);
    assert.match(m.leer('caja.html'), /Caja 01 — Cafetería/);
    assert.match(m.leer('assets/app.css'), /--tierra: #7A5C43;[\s\S]*--tierra-osc: #5B4331;[\s\S]*--arcilla: #A9643C;/);
    assert.match(m.leer('_redirects'), /andrade-mesapyae-staging\.cloudfunctions\.net\/api/);
    assert.match(m.leer('assets/config.js'), /"projectId": "andrade-mesapyae-staging"/);
    assert.ok(fs.existsSync(path.join(m.sitio, 'prueba.html')) && fs.existsSync(path.join(m.sitio, 'assets/prueba-staging.js')));
  } finally { m.borrar(); }
});
