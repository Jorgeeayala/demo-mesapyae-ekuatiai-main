'use strict';
/* Cadena completa: función Netlify -> (302 como Google) -> Apps Script emulado. */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

test('Proxy Netlify: reenvía al Apps Script con secreto, sigue la redirección y mapea errores', async (t) => {
  process.env.MESA_SKIP_GAS_TESTS = '1';
  const { emulator } = require('./gas.test.js');
  const E = emulator(); E.ctx.setup();
  const pin = E.logs.join('\n').match(/PIN inicial es: (\d+)/)[1];
  let seenSecret = null;
  const gas = http.createServer((req, res) => {
    if (req.url.startsWith('/exec') && req.method === 'POST') {
      let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
        seenSecret = JSON.parse(b).proxy_secret;
        E.newExecution();
        const out = E.ctx.doPost({ postData: { contents: b } }).getContent();
        const id = Math.random().toString(36).slice(2);
        gas.pending = gas.pending || {}; gas.pending[id] = out;
        res.writeHead(302, { Location: '/echo?id=' + id }); res.end();
      });
    } else if (req.url.startsWith('/echo')) {
      const id = new URL(req.url, 'http://x').searchParams.get('id');
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(gas.pending[id]);
    } else { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => gas.listen(0, '127.0.0.1', r));
  t.after(() => gas.close());
  process.env.GAS_URL = 'http://127.0.0.1:' + gas.address().port + '/exec';
  process.env.GAS_PROXY_SECRET = E.props.get('PROXY_SECRET');
  const fn = (await import(pathToFileURL(path.join(__dirname, '../alternativas/apps-script/netlify-function/api.mjs')).href)).default;
  const call = async (body, ip) => {
    const r = await fn(new Request('https://x/api', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }), { ip: ip || '1.1.1.1' });
    return { status: r.status, body: await r.json() };
  };
  const ok = await call({ action: 'auth.login', payload: { usuario: 'admin', pin } });
  assert.equal(ok.status, 200); assert.equal(ok.body.ok, true);
  assert.equal(seenSecret, process.env.GAS_PROXY_SECRET);
  assert.ok(!JSON.stringify(ok.body).includes(process.env.GAS_PROXY_SECRET), 'el secreto no vuelve al navegador');
  // El navegador no puede imponer otro secreto
  const forged = await call({ action: 'health', proxy_secret: 'x' });
  assert.equal(forged.status, 200);
  const bad = await call({ action: 'auth.login', payload: { usuario: 'admin', pin: '000000' } });
  assert.equal(bad.status, 401); assert.equal(bad.body.error.code, 'LOGIN_INVALIDO');
  assert.equal((await call('{x')).status, 400);
  const get = await fn(new Request('https://x/api'), {}); assert.equal(get.status, 405);
  // Límite por IP para acciones públicas
  let last;
  for (let i = 0; i < 45; i++) last = await call({ action: 'public.resolve', payload: { token: 'zzzzzzzzzzzz' } }, '9.9.9.9');
  assert.equal(last.status, 429);
  // Backend caído
  process.env.GAS_URL = 'http://127.0.0.1:1/exec';
  const down = await call({ action: 'health' }, '2.2.2.2');
  assert.equal(down.status, 504);
});
