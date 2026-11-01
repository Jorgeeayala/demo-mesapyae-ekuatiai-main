'use strict';
/* Cargar la carta con IA: la lectura (Gemini en Vertex AI, simulado), la limpieza de la propuesta y la importación
   revisada por el encargado.  node --test tests/carta-ia.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../server/dev-server.js');
const CartaIA = require('../core/carta-ia.js');

const PIN = { admin: '246810', mozo: '1111' };
function fresh() {
  const b = buildApp(null, { secret: 'test-secret', adminPin: PIN.admin, mesas: 5, log: () => {}, usuarios: [{ usuario_id: 'mozo', nombre: 'Mozo', rol: 'MOZO', pin: PIN.mozo }], plan: '' });
  const call = (action, payload, token) => b.app.handle({ action, payload: payload || {}, token });
  const ok = (a, p, t) => { const r = call(a, p, t); assert.equal(r.ok, true, a + ' falló: ' + JSON.stringify(r.error)); return r.data; };
  const tk = { admin: ok('auth.login', { usuario: 'admin', pin: PIN.admin }).token, mozo: ok('auth.login', { usuario: 'mozo', pin: PIN.mozo }).token };
  const handle = (r) => b.app.handle(r);
  return { b, call, ok, tk, handle, data: b.store._data() };
}
const FOTO = { mime: 'image/jpeg', datos: Buffer.from('foto de prueba').toString('base64') };
const leer = (t, token, lector, archivos) => CartaIA.manejar({ action: 'carta.leer', token, payload: { archivos: archivos || [FOTO] } }, { handle: t.handle, lector: lector || CartaIA.lectorEjemplo() });

test('IA01 precios: siempre guaraníes enteros, nunca decimales ni inventados', () => {
  assert.equal(CartaIA.precio(25000), 25000);
  assert.equal(CartaIA.precio('25.000'), 25000);
  assert.equal(CartaIA.precio('Gs. 25.000'), 25000);
  assert.equal(CartaIA.precio('25 mil'), 25000);
  assert.equal(CartaIA.precio(''), 0);
  assert.equal(CartaIA.precio('consultar'), 0);
  assert.equal(CartaIA.precio(-5), 0);
  assert.equal(CartaIA.precio(12000.4), 12000);
});

test('IA02 la propuesta: limpia, sin repetidos, marca lo que ya está y no incluye lo que no tiene precio', () => {
  const raw = { categorias: [
    { nombre: 'Cafés', productos: [{ nombre: 'Cortado', precio_gs: '14.000' }, { nombre: 'cortado', precio_gs: 14000 }, { nombre: 'Latte <b>', precio_gs: 20000 }, { nombre: 'Mocha', precio_gs: '' }, { nombre: 'x', precio_gs: 1 }] },
    { nombre: '', productos: [{ nombre: 'Agua', precio_gs: 6000 }] }
  ] };
  const p = CartaIA.normalizar(raw, ['LATTE B']);
  assert.deepEqual(p.productos.map((x) => x.nombre), ['Cortado', 'Latte b', 'Mocha', 'Agua']);
  assert.equal(p.productos.find((x) => x.nombre === 'Latte b').existe, true);
  assert.equal(p.productos.find((x) => x.nombre === 'Latte b').incluir, false);
  assert.equal(p.productos.find((x) => x.nombre === 'Mocha').incluir, false);
  assert.equal(p.productos.find((x) => x.nombre === 'Agua').categoria, 'Carta');
  assert.ok(p.avisos.some((a) => /sin precio/.test(a)));
  assert.ok(p.avisos.some((a) => /ya está/.test(a)));
  assert.equal(CartaIA.normalizar(null).productos.length, 0);
});

test('IA03 archivos: formato, cantidad y tamaño', () => {
  assert.match(CartaIA.validarArchivos([]), /al menos/);
  assert.match(CartaIA.validarArchivos([FOTO, FOTO, FOTO, FOTO, FOTO]), /Hasta 4/);
  assert.match(CartaIA.validarArchivos([{ mime: 'text/html', datos: 'aGk=' }]), /Formato/);
  assert.match(CartaIA.validarArchivos([{ mime: 'image/png', datos: 'no es base64!' }]), /inválido/);
  assert.match(CartaIA.validarArchivos([{ mime: 'application/pdf', datos: 'A'.repeat(6 * 1024 * 1024) }]), /4 MB/);
  assert.equal(CartaIA.validarArchivos([FOTO, { mime: 'application/pdf', datos: 'aGk=' }]), '');
});

test('IA04 solo el encargado lee la carta; sin sesión o como mozo no llega a la IA', async () => {
  const t = fresh();
  let llamadas = 0; const espia = async () => { llamadas++; return CartaIA.EJEMPLO; };
  assert.equal((await leer(t, undefined, espia)).ok, false);
  const m = await leer(t, t.tk.mozo, espia);
  assert.equal(m.ok, false); assert.equal(m.error.code, 'SIN_PERMISO');
  assert.equal(llamadas, 0);
  const r = await leer(t, t.tk.admin, espia);
  assert.equal(r.ok, true); assert.equal(llamadas, 1);
  assert.equal(r.data.productos.length, 9);
  assert.equal(r.data.usos_hoy, 1);
  assert.ok(t.data.active.Auditoria.some((a) => a.accion === 'CARTA_IA_LECTURA'));
});

test('IA05 un archivo inválido no llama a la IA; si la IA falla, el mensaje es claro', async () => {
  const t = fresh();
  let llamadas = 0;
  const r = await leer(t, t.tk.admin, async () => { llamadas++; return {}; }, [{ mime: 'text/plain', datos: 'aGk=' }]);
  assert.equal(r.ok, false); assert.equal(r.error.code, 'ARCHIVO_INVALIDO'); assert.equal(llamadas, 0);
  const f = await CartaIA.manejar({ token: t.tk.admin, payload: { archivos: [FOTO] } }, { handle: t.handle, lector: async () => { throw new Error('503'); }, log: () => {} });
  assert.equal(f.ok, false); assert.equal(f.error.code, 'IA_NO_DISPONIBLE');
});

test('IA06 límite diario de lecturas por local', async () => {
  const t = fresh();
  for (let i = 0; i < 20; i++) assert.equal((await leer(t, t.tk.admin)).ok, true);
  const r = await leer(t, t.tk.admin);
  assert.equal(r.ok, false); assert.equal(r.error.code, 'LIMITE_IA');
});

test('IA07 importar: crea categorías y productos POR VALIDAR, sin duplicar y una sola vez por solicitud', () => {
  const t = fresh();
  const antes = t.data.active.Productos.length;
  const productos = [
    { nombre: 'Cortado especial', categoria: 'Cafetería IA', precio_gs: 14000, descripcion: 'Doble' },
    { nombre: 'Cappuccino IA', categoria: 'Cafetería IA', precio_gs: 22000, variantes: 'Chico 22.000 · Grande 28.000' },
    { nombre: 'Jugo IA', categoria: 'Jugos IA', precio_gs: 15000 }
  ];
  const r = t.ok('admin.importarCarta', { request_id: 'imp-prueba-1', productos }, t.tk.admin);
  assert.deepEqual(r, { productos_nuevos: 3, categorias_nuevas: 2, omitidos: 0 });
  assert.equal(t.data.active.Productos.length, antes + 3);
  const cap = t.data.active.Productos.find((p) => p.nombre === 'Cappuccino IA');
  assert.equal(cap.validacion, 'POR_VALIDAR');
  assert.equal(cap.precio_gs, 22000);
  assert.match(cap.nota, /Variantes: Chico/);
  assert.match(cap.fuente, /Carta con IA · revisado por admin/);
  // Reintento de la misma solicitud: no duplica
  assert.equal(t.ok('admin.importarCarta', { request_id: 'imp-prueba-1', productos }, t.tk.admin).duplicado, true);
  // Otra solicitud con los mismos platos: los omite
  assert.equal(t.ok('admin.importarCarta', { request_id: 'imp-prueba-2', productos }, t.tk.admin).omitidos, 3);
  assert.equal(t.data.active.Productos.length, antes + 3);
  // Aparecen en el catálogo del encargado y no en la carta pública hasta que se valide... (la carta los muestra igual que cualquier producto POR_VALIDAR)
  assert.ok(t.ok('admin.data', {}, t.tk.admin).menu.productos.some((p) => p.nombre === 'Jugo IA'));
});

test('IA08 importar: nunca sin precio, solo el encargado', () => {
  const t = fresh();
  const sinPrecio = t.call('admin.importarCarta', { request_id: 'imp-prueba-3', productos: [{ nombre: 'Mocha', categoria: 'Cafés', precio_gs: 0 }] }, t.tk.admin);
  assert.equal(sinPrecio.ok, false); assert.equal(sinPrecio.error.code, 'PRECIO_INVALIDO');
  const decimal = t.call('admin.importarCarta', { request_id: 'imp-prueba-4', productos: [{ nombre: 'Mocha', categoria: 'Cafés', precio_gs: 1500.5 }] }, t.tk.admin);
  assert.equal(decimal.ok, false);
  assert.equal(t.call('admin.importarCarta', { request_id: 'imp-prueba-5', productos: [{ nombre: 'Mocha', precio_gs: 1500 }] }, t.tk.mozo).ok, false);
  assert.equal(t.call('admin.importarCarta', { request_id: 'imp-prueba-6', productos: [] }, t.tk.admin).error.code, 'CARTA_VACIA');
  // Una línea mala no deja nada a medias
  const n = t.data.active.Productos.length;
  assert.equal(t.call('admin.importarCarta', { request_id: 'imp-prueba-7', productos: [{ nombre: 'Bueno', precio_gs: 1000 }, { nombre: 'Malo', precio_gs: 0 }] }, t.tk.admin).ok, false);
  assert.equal(t.data.active.Productos.length, n);
});

test('IA09 lector de Vertex AI: arma la llamada con la cuenta del servidor y lee el JSON', async () => {
  let pedido;
  const lector = CartaIA.crearLectorVertex({
    proyecto: 'mi-proyecto', region: 'global', modelo: 'gemini-x',
    token: async () => 'tok-123',
    fetch: async (url, o) => { pedido = { url, o }; return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(CartaIA.EJEMPLO) }] } }] }) }; }
  });
  const r = await lector([FOTO]);
  assert.equal(r.categorias.length, 3);
  assert.equal(pedido.url, 'https://aiplatform.googleapis.com/v1/projects/mi-proyecto/locations/global/publishers/google/models/gemini-x:generateContent');
  assert.equal(pedido.o.headers.Authorization, 'Bearer tok-123');
  const body = JSON.parse(pedido.o.body);
  assert.equal(body.contents[0].parts[0].inlineData.mimeType, 'image/jpeg');
  assert.equal(body.generationConfig.temperature, 0);
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  const reg = CartaIA.crearLectorVertex({ proyecto: 'p', region: 'us-central1', token: async () => 't', fetch: async (u) => { pedido = u; return { ok: false, status: 429 }; } });
  await assert.rejects(reg([FOTO]), /429/);
  assert.match(pedido, /^https:\/\/us-central1-aiplatform\.googleapis\.com\//);
  assert.match(CartaIA.PROMPT, /no inventes/i);
});

test('IA10 el servidor de Firebase manda carta.leer a la IA y el despliegue activa Vertex AI', () => {
  const fs = require('fs'), path = require('path');
  const idx = fs.readFileSync(path.join(__dirname, '..', 'firebase', 'functions', 'index.js'), 'utf8');
  assert.match(idx, /carta\.leer/);
  assert.match(idx, /timeoutSeconds: 120/);
  const sh = fs.readFileSync(path.join(__dirname, '..', 'firebase', 'desplegar.sh'), 'utf8');
  assert.match(sh, /aiplatform\.googleapis\.com/);
  assert.match(sh, /roles\/aiplatform\.user/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'tools', 'build_firebase.sh'), 'utf8'), /carta-ia\.js/);
  // La lectura va directo al servidor (el proxy de Netlify corta a los 26 s): CORS sin cookies y apiDirecta en el sitio
  assert.match(idx, /Access-Control-Allow-Origin/);
  assert.match(idx, /req\.method === 'OPTIONS'/);
  assert.doesNotMatch(idx, /Allow-Credentials/);
  const os = require('os'), { execFileSync } = require('child_process');
  const sitio = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ia-sitio-')), 'site');
  fs.cpSync(path.join(__dirname, '..', 'public'), sitio, { recursive: true });
  execFileSync('python3', [path.join(__dirname, '..', 'tools', 'marca_local.py'), sitio, 'andrade'], { stdio: 'ignore' });
  const cfg = fs.readFileSync(path.join(sitio, 'assets', 'config.js'), 'utf8');
  assert.match(cfg, /"apiUrl": "\/api"/);
  // El sitio deja que las pantallas hablen directo con el servidor (Content-Security-Policy → connect-src)
  const toml = fs.readFileSync(path.join(__dirname, '..', 'netlify.toml'), 'utf8');
  assert.match((toml.match(/connect-src [^;]+/) || [''])[0], /https:\/\/\*\.cloudfunctions\.net/);
  assert.match(cfg, /"apiDirecta": "https:\/\/[a-z0-9-]+-[a-z0-9-]+\.cloudfunctions\.net\/api"/);
});
