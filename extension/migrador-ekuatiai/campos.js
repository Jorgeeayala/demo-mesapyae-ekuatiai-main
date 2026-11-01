/*
 * Campos del formulario "Nueva factura" de e-Kuatia'i que rellena el migrador.
 * Cada campo se ubica, en este orden:
 *   1. por el selector que la persona calibró desde el popup (chrome.storage.local → mapa), o
 *   2. por pistas: primero los nombres del SIFEN que usa e-Kuatia'i en ng-model/id (ej. row.dPUniProSerModel,
 *      formItem.dCantProSer0), después atributos (ng-model, name, id, placeholder, aria-label, formcontrolname) y el texto de su etiqueta.
 * e-Kuatia'i es una aplicación AngularJS y la DNIT puede cambiar su pantalla: si un campo no se encuentra,
 * se calibra una sola vez desde el popup ("Calibrar campos") y queda guardado en este navegador.
 */
(function (root) {
  'use strict';
  // tipo: entrada | boton | lista ; item: true = está en la fila del ítem
  var CAMPOS = [
    { id: 'ruc', nombre: 'RUC / documento del receptor', tipo: 'entrada', obligatorio: true,
      pistas: [/dRucRec|dNumIDRec/i, /receptor.*(ruc|doc)/i, /(ruc|doc).*receptor/i, /^ruc$/i, /\bruc\b/i, /num(ero)?_?doc/i] },
    { id: 'dv', nombre: 'Dígito verificador (DV)', tipo: 'entrada',
      pistas: [/dDVRec/i, /receptor.*\bdv\b/i, /\bdv\b/i, /digito/i] },
    { id: 'buscarRuc', nombre: 'Botón "Buscar" del RUC', tipo: 'boton',
      pistas: [/^\s*(buscar|consultar)\s*$/i, /buscar.*(ruc|contribuyente)/i] },
    { id: 'razon', nombre: 'Razón social / nombre del receptor', tipo: 'entrada', obligatorio: true, lectura: true,
      pistas: [/dNomRec/i, /raz[oó]n.?social/i, /receptor.*nombre/i, /nombre.*receptor/i, /denominaci/i] },
    { id: 'email', nombre: 'Correo del receptor', tipo: 'entrada',
      pistas: [/dEmailRec/i, /receptor.*(e-?mail|correo)/i, /(e-?mail|correo)/i] },
    { id: 'agregarItem', nombre: 'Botón "Agregar ítem"', tipo: 'boton',
      pistas: [/agregar_?(item|detalle|producto)/i, /^\s*\+?\s*(agregar|añadir|nuevo)\s*([ií]tem|producto|detalle)?\s*$/i, /agregar\s+([ií]tem|producto|detalle)/i] },
    { id: 'descripcion', nombre: 'Descripción del ítem', tipo: 'entrada', item: true, obligatorio: true,
      pistas: [/dDesProSer/i, /descrip/i, /concepto/i, /producto/i] },
    { id: 'cantidad', nombre: 'Cantidad del ítem', tipo: 'entrada', item: true, obligatorio: true,
      pistas: [/dCantProSer/i, /cantidad/i, /\bcant\b/i] },
    { id: 'precio', nombre: 'Precio unitario del ítem', tipo: 'entrada', item: true, obligatorio: true,
      pistas: [/dPUniProSer/i, /precio.?unit/i, /^(?!.*total).*precio/i, /unitario/i] },
    { id: 'descuento', nombre: 'Descuento del ítem', tipo: 'entrada', item: true,
      pistas: [/dDescItem/i, /descuento/i, /\bdesc\b/i] },
    { id: 'iva', nombre: 'Tasa de IVA del ítem', tipo: 'lista', item: true, obligatorio: true,
      pistas: [/dTasaIVA|iAfecIVA/i, /\biva\b/i, /tasa/i, /afectaci/i, /impuesto/i] },
    { id: 'obligacion', nombre: 'Tipo de obligación afectada (lista)', tipo: 'lista',
      pistas: [/ObligacionAfectada|selectedObligacion/i, /obligaci[oó]n/i] },
    { id: 'tipoPago', nombre: 'Tipo de pago (lista desplegable)', tipo: 'lista',
      pistas: [/iTiPago/i, /tipo.?(de.?)?pago|forma.?(de.?)?pago|medio.?(de.?)?pago|tipoPago|formaPago/i,
        /\b(efectivo|cheque|transferencia|tarjeta de (cr[eé]dito|d[eé]bito)|billetera)\b/i] },
    { id: 'montoPago', nombre: 'Monto del pago', tipo: 'entrada',
      pistas: [/dMonTiPag/i, /monto.{0,12}pago|importe.{0,12}pago/i] },
    { id: 'agregarPago', nombre: 'Botón "Agregar" del pago', tipo: 'boton',
      pistas: [/agregarPago/i, /agregar\s+pago/i] },
    { id: 'confirmarItem', nombre: 'Botón que confirma el ítem (si hay ventana de ítem)', tipo: 'boton',
      pistas: [/^\s*(aceptar|guardar\s+[ií]tem|confirmar\s+[ií]tem)\s*$/i] }
  ];

  function atributos(el) {
    return ['ng-model', 'data-ng-model', 'ng-click', 'data-ng-click', 'formcontrolname', 'name', 'id', 'placeholder', 'aria-label', 'title']
      .map(function (a) { return el.getAttribute && el.getAttribute(a); }).filter(Boolean);
  }

  function textoEtiqueta(el) {
    var out = [];
    if (el.id) {
      try { var l = el.ownerDocument.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l) out.push(l.textContent); } catch (e) { /* id raro */ }
    }
    var p = el.closest('label'); if (p) out.push(p.textContent);
    // Patrón Bootstrap: <div class="form-group"><label>…</label><input></div>
    var g = el.closest('.form-group, .input-group, td, th, .col, [class*="col-"]');
    if (g) { var lab = g.querySelector('label, .control-label'); if (lab) out.push(lab.textContent); }
    // e-Kuatia'i: la etiqueta suele estar en una columna hermana ("Tipo de Pago" | ui-select). Se toma la etiqueta
    // más cercana que esté antes del campo, subiendo hasta 4 niveles.
    if (!out.length) {
      var a = el.parentElement;
      for (var n = 0; a && n < 4 && !out.length; n++, a = a.parentElement) {
        var labs = [].filter.call(a.querySelectorAll('label, .control-label'), function (x) {
          return !el.contains(x) && (x.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
        });
        if (labs.length) out.push(labs[labs.length - 1].textContent);
      }
    }
    return out.join(' ').replace(/\s+/g, ' ').trim();
  }

  // Texto elegido en un ui-select (span.ui-select-match-text), ej. "Efectivo".
  function textoUiSelect(el) {
    if (el.matches('.ui-select-multiple')) return elegidosUiSelect(el).join(' | ');
    var t = el.querySelector('.ui-select-match-text');
    if (t && t.textContent.trim()) return t.textContent.replace(/\s+/g, ' ').trim();
    var m = el.querySelector('.ui-select-toggle, .ui-select-match');
    if (!m) return '';
    var c = m.cloneNode(true); // sin el texto de ejemplo ("Seleccionar…")
    [].forEach.call(c.querySelectorAll('.ui-select-placeholder, .text-muted'), function (x) { x.remove(); });
    return c.textContent.replace(/\s+/g, ' ').trim();
  }
  // ui-select múltiple (ej. obligaciones): cada elegido es un .ui-select-match-item.
  function elegidosUiSelect(el) {
    return [].map.call(el.querySelectorAll('.ui-select-match-item'), function (x) { return x.textContent.replace(/[×✕]/g, '').replace(/\s+/g, ' ').trim(); });
  }

  // Medio de pago de Mesa Pya'e (Config medios_pago) → opción "Tipo de pago" de e-Kuatia'i (tabla iTiPago del SIFEN).
  var MEDIOS = {
    EFECTIVO: { txt: 'Efectivo', re: /\befectivo\b/i },
    TRANSFERENCIA: { txt: 'Transferencia', re: /transferencia/i },
    TC: { txt: 'Tarjeta de crédito', re: /tarjeta de cr[eé]dito/i },
    TD: { txt: 'Tarjeta de débito', re: /tarjeta de d[eé]bito/i },
    CHEQUE: { txt: 'Cheque', re: /\bcheque\b/i },
    QR: { txt: 'Pago electrónico', re: /pago electr[oó]nico|billetera/i },
    BILLETERA: { txt: 'Billetera electrónica', re: /billetera/i },
    GIRO: { txt: 'Giro', re: /\bgiro\b/i }
  };
  function medioEkuatia(medio) {
    medio = String(medio || '').toUpperCase();
    return MEDIOS[medio] || (/TARJ.*CR|CREDIT/.test(medio) ? MEDIOS.TC : /TARJ.*D|DEBIT/.test(medio) ? MEDIOS.TD : /TRANSF/.test(medio) ? MEDIOS.TRANSFERENCIA : { txt: 'Otro', re: /^\s*otro/i });
  }

  function visible(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    var cs = el.ownerDocument.defaultView.getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
  }

  function candidatos(doc, tipo, campo) {
    if (tipo === 'entrada' && campo && campo.lectura) // campos que el portal completa solo (razón social): también de solo lectura
      return [].slice.call(doc.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]), textarea'))
        .filter(function (el) { return !el.closest('.ui-select-container'); });
    if (tipo === 'boton') return [].slice.call(doc.querySelectorAll('button, a.btn, input[type=button], input[type=submit], [role=button]'));
    // Listas: <select>, los ui-select de AngularJS (div.ui-select-container) e inputs sueltos (no los de adentro de un ui-select).
    if (tipo === 'lista') return [].slice.call(doc.querySelectorAll('select, .ui-select-container, input:not([type=hidden]):not([type=checkbox]):not([type=radio])'))
      .filter(function (el) { return el.matches('.ui-select-container') || (!el.closest('.ui-select-container') && !el.readOnly && !el.disabled); });
    // Las casillas de solo lectura (total del ítem, subtotales) no se escriben nunca.
    return [].slice.call(doc.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([readonly]), textarea:not([readonly])'))
      .filter(function (el) { return !el.closest('.ui-select-container'); }); // el buscador de un ui-select no es una casilla de datos
  }

  // Devuelve todos los elementos que coinciden (los de ítem pueden repetirse por fila).
  // Un id con el número de fila al final (formItem.dPUniProSer0) solo sirve para la primera fila:
  // se generaliza a "todas las que empiezan igual" para que funcione en cada ítem.
  function normalizarSelector(sel) {
    var m = /^#((?:\\.|[^\s>#\[])+?)(\d+)$/.exec(String(sel || ''));
    if (!m) return sel;
    var pref = m[1].replace(/\\(.)/g, '$1');
    return '[id^="' + pref.replace(/"/g, '\\"') + '"]';
  }

  function buscarTodos(doc, campo, mapa) {
    var sel = mapa && mapa[campo.id] && (campo.item ? normalizarSelector(mapa[campo.id]) : mapa[campo.id]);
    if (sel) {
      try { return [].slice.call(doc.querySelectorAll(sel)).filter(visible); } catch (e) { return []; }
    }
    var lista = candidatos(doc, campo.tipo, campo).filter(visible);
    for (var i = 0; i < campo.pistas.length; i++) {
      var re = campo.pistas[i];
      var hits = lista.filter(function (el) {
        var partes = campo.tipo === 'boton'
          ? [String(el.textContent || el.value || '').replace(/\s+/g, ' ').trim()].concat(atributos(el))
          : [atributos(el).join(' ') + ' ' + textoEtiqueta(el) + (el.matches && el.matches('.ui-select-container') ? ' ' + textoUiSelect(el) : '')];
        if (/emisor/i.test(partes.join(' ')) && campo.id !== 'agregarItem') return false; // nunca tocar datos del emisor
        if (campo.id === 'iva' && /obligaci/i.test(partes.join(' '))) return false; // "Impuesto al valor agregado" de la obligación no es la tasa
        if (campo.id === 'agregarItem' && /pago|obligaci/i.test(partes.join(' '))) return false; // el "Agregar" de pagos no es el de ítems
        return partes.some(function (t) { return re.test(t); });
      });
      // En listas, primero las listas de verdad (select / ui-select) y después casillas sueltas.
      if (hits.length && campo.tipo === 'lista') hits.sort(function (x, y) { return (x.matches('select, .ui-select-container') ? 0 : 1) - (y.matches('select, .ui-select-container') ? 0 : 1); });
      if (hits.length && campo.tipo !== 'lista' && !campo.lectura) hits = hits.filter(function (el) { return !el.disabled; });
      if (hits.length) return hits;
    }
    return [];
  }

  // Selector estable para guardar en la calibración. Las filas de tabla se generalizan para que sirva en cada ítem.
  function selectorDe(el) {
    var doc = el.ownerDocument;
    function unico(s) { try { return doc.querySelectorAll(s).length === 1; } catch (e) { return false; } }
    if (!el.matches('.ui-select-container') && el.closest('.ui-select-container')) el = el.closest('.ui-select-container');
    var tag = el.tagName.toLowerCase();
    var enFila = !!el.closest('tr, [ng-repeat], [data-ng-repeat]');
    // En filas de ítems, ng-model (row.dPUniProSerModel) es igual en todas las filas: sirve más que el id.
    var ng = el.getAttribute('ng-model') || el.getAttribute('data-ng-model');
    if (enFila && ng) return tag + '[' + (el.hasAttribute('ng-model') ? 'ng-model' : 'data-ng-model') + '="' + ng.replace(/"/g, '\\"') + '"]';
    if (el.id && /\d$/.test(el.id) && enFila) return normalizarSelector('#' + CSS.escape(el.id));
    if (el.id && !/\d{3,}/.test(el.id) && unico('#' + CSS.escape(el.id))) return '#' + CSS.escape(el.id);
    var attrs = ['ng-model', 'data-ng-model', 'formcontrolname', 'name', 'aria-label', 'placeholder'];
    for (var i = 0; i < attrs.length; i++) {
      var v = el.getAttribute(attrs[i]);
      if (v) return tag + '[' + attrs[i] + '="' + v.replace(/"/g, '\\"') + '"]';
    }
    var partes = [], n = el;
    while (n && n.nodeType === 1 && n !== doc.body) {
      var p = n.tagName.toLowerCase();
      if (n.id && !/\d{3,}/.test(n.id)) { partes.unshift('#' + CSS.escape(n.id)); break; }
      var hermanos = n.parentNode ? [].filter.call(n.parentNode.children, function (h) { return h.tagName === n.tagName; }) : [];
      if (hermanos.length > 1 && p !== 'tr') p += ':nth-of-type(' + (hermanos.indexOf(n) + 1) + ')';
      partes.unshift(p);
      n = n.parentNode;
    }
    return partes.join(' > ');
  }

  var api = { elegidosUiSelect: elegidosUiSelect, MEDIOS: MEDIOS, medioEkuatia: medioEkuatia, textoUiSelect: textoUiSelect, CAMPOS: CAMPOS, buscarTodos: buscarTodos, selectorDe: selectorDe, visible: visible, normalizarSelector: normalizarSelector };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MigradorCampos = api;
})(typeof self !== 'undefined' ? self : this);
