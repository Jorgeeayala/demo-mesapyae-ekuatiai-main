'use strict';
/*
 * ¿Hay que publicar este sitio de Netlify? (comando "ignore" de netlify.toml)
 * Netlify: salida 0 = NO publicar (se saltea), salida 1 = publicar.
 *
 * Todos los sitios (cada local, pruebas, demo) se arman desde este mismo repositorio.
 * Sin esta regla, el alta de un local nuevo vuelve a publicar el sitio de TODOS los locales
 * y cada publicación cuesta créditos de Netlify (15 por publicación).
 *
 * Regla, siempre del lado seguro: se saltea SOLO si todos los archivos cambiados son
 *   - de la carpeta de OTRO local (locales/<otro>/...), o
 *   - documentación o pruebas (docs/, tests/, *.md en la raíz o en locales/).
 * Cualquier otra cosa (core/, public/, tools/, netlify.toml, la carpeta del propio local...) publica.
 * Sitio único (MESA_SITIO=LOCALES, E4): la carpeta de cualquier local publica (menos la plantilla "ejemplo").
 * Si no se puede saber qué cambió (primera publicación, redeploy del mismo commit, historial
 * incompleto), publica.
 */
const { execFileSync } = require('node:child_process');

function irrelevante(archivo, local, unico) {
  if (archivo.startsWith('docs/') || archivo.startsWith('tests/')) return true;
  if (!archivo.includes('/') && archivo.endsWith('.md')) return true; // README.md, CLAUDE.md...
  const m = archivo.match(/^locales\/([^/]+)(\/.*)?$/);
  if (!m) return false;
  if (!m[2]) return m[1].endsWith('.md'); // locales/README.md
  const carpeta = m[1];
  if (unico) return carpeta === 'ejemplo'; // sitio único: le importan todos los locales
  if (local) return carpeta !== local; // sitio de un local: solo le importa su carpeta
  return carpeta !== 'ejemplo'; // pruebas/demo: la plantilla ficticia puede usarse; el resto no
}

function debePublicar(cambios, local, unico) {
  const lista = (cambios || []).map((s) => s.trim()).filter(Boolean);
  if (!lista.length) return true; // no se sabe qué cambió: publicar
  return !lista.every((a) => irrelevante(a, local, unico));
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function cambiosEntre(base, cabeza) {
  if (!base || !cabeza) { console.log('Sin CACHED_COMMIT_REF/COMMIT_REF'); return null; }
  if (base === cabeza) { console.log('Mismo commit que la última publicación'); return null; }
  try { return git(['diff', '--name-only', base, cabeza]).split('\n'); } catch (_) { /* clon superficial */ }
  try { // Netlify clona con poco historial: traer el commit de la última publicación y reintentar
    git(['fetch', '--quiet', '--depth=200', 'origin', base]);
    return git(['diff', '--name-only', base, cabeza]).split('\n');
  } catch (e) {
    console.log('No se pudo comparar ' + base.slice(0, 7) + '..' + cabeza.slice(0, 7) + ': ' + String(e.stderr || e.message).split('\n')[0]);
    return null;
  }
}

if (require.main === module) {
  const local = (process.env.MESA_LOCAL || '').trim();
  const cambios = cambiosEntre(process.env.CACHED_COMMIT_REF, process.env.COMMIT_REF);
  const unico = process.env.MESA_SITIO === 'LOCALES';
  const publicar = cambios === null ? true : debePublicar(cambios, local, unico);
  console.log((publicar ? 'Publicar' : 'Saltear') + ' sitio' + (local ? ' de ' + local : '') +
    (cambios === null ? ' (sin historial comparable)' : ' (' + cambios.filter(Boolean).length + ' archivos cambiados)'));
  process.exit(publicar ? 1 : 0);
}

module.exports = { debePublicar, irrelevante };
