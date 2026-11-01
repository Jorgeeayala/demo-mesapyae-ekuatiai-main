#!/usr/bin/env node
'use strict';
/*
 * Revisa que un local de la matriz esté completo y coherente antes de publicarlo.
 * Uso: node tools/validar_local.js <local>      (carpeta locales/<local>)
 * Sale con código 1 si hay errores. Los avisos no frenan, pero hay que leerlos.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PLANES = ['BASICO', 'GOLD', 'PREMIUM'];
const ROLES = ['ADMIN', 'MOZO', 'COCINA', 'CAJA'];
const PUNTOS = ['A_CAFE', 'B_TAKEAWAY'];
const ID = /^[A-Z0-9_]{2,40}$/;
const HEX = /^#[0-9a-fA-F]{6}$/;

function validar(slug) {
  const errores = [], avisos = [];
  const err = (m) => errores.push(m), aviso = (m) => avisos.push(m);
  const dir = path.join(ROOT, 'locales', String(slug || ''));
  if (!/^[a-z0-9-]{3,40}$/.test(String(slug || ''))) { err('Nombre de local inválido: usar minúsculas, números y guiones (3 a 40).'); return { errores, avisos }; }
  if (!fs.existsSync(path.join(dir, 'local.json'))) { err('No existe locales/' + slug + '/local.json'); return { errores, avisos }; }

  let L;
  try { L = JSON.parse(fs.readFileSync(path.join(dir, 'local.json'), 'utf8')); } catch (e) { err('local.json no es JSON válido: ' + e.message); return { errores, avisos }; }

  // Nunca PIN, contraseñas ni tokens en la matriz.
  (function buscar(o, ruta) {
    if (!o || typeof o !== 'object') return;
    Object.keys(o).forEach((k) => {
      if (/pin|pass|clave_|contrase|secret|token/i.test(k)) err('local.json no puede guardar PIN, contraseñas ni tokens (' + ruta + k + ').');
      buscar(o[k], ruta + k + '.');
    });
  })(L, '');

  if (L.slug !== slug) err('slug de local.json ("' + L.slug + '") no coincide con la carpeta ("' + slug + '").');
  ['nombre', 'nombre_corto', 'direccion'].forEach((k) => { if (!String(L[k] || '').trim()) err('Falta ' + k + '.'); });
  if (String(L.nombre_corto || '').length > 24) aviso('nombre_corto tiene más de 24 caracteres; en el celular se puede cortar.');
  if (/andrade/i.test(JSON.stringify([L.nombre, L.nombre_corto, L.direccion])) && slug !== 'andrade') err('Los datos del local mencionan "Andrade".');
  if (PLANES.indexOf(L.plan) < 0) err('plan debe ser BASICO, GOLD o PREMIUM.');
  if (!(Number.isInteger(L.mesas) && L.mesas >= 0 && L.mesas <= 300)) err('mesas debe ser un número entero de 0 a 300.');
  const P = L.puntos || {}, S = P.salon || {}, T = P.para_llevar || {};
  const conTk = T.activo !== false;
  if (!S.nombre || !S.corto) err('Faltan puntos.salon.nombre y puntos.salon.corto.');
  if (conTk && (!T.nombre || !T.corto || !T.lugar)) err('Con para llevar activo faltan puntos.para_llevar.nombre, corto y lugar (ej: "el mostrador").');
  const C = L.cajas || {};
  if (!C.A) err('Falta cajas.A (nombre de la caja principal).');
  if (conTk && !C.B) err('Con para llevar activo falta cajas.B.');
  const textos = [L.nombre, L.nombre_corto, L.direccion, S.nombre, S.corto, T.nombre, T.corto, T.lugar, C.A, C.B].filter(Boolean);
  textos.forEach((t) => { if (/[<>"\\`]/.test(t)) err('Texto con caracteres no permitidos (< > " \\ `): ' + t); });
  if (L.colores) ['principal', 'secundario'].forEach((k) => { if (L.colores[k] && !HEX.test(L.colores[k])) err('colores.' + k + ' debe ser un código como #2F5D62.'); });
  if (!fs.existsSync(path.join(dir, 'logo.png'))) err('Falta logo.png en la carpeta del local.');
  ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png'].forEach((f) => {
    if (!fs.existsSync(path.join(dir, f))) aviso('Falta ' + f + ' (se genera con: python3 tools/iconos_local.py ' + slug + ').');
  });
  const sitio = L.sitio || {};
  if (!/^https:\/\/[^\s]+$/.test(sitio.api_url || '')) aviso('Falta sitio.api_url: se completa después de publicar el servidor (lo imprime desplegar.sh).');
  const fb = sitio.firebase || {};
  if (!fb.projectId) aviso('Falta sitio.firebase (projectId, apiKey, appId): sin eso las pantallas actualizan cada pocos segundos en vez de al instante.');
  (L.equipo || []).forEach((u, i) => {
    if (!u.nombre) err('equipo[' + i + '] sin nombre.');
    if (ROLES.indexOf(u.rol) < 0) err('equipo[' + i + '] rol inválido (' + u.rol + '). Roles: ' + ROLES.join(', ') + '.');
  });
  if (!(L.equipo || []).some((u) => u.rol === 'ADMIN')) aviso('El equipo no tiene ningún ADMIN (dueño o encargado).');

  // Catálogo
  let cat;
  try { cat = JSON.parse(fs.readFileSync(path.join(dir, 'catalogo.json'), 'utf8')); } catch (e) { err('Falta catalogo.json o no es JSON válido.'); return { errores, avisos, local: L }; }
  const faltaLista = ['categorias', 'grupos', 'opciones', 'productos'].filter((k) => !Array.isArray(cat[k]));
  faltaLista.forEach((k) => err('catalogo.json: falta la lista ' + k + '.'));
  if (faltaLista.length) return { errores, avisos, local: L };
  const ids = (lista, k, nombre) => {
    const vistos = new Set();
    lista.forEach((x) => {
      if (!ID.test(String(x[k]))) err(nombre + ' con id inválido: ' + x[k] + ' (MAYÚSCULAS, números y _; 2 a 40).');
      if (vistos.has(x[k])) err(nombre + ' repetido: ' + x[k]);
      vistos.add(x[k]);
    });
    return vistos;
  };
  const cats = ids(cat.categorias, 'categoria_id', 'Categoría');
  const grupos = ids(cat.grupos, 'grupo_id', 'Grupo');
  ids(cat.opciones, 'opcion_id', 'Opción');
  ids(cat.productos, 'producto_id', 'Producto');
  cat.grupos.forEach((g) => {
    const n = cat.opciones.filter((o) => o.grupo_id === g.grupo_id).length;
    if (!n) err('El grupo ' + g.grupo_id + ' no tiene opciones.');
    if (g.min > g.max) err('El grupo ' + g.grupo_id + ' tiene min mayor que max.');
  });
  cat.opciones.forEach((o) => {
    if (!grupos.has(o.grupo_id)) err('La opción ' + o.opcion_id + ' apunta a un grupo que no existe: ' + o.grupo_id);
    if (!Number.isInteger(o.delta_gs) || o.delta_gs < 0) err('La opción ' + o.opcion_id + ' tiene un precio adicional inválido.');
  });
  let porValidar = 0;
  cat.productos.forEach((p) => {
    const q = 'Producto ' + p.producto_id;
    if (!String(p.nombre || '').trim()) err(q + ' sin nombre.');
    if (!cats.has(p.categoria_id)) err(q + ': categoría inexistente ' + p.categoria_id);
    if (!Number.isInteger(p.precio_gs) || p.precio_gs <= 0) err(q + ': precio inválido (' + p.precio_gs + '). Nunca inventar precios: si falta, preguntar al local.');
    String(p.grupos || '').split(',').filter(Boolean).forEach((g) => { if (!grupos.has(g)) err(q + ': grupo inexistente ' + g); });
    const pts = String(p.puntos || '').split(',').filter(Boolean);
    if (!pts.length) err(q + ': no está en ningún punto de venta.');
    pts.forEach((x) => { if (PUNTOS.indexOf(x) < 0) err(q + ': punto inválido ' + x); });
    if (!conTk && pts.indexOf('B_TAKEAWAY') >= 0) aviso(q + ' figura en para llevar, pero el local no tiene para llevar.');
    if (p.dias && !/^[1-7](,[1-7])*$/.test(String(p.dias))) err(q + ': días inválidos (' + p.dias + '). Usar 1 = lunes … 7 = domingo, separados por coma.');
    if (p.imagen && !/^(https:\/\/|imagenes\/)/.test(p.imagen)) err(q + ': la foto debe ser un link https o imagenes/archivo.jpg');
    if (p.validacion === 'POR_VALIDAR') porValidar++;
  });
  if (!cat.productos.length) err('El catálogo no tiene productos.');
  if (porValidar) aviso(porValidar + ' productos POR_VALIDAR: el local tiene que revisarlos antes de salir en vivo.');
  return { errores, avisos, local: L, catalogo: cat };
}

module.exports = { validar };

if (require.main === module) {
  const slug = process.argv[2];
  const r = validar(slug);
  r.avisos.forEach((m) => console.log('  aviso: ' + m));
  r.errores.forEach((m) => console.log('  ERROR: ' + m));
  if (r.errores.length) { console.log('Local ' + slug + ': ' + r.errores.length + ' error(es).'); process.exit(1); }
  console.log('Local ' + slug + ': OK' + (r.avisos.length ? ' (' + r.avisos.length + ' aviso(s))' : '') + ' — ' + r.catalogo.productos.length + ' productos.');
}
