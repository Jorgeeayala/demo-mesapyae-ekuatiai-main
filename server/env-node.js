'use strict';
const crypto = require('crypto');

const ALPHA = 'abcdefghijkmnpqrstuvwxyz23456789'; // sin caracteres ambiguos

function createNodeEnv(opts) {
  opts = opts || {};
  const cache = new Map();
  let clock = opts.clock || null; // para pruebas: función que devuelve ms
  return {
    now: () => (clock ? clock() : Date.now()),
    uuid: () => crypto.randomUUID(),
    token(n) {
      const b = crypto.randomBytes(n);
      let s = '';
      for (let i = 0; i < n; i++) s += ALPHA[b[i] % ALPHA.length];
      return s;
    },
    sha256: (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex'),
    hmac: (k, m) => crypto.createHmac('sha256', String(k)).update(String(m), 'utf8').digest('hex'),
    b64: (s) => Buffer.from(String(s), 'utf8').toString('base64'),
    unb64: (s) => Buffer.from(String(s), 'base64').toString('utf8'),
    dateKey(ms) {
      // Fecha local de Asunción (sin depender de la zona del servidor)
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
    },
    secret: opts.secret,
    // Módulos premium con licencia en este despliegue (ej.: MESA_MODULOS=RECOMPENSAS)
    // Plan del local: BASICO (por defecto), GOLD o PREMIUM (ej.: MESA_PLAN=GOLD)
    plan: String(opts.plan !== undefined ? opts.plan : (process.env.MESA_PLAN || '')).toUpperCase().trim(),
    modulos: String(opts.modulos !== undefined ? opts.modulos : (process.env.MESA_MODULOS || '')).toUpperCase().split(',').map((x) => x.trim()).filter(Boolean),
    cache: {
      get(k) { const v = cache.get(k); if (!v) return null; if (v.exp < Date.now()) { cache.delete(k); return null; } return v.val; },
      put(k, val, sec) { cache.set(k, { val, exp: Date.now() + sec * 1000 }); }
    },
    log: opts.log || ((m) => console.error(m)),
    setClock(fn) { clock = fn; }
  };
}

module.exports = { createNodeEnv };
