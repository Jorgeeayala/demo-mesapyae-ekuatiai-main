'use strict';
/*
 * firebase/desplegar.sh — PIN de sol desde la bóveda central (Secret Manager de mesapyae-central).
 * gcloud, firebase y npm se reemplazan por simuladores: no se toca ninguna nube.  node --test tests/desplegar.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const LINEA_OK = 'sol:abcdefghijkmnpqr:' + 'a'.repeat(64);

// Arma una copia mínima del paquete (firebase/ + tools/) y simuladores de gcloud/firebase/npm.
function armar({ boveda, centralExiste }) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'desplegar-'));
  fs.mkdirSync(path.join(d, 'firebase', 'functions'), { recursive: true });
  fs.mkdirSync(path.join(d, 'tools'));
  fs.copyFileSync(path.join(ROOT, 'firebase', 'desplegar.sh'), path.join(d, 'firebase', 'desplegar.sh'));
  fs.copyFileSync(path.join(ROOT, 'tools', 'plataforma-pin.js'), path.join(d, 'tools', 'plataforma-pin.js'));
  const bin = path.join(d, 'bin'); fs.mkdirSync(bin);
  const log = path.join(d, 'gcloud.log');
  const secreto = path.join(d, 'boveda.txt');
  if (boveda) fs.writeFileSync(secreto, boveda);
  fs.writeFileSync(path.join(bin, 'gcloud'), `#!/bin/sh
echo "$*" >> "${log}"
case "$*" in
  *"secrets versions access latest --secret=MESA_PLATAFORMA"*) [ -f "${secreto}" ] && cat "${secreto}" && exit 0; exit 1;;
  *"secrets describe MESA_PLATAFORMA"*) [ -f "${secreto}" ] && exit 0; exit 1;;
  *"secrets create MESA_PLATAFORMA"*) cat > "${secreto}"; exit 0;;
  *"projects describe local-prueba"*) echo 123456789; exit 0;;
  *"projects describe mesapyae-central"*) ${centralExiste ? 'exit 0' : 'exit 1'};;
  *"secrets describe"*) exit 0;;
esac
exit 0
`);
  fs.writeFileSync(path.join(bin, 'firebase'), '#!/bin/sh\nexit 0\n');
  fs.writeFileSync(path.join(bin, 'npm'), '#!/bin/sh\nexit 0\n');
  fs.writeFileSync(path.join(bin, 'clear'), '#!/bin/sh\nexit 0\n');
  for (const f of ['gcloud', 'firebase', 'npm', 'clear']) fs.chmodSync(path.join(bin, f), 0o755);
  const correr = (entrada, extra) => spawnSync('sh', [path.join(d, 'firebase', 'desplegar.sh'), 'local-prueba'], {
    input: entrada || '', encoding: 'utf8', timeout: 20000,
    env: Object.assign({}, process.env, { PATH: bin + ':' + process.env.PATH, CI: '' }, extra || {})
  });
  const env = () => fs.readFileSync(path.join(d, 'firebase', 'functions', '.env.local-prueba'), 'utf8');
  const boveda2 = () => (fs.existsSync(secreto) ? fs.readFileSync(secreto, 'utf8') : null);
  const llamadas = () => fs.readFileSync(log, 'utf8');
  return { d, correr, env, boveda: boveda2, llamadas, borrar: () => fs.rmSync(d, { recursive: true, force: true }) };
}

test('D01 con la bóveda central: no pide el PIN y usa el mismo en el local', () => {
  const t = armar({ boveda: LINEA_OK, centralExiste: true });
  try {
    const r = t.correr('');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /ESCRIBI EL PIN/);
    assert.match(r.stdout, /bóveda central/);
    assert.match(t.env(), new RegExp('^MESA_PLATAFORMA=' + LINEA_OK + '$', 'm'));
  } finally { t.borrar(); }
});

test('D02 sin bóveda todavía: pide el PIN dos veces, rechaza si no coinciden y lo guarda en la bóveda', () => {
  const t = armar({ boveda: null, centralExiste: true });
  try {
    const r = t.correr('135790\n135791\n135790\n135790\n');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /no coinciden/);
    const linea = t.env().match(/^MESA_PLATAFORMA=(.*)$/m)[1];
    assert.match(linea, /^sol:[a-z0-9]{16}:[0-9a-f]{64}$/);
    assert.equal(t.boveda(), linea, 'la bóveda guarda la misma línea (sal + hash), nunca el PIN');
    assert.doesNotMatch(t.boveda(), /135790/);
    assert.doesNotMatch(t.llamadas(), /135790/);
  } finally { t.borrar(); }
});

test('D03 sin proyecto central: funciona como antes (pide el PIN y no intenta guardarlo afuera)', () => {
  const t = armar({ boveda: null, centralExiste: false });
  try {
    const r = t.correr('246810\n246810\n');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(t.env(), /^MESA_PLATAFORMA=sol:/m);
    assert.equal(t.boveda(), null);
    assert.doesNotMatch(t.llamadas(), /secrets create MESA_PLATAFORMA/);
  } finally { t.borrar(); }
});

test('D04 una bóveda con contenido raro no se usa: se pide el PIN', () => {
  const t = armar({ boveda: 'cualquier-cosa', centralExiste: true });
  try {
    const r = t.correr('112233\n112233\n');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /ESCRIBI EL PIN/);
    assert.equal(t.boveda(), 'cualquier-cosa', 'no pisa un secreto existente');
  } finally { t.borrar(); }
});

test('D05 en GitHub (CI) sin bóveda: corta con un error claro en vez de quedarse esperando el PIN', () => {
  const t = armar({ boveda: null, centralExiste: true });
  try {
    const r = t.correr('', { CI: 'true' });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /no se pudo leer el PIN de sol/);
  } finally { t.borrar(); }
});

test('D06 en GitHub (CI) con bóveda: publica sin pedir nada', () => {
  const t = armar({ boveda: LINEA_OK, centralExiste: true });
  try {
    const r = t.correr('', { CI: 'true' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(t.env(), /^MESA_PLATAFORMA=sol:/m);
  } finally { t.borrar(); }
});

test('D07 proyecto nuevo: le da a la cuenta por defecto los roles para compilar y para usar Firestore', () => {
  const t = armar({ boveda: LINEA_OK, centralExiste: true });
  try {
    const r = t.correr('', { CI: 'true' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(t.llamadas(), /projects add-iam-policy-binding local-prueba --member serviceAccount:\S*-compute@developer\.gserviceaccount\.com --role roles\/cloudbuild\.builds\.builder/);
    assert.match(t.llamadas(), /add-iam-policy-binding local-prueba --member serviceAccount:\S*-compute@\S* --role roles\/datastore\.user/, 'el servidor puede usar Firestore');
  } finally { t.borrar(); }
});

test('D08 programa el respaldo diario de la base (7 días) si no lo tiene', () => {
  const t = armar({ boveda: LINEA_OK, centralExiste: true });
  try {
    const r = t.correr('', { CI: 'true' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(t.llamadas(), /firestore backups schedules create --database=\(default\) --recurrence=daily --retention=7d --project local-prueba/);
  } finally { t.borrar(); }
});
