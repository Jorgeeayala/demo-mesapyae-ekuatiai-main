'use strict';
/* E3 · acciones de GitHub que publican servidores y dan de alta locales.  node --test tests/e3.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { listar, proyectoDe } = require('../tools/locales_servidor.js');
const W = (f) => fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', f), 'utf8');

test('E301 el proyecto de cada local sale de su api_url', () => {
  assert.equal(proyectoDe('https://southamerica-east1-andrade-mesapyae-staging.cloudfunctions.net/api'), 'andrade-mesapyae-staging');
  assert.equal(proyectoDe('https://evil.example.com/api'), null);
  assert.equal(proyectoDe('https://southamerica-east1-x.cloudfunctions.net/api; rm -rf /'), null);
});

test('E302 la lista de locales con servidor no incluye el local de ejemplo y filtra por nombre', () => {
  const todos = listar('todos');
  assert.ok(todos.some((l) => l.local === 'andrade' && l.proyecto === 'andrade-mesapyae-staging'));
  assert.ok(!todos.some((l) => l.local === 'ejemplo'));
  assert.deepEqual(listar('andrade').map((l) => l.local), ['andrade']);
  assert.deepEqual(listar('no-existe'), []);
});

test('E303 las acciones entran a Google Cloud sin claves y nunca llevan el PIN', () => {
  for (const f of ['publicar-servidores.yml', 'alta-local.yml', 'publicar-demo.yml']) {
    const y = W(f);
    assert.match(y, /workload_identity_provider: \$\{\{ vars\.GCP_PROVEEDOR \}\}/, f);
    assert.match(y, /id-token: write/, f);
    assert.doesNotMatch(y, /credentials_json|AIza|MESA_PLATAFORMA=/, f);
    assert.match(y, /workflow_dispatch/, f, 'solo se corren a mano (botón)');
  }
  const a = W('alta-local.yml');
  assert.match(a, /--budget-amount=10USD/);
  assert.match(a, /CARPETA_CLIENTES: "188823144806"/);
});

test('E304 la demo pública se publica con un botón, en su proyecto de demo y con datos ficticios', () => {
  const y = W('publicar-demo.yml');
  assert.match(y, /PROYECTO: mesapyae-demo/);
  assert.match(y, /sh tools\/paquete_demo\.sh/);
  assert.match(y, /desplegar\.sh "\$PROYECTO" PREMIUM demo <\/dev\/null/);
  assert.doesNotMatch(y, /locales\//, 'no toca datos de ningún local');
});

test('E305 vigilancia: respaldo diario, chequeo del servidor y alerta por correo, sin claves', () => {
  const y = W('vigilancia.yml');
  assert.match(y, /workload_identity_provider: \$\{\{ vars\.GCP_PROVEEDOR \}\}/);
  assert.match(y, /sh tools\/vigilancia\.sh/);
  const s = fs.readFileSync(path.join(__dirname, '..', 'tools', 'vigilancia.sh'), 'utf8');
  assert.match(s, /--recurrence=daily --retention=7d/);
  assert.match(s, /--body='\{"action":"health"\}'/);
  assert.match(s, /REDUCE_COUNT_FALSE/);
  assert.doesNotMatch(s, /MESA_PLATAFORMA|AIza/);
});
