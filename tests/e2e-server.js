'use strict';
// Servidor para pruebas E2E con usuarios de prueba. Imprime JSON con puerto y tokens QR.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { buildApp, buildFirebaseApp, serve, setPublic } = require('../server/dev-server.js');
const OPTS = {
  secret: 'e2e-secret', adminPin: '246810', mesas: 20, log: (m) => console.error(m),
  usuarios: [
    { usuario_id: 'mozo', nombre: 'Mozo Prueba', rol: 'MOZO', pin: '1111' },
    { usuario_id: 'cocina', nombre: 'Cocina Prueba', rol: 'COCINA', pin: '2222' },
    { usuario_id: 'cajaa', nombre: 'Cajera Café', rol: 'CAJA', caja_id: 'CAJA_A', pin: '3333' },
    { usuario_id: 'cajab', nombre: 'Cajero Takeaway', rol: 'CAJA', caja_id: 'CAJA_B', pin: '4444' }
  ]
};
// Las pruebas nunca llaman al servidor real del local: se quita la dirección directa (apiDirecta) de config.js.
function sinDirecta(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) sinDirecta(f);
    else if (e.name === 'config.js') fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/, "apiDirecta": "[^"]*"/, ''));
  }
  return dir;
}
// Sirve las pantallas con la marca de locales/<local> y su catálogo. Por defecto, Andrade (local piloto de referencia).
if (process.env.MESA_LOCAL === undefined) process.env.MESA_LOCAL = 'andrade';
if (process.env.MESA_UNICO) {
  // E4 · sitio único: el local vive en /<local>/ y su API en /<local>/api (tools/sitio_unico.py)
  const sitio = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-unico-')), 'site');
  execFileSync('python3', [path.join(__dirname, '..', 'tools', 'sitio_unico.py'), sitio, process.env.MESA_UNICO], { stdio: ['ignore', 'ignore', 'inherit'] });
  setPublic(sinDirecta(sitio));
  OPTS.local = process.env.MESA_UNICO; delete OPTS.mesas;
} else if (process.env.MESA_LOCAL) {
  const sitio = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-local-')), 'site');
  fs.cpSync(path.join(__dirname, '..', 'public'), sitio, { recursive: true });
  execFileSync('python3', [path.join(__dirname, '..', 'tools', 'marca_local.py'), sitio, process.env.MESA_LOCAL], { stdio: ['ignore', 'ignore', 'inherit'] });
  setPublic(sinDirecta(sitio));
  OPTS.local = process.env.MESA_LOCAL; delete OPTS.mesas;
}
(async () => {
  const fb = process.env.BACKEND === 'firebase';
  const b = fb ? await buildFirebaseApp(OPTS) : buildApp(process.argv[2] || null, OPTS);
  const s = await serve(b, Number(process.env.PORT || 0));
  let mesas, takeaway;
  if (fb) {
    const rows = (t) => [...b.db.docs.entries()].filter(([p]) => p.startsWith('t_' + t + '/')).map(([, d]) => d.data);
    mesas = rows('Mesas').sort((a, c) => a.numero - c.numero).map((m) => m.qr_token);
    takeaway = rows('Puntos').find((p) => p.punto_id === 'B_TAKEAWAY').qr_token;
  } else {
    const d = b.store._data().active;
    mesas = d.Mesas.map((m) => m.qr_token); takeaway = d.Puntos.find((p) => p.punto_id === 'B_TAKEAWAY').qr_token;
  }
  console.log(JSON.stringify({ port: s.address().port, mesas, takeaway, backend: fb ? 'firebase' : 'json' }));
})();
