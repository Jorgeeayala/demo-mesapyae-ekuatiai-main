'use strict';
/* Pie de los tickets del cliente (Premium): QR del club y mensaje propio del local.  node --test tests/ticket.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../server/dev-server.js');

const PIN = { admin: '246810', mozo: '1111' };
const USUARIOS = [{ usuario_id: 'mozo', nombre: 'Mozo', rol: 'MOZO', pin: PIN.mozo }];
function fresh(plan) {
  const b = buildApp(null, { secret: 'test-secret', adminPin: PIN.admin, log: () => {}, usuarios: USUARIOS, plan: plan || '', modulos: '' });
  const call = (action, payload, token) => b.app.handle({ action, payload: payload || {}, token });
  const ok = (a, p, t) => { const r = call(a, p, t); assert.equal(r.ok, true, a + ' falló: ' + JSON.stringify(r.error)); return r.data; };
  const tk = {}; for (const u of Object.keys(PIN)) tk[u] = ok('auth.login', { usuario: u, pin: PIN[u] }).token;
  return { call, ok, tk };
}

test('TK01 Básico: sin pie del club (y no puede configurarlo)', () => {
  const t = fresh('');
  assert.equal(t.ok('sync', {}, t.tk.mozo).recompensas, null);
  const r = t.call('rec.config', { config: { rec_ticket_mensaje: 'Hola' } }, t.tk.admin);
  assert.equal(r.error.code, 'MODULO_NO_ACTIVO');
});

test('TK02 Premium con el club activo: QR por defecto y mensaje propio', () => {
  const t = fresh('PREMIUM');
  t.ok('rec.config', { config: { rec_activo: 'SI' }, premios: [{ tipo: 'SELLOS', sellos: 10, nombre: 'Café gratis', producto_id: 'ESPRESSO' }] }, t.tk.admin);
  let tk = t.ok('sync', {}, t.tk.mozo).recompensas.ticket;
  assert.equal(tk.qr, true, 'el QR viene encendido');
  assert.equal(tk.mensaje, '');
  assert.equal(tk.premio, '10 sellos: Café gratis');
  t.ok('rec.config', { config: { rec_ticket_mensaje: '  ¡Gracias! Seguinos en @tulocal  ' } }, t.tk.admin);
  tk = t.ok('sync', {}, t.tk.mozo).recompensas.ticket;
  assert.equal(tk.mensaje, '¡Gracias! Seguinos en @tulocal');
  t.ok('rec.config', { config: { rec_ticket_qr: 'NO' } }, t.tk.admin);
  assert.equal(t.ok('sync', {}, t.tk.mozo).recompensas.ticket.qr, false);
  assert.equal(t.call('rec.config', { config: { rec_ticket_qr: 'TAL VEZ' } }, t.tk.admin).error.code, 'VALOR_INVALIDO');
  t.ok('rec.config', { config: { rec_ticket_mensaje: 'x'.repeat(300) } }, t.tk.admin);
  assert.equal(t.ok('sync', {}, t.tk.mozo).recompensas.ticket.mensaje.length, 120, 'máximo 120 caracteres');
});

test('TK03 Premium con el club pausado: sin pie', () => {
  const t = fresh('PREMIUM');
  assert.equal(t.ok('sync', {}, t.tk.mozo).recompensas, null);
});
