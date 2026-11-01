'use strict';
/*
 * Servidor local de Mesa Pya'e: sirve /public y expone POST /api con el mismo
 * contrato que la función de Netlify. Uso:
 *   node server/dev-server.js [--port 8787] [--db data/dev-db.json] [--mesas 20] [--local <local> --public <carpeta>]
 *   --local: carga el catálogo y los datos de locales/<local> (matriz). --public: sirve otra carpeta (ej. el sitio ya marcado).
 * Variables: MESA_SECRET (firma de sesiones), MESA_ADMIN_PIN (PIN inicial).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const MesaCore = require('../core/core.js');
const CartaIA = require('../core/carta-ia.js');
const AtencionWA = require('../core/atencion-wa.js');
const { createJsonStore } = require('./store-json.js');
const { createNodeEnv } = require('./env-node.js');

function arg(name, def) { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : def; }

const ROOT = path.join(__dirname, '..');
const PORT = Number(arg('port', process.env.PORT || 8787));
const DB = path.resolve(ROOT, arg('db', 'data/dev-db.json'));
let PUBLIC = path.resolve(ROOT, arg('public', 'public'));

function loadSecret() {
  if (process.env.MESA_SECRET) return process.env.MESA_SECRET;
  const f = path.join(path.dirname(DB), '.dev-secret');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(f, 'utf8').trim();
}

// Backend Firebase con Firestore simulado en memoria (desarrollo y pruebas sin credenciales).
async function buildFirebaseApp(opts) {
  opts = opts || {};
  const { FakeFirestore } = require('../tests/fake-firestore.js');
  const { createFirestoreBackend } = require('../firebase/firestore-backend.js');
  const db = new FakeFirestore({ latency: opts.latency === undefined ? 2 : opts.latency });
  const env = createNodeEnv({ secret: opts.secret || loadSecret(), log: opts.log, modulos: opts.modulos, plan: opts.plan });
  const logs = [];
  const backend = createFirestoreBackend({ firestore: db, MesaCore, env, log: (m) => logs.push(m), pulseTtlMs: 1000 });
  const { catalogo, local } = datosLocal(opts.local);
  const seed = { catalogo, local, mesas: opts.mesas || (local && local.mesas) || 20, plataforma: opts.plataforma || MesaCore.parsePlataforma(process.env.MESA_PLATAFORMA) };
  await backend.handle({ action: 'health' }, seed);
  let adminPin = (logs.join('\n').match(/PIN inicial: (\d+)/) || [])[1];
  if (opts.adminPin) {
    const t = (await backend.handle({ action: 'auth.login', payload: { usuario: 'admin', pin: adminPin } }, seed)).data.token;
    await backend.handle({ action: 'admin.user', token: t, payload: { usuario: { usuario_id: 'admin', nombre: 'Encargado (Admin)', rol: 'ADMIN', pin: opts.adminPin, activo: true } } }, seed);
    adminPin = opts.adminPin;
    const t2 = (await backend.handle({ action: 'auth.login', payload: { usuario: 'admin', pin: adminPin } }, seed)).data.token;
    for (const u of (opts.usuarios || [])) await backend.handle({ action: 'admin.user', token: t2, payload: { usuario: Object.assign({ activo: true }, u) } }, seed);
  }
  return { app: { handle: (req) => backend.handle(req, seed) }, backend, db, env, adminPin, seeded: 1 };
}

// Catálogo y datos del local (locales/<local>). Sin local, el de referencia de las pruebas: Andrade, el local piloto.
// slug = '' (vacío): la base neutra de Mesa Pya'e, sin carta.
const LOCAL_PRUEBAS = 'andrade';
function datosLocal(slug) {
  if (slug === undefined || slug === null) slug = LOCAL_PRUEBAS;
  if (!slug) return { catalogo: JSON.parse(fs.readFileSync(path.join(ROOT, 'data/catalogo-base.json'), 'utf8')), local: undefined };
  const d = path.join(ROOT, 'locales', slug);
  return { catalogo: JSON.parse(fs.readFileSync(path.join(d, 'catalogo.json'), 'utf8')), local: JSON.parse(fs.readFileSync(path.join(d, 'local.json'), 'utf8')) };
}

function buildApp(dbFile, opts) {
  opts = opts || {};
  const store = createJsonStore(dbFile);
  const env = createNodeEnv({ secret: opts.secret || loadSecret(), log: opts.log, modulos: opts.modulos, plan: opts.plan });
  const app = MesaCore.create(store, env);
  const { catalogo, local } = datosLocal(opts.local);
  const adminPin = opts.adminPin || process.env.MESA_ADMIN_PIN || String(crypto.randomInt(100000, 999999));
  const r = app.seed({ catalogo, local, mesas: opts.mesas || (local && local.mesas) || 20, admin: { usuario_id: 'admin', nombre: 'Encargado (Admin)', pin: adminPin }, usuarios: opts.usuarios, demo: opts.demo, plataforma: opts.plataforma || MesaCore.parsePlataforma(process.env.MESA_PLATAFORMA) });
  return { app, store, env, adminPin, seeded: r.creados };
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };

function serve(appBundle, port) {
  const { app } = appBundle;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    // /api o, en el sitio único (E4), /<local>/api
    if (/^(\/[a-z0-9-]{3,40})?\/api\/?$/.test(url.pathname)) {
      if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 12000000) req.destroy(); }); // fotos de la carta con IA
      req.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(body); } catch (e) { parsed = null; }
        const send = (out) => {
          res.writeHead(out.status || 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ ok: out.ok, data: out.data, error: out.error, pulse: out.pulse }));
        };
        if (!parsed) return send({ ok: false, error: { code: 'JSON_INVALIDO', message: 'Solicitud inválida.' }, status: 400 });
        // Carta con IA: en desarrollo usa la carta de ejemplo (appBundle.lectorCarta para probar con otro lector).
        // Atención Integrada (Upgrade ATENCION): en desarrollo, Whaticket simulado (appBundle.whaticket para otro cliente).
        const wa = { handle: (r) => app.handle(r), token: 'dev', cliente: appBundle.whaticket || AtencionWA.clienteSimulado(appBundle.avisosEnviados), firmar: (m) => appBundle.env.hmac(appBundle.env.secret, m) };
        const run = parsed.action === 'carta.leer'
          ? () => CartaIA.manejar(parsed, { handle: (r) => app.handle(r), lector: appBundle.lectorCarta || CartaIA.lectorEjemplo(), ejemplo: !appBundle.lectorCarta })
          : parsed.action === 'wa.probar'
            ? () => AtencionWA.probar(parsed, wa)
            : () => Promise.resolve(app.handle(parsed)).then((out) => (out.ok && AtencionWA.DISPARAN[parsed.action]
              ? AtencionWA.enviarPendientes(wa).then(() => out, () => out) : out));
        Promise.resolve().then(run).then(send, (e) => send({ ok: false, error: { code: e && e.busy ? 'OCUPADO' : 'ERROR_INTERNO', message: 'Error del servidor. Reintentá.' }, status: e && e.busy ? 503 : 500 }));
      });
      return;
    }
    let p = decodeURIComponent(url.pathname);
    if (p.endsWith('/')) p += 'index.html';
    if (!path.extname(p)) p += '.html';
    const f = path.join(PUBLIC, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (!f.startsWith(PUBLIC) || !fs.existsSync(f)) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('No encontrado'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok(server)));
}

module.exports = { buildApp, buildFirebaseApp, serve, datosLocal, setPublic: (d) => { PUBLIC = path.resolve(d); } };

if (require.main === module && arg('backend', 'json') === 'firebase') {
  buildFirebaseApp({ mesas: Number(arg('mesas', 20)) }).then((bundle) => serve(bundle, PORT).then(() => {
    console.log(`Mesa Pya'e (dev, Firestore simulado en memoria) en http://127.0.0.1:${PORT}`);
    console.log(`Usuario inicial: admin  PIN: ${bundle.adminPin}`);
  }));
} else if (require.main === module) {
  fs.mkdirSync(path.dirname(DB), { recursive: true });
  const bundle = buildApp(DB, { mesas: Number(arg('mesas', 0)) || undefined, local: arg('local') });
  serve(bundle, PORT).then(() => {
    console.log(`Mesa Pya'e (dev) en http://127.0.0.1:${PORT}  base: ${DB}`);
    if (bundle.seeded) console.log(`Usuario inicial: admin  PIN: ${bundle.adminPin}  (cambialo en Admin > Usuarios)`);
  });
}
