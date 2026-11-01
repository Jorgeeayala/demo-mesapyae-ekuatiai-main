'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { debePublicar } = require('../tools/netlify_publicar.js');

test('Alta de un local nuevo: no publica los sitios de los otros locales', () => {
  const alta = ['locales/pizzeria-don-luis/local.json', 'locales/pizzeria-don-luis/catalogo.json', 'locales/pizzeria-don-luis/logo.png'];
  assert.equal(debePublicar(alta, 'andrade'), false);
  assert.equal(debePublicar(alta, 'lo-de-rolo'), false);
  assert.equal(debePublicar(alta, ''), false, 'pruebas/demo no usan locales reales');
  assert.equal(debePublicar(alta, 'pizzeria-don-luis'), true, 'el sitio nuevo sí se publica');
});

test('Cambio en la carta de un local: publica solo ese local', () => {
  assert.equal(debePublicar(['locales/andrade/catalogo.json'], 'andrade'), true);
  assert.equal(debePublicar(['locales/andrade/catalogo.json'], 'lo-de-rolo'), false);
});

test('Cambio de código compartido: publica todos', () => {
  for (const f of ['core/core.js', 'public/menu.html', 'tools/marca_local.py', 'netlify.toml', 'package.json', 'demo/catalogo-demo.json']) {
    assert.equal(debePublicar([f], 'andrade'), true, f);
    assert.equal(debePublicar([f], ''), true, f);
  }
  assert.equal(debePublicar(['locales/otro/local.json', 'core/core.js'], 'andrade'), true, 'mezcla: publica');
});

test('Solo documentación o pruebas: no publica', () => {
  assert.equal(debePublicar(['docs/manual-tecnico.md', 'tests/mesa.test.js', 'CLAUDE.md', 'locales/README.md'], 'andrade'), false);
});

test('Plantilla de ejemplo: la usan pruebas/demo, no los locales', () => {
  assert.equal(debePublicar(['locales/ejemplo/local.json'], ''), true);
  assert.equal(debePublicar(['locales/ejemplo/local.json'], 'andrade'), false);
});

test('Sin información de cambios: publica (lado seguro)', () => {
  assert.equal(debePublicar([], 'andrade'), true);
  assert.equal(debePublicar(null, 'andrade'), true);
});

test('E4 · Sitio único: el alta o la carta de cualquier local lo publica; la plantilla y los documentos no', () => {
  assert.equal(debePublicar(['locales/pizzeria-don-luis/local.json'], '', true), true);
  assert.equal(debePublicar(['locales/andrade/catalogo.json'], '', true), true);
  assert.equal(debePublicar(['locales/ejemplo/local.json', 'docs/x.md', 'locales/README.md'], '', true), false);
  assert.equal(debePublicar(['core/core.js'], '', true), true);
});
