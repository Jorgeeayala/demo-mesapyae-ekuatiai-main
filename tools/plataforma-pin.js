'use strict';
/*
 * Genera la línea MESA_PLATAFORMA para el usuario de plataforma de Ser o Límites (cambia planes por local).
 * El PIN se escribe oculto y no se guarda: solo se imprime la sal y el hash.
 * Uso:  node tools/plataforma-pin.js [usuario]      (por defecto: sol)
 * Pegar la línea resultante en firebase/functions/.env.<proyecto> y volver a publicar las funciones.
 */
const crypto = require('crypto');
const usuario = (process.argv[2] || 'sol').toLowerCase();
if (!/^[a-z0-9_.]{3,30}$/.test(usuario)) { console.error('Usuario inválido.'); process.exit(1); }
const sha = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
function hashPin(pin, salt) { let h = salt + ':' + pin; for (let i = 0; i < 300; i++) h = sha(h + ':' + salt); return h; }
const ALPHA = 'abcdefghijkmnpqrstuvwxyz23456789';
const salt = Array.from(crypto.randomBytes(16), (b) => ALPHA[b % ALPHA.length]).join('');
process.stderr.write('PIN de plataforma (6 a 8 números; se ve un * por cada uno): ');
const stdin = process.stdin; let pin = '';
if (stdin.isTTY) stdin.setRawMode(true);
stdin.resume(); stdin.setEncoding('utf8');
stdin.on('data', (ch) => {
  for (const c of ch) {
    if ((c === '\r' || c === '\n') && !pin) continue;  // Enter sin números: seguir esperando
    if (c === '\r' || c === '\n') {
      if (stdin.isTTY) stdin.setRawMode(false);
      process.stderr.write('\n');
      if (!/^[0-9]{6,8}$/.test(pin)) { console.error('El PIN debe tener de 6 a 8 dígitos.'); process.exit(1); }
      console.log('MESA_PLATAFORMA=' + usuario + ':' + salt + ':' + hashPin(pin, salt));
      process.exit(0);
    } else if (c === '\u0003') process.exit(1);
    else if ((c === '\u007f' || c === '\b') && pin) { pin = pin.slice(0, -1); process.stderr.write('\b \b'); }
    else if (c >= '0' && c <= '9') { pin += c; process.stderr.write('*'); }
  }
});
