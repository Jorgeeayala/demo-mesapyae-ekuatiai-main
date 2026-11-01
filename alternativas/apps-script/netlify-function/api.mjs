/*
 * Mesa Pya'e — Andrade · Función proxy de Netlify
 * Navegador -> /api (esta función) -> Apps Script Web App (con secreto compartido).
 *
 * Variables de entorno (Netlify > Site configuration > Environment variables):
 *   GAS_URL           URL /exec del Web App de Apps Script
 *   GAS_PROXY_SECRET  valor de PROXY_SECRET que imprime setup() en Apps Script
 * Ninguna de las dos llega al navegador.
 */
const WINDOW_MS = 60_000;
const LIMITS = { publico: 40, personal: 400 }; // solicitudes por minuto por IP (mejor esfuerzo, por instancia)
const hits = new Map();

function limited(ip, kind) {
  const now = Date.now();
  const key = kind + ':' + ip;
  const h = hits.get(key);
  if (!h || now - h.t > WINDOW_MS) { hits.set(key, { t: now, n: 1 }); return false; }
  h.n++;
  if (hits.size > 5000) hits.clear();
  return h.n > LIMITS[kind];
}
const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});

export default async (req, context) => {
  if (req.method !== 'POST') return json(405, { ok: false, error: { code: 'METODO', message: 'Usá POST.' } });
  const url = process.env.GAS_URL, secret = process.env.GAS_PROXY_SECRET;
  if (!url || !secret) return json(500, { ok: false, error: { code: 'CONFIG', message: 'Servidor sin configurar (GAS_URL / GAS_PROXY_SECRET).' } });
  let body;
  try {
    const text = await req.text();
    if (text.length > 100_000) return json(413, { ok: false, error: { code: 'MUY_GRANDE', message: 'Solicitud demasiado grande.' } });
    body = JSON.parse(text);
  } catch {
    return json(400, { ok: false, error: { code: 'JSON_INVALIDO', message: 'Solicitud inválida.' } });
  }
  const action = String(body.action || '');
  const kind = action.startsWith('public.') || action === 'auth.login' ? 'publico' : 'personal';
  const ip = (context && context.ip) || req.headers.get('x-nf-client-connection-ip') || 'desconocida';
  if (limited(ip, kind)) return json(429, { ok: false, error: { code: 'DEMASIADAS_SOLICITUDES', message: 'Demasiadas solicitudes. Esperá un minuto.' } });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25_000);
  try {
    const r = await fetch(url, {
      method: 'POST', redirect: 'follow', signal: ctrl.signal,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // evita preflight; Apps Script lee postData.contents
      body: JSON.stringify({ action, payload: body.payload || {}, token: body.token, proxy_secret: secret })
    });
    const text = await r.text();
    let out;
    try { out = JSON.parse(text); } catch { return json(502, { ok: false, error: { code: 'BACKEND', message: 'Respuesta inesperada del servidor. Reintentá.' } }); }
    return json(out.status || (out.ok ? 200 : 400), { ok: out.ok, data: out.data, error: out.error });
  } catch (e) {
    return json(504, { ok: false, error: { code: 'TIMEOUT', message: 'El servidor tardó demasiado. Reintentá: no se duplicará.' } });
  } finally {
    clearTimeout(timer);
  }
};

export const config = { path: '/api' };
