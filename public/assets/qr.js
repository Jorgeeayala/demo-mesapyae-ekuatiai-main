/*
 * Generador de códigos QR (modo byte, corrección M, versiones 1–40).
 * Implementación propia según ISO/IEC 18004, sin dependencias.
 * API: QR.matrix(texto) -> boolean[][] ; QR.svg(texto, {margin, size}) -> string SVG
 */
(function (root) {
  'use strict';
  var ECC_PER_BLOCK_M = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
  var BLOCKS_M = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];
  var FORMAT_BITS_M = 0;

  function getBit(x, i) { return ((x >>> i) & 1) !== 0; }
  function rawModules(ver) {
    var r = (16 * ver + 128) * ver + 64;
    if (ver >= 2) { var n = Math.floor(ver / 7) + 2; r -= (25 * n - 10) * n - 55; if (ver >= 7) r -= 36; }
    return r;
  }
  function dataCodewords(ver) { return Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK_M[ver] * BLOCKS_M[ver]; }
  function gfMul(x, y) { var z = 0; for (var i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; } return z & 0xFF; }
  function rsDivisor(deg) {
    var r = []; for (var i = 0; i < deg; i++) r.push(0); r[deg - 1] = 1;
    var root = 1;
    for (i = 0; i < deg; i++) {
      for (var j = 0; j < r.length; j++) { r[j] = gfMul(r[j], root); if (j + 1 < r.length) r[j] ^= r[j + 1]; }
      root = gfMul(root, 0x02);
    }
    return r;
  }
  function rsRemainder(data, div) {
    var r = div.map(function () { return 0; });
    data.forEach(function (b) {
      var f = b ^ r.shift(); r.push(0);
      div.forEach(function (c, i) { r[i] ^= gfMul(c, f); });
    });
    return r;
  }
  function utf8(s) {
    var out = [];
    var e = unescape(encodeURIComponent(s));
    for (var i = 0; i < e.length; i++) out.push(e.charCodeAt(i));
    return out;
  }
  function alignPositions(ver, size) {
    if (ver === 1) return [];
    var n = Math.floor(ver / 7) + 2;
    var step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
    var res = [6];
    for (var pos = size - 7; res.length < n; pos -= step) res.splice(1, 0, pos);
    return res;
  }

  function encode(text) {
    var bytes = utf8(text), ver, cap;
    for (ver = 1; ver <= 40; ver++) {
      cap = dataCodewords(ver) * 8;
      var ccBits = ver <= 9 ? 8 : 16;
      if (4 + ccBits + bytes.length * 8 <= cap) break;
    }
    if (ver > 40) throw new Error('Texto demasiado largo para QR');
    var bits = [];
    function push(v, n) { for (var i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); }
    push(4, 4); push(bytes.length, ver <= 9 ? 8 : 16);
    bytes.forEach(function (b) { push(b, 8); });
    push(0, Math.min(4, cap - bits.length));
    push(0, (8 - bits.length % 8) % 8);
    for (var pad = 0xEC; bits.length < cap; pad ^= 0xEC ^ 0x11) push(pad, 8);
    var data = [];
    for (var i = 0; i < bits.length; i += 8) { var v = 0; for (var j = 0; j < 8; j++) v = (v << 1) | bits[i + j]; data.push(v); }

    // ECC e intercalado
    var nb = BLOCKS_M[ver], eccLen = ECC_PER_BLOCK_M[ver], raw = Math.floor(rawModules(ver) / 8);
    var nShort = nb - raw % nb, shortLen = Math.floor(raw / nb), div = rsDivisor(eccLen);
    var blocks = [], k = 0;
    for (i = 0; i < nb; i++) {
      var dat = data.slice(k, k + shortLen - eccLen + (i < nShort ? 0 : 1));
      k += dat.length;
      var ecc = rsRemainder(dat, div);
      if (i < nShort) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    var cw = [];
    for (i = 0; i < blocks[0].length; i++) blocks.forEach(function (b, j) { if (i !== shortLen - eccLen || j >= nShort) cw.push(b[i]); });

    // Matriz
    var size = ver * 4 + 17, M = [], F = [];
    for (i = 0; i < size; i++) { M.push(new Array(size).fill(false)); F.push(new Array(size).fill(false)); }
    function setF(x, y, d) { M[y][x] = d; F[y][x] = true; }
    for (i = 0; i < size; i++) { setF(6, i, i % 2 === 0); setF(i, 6, i % 2 === 0); }
    [[3, 3], [size - 4, 3], [3, size - 4]].forEach(function (c) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var d = Math.max(Math.abs(dx), Math.abs(dy)), xx = c[0] + dx, yy = c[1] + dy;
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) setF(xx, yy, d !== 2 && d !== 4);
      }
    });
    var al = alignPositions(ver, size), na = al.length;
    for (i = 0; i < na; i++) for (j = 0; j < na; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) continue;
      for (var dy2 = -2; dy2 <= 2; dy2++) for (var dx2 = -2; dx2 <= 2; dx2++) setF(al[i] + dx2, al[j] + dy2, Math.max(Math.abs(dx2), Math.abs(dy2)) !== 1);
    }
    function drawFormat(mask) {
      var d = FORMAT_BITS_M << 3 | mask, rem = d;
      for (var q = 0; q < 10; q++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      var b = (d << 10 | rem) ^ 0x5412;
      for (q = 0; q <= 5; q++) setF(8, q, getBit(b, q));
      setF(8, 7, getBit(b, 6)); setF(8, 8, getBit(b, 7)); setF(7, 8, getBit(b, 8));
      for (q = 9; q < 15; q++) setF(14 - q, 8, getBit(b, q));
      for (q = 0; q < 8; q++) setF(size - 1 - q, 8, getBit(b, q));
      for (q = 8; q < 15; q++) setF(8, size - 15 + q, getBit(b, q));
      setF(8, size - 8, true);
    }
    drawFormat(0);
    if (ver >= 7) {
      var rem = ver;
      for (i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
      var vb = ver << 12 | rem;
      for (i = 0; i < 18; i++) { var bit = getBit(vb, i), a = size - 11 + i % 3, b2 = Math.floor(i / 3); setF(a, b2, bit); setF(b2, a, bit); }
    }
    // Datos en zigzag
    var bi = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) for (j = 0; j < 2; j++) {
        var x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
        if (!F[y][x] && bi < cw.length * 8) { M[y][x] = getBit(cw[bi >>> 3], 7 - (bi & 7)); bi++; }
      }
    }
    function maskFn(m, x, y) {
      switch (m) {
        case 0: return (x + y) % 2 === 0; case 1: return y % 2 === 0; case 2: return x % 3 === 0; case 3: return (x + y) % 3 === 0;
        case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; case 5: return x * y % 2 + x * y % 3 === 0;
        case 6: return (x * y % 2 + x * y % 3) % 2 === 0; default: return ((x + y) % 2 + x * y % 3) % 2 === 0;
      }
    }
    function applyMask(m) { for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) if (!F[y][x] && maskFn(m, x, y)) M[y][x] = !M[y][x]; }
    function penalty() {
      var p = 0, x, y, run, dark = 0;
      for (y = 0; y < size; y++) { run = 1; for (x = 1; x < size; x++) { if (M[y][x] === M[y][x - 1]) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1; } }
      for (x = 0; x < size; x++) { run = 1; for (y = 1; y < size; y++) { if (M[y][x] === M[y - 1][x]) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1; } }
      for (y = 0; y < size - 1; y++) for (x = 0; x < size - 1; x++) { var c = M[y][x]; if (c === M[y][x + 1] && c === M[y + 1][x] && c === M[y + 1][x + 1]) p += 3; }
      for (y = 0; y < size; y++) for (x = 0; x < size; x++) if (M[y][x]) dark++;
      var t = size * size; p += (Math.ceil(Math.abs(dark * 20 - t * 10) / t) - 1) * 10;
      return p;
    }
    var best = 0, bestP = Infinity;
    for (var m = 0; m < 8; m++) { applyMask(m); drawFormat(m); var pp = penalty(); if (pp < bestP) { bestP = pp; best = m; } applyMask(m); }
    applyMask(best); drawFormat(best);
    return M;
  }

  function svg(text, opt) {
    opt = opt || {};
    var M = encode(text), n = M.length, mg = opt.margin === undefined ? 4 : opt.margin, s = n + mg * 2, d = '';
    for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) if (M[y][x]) d += 'M' + (x + mg) + ',' + (y + mg) + 'h1v1h-1z';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + s + ' ' + s + '"' + (opt.size ? ' width="' + opt.size + '" height="' + opt.size + '"' : '') +
      ' shape-rendering="crispEdges" role="img" aria-label="Código QR"><rect width="100%" height="100%" fill="#fff"/><path fill="#000" d="' + d + '"/></svg>';
  }

  var QR = { matrix: encode, svg: svg };
  if (typeof module !== 'undefined' && module.exports) module.exports = QR; else root.QR = QR;
})(this);
