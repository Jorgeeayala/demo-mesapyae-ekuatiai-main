/*
 * Facturador e-Kuatia'i (disparador): arma el detalle de factura de un cobro y lo manda a la extensión
 * "Mesa Pya'e · Migrador e-Kuatia'i" (extension/migrador-ekuatiai), que rellena el formulario de la DNIT.
 * La persona inicia sesión, firma con su PIN y emite: este código nunca lo hace.
 * Si la extensión no está instalada en ese navegador, la caja no muestra nada nuevo.
 * Funciona en el navegador (window.Facturador) y en Node (pruebas).
 */
(function (root) {
  'use strict';
  // ID fijo de la extensión: sale de la clave pública del manifest ("key"). Se puede pisar con window.MESA_EKUATIAI_ID.
  var EXT_ID = 'cdjnkjemaniamlfcdpccchenabkfbfgf';
  // Extensión publicada en la tienda de Chrome (Chrome Web Store, no listada): Google le da otro ID. Mientras conviven las dos,
  // la caja prueba primero la de la tienda y después la instalada a mano. Vacío = todavía no está publicada.
  var TIENDA_ID = '';
  var TIENDA_URL = TIENDA_ID ? 'https://chromewebstore.google.com/detail/' + TIENDA_ID : '';
  var IVA = 10; // gastronomía: todos los ítems van con IVA 10 %.

  function int(v) { var n = Math.round(Number(v)); return isFinite(n) ? n : 0; }
  function limpio(s, max) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max); }
  function suma(l, k) { return l.reduce(function (a, x) { return a + int(x[k]); }, 0); }

  // "80012345-6" → RUC 80012345 / DV 6 ; "1234567" → CI 1234567
  function receptorDe(cp) {
    var doc = String(cp.ruc || '').replace(/[\s.]/g, '').toUpperCase();
    var m = /^([0-9]{3,10})-([0-9])$/.exec(doc);
    return {
      tipo: m ? 'RUC' : 'CI', ruc: m ? m[1] : doc, dv: m ? m[2] : '', documento: doc,
      razon: limpio(cp.razon, 120), email: limpio(cp.email, 120)
    };
  }

  function lineaDe(i, ivaDefecto) {
    var cant = int(i.cantidad) || 1, total = int(i.total_gs);
    var desc = limpio(i.nombre + (i.opciones ? ' · ' + i.opciones : ''), 120);
    var iva = ivaDefecto;
    // Si el total no se divide exacto por la cantidad, va en una sola línea para que la suma cuadre.
    if (total % cant !== 0) return { descripcion: limpio(cant + ' × ' + desc, 120), cantidad: 1, precio_unit_gs: total, descuento_gs: 0, iva: iva, persona: i.persona || '' };
    return { descripcion: desc, cantidad: cant, precio_unit_gs: total / cant, descuento_gs: 0, iva: iva, persona: i.persona || '' };
  }

  // Elige qué ítems corresponden a este cobro. Cuenta entera → todos; cobro por personas → los de esas personas
  // más su parte de lo compartido. Si algo no cuadra, una sola línea con el importe cobrado (nunca se inventan precios).
  function itemsDelCobro(cobro, lineas, ivaDefecto) {
    var sub = int(cobro.subtotal_gs);
    var tot = function (l) { return l.reduce(function (a, x) { return a + x.cantidad * x.precio_unit_gs; }, 0); };
    if (tot(lineas) === sub) return { items: lineas, modo: 'COMPLETO' };
    var d = cobro.detalle;
    if (d && d.personas) {
      var ids = Object.keys(d.personas);
      var propias = lineas.filter(function (x) { return ids.indexOf(String(x.persona)) >= 0; });
      var compartidas = lineas.filter(function (x) { return !x.persona; });
      var comp = int(d.compartido);
      var sumaPersonas = Object.keys(d.personas).reduce(function (a, k) { return a + int(d.personas[k]); }, 0);
      if (tot(propias) === sumaPersonas) {
        if (comp && tot(compartidas) === comp) return { items: propias.concat(compartidas), modo: 'PERSONAS' };
        var out = propias.slice();
        if (comp) out.push({ descripcion: 'Parte del consumo compartido', cantidad: 1, precio_unit_gs: comp, descuento_gs: 0, iva: ivaDefecto, persona: '' });
        if (tot(out) === sub) return { items: out, modo: 'PERSONAS' };
      }
    }
    return { items: [{ descripcion: 'Consumo en el local', cantidad: 1, precio_unit_gs: sub, descuento_gs: 0, iva: ivaDefecto, persona: '' }], modo: 'RESUMIDO' };
  }

  // Reparte el descuento del cobro entre las líneas, proporcional a su importe (el resto, en la línea más grande).
  function repartirDescuento(items, desc) {
    if (!desc) return items;
    var base = items.reduce(function (a, x) { return a + x.cantidad * x.precio_unit_gs; }, 0);
    var usado = 0, mayor = 0;
    items.forEach(function (x, k) {
      var imp = x.cantidad * x.precio_unit_gs;
      x.descuento_gs = Math.floor(desc * imp / base);
      usado += x.descuento_gs;
      if (imp > items[mayor].cantidad * items[mayor].precio_unit_gs) mayor = k;
    });
    items[mayor].descuento_gs += desc - usado;
    return items;
  }

  /*
   * armar({ cobro, pedidos, local, iva }) → paquete versión 1 para la extensión.
   * cobro: el de caja.estado (con comprobante FACTURA); pedidos: los de esa cuenta (de sync).
   */
  function armar(o) {
    var c = o.cobro;
    if (!c || c.estado !== 'VALIDO') throw new Error('Solo se factura un cobro válido.');
    if (!c.comprobante || c.comprobante.tipo !== 'FACTURA') throw new Error('Este cobro se pidió como ticket, sin datos de factura.');
    var ivaDef = IVA;
    var lineas = [];
    (o.pedidos || []).forEach(function (p) {
      if (p.cuenta_id !== c.cuenta_id || p.estado === 'CANCELADO') return;
      (p.items || []).forEach(function (i) { if (!i.anulado && int(i.total_gs) > 0) lineas.push(lineaDe(i, ivaDef)); });
    });
    var sel = itemsDelCobro(c, lineas, ivaDef);
    var items = repartirDescuento(sel.items.map(function (x) { return { descripcion: x.descripcion, cantidad: x.cantidad, precio_unit_gs: x.precio_unit_gs, descuento_gs: 0, iva: x.iva }; }), int(c.descuento_gs));
    return {
      version: 1, origen: 'mesa-pyae', local: limpio(o.local, 80),
      cobro_id: c.cobro_id, fecha: c.fecha, modo: sel.modo,
      receptor: receptorDe(c.comprobante),
      items: items,
      subtotal_gs: int(c.subtotal_gs), descuento_gs: int(c.descuento_gs), total_gs: int(c.total_gs),
      condicion: 'CONTADO', pagos: (c.pagos || []).map(function (p) { return { medio: p.medio, monto_gs: int(p.monto_gs) }; })
    };
  }

  var elegido = null; // el ID que respondió al detectar
  function ids() {
    var w = typeof window !== 'undefined' ? window : {};
    return [w.MESA_EKUATIAI_ID, TIENDA_ID, EXT_ID].filter(function (x, i, a) { return x && a.indexOf(x) === i; });
  }
  function extId() { return elegido || ids()[0]; }
  function runtime() { return typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage ? chrome.runtime : null; }

  function mensaje(msg, ms) {
    return new Promise(function (res, rej) {
      var rt = runtime();
      if (!rt) return rej(Object.assign(new Error('La extensión Migrador e-Kuatia\'i no está instalada en este navegador.'), { codigo: 'SIN_EXTENSION' }));
      var listo = false;
      var t = setTimeout(function () { if (!listo) { listo = true; rej(Object.assign(new Error('La extensión no respondió.'), { codigo: 'SIN_RESPUESTA' })); } }, ms || 8000);
      try {
        rt.sendMessage(msg._id || extId(), msg._id ? { tipo: msg.tipo } : msg, function (r) {
          if (listo) return; listo = true; clearTimeout(t);
          var e = rt.lastError;
          if (e || !r) return rej(Object.assign(new Error('La extensión Migrador e-Kuatia\'i no está instalada o no admite este sitio.'), { codigo: 'SIN_EXTENSION' }));
          res(r);
        });
      } catch (e) { listo = true; clearTimeout(t); rej(Object.assign(new Error('La extensión Migrador e-Kuatia\'i no está instalada en este navegador.'), { codigo: 'SIN_EXTENSION' })); }
    });
  }

  // Resuelve con la info de la extensión o con null si no está (nunca falla).
  // Prueba cada ID conocido (tienda, instalada a mano) y se queda con el primero que responde.
  function detectar() {
    if (!runtime()) return Promise.resolve(null);
    var lista = ids();
    function probar(i) {
      if (i >= lista.length) return Promise.resolve(null);
      return mensaje({ tipo: 'PING', _id: lista[i] }, 2500).then(function (r) {
        if (r && r.ok) { elegido = lista[i]; return r; }
        return probar(i + 1);
      }, function () { return probar(i + 1); });
    }
    return probar(0);
  }
  // Dónde instalar la extensión: la tienda de Chrome si ya está publicada; si no, la guía paso a paso de este mismo sitio
  // (en la raíz: también sirve en el sitio único, donde la caja vive en /<local>/).
  function instalarUrl() { return TIENDA_URL || '/extension/instalar.html'; }
  function enviar(factura, forzar) { return mensaje({ tipo: 'FACTURAR', factura: factura, forzar: !!forzar }, 15000); }

  var api = { EXT_ID: EXT_ID, TIENDA_ID: TIENDA_ID, ids: ids, instalarUrl: instalarUrl, armar: armar, receptorDe: receptorDe, detectar: detectar, enviar: enviar };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Facturador = api;
})(typeof window !== 'undefined' ? window : this);
