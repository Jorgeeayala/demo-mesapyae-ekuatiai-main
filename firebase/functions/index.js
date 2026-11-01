'use strict';
/*
 * Mesa Pya'e · Cloud Functions (2ª generación), región São Paulo.
 *
 *  api            POST /api  →  mismo contrato que el resto del sistema ({action, payload, token, pulse})
 *  archivoDiario  todos los días 05:00 (Asunción): archiva lo cerrado hace más de N días
 *  exportDia      GET  ?dia=YYYY-MM-DD con encabezado X-Export-Key  →  datos del día (para Google Sheets)
 *
 * Secretos (Secret Manager):  SESSION_SECRET (firma de sesiones), EXPORT_KEY (exportación a Sheets),
 *                             WHATICKET_TOKEN (Upgrade Atención Integrada; «pendiente» mientras el local no lo tenga)
 * Los archivos core.js, env-node.js, firestore-backend.js y catalogo.json los copia tools/build_firebase.sh.
 */
const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const MesaCore = require('./lib/core.js');
const { createNodeEnv } = require('./lib/env-node.js');
const { createFirestoreBackend } = require('./lib/firestore-backend.js');
const catalogo = require('./lib/catalogo.json');
const CartaIA = require('./lib/carta-ia.js');
const AtencionWA = require('./lib/atencion-wa.js');

initializeApp();
const SESSION_SECRET = defineSecret('SESSION_SECRET');
const EXPORT_KEY = defineSecret('EXPORT_KEY');
const WHATICKET_TOKEN = defineSecret('WHATICKET_TOKEN');
const REGION = 'southamerica-east1';
// MESA_PLAN (BASICO/GOLD/PREMIUM) y MESA_PLATAFORMA (usuario:sal:hash) van en firebase/functions/.env.<proyecto>
// Local nuevo (matriz): tools/paquete_local.sh <salida> <local> copia locales/<local>/local.json a lib/local.json.
// Sin ese archivo queda la base neutra (sin carta).
let LOCAL = null;
try { LOCAL = require('./lib/local.json'); } catch (e) { /* sin datos de local */ }
const SEED = { catalogo, mesas: (LOCAL && LOCAL.mesas) || 20, local: LOCAL || undefined, plataforma: MesaCore.parsePlataforma(process.env.MESA_PLATAFORMA) };
// MESA_DEMO=SI (solo el sitio de demo de Mesa Pya'e): carga los modelos 3D de ejemplo en tres productos
if (process.env.MESA_DEMO === 'SI') SEED.modelos3d = { ESPRESSO: 'modelos/espresso.glb', PIZZA_PERSONAL: 'modelos/pizza.glb', PANINI_CESAR: 'modelos/panini.glb' };
if (process.env.MESA_DEMO === 'SI') {  // fotos de ejemplo (Unsplash) en los productos principales
  try {
    const f = require('./lib/fotos-demo.json');
    SEED.imagenes = {};
    Object.keys(f).filter((k) => k[0] !== '_').forEach((k) => { SEED.imagenes[k] = 'https://images.unsplash.com/' + f[k] + '?auto=format&fit=crop&w=720&q=70'; });
  } catch (e) { /* sin fotos de ejemplo */ }
}
if (process.env.MESA_DEMO === 'SI') SEED.demo = {
  premios: [
    { tipo: 'SELLOS', sellos: 6, nombre: '1 Espresso gratis', producto_id: 'ESPRESSO', costo_gs: 4000 },
    { tipo: 'SELLOS', sellos: 10, nombre: '1 Panini César gratis', producto_id: 'PANINI_CESAR', costo_gs: 15000 },
    { tipo: 'CUMPLE', nombre: 'Porción de torta de cumpleaños', valor_gs: 18000, costo_gs: 7000 }
  ],
  config: { nombre_negocio: process.env.MESA_DEMO_NOMBRE || 'Café Demo', rec_activo: 'SI', rec_nombre: 'Club ' + (process.env.MESA_DEMO_NOMBRE || 'Café Demo'), rec_minimo_gs: '20000',
    rec_mensaje: 'Sumá un sello en cada visita y ganá premios de la casa.', res_google_url: 'https://www.google.com/maps' }
};

let backend = null;
function getBackend() {
  if (!backend) {
    const env = createNodeEnv({ secret: SESSION_SECRET.value(), log: (m) => console.error(m) });
    backend = createFirestoreBackend({ firestore: getFirestore(), MesaCore, env, log: (m) => console.warn(m) });
  }
  return backend;
}

