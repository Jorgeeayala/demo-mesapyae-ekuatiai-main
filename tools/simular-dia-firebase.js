'use strict';
/*
 * Simula un día de operación sobre Firestore (simulado) y cuenta lecturas/escrituras
 * para estimar el costo real en Firebase. Uso: node tools/simular-dia-firebase.js [pedidos] [pantallas]
 */
const fs = require('fs'), path = require('path');
const MesaCore = require('../core/core.js');
const { createNodeEnv } = require('../server/env-node.js');
const { createFirestoreBackend } = require('../firebase/firestore-backend.js');
const { FakeFirestore } = require('../tests/fake-firestore.js');
const catalogo = JSON.parse(fs.readFileSync(path.join(__dirname, '../locales/andrade/catalogo.json'), 'utf8'));
const PEDIDOS = Number(process.argv[2] || 200), PANTALLAS = Number(process.argv[3] || 6);
(async () => {
  const db = new FakeFirestore({ latency: 0 });
  // 2 instancias de la función (lo habitual con tráfico de un café)
  const I = [0, 1].map(() => createFirestoreBackend({ firestore: db, MesaCore, env: createNodeEnv({ secret: 's', log: () => {} }), log: () => {}, pulseTtlMs: 1500 }));
  const seed = { catalogo, mesas: 20 };
  let k = 0;
  const call = (a, p, t, extra) => I[(k++) % 2].handle(Object.assign({ action: a, payload: p || {}, token: t }, extra || {}), seed);
  const logs = []; const b0 = createFirestoreBackend({ firestore: db, MesaCore, env: createNodeEnv({ secret: 's', log: () => {} }), log: (m) => logs.push(m), pulseTtlMs: 0 });
  await b0.handle({ action: 'health' }, seed);
  const pin = logs.join('').match(/PIN inicial: (\d+)/)[1];
  const adm = (await b0.handle({ action: 'auth.login', payload: { usuario: 'admin', pin } }, seed)).data.token;
  for (const u of [['mozo', 'MOZO', ''], ['cocina', 'COCINA', ''], ['cajaa', 'CAJA', 'CAJA_A'], ['cajab', 'CAJA', 'CAJA_B']]) await b0.handle({ action: 'admin.user', token: adm, payload: { usuario: { usuario_id: u[0], nombre: u[0], rol: u[1], caja_id: u[2], pin: '1234', activo: true } } }, seed);
  const tk = {}; for (const u of ['mozo', 'cocina', 'cajaa', 'cajab']) tk[u] = (await call('auth.login', { usuario: u, pin: '1234' })).data.token;
  db.resetCounters();
  let pulseReads = 0; let cambios = 0;
  // Cada cambio: las pantallas reciben el pulso (1 lectura c/u) y piden sincronizar con esa revisión.
  async function despuesDeCambio(out) {
    cambios++; pulseReads += PANTALLAS;
    await Promise.all([...Array(PANTALLAS)].map((_, i) => call('sync', { since: 0 }, i % 2 ? tk.cocina : tk.mozo, { pulse: out.pulse })));
  }
  await despuesDeCambio(await call('caja.abrir', { caja_id: 'CAJA_A', monto_inicial_gs: 100000 }, tk.cajaa));
  await despuesDeCambio(await call('caja.abrir', { caja_id: 'CAJA_B', monto_inicial_gs: 50000 }, tk.cajab));
  for (let i = 0; i < PEDIDOS; i++) {
    const tk_ = i % 4 === 3 ? tk.cajab : tk.mozo;
    const body = i % 4 === 3 ? { punto_id: 'B_TAKEAWAY', alias: 'Cliente ' + i } : { mesa_id: 'M' + String((i % 20) + 1).padStart(2, '0') };
    const r = await call('order.create', Object.assign({ request_id: 'dia-sim-' + i, items: [{ producto_id: 'CAPUCHINO', cantidad: 1 }, { producto_id: 'MIXTO', cantidad: 1 }, { producto_id: 'JUGO_NATURAL', cantidad: 1, opciones: ['JS_NAR', 'JT_250'] }] }, body), tk_);
    await despuesDeCambio(r);
    const p = r.data.pedido;
    for (const e of ['EN_PREPARACION', 'LISTO']) await despuesDeCambio(await call('order.state', { pedido_id: p.pedido_id, estado: e }, tk.cocina));
    await despuesDeCambio(await call('order.state', { pedido_id: p.pedido_id, estado: 'ENTREGADO' }, tk_));
    await despuesDeCambio(await call('caja.cobrar', { request_id: 'dia-cobro-' + i, cuenta_id: p.cuenta_id, pagos: [{ medio: 'EFECTIVO', monto_gs: p.total_gs }] }, i % 4 === 3 ? tk.cajab : tk.cajaa));
  }
  // Consultas de respaldo cada 30 s durante 14 h en cada pantalla (sin cambios)
  const respaldo = PANTALLAS * 2 * 60 * 14;
  const r0 = db.reads;
  for (let i = 0; i < 300; i++) await call('sync', { since: 999999 }, tk.cocina);
  const lecturasRespaldo = Math.round((db.reads - r0) / 300 * respaldo);
  const lecturas = db.reads + pulseReads + lecturasRespaldo, escrituras = db.writes;
  const usd = Math.max(0, lecturas - 50000) / 100000 * 0.03 + Math.max(0, escrituras - 20000) / 100000 * 0.09;
  console.log(JSON.stringify({ pedidos: PEDIDOS, pantallas: PANTALLAS, cambios, lecturas_por_dia: lecturas, escrituras_por_dia: escrituras, invocaciones_funcion_por_dia: k + respaldo, costo_firestore_usd_dia: +usd.toFixed(4), costo_firestore_usd_mes: +(usd * 30).toFixed(2) }, null, 1));
})();
