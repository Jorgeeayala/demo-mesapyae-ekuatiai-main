'use strict';
/*
 * Lista los locales que tienen servidor (sitio.api_url en locales/<local>/local.json) para las acciones de GitHub.
 * Uso: node tools/locales_servidor.js [local|todos]  →  imprime JSON [{ local, proyecto }]
 */
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', 'locales');
function proyectoDe(apiUrl) {
  const m = /^https:\/\/southamerica-east1-([a-z][a-z0-9-]{4,28}[a-z0-9])\.cloudfunctions\.net\/api$/.exec(String(apiUrl || ''));
  return m ? m[1] : null;
}
function listar(filtro) {
  const out = [];
  for (const local of fs.readdirSync(DIR).sort()) {
    const f = path.join(DIR, local, 'local.json');
    if (local === 'ejemplo' || !fs.existsSync(f)) continue;
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    const proyecto = proyectoDe(j.sitio && j.sitio.api_url);
    if (!proyecto) continue;
    if (filtro && filtro !== 'todos' && filtro !== local) continue;
    out.push({ local, proyecto });
  }
  return out;
}
module.exports = { listar, proyectoDe };
if (require.main === module) {
  const filtro = process.argv[2] || 'todos';
  const l = listar(filtro);
  if (!l.length) { console.error('No hay locales con servidor para: ' + filtro); process.exit(1); }
  process.stdout.write(JSON.stringify(l));
}
