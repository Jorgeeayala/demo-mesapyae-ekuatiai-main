#!/usr/bin/env node
'use strict';
/*
 * Arma la extensión "Migrador e-Kuatia'i" para un local: agrega a externally_connectable el dominio del local
 * (local.json → "dominio") y los sitios extra que se pasen, así la caja de ese local puede mandarle facturas.
 * La base (extension/migrador-ekuatiai) es neutra: solo acepta la demo, el sitio de pruebas y el servidor local.
 *
 * Uso: node tools/extension_local.js <local|-> [sitio extra ...] [--out carpeta] [--zip archivo.zip]
 *   ej.: node tools/extension_local.js andrade andrade-mesapyae.netlify.app
 *        node tools/extension_local.js - mi-sitio.netlify.app   (sin local: solo los sitios indicados)
 *        node tools/extension_local.js todos mesapyae.serolimites.com   (E4: UNA extensión para todos los locales:
 *              el sitio único + el dominio propio de cada local que lo tenga en local.json → "dominio", texto o lista)
 *        node tools/extension_local.js todos mesapyae.serolimites.com --tienda --zip mesa-ekuatiai-tienda.zip
 *              paquete para subir a la tienda de Chrome (Chrome Web Store): sin "key" (Google le da su propio ID)
 *              y sin las direcciones locales de desarrollo.
 * Resultado: dist-extension-<local>/ (se carga en chrome://extensions → "Cargar descomprimida")
 *            y su .zip (o el archivo de --zip), con la carpeta migrador-ekuatiai adentro.
 * El ID de la extensión no cambia (sale de la clave del manifest), así que la caja la encuentra sin configurar nada.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const local = args[0];
if (!local || (local.startsWith('-') && local !== '-')) { console.error('Uso: node tools/extension_local.js <local|-> [sitio extra ...] [--out carpeta] [--zip archivo.zip]'); process.exit(1); }
const raiz = path.join(__dirname, '..');
let ficha = {};
const todos = local === 'todos';
let dominiosLocales = [];
if (todos) {
  const dir = path.join(raiz, 'locales');
  for (const l of fs.readdirSync(dir).sort()) {
    const f = path.join(dir, l, 'local.json');
    if (l === 'ejemplo' || !fs.existsSync(f)) continue;
    const d = JSON.parse(fs.readFileSync(f, 'utf8')).dominio;
    dominiosLocales = dominiosLocales.concat(d || []);
  }
} else if (local !== '-') {
  const fichaPath = path.join(raiz, 'locales', local, 'local.json');
  if (!fs.existsSync(fichaPath)) { console.error('No existe locales/' + local + '/local.json'); process.exit(1); }
  ficha = JSON.parse(fs.readFileSync(fichaPath, 'utf8'));
}
let out = path.join(raiz, 'dist-extension-' + (local === '-' ? 'sitio' : local));
let zipOut = null;
let tienda = false;
const extras = [];
for (let i = 1; i < args.length; i++) {
  if (args[i] === '--out') { out = path.resolve(args[++i]); continue; }
  if (args[i] === '--zip') { zipOut = path.resolve(args[++i]); continue; }
  if (args[i] === '--tienda') { tienda = true; continue; }
  extras.push(args[i]);
}

function patron(host) {
  host = String(host).trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?$/.test(host)) throw new Error('Sitio inválido: ' + host);
  return 'https://' + host.replace(/:\d+$/, '') + '/*';
}

const hosts = [].concat(ficha.dominio || [], dominiosLocales, extras).filter(Boolean).map(patron);
if (!hosts.length) { console.error('Sin sitios: pasá el dominio del sitio como argumento.'); process.exit(1); }

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(raiz, 'extension', 'migrador-ekuatiai'), out, { recursive: true });
const mPath = path.join(out, 'manifest.json');
const m = JSON.parse(fs.readFileSync(mPath, 'utf8'));
m.externally_connectable.matches = Array.from(new Set(hosts.concat(m.externally_connectable.matches)));
if (tienda) {
  delete m.key; // la tienda de Chrome no acepta la clave: asigna su propio ID (va en public/assets/facturador.js → TIENDA_ID)
  m.externally_connectable.matches = m.externally_connectable.matches.filter((x) => x.startsWith('https://'));
}
if (local !== '-' && !todos) m.name = m.name + ' · ' + (ficha.nombre_corto || ficha.nombre || local);
fs.writeFileSync(mPath, JSON.stringify(m, null, 2) + '\n');
console.log('Extensión para ' + local + ' en ' + path.relative(process.cwd(), out));
console.log('Sitios que pueden mandarle facturas:\n  ' + m.externally_connectable.matches.join('\n  '));
// Zip con la carpeta adentro (migrador-ekuatiai/manifest.json): se descomprime y se elige esa carpeta.
const destinoZip = zipOut || out + '.zip';
fs.mkdirSync(path.dirname(destinoZip), { recursive: true });
execFileSync('python3', ['-c', [
  'import os, sys, zipfile',
  'src, dst = sys.argv[1], sys.argv[2]',
  'base = os.path.basename(src.rstrip(os.sep))',
  'z = zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED)',
  'for r, _, fs in os.walk(src):',
  '    for f in sorted(fs): p = os.path.join(r, f); z.write(p, os.path.join(base, os.path.relpath(p, src)))',
  'z.close()'
].join('\n'), out, destinoZip]);
console.log('Paquete: ' + path.relative(process.cwd(), destinoZip));
