'use strict';
/* E4 · Sitio único (tools/sitio_unico.py) y extensión única (tools/extension_local.js todos).  node --test tests/sitio.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const armar = (...locales) => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'unico-')), 'sitio');
  const r = spawnSync('python3', [path.join(ROOT, 'tools', 'sitio_unico.py'), out, ...locales], { encoding: 'utf8' });
  return { out, r, leer: (f) => fs.readFileSync(path.join(out, f), 'utf8') };
};

test('U01 cada local en su carpeta, con su API por /<local>/api y URLs limpias', () => {
  const { out, r, leer } = armar('andrade', 'prueba-alta');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  for (const l of ['andrade', 'prueba-alta']) {
    assert.ok(fs.existsSync(path.join(out, l, 'menu.html')));
    assert.match(leer(l + '/assets/config.js'), new RegExp('"apiUrl": "/' + l + '/api"'));
    assert.ok(!fs.existsSync(path.join(out, l, '_redirects')), 'las reglas van en la raíz');
  }
  const red = leer('_redirects');
  assert.match(red, /^\/andrade\/api  https:\/\/southamerica-east1-andrade-mesapyae-staging\.cloudfunctions\.net\/api  200!$/m);
  assert.match(red, /^\/prueba-alta\/api  https:\/\/southamerica-east1-prueba-alta-mesapyae\.cloudfunctions\.net\/api  200!$/m);
  assert.match(red, /^\/prueba-alta\/caja  \/prueba-alta\/caja\.html  200$/m);
});

test('U02 cada local guarda lo suyo en el navegador y su app instalable vive en /<local>/', () => {
  const { r, leer } = armar('prueba-alta');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(leer('prueba-alta/assets/lib.js'), /'mesapyae\.prueba-alta\.sesion'/);
  assert.doesNotMatch(leer('prueba-alta/assets/lib.js'), /'mesapyae\.sesion'/);
  assert.match(leer('prueba-alta/tarjeta.html'), /'mesapyae\.prueba-alta\.rec\.token'/);
  assert.doesNotMatch(leer('prueba-alta/caja.html'), /register\('\/sw\.js'\)/);
  const man = JSON.parse(leer('prueba-alta/manifest.webmanifest'));
  assert.deepEqual([man.id, man.start_url, man.scope], ['./', './', './']);
  assert.match(man.name, /Prueba de Alta/);
});

test('U03 la raíz no muestra la lista de clientes: va a la página de Mesa Pya\'e', () => {
  const { out, r, leer } = armar('andrade', 'prueba-alta');
  assert.equal(r.status, 0);
  assert.deepEqual(fs.readdirSync(out).sort(), ['_redirects', 'andrade', 'index.html', 'prueba-alta']);
  assert.doesNotMatch(leer('index.html'), /andrade|prueba/i);
});

test('U04 un local que no existe o un nombre reservado no entra y el armado avisa con error', () => {
  const { r } = armar('prueba-alta', 'no-existe', 'assets');
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /no-existe \(no existe/);
  assert.match(r.stdout, /assets \(nombre de carpeta no permitido/);
});

test('U05 las pantallas base no cambian (los sitios propios de cada local siguen igual)', () => {
  armar('prueba-alta');
  assert.match(fs.readFileSync(path.join(ROOT, 'public', 'assets', 'lib.js'), 'utf8'), /'mesapyae\.sesion'/);
  assert.match(fs.readFileSync(path.join(ROOT, 'public', 'manifest.webmanifest'), 'utf8'), /"scope": "\/"/);
});

test('U06 UNA extensión e-Kuatia\'i para todos: el sitio único + el dominio propio de cada local', () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ext-')), 'migrador');
  execFileSync(process.execPath, [path.join(ROOT, 'tools', 'extension_local.js'), 'todos', 'mesapyae-locales.netlify.app', '--out', out], { stdio: 'ignore' });
  const m = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
  assert.ok(m.externally_connectable.matches.includes('https://mesapyae-locales.netlify.app/*'));
  assert.ok(m.externally_connectable.matches.includes('https://pedidos.andradecasacafe.com/*'), 'Andrade con su dominio');
  assert.doesNotMatch(m.name, /Andrade|Prueba/, 'sin nombre de un local');
});

test('U07 paquete para la tienda de Chrome: sin clave, solo https, con todos los locales', () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tienda-')), 'migrador');
  execFileSync(process.execPath, [path.join(ROOT, 'tools', 'extension_local.js'), 'todos', 'mesapyae.serolimites.com', '--tienda', '--out', out], { stdio: 'ignore' });
  const m = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
  assert.equal(m.key, undefined, 'la tienda asigna su propio ID');
  const mt = m.externally_connectable.matches;
  assert.ok(mt.every((x) => x.startsWith('https://')), mt.join(' '));
  for (const d of ['mesapyae.serolimites.com', 'pedidos.andradecasacafe.com', 'andrade-mesapyae.netlify.app']) assert.ok(mt.includes('https://' + d + '/*'), d);
});
