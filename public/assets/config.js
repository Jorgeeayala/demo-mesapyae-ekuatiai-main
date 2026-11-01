/*
 * Configuración del frontend (base de Mesa Pya'e, sin local).
 *  apiUrl:   /api (Netlify lo redirige al servidor del local)
 *  firebase: datos PÚBLICOS del proyecto del local para escuchar el pulso en tiempo real.
 * En el sitio de cada local, tools/marca_local.py reemplaza este archivo con los datos de locales/<local>/local.json.
 */
window.MESA_CONFIG = {
  apiUrl: '/api',
  firebase: { apiKey: '', authDomain: '', projectId: '', appId: '' }
};