// Carta con IA: Gemini en Vertex AI del mismo proyecto, con la cuenta de servicio de la función (sin claves).
// MESA_IA_MODELO y MESA_IA_REGION en firebase/functions/.env.<proyecto> para cambiar de modelo o región.
let lectorCarta = null;
function getLectorCarta() {
  if (!lectorCarta) lectorCarta = CartaIA.crearLectorVertex({
    proyecto: process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT, region: process.env.MESA_IA_REGION, modelo: process.env.MESA_IA_MODELO,
    fetch: (u, o) => fetch(u, o), token: CartaIA.tokenMetadatos((u, o) => fetch(u, o))
  });
  return lectorCarta;
}

// Atención Integrada (Upgrade ATENCION): avisos por WhatsApp con Whaticket. El token vive solo en Secret Manager.
function depsWA() {
  const crypto = require('crypto');
  return {
    handle: (r) => getBackend().handle(r, SEED), token: WHATICKET_TOKEN.value(), fetch: (u, o) => fetch(u, o),
    firmar: (m) => crypto.createHmac('sha256', String(SESSION_SECRET.value())).update(String(m), 'utf8').digest('hex'),
    log: (m) => console.warn(m)
  };
}

exports.api = onRequest({
  region: REGION, secrets: [SESSION_SECRET, WHATICKET_TOKEN], memory: '512MiB', cpu: 1, timeoutSeconds: 120,
  concurrency: 80, maxInstances: 4, minInstances: 0, invoker: 'public', cors: false
}, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  // CORS para llamadas directas desde las pantallas (la carta con IA no pasa por el proxy de Netlify, que corta a los
  // 26 s). Sin cookies: la sesión va como token en el cuerpo, así que abrir el origen no da acceso a nada nuevo.
  const origen = req.get('Origin');
  if (origen && /^https:\/\/[a-z0-9.-]+$/i.test(origen) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origen || '')) {
    res.set('Access-Control-Allow-Origin', origen); res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Methods', 'POST'); res.set('Access-Control-Allow-Headers', 'Content-Type'); res.set('Access-Control-Max-Age', '3600');
  }
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: { code: 'METODO', message: 'Usá POST.' } }); return; }
  let body = req.body;
  if (typeof body === 'string' || Buffer.isBuffer(body)) { try { body = JSON.parse(String(body)); } catch (e) { body = null; } }
  if (!body || typeof body !== 'object') { res.status(400).json({ ok: false, error: { code: 'JSON_INVALIDO', message: 'Solicitud inválida.' } }); return; }
  try {
    let out;
    if (body.action === 'carta.leer') out = await CartaIA.manejar({ payload: body.payload, token: body.token }, { handle: (r) => getBackend().handle(r, SEED), lector: getLectorCarta(), log: (m) => console.error(m) });
    else if (body.action === 'wa.probar') out = await AtencionWA.probar({ token: body.token }, depsWA());
    else {
      out = await getBackend().handle({ action: body.action, payload: body.payload, token: body.token, pulse: body.pulse }, SEED);
      // Aviso por WhatsApp pendiente (pedido recibido o listo): sale ya, sin frenar la respuesta más de 8 s.
      if (out.ok && AtencionWA.DISPARAN[body.action] && AtencionWA.tokenConfigurado(WHATICKET_TOKEN.value())) {
        await Promise.race([AtencionWA.enviarPendientes(depsWA()).catch((e) => console.warn('avisoWA', e && e.message)), new Promise((r) => setTimeout(r, 8000))]);
      }
    }
    res.status(out.status || 200).json({ ok: out.ok, data: out.data, error: out.error, pulse: out.pulse });
  } catch (e) {
    if (e && e.busy) { res.status(503).json({ ok: false, error: { code: 'OCUPADO', message: 'El sistema está ocupado. Reintentá en unos segundos: no se duplicará.' } }); return; }
    console.error(e);
    res.status(500).json({ ok: false, error: { code: 'ERROR_INTERNO', message: 'Error interno. Reintentá; si persiste avisá al encargado.' } });
  }
});

exports.archivoDiario = onSchedule({ region: REGION, schedule: '0 5 * * *', timeZone: 'America/Asuncion', secrets: [SESSION_SECRET] }, async () => {
  const n = await getBackend().archive();
  console.log('Archivo diario:', JSON.stringify(n));
});

exports.exportDia = onRequest({ region: REGION, secrets: [SESSION_SECRET, EXPORT_KEY], memory: '512MiB', invoker: 'public' }, async (req, res) => {
  if (req.get('X-Export-Key') !== EXPORT_KEY.value()) { res.status(403).json({ ok: false }); return; }
  const dia = String(req.query.dia || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) { res.status(400).json({ ok: false, error: 'dia=YYYY-MM-DD' }); return; }
  res.json({ ok: true, data: await getBackend().exportDay(dia) });
});
