/*
 * Validación del paquete que manda la caja de Mesa Pya'e (versión 1).
 * Se usa en el service worker (importScripts) y en las pruebas de Node.
 * Nada de esto viaja a la DNIT: solo decide si el paquete es sano antes de rellenar el formulario.
 */
(function (root) {
  'use strict';
  var IVAS = [10, 5, 0];

  function entero(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v; }
  function texto(v, max) { return typeof v === 'string' && v.trim().length > 0 && v.length <= max; }

  function validarFactura(f) {
    var errores = [];
    if (!f || typeof f !== 'object') return ['Paquete vacío.'];
    if (f.version !== 1) errores.push('Versión de paquete no soportada.');
    if (!texto(f.cobro_id, 80)) errores.push('Falta el identificador del cobro.');
    var r = f.receptor || {};
    if (!/^[0-9]{3,10}$/.test(String(r.ruc || ''))) errores.push('RUC/CI del receptor inválido.');
    if (r.tipo === 'RUC' && !/^[0-9]$/.test(String(r.dv || ''))) errores.push('Falta el dígito verificador del RUC.');
    if (r.tipo !== 'RUC' && r.tipo !== 'CI') errores.push('Tipo de documento del receptor inválido.');
    if (!texto(r.razon, 120)) errores.push('Falta la razón social.');
    var items = Array.isArray(f.items) ? f.items : [];
    if (!items.length) errores.push('La factura no tiene ítems.');
    if (items.length > 300) errores.push('Demasiados ítems (máximo 300).');
    var suma = 0;
    items.forEach(function (it, i) {
      var n = 'Ítem ' + (i + 1) + ': ';
      if (!texto(it.descripcion, 120)) errores.push(n + 'descripción inválida.');
      if (!entero(it.cantidad) || it.cantidad <= 0) errores.push(n + 'cantidad inválida.');
      if (!entero(it.precio_unit_gs) || it.precio_unit_gs < 0) errores.push(n + 'precio inválido.');
      var d = it.descuento_gs || 0;
      if (!entero(d) || d < 0 || d > it.cantidad * it.precio_unit_gs) errores.push(n + 'descuento inválido.');
      if (IVAS.indexOf(it.iva) < 0) errores.push(n + 'tasa de IVA inválida (10, 5 o 0).');
      suma += it.cantidad * it.precio_unit_gs - d;
    });
    if (!entero(f.total_gs) || f.total_gs <= 0) errores.push('Total inválido.');
    else if (!errores.length && suma !== f.total_gs) errores.push('La suma de los ítems (Gs. ' + suma + ') no coincide con el total cobrado (Gs. ' + f.total_gs + ').');
    return errores;
  }

  var api = { validarFactura: validarFactura, IVAS: IVAS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MigradorFactura = api;
})(typeof self !== 'undefined' ? self : this);
