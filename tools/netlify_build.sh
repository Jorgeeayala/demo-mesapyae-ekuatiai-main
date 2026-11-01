#!/bin/sh
# Paso de build de Netlify. Sin variables publica la base neutra de Mesa Pya'e (public/).
# En otro sitio (demo u otro local) se configura con variables de entorno de Netlify:
#   MESA_API_URL        URL de la función api de su proyecto Firebase
#   MESA_FB_PROJECT, MESA_FB_APIKEY, MESA_FB_APPID   datos públicos de la app web (tiempo real)
#   MESA_DEMO_MODELOS=SI  copia los modelos 3D de ejemplo (solo sitio de demo)
#   MESA_LOCAL=<local>  sitio de un local de la matriz: aplica locales/<local> (marca, puntos, cajas y servidor)
#   MESA_SITIO=SISTEMA_DEMO  el panel del sistema tal cual (marca Mesa Pya'e, /caja, /admin…) con datos de prueba en el
#                       navegador: sirve para probar sin servidor (ej. la factura en e-Kuatia'i). Sin portada de ventas.
#   MESA_SITIO=LOCALES  E4 · sitio único: todos los locales con servidor, cada uno en /<local>/ (tools/sitio_unico.py),
#                       y una sola extensión e-Kuatia'i para todos.
# Siempre: publica /extension/migrador-ekuatiai.zip con el dominio del sitio ya autorizado (variable URL de Netlify).
set -e
cd "$(dirname "$0")/.."
if [ -n "$MESA_API_URL" ]; then
  printf '/api  %s  200!\n' "$MESA_API_URL" > public/_redirects
  echo "API -> $MESA_API_URL"
fi
if [ -n "$MESA_FB_PROJECT" ]; then
  cat > public/assets/config.js <<JS
window.MESA_CONFIG = {
  apiUrl: '/api',
  firebase: { apiKey: '${MESA_FB_APIKEY}', authDomain: '${MESA_FB_PROJECT}.firebaseapp.com', projectId: '${MESA_FB_PROJECT}', appId: '${MESA_FB_APPID}' }
};
JS
  echo "Tiempo real -> $MESA_FB_PROJECT"
fi
if [ -n "$MESA_LOCAL" ]; then
  node tools/validar_local.js "$MESA_LOCAL"
  python3 tools/marca_local.py public "$MESA_LOCAL"
fi
if [ "$MESA_DEMO_MODELOS" = "SI" ]; then
  mkdir -p public/modelos && cp demo/modelos/*.glb public/modelos/
  echo "Modelos 3D de ejemplo copiados"
fi
# MESA_SITIO=SISTEMA_DEMO: las mismas pantallas del sistema en la raíz, con el núcleo corriendo en el navegador.
if [ "$MESA_SITIO" = "SISTEMA_DEMO" ]; then
  T=$(mktemp -d)
  OUT="$T/app" PLAN="${MESA_DEMO_PLAN:-PREMIUM}" EMBED_MODELOS=NO sh tools/build_demo.sh
  rm -rf public && mv "$T/app" public
  printf '/api  /index.html  404\n' > public/_redirects
  echo "Panel del sistema con datos de prueba listo en public/"
fi
# MESA_SITIO=DEMO_WEB: el sitio público de demo de Mesa Pya'e (marca ficticia, todo en el navegador del visitante).
if [ "$MESA_SITIO" = "DEMO_WEB" ]; then
  T=$(mktemp -d)
  OUT="$T/app" PLAN="${MESA_DEMO_PLAN:-PREMIUM}" EMBED_MODELOS=NO sh tools/build_demo.sh
  python3 tools/marca_demo.py "$T/app"
  rm -rf public && mkdir public && mv "$T/app" public/app
  {
    printf '<!doctype html>\n<html lang="es">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
    printf '<meta name="description" content="Probá Mesa Pya%se: pedidos por QR, cocina, cajas, menú 3D, reseñas y tarjeta de sellos.">\n<link rel="icon" href="app/assets/mesapyae-icono.png">\n' "'"
    sed -n '1,/<\/style>/p' demo/landing-planes.html
    printf '</head>\n<body>\n'
    sed -n '/<\/style>/,$p' demo/landing-planes.html | sed '1d'
    printf '</body>\n</html>\n'
  } > public/index.html
  mkdir -p public/video && cp demo/video/presentacion-mesa-pyae.mp4 demo/video/presentacion-mesa-pyae.jpg public/video/
  printf '/api  /index.html  404\n' > public/_redirects
  echo "Demo web lista en public/"
fi
# E4 · Sitio único con todos los locales (cada uno en /<local>/).
if [ "$MESA_SITIO" = "LOCALES" ]; then
  T=$(mktemp -d)
  python3 tools/sitio_unico.py "$T/sitio"
  rm -rf public && mv "$T/sitio" public
  echo "Sitio único listo en public/"
fi
# Extensión Migrador e-Kuatia'i para descargar desde este mismo sitio, con su dominio autorizado.
# En el sitio único es UNA extensión para todos: autoriza este sitio y el dominio propio de cada local.
if [ -n "$URL" ]; then
  EXT_LOCAL="${MESA_LOCAL:--}"; [ "$MESA_SITIO" = "LOCALES" ] && EXT_LOCAL=todos
  node tools/extension_local.js "$EXT_LOCAL" "$URL" ${DEPLOY_PRIME_URL:+"$DEPLOY_PRIME_URL"} --out "$(mktemp -d)/migrador-ekuatiai" --zip public/extension/migrador-ekuatiai.zip
  cp extension/privacidad-ekuatiai.html public/extension/privacidad.html  # política de privacidad (tienda de Chrome)
  cp extension/instalar-ekuatiai.html public/extension/instalar.html && cp -r extension/guia public/extension/  # guía de instalación para el cliente
fi
