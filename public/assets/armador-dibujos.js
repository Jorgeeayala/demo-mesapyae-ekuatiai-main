/*
 * Dibujos del Upgrade "Armá tu pedido" (SVG propios, estilo ilustración plana con volumen).
 * - pieza(d, c, o): ingrediente visto de arriba, centrado en 0,0 (radio ~12): se reparte sobre la pizza o la porción.
 * - icono(d, o, tipo): ícono de la grilla (viewBox -24..24).
 * - capa(d, c, o): capa de hamburguesa vista de costado (ancho 240): { h: lo que suma a la pila, vh: alto del dibujo, s: svg }.
 * - panArriba/panAbajo, pizzaBase, porcionBase, capaQueso: el plato.
 * - cajaPizza/cajaPorcion/cajaHamburguesa: las cajas con el logo de Mesa Pya'e.
 * Nada de esto viene de bancos de imágenes: todo está dibujado acá.
 */
(function (w) {
  'use strict';

  function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function rng(semilla) {
    var h = 2166136261;
    for (var i = 0; i < semilla.length; i++) { h ^= semilla.charCodeAt(i); h = Math.imul(h, 16777619); }
    return function () { h += 0x6D2B79F5; var t = h; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function f(n) { return Math.round(n * 10) / 10; }

  // ------------------------------------------------------------------ nombre → dibujo
  var ADIVINAR = [
    [/caramel/, 'CEBOLLA_CARAMELIZADA'], [/cheddar/, 'CHEDDAR'], [/catupiry|cremoso|queso crema|requeson/, 'QUESO_CREMA'],
    [/queso|muzza|mozza|parmesan|provolone|gouda|dambo|sardo/, 'QUESO'], [/pepperoni|peperoni|salame|salami|calabresa|longaniza|chorizo/, 'PEPPERONI'],
    [/jamon|pernil/, 'JAMON'], [/champi|hongo|funghi|cogumelo|seta/, 'CHAMPINON'], [/aceituna|oliva/, 'ACEITUNA'],
    [/cebolla/, 'CEBOLLA'], [/morron|pimiento|pimenton|locote|aji dulce/, 'MORRON'], [/jalap|picante|aji/, 'JALAPENO'], [/tomate/, 'TOMATE'],
    [/albahaca|rucula|espinaca|oregano/, 'ALBAHACA'], [/choclo|maiz/, 'CHOCLO'], [/anana|pina/, 'ANANA'], [/palmito/, 'PALMITO'],
    [/panceta|bacon|tocino|beicon/, 'PANCETA'], [/pollo|chicken|crispy/, 'POLLO'], [/huevo/, 'HUEVO'],
    [/carne|medallon|hamburguesa|smash|res|vacuno/, 'CARNE'], [/lechuga/, 'LECHUGA'], [/pepino|pickle/, 'PEPINO'],
    [/salsa|mayo|ketchup|barbacoa|bbq|mostaza|alioli/, 'SALSA'],
    [/negro|integral|australiano|centeno/, 'PAN_NEGRO'], [/papa|batata/, 'PAN_PAPA'], [/brioche|clasico|blanco|pan|sesamo/, 'PAN_BRIOCHE']
  ];
  function dibujoDe(o) {
    if (o && o.dibujo) return o.dibujo;
    var n = norm(o && o.nombre);
    for (var i = 0; i < ADIVINAR.length; i++) if (ADIVINAR[i][0].test(n)) return ADIVINAR[i][1];
    return 'GENERICO';
  }
  function colorSalsa(nombre) {
    var n = norm(nombre);
    if (/mostaza/.test(n)) return ['#F2B414', '#D99A06'];
    if (/mayo|alioli|ajo|blanca/.test(n)) return ['#FBF3DA', '#E8DAB2'];
    if (/bbq|barbacoa/.test(n)) return ['#7A2E17', '#5B200F'];
    if (/cheddar/.test(n)) return ['#F7A82B', '#DE8B12'];
    return ['#E0331F', '#B8240F'];
  }
  function colorGenerico(nombre) {
    var n = norm(nombre), h = 0;
    for (var i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) % 360;
    return 'hsl(' + h + ',55%,50%)';
  }

  // ------------------------------------------------------------------ degradados (una vez por pantalla)
  var DEFS = '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>' +
    '<radialGradient id="adb-masa" cx="50%" cy="45%" r="55%"><stop offset="78%" stop-color="#F0C27A"/><stop offset="93%" stop-color="#DDA05A"/><stop offset="100%" stop-color="#C4843E"/></radialGradient>' +
    '<radialGradient id="adb-salsa" cx="42%" cy="38%" r="65%"><stop offset="0%" stop-color="#E5482F"/><stop offset="100%" stop-color="#C02E1C"/></radialGradient>' +
    '<radialGradient id="adb-queso" cx="40%" cy="35%" r="70%"><stop offset="0%" stop-color="#FFF1B8"/><stop offset="100%" stop-color="#F7D774"/></radialGradient>' +
    '<radialGradient id="adb-ched" cx="40%" cy="35%" r="70%"><stop offset="0%" stop-color="#FFCF5C"/><stop offset="100%" stop-color="#F3A41F"/></radialGradient>' +
    '<linearGradient id="adb-carne" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#8A4A2A"/><stop offset="45%" stop-color="#6A3519"/><stop offset="100%" stop-color="#4A220F"/></linearGradient>' +
    '<linearGradient id="adb-pollo" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#EEAA44"/><stop offset="100%" stop-color="#B9661E"/></linearGradient>' +
    '<linearGradient id="adb-ched-l" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#FFC93D"/><stop offset="100%" stop-color="#F29F12"/></linearGradient>' +
    '<linearGradient id="adb-queso-l" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#FFE79A"/><stop offset="100%" stop-color="#F4CF5A"/></linearGradient>' +
    '<linearGradient id="adb-tom" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#F0533C"/><stop offset="100%" stop-color="#C92E1D"/></linearGradient>' +
    '<linearGradient id="adb-lech" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#9BDB62"/><stop offset="100%" stop-color="#4FA233"/></linearGradient>' +
    [['BRIOCHE', '#F4A94A', '#E08A2C', '#B9661B'], ['NEGRO', '#4A3A33', '#2F2420', '#1E1714'], ['PAPA', '#F8CD67', '#EBAE3C', '#C98C25']].map(function (p) {
      return '<radialGradient id="adb-pan-' + p[0] + '" cx="38%" cy="25%" r="85%"><stop offset="0%" stop-color="' + p[1] + '"/><stop offset="60%" stop-color="' + p[2] + '"/><stop offset="100%" stop-color="' + p[3] + '"/></radialGradient>' +
        '<linearGradient id="adb-panb-' + p[0] + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="' + p[2] + '"/><stop offset="100%" stop-color="' + p[3] + '"/></linearGradient>';
    }).join('') +
    '<linearGradient id="adb-caja" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#FFFFFF"/><stop offset="100%" stop-color="#E9E6E0"/></linearGradient>' +
    '<linearGradient id="adb-kraft2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#E3CDA2"/><stop offset="100%" stop-color="#CFB287"/></linearGradient>' +
    '<linearGradient id="adb-kraft" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#D8B485"/><stop offset="100%" stop-color="#BF955F"/></linearGradient>' +
    '<filter id="adb-sombra" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="6"/></filter>' +
    '</defs></svg>';

  // ------------------------------------------------------------------ piezas (vista de arriba)
  function circ(r, fill, extra) { return '<circle r="' + r + '" fill="' + fill + '"' + (extra || '') + '/>'; }
  var PIEZA = {
    PEPPERONI: function (c) {
      var r = rng('pep' + c), dots = '';
      for (var i = 0; i < 6; i++) { var a = r() * 6.28, d = 2 + r() * 6.5; dots += '<circle cx="' + f(Math.cos(a) * d) + '" cy="' + f(Math.sin(a) * d) + '" r="' + f(0.9 + r() * 1) + '" fill="#F2B8A8"/>'; }
      return circ(12.5, '#A82A1E') + circ(11, '#D2402C') + dots + '<path d="M-7,-6 a9,9 0 0 1 8,-3" stroke="#E86A52" stroke-width="1.6" fill="none" stroke-linecap="round"/>';
    },
    JAMON: function () { return '<rect x="-12" y="-10" width="24" height="20" rx="6" fill="#E9858F"/><rect x="-12" y="-11" width="24" height="19" rx="6" fill="#F6AEB6"/><circle cx="-5" cy="-4" r="1.5" fill="#FCD6DA"/><circle cx="4" cy="1" r="1.8" fill="#FCD6DA"/><circle cx="-2" cy="4" r="1.1" fill="#FCD6DA"/>'; },
    CHAMPINON: function () { return '<path d="M-12,1 q0,-13 12,-13 q12,0 12,13 q-12,3 -24,0z" fill="#EFE4D3"/><path d="M-12,1 q12,3 24,0" stroke="#C9AE8C" stroke-width="1.5" fill="none"/><path d="M-4,2 h8 v7 q-4,3 -8,0z" fill="#F7F0E4" stroke="#D9C3A2" stroke-width="1"/><path d="M-8,-5 q8,-6 16,0" stroke="#D6C1A3" stroke-width="1.4" fill="none"/>'; },
    ACEITUNA: function () { return '<path d="M-7,0 a7,7 0 1 0 14,0 a7,7 0 1 0 -14,0z M-2.6,0 a2.6,2.6 0 1 1 5.2,0 a2.6,2.6 0 1 1 -5.2,0z" fill="#26201D" fill-rule="evenodd"/><path d="M-4.5,-4 a6,6 0 0 1 5,-2" stroke="#6E625A" stroke-width="1.3" fill="none" stroke-linecap="round"/>'; },
    CEBOLLA: function () { return '<circle r="10" fill="none" stroke="#B85FCC" stroke-width="3.2"/><circle r="10" fill="none" stroke="#E9C9F1" stroke-width="1" /><circle r="5.5" fill="none" stroke="#C77BD8" stroke-width="2.4"/>'; },
    MORRON: function (c) {
      var col = [['#E2322A', '#B71F18'], ['#3FA03A', '#2A7C27'], ['#F5B820', '#D69610']][c % 3];
      var d = 'M0,-11 q6,-1 7,4 q5,0 4,6 q2,6 -4,8 q-3,5 -7,2 q-4,3 -7,-2 q-6,-2 -4,-8 q-1,-6 4,-6 q1,-5 7,-4z';
      return '<path d="' + d + '" fill="none" stroke="' + col[1] + '" stroke-width="4.5" stroke-linejoin="round"/><path d="' + d + '" fill="none" stroke="' + col[0] + '" stroke-width="2.6" stroke-linejoin="round"/>';
    },
    TOMATE: function () {
      var s = '';
      for (var i = 0; i < 5; i++) { var a = i / 5 * 6.28; s += '<ellipse cx="' + f(Math.cos(a) * 5.3) + '" cy="' + f(Math.sin(a) * 5.3) + '" rx="2.6" ry="1.5" transform="rotate(' + f(a * 57.3) + ' ' + f(Math.cos(a) * 5.3) + ' ' + f(Math.sin(a) * 5.3) + ')" fill="#F9C7A4"/>'; }
      return circ(12, '#C92E1D') + circ(10.4, '#EE4B33') + circ(8.6, '#F36A50') + s + circ(2.6, '#EE4B33');
    },
    ALBAHACA: function () { return '<path d="M0,0 q-12,-4 -12,-12 q9,-1 12,12z" fill="#3E8E2F"/><path d="M0,0 q12,-4 12,-12 q-9,-1 -12,12z" fill="#4FA53A"/><path d="M0,0 q-6,-6 -10,-10 M0,0 q6,-6 10,-10" stroke="#2D6E22" stroke-width="1" fill="none"/><path d="M0,0 v5" stroke="#2D6E22" stroke-width="1.4"/>'; },
    CHOCLO: function () { return '<rect x="-3.6" y="-4" width="7.2" height="8" rx="3" fill="#F2B92C"/><rect x="-2.6" y="-3.2" width="3" height="3.6" rx="1.5" fill="#FCE07A"/>'; },
    ANANA: function () {
      // Trozo de anillo de ananá (como una rodaja cortada en cuatro).
      var arco = function (r1, r2, a1, a2) { var p = function (r, a) { return f(Math.cos(a) * r) + ',' + f(Math.sin(a) * r); }; return 'M' + p(r2, a1) + ' A' + r2 + ',' + r2 + ' 0 0 1 ' + p(r2, a2) + ' L' + p(r1, a2) + ' A' + r1 + ',' + r1 + ' 0 0 0 ' + p(r1, a1) + 'Z'; };
      return '<g transform="translate(0,6)"><path d="' + arco(5, 14, -2.6, -0.54) + '" fill="#E2B32A"/><path d="' + arco(5.5, 13, -2.55, -0.6) + '" fill="#FADC5E"/><path d="M' + f(Math.cos(-1.57) * 6) + ',' + f(Math.sin(-1.57) * 6) + ' L' + f(Math.cos(-1.57) * 12) + ',' + f(Math.sin(-1.57) * 12) + ' M' + f(Math.cos(-2.1) * 6) + ',' + f(Math.sin(-2.1) * 6) + ' L' + f(Math.cos(-2.1) * 12) + ',' + f(Math.sin(-2.1) * 12) + ' M' + f(Math.cos(-1.05) * 6) + ',' + f(Math.sin(-1.05) * 6) + ' L' + f(Math.cos(-1.05) * 12) + ',' + f(Math.sin(-1.05) * 12) + '" stroke="#F0C43A" stroke-width="1.2"/></g>';
    },
    PANCETA: function () { var d = 'M-13,0 q3.25,-5 6.5,0 t6.5,0 t6.5,0 t6.5,0'; return '<path d="' + d + '" fill="none" stroke="#B43A26" stroke-width="7.5" stroke-linecap="round"/><path d="' + d + '" fill="none" stroke="#E0705A" stroke-width="5" stroke-linecap="round"/><path d="' + d + '" fill="none" stroke="#F8D3C5" stroke-width="1.7" stroke-linecap="round"/>'; },
    POLLO: function () { return '<path d="M-9,-6 q6,-6 13,-2 q7,5 2,11 q-6,6 -13,2 q-7,-5 -2,-11z" fill="#C9894A"/><path d="M-9,-7 q6,-6 13,-2 q7,5 2,11 q-6,5 -13,1 q-7,-5 -2,-10z" fill="#EDBE7C"/><path d="M-5,-3 l8,4 M-6,2 l7,3" stroke="#C88A45" stroke-width="1.6" stroke-linecap="round"/>'; },
    CARNE: function (c) { var r = rng('cm' + c), s = ''; for (var i = 0; i < 4; i++) { var x = (r() - .5) * 14, y = (r() - .5) * 12; s += '<path d="M' + f(x - 3.5) + ',' + f(y) + ' q2,-4 5,-2 q3,2 0,5 q-4,2 -5,-3z" fill="' + (i % 2 ? '#6A3519' : '#86482A') + '"/>'; } return s; },
    JALAPENO: function () { return circ(7.5, '#2F7A24') + circ(6.2, '#5DAE3B') + circ(3.8, '#CFEA9F') + '<circle cx="-1.2" cy="-.8" r=".9" fill="#F4F7E8"/><circle cx="1.4" cy=".6" r=".9" fill="#F4F7E8"/>'; },
    PEPINO: function () {
      var s = ''; for (var i = 0; i < 6; i++) { var a = i / 6 * 6.28; s += '<ellipse cx="' + f(Math.cos(a) * 3.6) + '" cy="' + f(Math.sin(a) * 3.6) + '" rx="1.6" ry=".9" transform="rotate(' + f(a * 57.3) + ' ' + f(Math.cos(a) * 3.6) + ' ' + f(Math.sin(a) * 3.6) + ')" fill="#EAF6D2"/>'; }
      return circ(10.5, '#3F8E2B') + circ(9, '#9ED36A') + circ(7.4, '#C9E9A0') + s;
    },
    LECHUGA: function () { return '<path d="M-12,2 q-2,-9 5,-11 q3,-5 8,-2 q6,-3 9,3 q5,4 1,10 q-1,6 -8,6 q-5,3 -9,-1 q-7,0 -6,-5z" fill="#6DBE45"/><path d="M-12,1 q-2,-8 5,-10 q3,-5 8,-2 q6,-3 9,3 q5,4 1,9 q-6,-3 -12,-1 q-6,-2 -11,1z" fill="#93D763"/><path d="M-6,6 q4,-7 12,-9" stroke="#4E9A2F" stroke-width="1.2" fill="none"/>'; },
    PALMITO: function () { return circ(8.5, '#E3DAB5') + circ(7.2, '#F6F1DE') + '<circle r="4" fill="none" stroke="#E0D6AE" stroke-width="1.4"/>'; },
    QUESO_CREMA: function () { return '<path d="M-10,1 q-1,-10 9,-10 q11,0 10,9 q0,9 -10,9 q-9,0 -9,-8z" fill="#EDE3C6"/><path d="M-10,0 q-1,-10 9,-10 q11,0 10,9 q0,7 -10,7 q-9,0 -9,-6z" fill="#FFFDF4"/>'; },
    HUEVO: function () { return '<path d="M-14,1 q-2,-11 8,-12 q6,-5 13,0 q9,2 7,10 q2,9 -9,11 q-6,4 -12,0 q-8,-1 -7,-9z" fill="#ECE6D8"/><path d="M-14,0 q-2,-11 8,-12 q6,-5 13,0 q9,2 7,10 q1,7 -9,9 q-6,4 -12,0 q-8,-1 -7,-7z" fill="#FFFFFF"/>' + circ(6, '#F09A12') + circ(5.2, '#FBB52A') + '<circle cx="-1.8" cy="-2" r="1.7" fill="#FFE29A"/>'; },
    SALSA: function (c, o) { var col = colorSalsa(o && o.nombre); var d = 'M-12,3 q3,-8 6,0 t6,0 t6,0 t6,0'; return '<path d="' + d + '" fill="none" stroke="' + col[1] + '" stroke-width="4.5" stroke-linecap="round" transform="translate(0,1)"/><path d="' + d + '" fill="none" stroke="' + col[0] + '" stroke-width="3.6" stroke-linecap="round"/>'; },
    QUESO: function () { return '<path d="M-11,-9 h22 v18 h-22z" fill="#F0C445"/><path d="M-11,-10 h22 v17 h-22z" fill="#FFDA63"/><circle cx="-5" cy="-4" r="2.2" fill="#F0C445"/><circle cx="5" cy="2" r="1.8" fill="#F0C445"/><circle cx="4" cy="-6" r="1.2" fill="#F0C445"/>'; },
    CHEDDAR: function () { return '<path d="M-11,-10 h22 v14 l-3,5 l-3,-4 l-4,5 l-3,-5 l-4,4 l-5,-4z" fill="#F29F12"/><path d="M-11,-11 h22 v13 l-3,4 l-3,-3 l-4,4 l-3,-4 l-4,3 l-5,-3z" fill="#FFBE33"/>'; },
    CEBOLLA_CARAMELIZADA: function () { return '<path d="M-11,-3 q3,-5 6,0 t6,0 t6,0 M-9,4 q3,-5 6,0 t6,0 t6,0" fill="none" stroke="#7A3E14" stroke-width="3.6" stroke-linecap="round"/><path d="M-11,-3 q3,-5 6,0 t6,0 t6,0 M-9,4 q3,-5 6,0 t6,0 t6,0" fill="none" stroke="#A85F26" stroke-width="2" stroke-linecap="round"/>'; },
    GENERICO: function (c, o) { var col = colorGenerico(o && o.nombre); return circ(7.5, col) + '<circle cx="-2.4" cy="-2.4" r="2.3" fill="rgba(255,255,255,.38)"/>'; }
  };
  // Piezas por porción, cuando se reparten sobre una pizza entera (en la porción se usa la mitad).
  var CANT = { PEPPERONI: 15, JAMON: 12, CHAMPINON: 13, ACEITUNA: 17, CEBOLLA: 13, MORRON: 13, TOMATE: 11, ALBAHACA: 11, CHOCLO: 32, ANANA: 13, PANCETA: 13, POLLO: 14, CARNE: 15, JALAPENO: 14, PEPINO: 11, LECHUGA: 10, PALMITO: 13, QUESO_CREMA: 13, HUEVO: 4, SALSA: 8, CEBOLLA_CARAMELIZADA: 11, GENERICO: 13 };
  var CAPA_PIZZA = { QUESO: 'adb-queso', CHEDDAR: 'adb-ched' }; // en la pizza el queso es una capa derretida
  function pieza(d, c, o) { return (PIEZA[d] || PIEZA.GENERICO)(c || 0, o); }

  // Íconos de la grilla: varias piezas juntas, como en una lámina de ingredientes.
  function icono(d, o, tipo) {
    var P = function (k, x, y, s, rot, c) { return '<g transform="translate(' + x + ',' + y + ') rotate(' + (rot || 0) + ') scale(' + s + ')">' + pieza(k, c || 0, o) + '</g>'; };
    var g;
    switch (d) {
      case 'PEPPERONI': g = P(d, -6, -5, 1.15) + P(d, 7, 6, 1.15, 0, 1); break;
      case 'ACEITUNA': g = P(d, -8, -6, 1.3) + P(d, 8, -4, 1.3) + P(d, 0, 9, 1.3); break;
      case 'CHAMPINON': g = P(d, -7, -4, 1.25) + P(d, 8, 6, 1.1, 15); break;
      case 'MORRON': g = P(d, -6, -4, 1.2, 0, 0) + P(d, 7, 6, 1.2, 20, 1); break;
      case 'CHOCLO': g = P(d, -7, -6, 1.6) + P(d, 4, -7, 1.6) + P(d, -2, 3, 1.6) + P(d, 9, 3, 1.6) + P(d, -9, 8, 1.6); break;
      case 'CEBOLLA': g = P(d, -6, -2, 1.35) + P(d, 8, 4, 1.15); break;
      case 'PANCETA': g = P(d, 0, -6, 1.4) + P(d, 0, 7, 1.4); break;
      case 'JALAPENO': g = P(d, -7, -5, 1.3) + P(d, 7, -3, 1.3) + P(d, 0, 8, 1.3); break;
      case 'ANANA': g = P(d, -4, -2, 1.3) + P(d, 6, 6, 1.1, 70); break;
      case 'CARNE': if (tipo === 'HAMBURGUESA') g = '<circle r="17" fill="#4A220F"/><circle r="16" cy="-1.5" fill="#7A3E20"/><path d="M-11,-8 h22 M-13,-1 h26 M-11,6 h22" stroke="#5A2B14" stroke-width="2.6" stroke-linecap="round"/>'; else g = P(d, 0, 0, 1.6); break;
      case 'POLLO': g = tipo === 'HAMBURGUESA' ? '<path d="M-17,-1 q2,-15 18,-15 q16,1 16,15 q-2,16 -17,16 q-16,-1 -17,-16z" fill="#C9822F"/><path d="M-17,-3 q2,-15 18,-15 q16,1 16,14 q-1,13 -17,13 q-16,-1 -17,-12z" fill="#F0B95B"/><g fill="#FAD893"><circle cx="-7" cy="-6" r="2"/><circle cx="5" cy="-9" r="1.8"/><circle cx="7" cy="3" r="2"/><circle cx="-4" cy="5" r="1.6"/></g>' : P(d, 0, 0, 1.5); break;
      default: g = P(d, 0, 0, 1.55);
    }
    if (/^PAN_/.test(d)) return '<svg viewBox="0 0 240 150" aria-hidden="true"><g transform="translate(0,4)">' + panArriba(d) + '</g><g transform="translate(0,100)">' + panAbajo(d) + '</g></svg>';
    return '<svg viewBox="-22 -22 44 44" aria-hidden="true">' + g + '</svg>';
  }

  // ------------------------------------------------------------------ hamburguesa (vista de costado)
  function panColor(d) { return d === 'PAN_NEGRO' ? 'NEGRO' : d === 'PAN_PAPA' ? 'PAPA' : 'BRIOCHE'; }
  function panArriba(d) {
    var c = panColor(d), sem = '';
    var r = rng('sesamo'), semCol = c === 'NEGRO' ? '#B9AA9C' : '#FFF4DC';
    for (var i = 0; i < 26; i++) {
      var x = 34 + r() * 172, y = 12 + r() * 46;
      if (Math.pow((x - 120) / 100, 2) + Math.pow((y - 76) / 66, 2) < 0.92) sem += '<ellipse cx="' + f(x) + '" cy="' + f(y) + '" rx="3.4" ry="1.8" transform="rotate(' + Math.round(r() * 180) + ' ' + f(x) + ' ' + f(y) + ')" fill="' + semCol + '"/>';
    }
    return '<path d="M4,78 q-2,-74 116,-74 q118,0 116,74 q0,10 -10,12 q-106,8 -212,0 q-10,-2 -10,-12z" fill="url(#adb-panb-' + c + ')"/>' +
      '<path d="M6,74 q-2,-70 114,-70 q116,0 114,70 q-114,10 -228,0z" fill="url(#adb-pan-' + c + ')"/>' + sem +
      '<ellipse cx="80" cy="24" rx="40" ry="9" fill="#FFFFFF" opacity=".28" transform="rotate(-10 80 24)"/>';
  }
  function panAbajo(d) {
    var c = panColor(d);
    return '<path d="M6,10 q0,-8 10,-8 h208 q10,0 10,8 v14 q0,18 -26,20 h-176 q-26,-2 -26,-20z" fill="url(#adb-panb-' + c + ')"/>' +
      '<path d="M8,10 q0,-7 9,-7 h206 q9,0 9,7 v3 q-112,6 -224,0z" fill="' + (c === 'NEGRO' ? '#6B5A50' : '#F9DCA6') + '"/>' +
      '<path d="M18,30 q102,10 204,0" stroke="#FFFFFF" stroke-width="3" opacity=".18" fill="none" stroke-linecap="round"/>';
  }
  var CAPA = {
    CARNE: { h: 30, vh: 36, s: function (c) {
      var r = rng('car' + c), bordes = 'M8,10';
      for (var x = 8; x <= 232; x += 16) bordes += ' q8,' + f(-3 - r() * 3) + ' 16,0';
      var puntos = ''; for (var i = 0; i < 18; i++) puntos += '<circle cx="' + f(14 + r() * 212) + '" cy="' + f(14 + r() * 14) + '" r="' + f(0.8 + r() * 1.3) + '" fill="#4A220F" opacity=".7"/>';
      return '<path d="M6,12 q0,-8 12,-8 h204 q12,0 12,8 v12 q0,10 -14,10 h-200 q-14,0 -14,-10z" fill="url(#adb-carne)"/><path d="' + bordes + '" fill="none" stroke="#A35C35" stroke-width="2.5" stroke-linecap="round"/>' + puntos;
    } },
    POLLO: { h: 30, vh: 38, s: function (c) {
      // Milanesa crispy de costado: borde parejo y rugoso, más oscura abajo.
      var r = rng('pol' + c), d = 'M10,12';
      for (var x = 10; x < 230; x += 11) d += ' Q' + f(x + 5.5) + ',' + f(4 - r() * 4) + ' ' + f(x + 11) + ',' + f(10 + r() * 3);
      d += ' Q240,12 238,22 Q236,35 222,35 H18 Q4,35 2,22 Q0,12 10,12Z';
      var mig = ''; for (var i = 0; i < 30; i++) mig += '<circle cx="' + f(10 + r() * 220) + '" cy="' + f(10 + r() * 20) + '" r="' + f(0.9 + r() * 1.5) + '" fill="' + (r() < 0.35 ? '#FBD98E' : '#9E5418') + '" opacity=".75"/>';
      return '<path d="' + d + '" fill="url(#adb-pollo)"/><path d="M4,26 Q6,35 18,35 H222 Q236,35 237,26 Q120,32 4,26Z" fill="#A9621F" opacity=".55"/>' +
        '<path d="M22,14 Q120,8 218,14" stroke="#FFE3A3" stroke-width="2.4" fill="none" stroke-linecap="round" opacity=".6"/>' + mig;
    } },
    CHEDDAR: { h: 5, vh: 30, s: function () { return '<path d="M0,4 h240 l-6,8 q-2,10 -8,12 q-4,-6 -5,-12 l-18,4 q-3,12 -9,14 q-5,-6 -6,-14 h-56 q-4,14 -10,16 q-6,-4 -7,-16 h-50 l-8,8 q-2,6 -7,6 q-4,-4 -5,-10 l-14,-4z" fill="#E6900E"/><path d="M0,2 h240 l-6,7 q-2,9 -8,11 q-4,-5 -5,-11 l-18,4 q-3,11 -9,13 q-5,-5 -6,-13 h-56 q-4,13 -10,15 q-6,-4 -7,-15 h-50 l-8,7 q-2,5 -7,5 q-4,-3 -5,-9 l-14,-4z" fill="url(#adb-ched-l)"/><path d="M8,4 h224" stroke="#FFE08A" stroke-width="1.8" opacity=".8"/>'; } },
    QUESO: { h: 5, vh: 28, s: function () { return '<path d="M0,2 h240 l-10,9 q-3,9 -9,10 q-4,-4 -6,-10 l-26,4 l-10,-4 h-60 q-5,12 -11,13 q-6,-3 -8,-13 h-44 l-12,7 q-3,5 -8,5 q-4,-3 -6,-9z" fill="url(#adb-queso-l)"/><ellipse cx="60" cy="8" rx="5" ry="2.4" fill="#E9BF45"/><ellipse cx="150" cy="7" rx="4" ry="2" fill="#E9BF45"/><ellipse cx="205" cy="9" rx="3" ry="1.6" fill="#E9BF45"/>'; } },
    QUESO_CREMA: { h: 6, vh: 16, s: function () { return '<path d="M6,4 q30,12 60,2 q30,12 60,2 q30,12 60,2 q30,12 48,-2 v6 q-114,8 -228,0z" fill="#FFFDF4" stroke="#E8DCBC" stroke-width="1.4"/>'; } },
    PANCETA: { h: 12, vh: 20, s: function () {
      var d1 = 'M10,8 q12,-7 24,0 t24,0 t24,0 t24,0 t24,0 t24,0 t24,0 t24,0 t24,0', d2 = 'M16,14 q12,-6 24,0 t24,0 t24,0 t24,0 t24,0 t24,0 t24,0 t24,0 t18,0';
      return '<path d="' + d2 + '" fill="none" stroke="#8E2D1C" stroke-width="7" stroke-linecap="round"/><path d="' + d1 + '" fill="none" stroke="#B43A26" stroke-width="8" stroke-linecap="round"/><path d="' + d1 + '" fill="none" stroke="#DC6A52" stroke-width="5" stroke-linecap="round"/><path d="' + d1 + '" fill="none" stroke="#F8D3C5" stroke-width="1.8" stroke-linecap="round"/>';
    } },
    LECHUGA: { h: 12, vh: 30, s: function (c) {
      // Hoja de lechuga ondulada: volados redondeados que cuelgan por delante y asoman por los costados.
      function hoja(sem, y0, base, x0, x1, paso, desf) {
        var r = rng(sem), d = 'M' + x0 + ',' + y0, x, lobs = [];
        for (x = x0; x < x1; x += 24) d += ' Q' + f(x + 12) + ',' + f(y0 - 2 - r() * 3) + ' ' + f(Math.min(x + 24, x1)) + ',' + f(y0);
        d += ' C' + f(x1 + 10) + ',' + f(y0 + 2) + ' ' + f(x1 + 8) + ',' + f(base + 6) + ' ' + f(x1 - 2) + ',' + f(base);
        for (x = x1 - 2 - desf; x > x0 + 2; x -= paso) {
          var nx = Math.max(x - paso, x0 + 2), prof = 6 + r() * 5;
          d += ' L' + f(x) + ',' + f(base) + ' C' + f(x - 2) + ',' + f(base + prof) + ' ' + f(nx + 2) + ',' + f(base + prof) + ' ' + f(nx) + ',' + f(base);
          lobs.push([(x + nx) / 2, base + prof * 0.75]);
        }
        d += ' C' + f(x0 - 8) + ',' + f(base + 6) + ' ' + f(x0 - 10) + ',' + f(y0 + 2) + ' ' + x0 + ',' + y0 + 'Z';
        return { d: d, lobs: lobs };
      }
      var atras = hoja('lechA' + c, 7, 16, -6, 246, 26, 0), frente = hoja('lechB' + c, 4, 13, 2, 238, 22, 9), pliegues = '';
      frente.lobs.forEach(function (l) {
        pliegues += '<path d="M' + f(l[0]) + ',' + f(l[1] - 10) + ' Q' + f(l[0] + 2) + ',' + f(l[1] - 4) + ' ' + f(l[0] - 1) + ',' + f(l[1] + 1) + '" stroke="#DDF6BE" stroke-width="1.5" fill="none" stroke-linecap="round" opacity=".85"/>';
      });
      return '<path d="' + atras.d + '" fill="#3C8A25"/><path d="' + frente.d + '" fill="url(#adb-lech)"/>' + pliegues +
        '<path d="M10,5 Q120,0 230,5" stroke="#E6FAD0" stroke-width="2" fill="none" stroke-linecap="round" opacity=".75"/>';
    } },
    TOMATE: { h: 12, vh: 20, s: function () {
      // Dos rodajas de tomate vistas apenas desde arriba: cáscara, pulpa, celdas con semillas y el costado.
      return [64, 176].map(function (cx, k) {
        var celdas = '';
        [[-30, 0], [-10, -2], [12, -1.5], [32, 0.5]].forEach(function (p) {
          celdas += '<ellipse cx="' + (cx + p[0]) + '" cy="' + (8 + p[1] * 0.3) + '" rx="9" ry="2.6" fill="#F99377"/>' +
            '<circle cx="' + (cx + p[0] - 3) + '" cy="' + (8 + p[1] * 0.3) + '" r="1" fill="#FCE7A8"/><circle cx="' + (cx + p[0] + 3) + '" cy="' + (8.3 + p[1] * 0.3) + '" r="1" fill="#FCE7A8"/>';
        });
        return '<g' + (k ? ' transform="translate(0,1)"' : '') + '><path d="M' + (cx - 58) + ',8 v5 q0,6 10,6 h96 q10,0 10,-6 v-5z" fill="#B3231A"/>' +
          '<path d="M' + (cx - 58) + ',12 q58,9 116,0" stroke="#E6563F" stroke-width="1.6" fill="none" opacity=".7"/>' +
          '<ellipse cx="' + cx + '" cy="8" rx="58" ry="7" fill="#D8331F"/><ellipse cx="' + cx + '" cy="8" rx="53" ry="5.6" fill="#EE5A40"/>' + celdas +
          '<ellipse cx="' + (cx + 1) + '" cy="7.6" rx="5" ry="1.6" fill="#F7B19A"/></g>';
      }).join('');
    } },
    CEBOLLA: { h: 7, vh: 12, s: function () { return [18, 72, 126, 180].map(function (x) { return '<ellipse cx="' + (x + 22) + '" cy="6" rx="26" ry="4" fill="none" stroke="#9E44B5" stroke-width="3.4"/><ellipse cx="' + (x + 22) + '" cy="5.4" rx="26" ry="4" fill="none" stroke="#E7C3F0" stroke-width="1.4"/>'; }).join(''); } },
    CEBOLLA_CARAMELIZADA: { h: 8, vh: 12, s: function () { var d = 'M10,6'; for (var x = 10; x < 226; x += 16) d += ' q4,-6 8,0 t8,0'; return '<path d="' + d + '" fill="none" stroke="#6E3510" stroke-width="5" stroke-linecap="round"/><path d="' + d + '" fill="none" stroke="#A85F26" stroke-width="2.6" stroke-linecap="round"/>'; } },
    PEPINO: { h: 6, vh: 11, s: function () { return [22, 72, 122, 172].map(function (x) { return '<ellipse cx="' + (x + 23) + '" cy="6" rx="24" ry="4.4" fill="#3F8E2B"/><ellipse cx="' + (x + 23) + '" cy="5" rx="21" ry="2.8" fill="#B8E08A"/>'; }).join(''); } },
    JALAPENO: { h: 6, vh: 11, s: function () { return [36, 92, 148, 204].map(function (x) { return '<ellipse cx="' + x + '" cy="6" rx="18" ry="4.2" fill="#2F7A24"/><ellipse cx="' + x + '" cy="5" rx="12" ry="2.4" fill="#CFEA9F"/>'; }).join(''); } },
    HUEVO: { h: 12, vh: 22, s: function () { return '<path d="M4,16 q10,-10 40,-8 q20,-8 50,-4 q30,-6 60,-2 q40,-6 62,8 q8,6 -2,8 h-206 q-8,-2 -4,-2z" fill="#ECE6D8"/><path d="M4,14 q10,-10 40,-8 q20,-8 50,-4 q30,-6 60,-2 q40,-6 62,8 q-106,6 -212,6z" fill="#FFFFFF"/><ellipse cx="120" cy="9" rx="30" ry="9" fill="#F09A12"/><ellipse cx="120" cy="7.5" rx="27" ry="7" fill="#FBB52A"/><ellipse cx="111" cy="5" rx="9" ry="2.4" fill="#FFE29A"/>'; } },
    SALSA: { h: 4, vh: 16, s: function (c, o) { var col = colorSalsa(o && o.nombre); var d = 'M8,3 h224 q-8,2 -14,8 q-6,-6 -12,-2 q-10,8 -18,0 q-12,-4 -24,4 q-8,-6 -20,-2 q-14,6 -24,-2 q-12,8 -22,2 q-8,-6 -20,2 q-10,-6 -22,0 q-12,-4 -20,-8z'; return '<path d="' + d + '" fill="' + col[1] + '" transform="translate(0,1.5)"/><path d="' + d + '" fill="' + col[0] + '"/>'; } },
    GENERICO: { h: 10, vh: 14, s: function (c, o) { var col = colorGenerico(o && o.nombre); return '<rect x="8" y="3" width="224" height="10" rx="5" fill="' + col + '"/><rect x="14" y="3" width="212" height="3" rx="1.5" fill="#FFFFFF" opacity=".3"/>'; } }
  };
  var CAPA_EQUIV = { PEPPERONI: 'GENERICO', JAMON: 'GENERICO', CHAMPINON: 'GENERICO', ALBAHACA: 'LECHUGA', PALMITO: 'GENERICO', ANANA: 'GENERICO', ACEITUNA: 'GENERICO', MORRON: 'GENERICO', CHOCLO: 'GENERICO' };
  var ORDEN_HB = ['SALSA', 'LECHUGA', 'TOMATE', 'PEPINO', 'CEBOLLA', 'CARNE', 'POLLO', 'CHEDDAR', 'QUESO', 'QUESO_CREMA', 'PANCETA', 'HUEVO', 'CEBOLLA_CARAMELIZADA', 'JALAPENO', 'GENERICO'];
  function capaClave(d) { return CAPA[d] ? d : (CAPA_EQUIV[d] || 'GENERICO'); }
  function capa(d, c, o) { var C = CAPA[capaClave(d)]; return { h: C.h, vh: C.vh, s: C.s(c || 0, o) }; }

  // ------------------------------------------------------------------ pizza y porción (vista de arriba)
  function borde(semilla, rBase, var_, n) {
    var r = rng(semilla), pts = [];
    for (var i = 0; i < n; i++) { var a = i / n * Math.PI * 2, rr = rBase + (r() - 0.5) * var_; pts.push([Math.cos(a) * rr, Math.sin(a) * rr]); }
    var d = 'M' + f(pts[0][0]) + ',' + f(pts[0][1]);
    for (var k = 0; k < n; k++) { var p = pts[k], q = pts[(k + 1) % n]; d += ' Q' + f(p[0]) + ',' + f(p[1]) + ' ' + f((p[0] + q[0]) / 2) + ',' + f((p[1] + q[1]) / 2); }
    return d + 'Z';
  }
  function burbujas(semilla, rMin, rMax, n, col, op) {
    var r = rng(semilla), s = '';
    for (var i = 0; i < n; i++) { var a = r() * 6.28, rr = rMin + r() * (rMax - rMin); s += '<ellipse cx="' + f(Math.cos(a) * rr) + '" cy="' + f(Math.sin(a) * rr) + '" rx="' + f(2 + r() * 4) + '" ry="' + f(1.5 + r() * 2.5) + '" transform="rotate(' + Math.round(a * 57.3) + ' ' + f(Math.cos(a) * rr) + ' ' + f(Math.sin(a) * rr) + ')" fill="' + col + '" opacity="' + op + '"/>'; }
    return s;
  }
  // Pizza entera centrada en 0,0 (radio 142). "tostado" es la capa que aparece al hornear.
  function pizzaBase() {
    return '<circle r="146" cy="8" fill="rgba(0,0,0,.45)" filter="url(#adb-sombra)"/>' +
      '<circle r="142" fill="url(#adb-masa)"/>' + burbujas('masa', 126, 138, 26, '#FBE2AE', '.7') + burbujas('masa2', 128, 139, 14, '#C27B35', '.45') +
      '<path d="' + borde('salsa', 116, 7, 22) + '" fill="url(#adb-salsa)"/>' + burbujas('salsa', 10, 105, 22, '#A8261A', '.35');
  }
  function pizzaTostado() { return '<circle r="134" fill="none" stroke="#8C4E19" stroke-width="18" opacity=".45"/>' + burbujas('tost', 10, 110, 40, '#B5651E', '.5') + burbujas('tost2', 128, 140, 20, '#7A3F12', '.5'); }
  // Porción: triángulo con la punta abajo y el borde arriba.
  var PORCION = 'M-112,-92 Q0,-148 112,-92 L8,128 Q0,140 -8,128 Z';
  var PORCION_SALSA = 'M-92,-78 Q0,-122 92,-78 L4,108 Q0,116 -4,108 Z';
  function porcionBase() {
    return '<path d="' + PORCION + '" transform="translate(4,10)" fill="rgba(0,0,0,.4)" filter="url(#adb-sombra)"/>' +
      '<path d="' + PORCION + '" fill="#E8B266"/><path d="M-112,-92 Q0,-148 112,-92 L104,-74 Q0,-126 -104,-74 Z" fill="#D9984C"/>' +
      '<path d="M-100,-96 Q0,-142 100,-96" stroke="#F8DBA2" stroke-width="5" fill="none" stroke-linecap="round" opacity=".8"/>' +
      '<path d="' + PORCION_SALSA + '" fill="url(#adb-salsa)"/>';
  }
  function porcionTostado() { return '<path d="M-112,-92 Q0,-148 112,-92 L104,-74 Q0,-126 -104,-74 Z" fill="#7A3F12" opacity=".45"/><path d="' + PORCION + '" fill="#8C4E19" opacity=".18"/>'; }
  function capaQueso(gradiente, veces, semilla, forma) {
    var r = rng(semilla), manchas = '';
    var d = forma === 'PORCION' ? 'M-88,-74 Q-40,-104 0,-108 Q40,-104 88,-74 Q60,-8 30,52 Q12,92 3,104 Q-12,92 -30,52 Q-60,-8 -88,-74Z' : borde(semilla, 104, 14, 26);
    for (var k = 0; k < 8 + veces * 6; k++) {
      var x, y;
      if (forma === 'PORCION') { y = -90 + r() * 180; var ancho = Math.max(4, 84 * (1 - (y + 90) / 200)); x = (r() - 0.5) * 2 * ancho; }
      else { var a = r() * 6.28, rr = Math.sqrt(r()) * 92; x = Math.cos(a) * rr; y = Math.sin(a) * rr; }
      manchas += '<ellipse cx="' + f(x) + '" cy="' + f(y) + '" rx="' + f(3 + r() * 6) + '" ry="' + f(2 + r() * 4) + '" fill="#FFFBE6" opacity="' + f(0.25 + r() * 0.3) + '"/>';
    }
    return '<path d="' + d + '" fill="url(#' + gradiente + ')" opacity=".96"/>' + manchas;
  }
  function quesoTostado(semilla, forma) {
    var r = rng(semilla + 't'), s = '';
    for (var k = 0; k < 22; k++) {
      var x, y;
      if (forma === 'PORCION') { y = -80 + r() * 160; var ancho = Math.max(4, 74 * (1 - (y + 80) / 190)); x = (r() - 0.5) * 2 * ancho; }
      else { var a = r() * 6.28, rr = Math.sqrt(r()) * 96; x = Math.cos(a) * rr; y = Math.sin(a) * rr; }
      s += '<ellipse cx="' + f(x) + '" cy="' + f(y) + '" rx="' + f(2 + r() * 4) + '" ry="' + f(1.5 + r() * 3) + '" fill="#C97A22" opacity="' + f(0.35 + r() * 0.35) + '"/>';
    }
    return s;
  }
  // Lugares para repartir piezas, parejos (muestreo de Poisson): en el círculo de la salsa o en el triángulo de la porción.
  function dentro(forma, x, y, margen) {
    if (forma === 'PORCION') {
      if (y < -92 + margen * 0.6 || y > 98 - margen) return false;
      var t = (y + 92) / 200, ancho = 86 * (1 - t) - margen * 0.8;
      if (y < -70) ancho = Math.min(ancho, 86 - (-70 - y) * 0.3);
      return Math.abs(x) < ancho;
    }
    return x * x + y * y < Math.pow(104 - margen, 2);
  }
  var cachePuntos = {};
  function puntos(forma) {
    if (cachePuntos[forma]) return cachePuntos[forma];
    var r = rng('puntos-' + forma), out = [], minD = forma === 'PORCION' ? 10 : 12, intentos = 0;
    while (intentos++ < 6000 && out.length < 120) {
      var x = (r() - 0.5) * 230, y = (r() - 0.5) * 230;
      if (!dentro(forma, x, y, 6)) continue;
      var ok = true;
      for (var i = 0; i < out.length; i++) { var dx = out[i][0] - x, dy = out[i][1] - y; if (dx * dx + dy * dy < minD * minD) { ok = false; break; } }
      if (ok) out.push([x, y]);
    }
    cachePuntos[forma] = out;
    return out;
  }
  /*
   * Reparte los ingredientes: cada uno toma sus lugares lo más separados entre sí (búsqueda del punto más lejano),
   * así queda parejo en toda la pizza y mezclado con los demás. lista = [{ k, d, veces, o }] en el orden en que se eligieron.
   * Devuelve [{ k: clave estable, x, y, rot, d, c, o }].
   */
  function repartir(lista, forma) {
    var pool = puntos(forma).map(function (p, i) { return { x: p[0], y: p[1], i: i, libre: true }; });
    var out = [];
    lista.forEach(function (it) {
      var n = Math.max(1, Math.round((CANT[it.d] || 8) * (forma === 'PORCION' ? 0.62 : 1))) * it.veces;
      var r = rng(it.k), mios = [];
      for (var c = 0; c < n; c++) {
        var libres = pool.filter(function (p) { return p.libre; }), elegido;
        if (!libres.length) { var a = r() * 6.28, rr = Math.sqrt(r()) * 90; elegido = { x: Math.cos(a) * rr, y: Math.sin(a) * rr }; }
        else if (!mios.length) elegido = libres[Math.floor(r() * libres.length)];
        else {
          var mejor = -1;
          libres.forEach(function (p) {
            var dmin = Infinity;
            mios.forEach(function (m) { var dx = m.x - p.x, dy = m.y - p.y, dd = dx * dx + dy * dy; if (dd < dmin) dmin = dd; });
            var v = dmin + r() * 40; // un poco de azar para que no parezca una grilla
            if (v > mejor) { mejor = v; elegido = p; }
          });
        }
        if (elegido.libre) elegido.libre = false;
        mios.push(elegido);
        out.push({ k: it.k + '#' + c, x: elegido.x + (r() - 0.5) * 4, y: elegido.y + (r() - 0.5) * 4, rot: Math.round(r() * 360), d: it.d, c: c, o: it.o });
      }
    });
    return out;
  }

  // ------------------------------------------------------------------ cajas con el logo
  function logo(x, y, ancho) { return '<image href="assets/mesapyae-logo.png" x="' + (x - ancho / 2) + '" y="' + (y - ancho * 0.125) + '" width="' + ancho + '" height="' + (ancho * 0.25) + '" preserveAspectRatio="xMidYMid meet"/>'; }
  function octogono(r) { var p = []; for (var i = 0; i < 8; i++) { var a = (i + 0.5) / 8 * Math.PI * 2; p.push(f(Math.cos(a) * r) + ',' + f(Math.sin(a) * r)); } return p.join(' '); }
  // Caja de pizza vista de arriba: fondo (se ve primero, debajo de la pizza) y tapa (se cierra encima).
  function cajaPizza() {
    return {
      fondo: '<polygon points="' + octogono(162) + '" fill="#E6E1D8"/><polygon points="' + octogono(152) + '" fill="#B98F5E"/><polygon points="' + octogono(146) + '" fill="#A87D4D"/>',
      tapa: '<polygon points="' + octogono(164) + '" fill="url(#adb-caja)" stroke="#D9D3C7" stroke-width="2"/><polygon points="' + octogono(146) + '" fill="none" stroke="#E4DED3" stroke-width="2"/>' +
        logo(0, -12, 210) + '<text x="0" y="46" text-anchor="middle" font-family="Oswald, Arial Narrow, sans-serif" font-size="15" letter-spacing="3" fill="#134E39">RECIÉN HORNEADA</text>'
    };
  }
  function cajaPorcion() {
    var tri = 'M-128,-104 L128,-104 L0,150 Z';
    return {
      fondo: '<path d="' + tri + '" fill="#B98F5E" transform="scale(1.06) translate(0,-4)"/><path d="' + tri + '" fill="#A87D4D"/>',
      tapa: '<path d="' + tri + '" fill="url(#adb-kraft)" transform="scale(1.07) translate(0,-4)"/><path d="M-118,-96 L118,-96" stroke="#C9A06B" stroke-width="3"/>' +
        '<rect x="-84" y="-70" width="168" height="44" rx="8" fill="#FFFFFF" opacity=".92"/>' + logo(0, -48, 150) +
        '<text x="0" y="0" text-anchor="middle" font-family="Oswald, Arial Narrow, sans-serif" font-size="12" letter-spacing="2" fill="#5A3E1E">TU PORCIÓN</text>'
    };
  }
  // Caja de hamburguesa tipo "clamshell" de cartón kraft, vista de frente (a la medida de la hamburguesa, ancho 280):
  // - abierta: la tapa levantada detrás de la hamburguesa, con el interior blanco a la vista.
  // - base: la parte de abajo, adelante (cara recta y bisel inferior), con el logo.
  // - tapa: la tapa cerrada (cara recta y bisel de arriba) con el logo y la pestaña de cierre.
  function motas(sem, w_, h_, n) { var r = rng(sem), s_ = ''; for (var i = 0; i < n; i++) s_ += '<circle cx="' + f(r() * w_) + '" cy="' + f(r() * h_) + '" r="' + f(0.5 + r() * 0.9) + '" fill="' + (r() < 0.5 ? '#B89A6E' : '#F1E3C6') + '" opacity=".55"/>'; return s_; }
  function cajaHamburguesa(alto) {
    var hb = Math.round(Math.max(58, alto * 0.4)), b1 = Math.round(hb * 0.58);
    var ht = Math.round(alto - (hb - 8) + 14), t1 = Math.round(Math.min(ht * 0.34, 46)), ha = Math.round(ht * 0.9);
    var base = '<svg viewBox="0 0 280 ' + hb + '" width="280" height="' + hb + '" style="overflow:visible">' +
      '<path d="M4,0 H276 V' + b1 + ' H4Z" fill="url(#adb-kraft2)"/><path d="M4,' + b1 + ' H276 L256,' + hb + ' H24Z" fill="#BFA176"/>' + motas('cbase', 280, hb, 50) +
      '<path d="M4,1.5 H276" stroke="#F3E6CB" stroke-width="3"/><path d="M4,' + b1 + ' H276" stroke="#A88B60" stroke-width="1.5"/>' +
      '<path d="M120,0 h40 v7 q0,4 -4,4 h-32 q-4,0 -4,-4z" fill="#8E7350" opacity=".5"/>' + logo(140, b1 * 0.55 + 4, Math.min(150, b1 * 3.4)) + '</svg>';
    var tapa = '<svg viewBox="0 0 280 ' + (ht + 12) + '" width="280" height="' + (ht + 12) + '" style="overflow:visible">' +
      '<path d="M26,0 H254 L276,' + t1 + ' H4Z" fill="#E9D6B0"/><path d="M4,' + t1 + ' H276 V' + ht + ' H4Z" fill="url(#adb-kraft2)"/>' + motas('ctapa', 280, ht, 70) +
      '<path d="M4,' + t1 + ' H276" stroke="#BFA176" stroke-width="1.5"/><path d="M26,1 H254" stroke="#F7EDD8" stroke-width="2"/>' +
      '<path d="M122,' + (ht - 1) + ' h36 v8 q0,5 -5,5 h-26 q-5,0 -5,-5z" fill="url(#adb-kraft2)" stroke="#A88B60" stroke-width="1.2"/>' +
      '<rect x="74" y="' + f(t1 + (ht - t1) / 2 - 22) + '" width="132" height="40" rx="8" fill="#FFFFFF" opacity=".9"/>' + logo(140, t1 + (ht - t1) / 2 - 2, 120) + '</svg>';
    var abierta = '<svg viewBox="-10 0 300 ' + ha + '" width="300" height="' + ha + '" style="overflow:visible">' +
      '<path d="M-6,0 H286 L276,' + ha + ' H4Z" fill="#C9AC80"/><path d="M4,8 H276 L268,' + (ha - 4) + ' H12Z" fill="#F7F2E9"/>' +
      '<path d="M12,' + (ha - 24) + ' H268 L266,' + (ha - 4) + ' H14Z" fill="#E9E1D2"/><path d="M118,10 h44 v8 q0,4 -4,4 h-36 q-4,0 -4,-4z" fill="#D9CFBE"/></svg>';
    return { base: { h: hb, svg: base }, tapa: { h: ht, svg: tapa }, abierta: { h: ha, svg: abierta } };
  }

  w.ArmadorDibujos = {
    DEFS: DEFS, dibujoDe: dibujoDe, rng: rng, pieza: pieza, icono: icono, capa: capa, capaClave: capaClave, ORDEN_HB: ORDEN_HB,
    panArriba: panArriba, panAbajo: panAbajo, pizzaBase: pizzaBase, pizzaTostado: pizzaTostado, porcionBase: porcionBase, porcionTostado: porcionTostado,
    capaQueso: capaQueso, quesoTostado: quesoTostado, CAPA_PIZZA: CAPA_PIZZA, repartir: repartir,
    cajaPizza: cajaPizza, cajaPorcion: cajaPorcion, cajaHamburguesa: cajaHamburguesa, logoUrl: 'assets/mesapyae-logo.png',
    LISTA: Object.keys(PIEZA).concat(['PAN_BRIOCHE', 'PAN_NEGRO', 'PAN_PAPA'])
  };
})(window);
