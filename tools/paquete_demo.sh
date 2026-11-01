#!/bin/sh
# Arma mesa-demo.tgz para publicar el proyecto de demo de Mesa Pya'e (Firebase mesapyae-demo) desde Cloud Shell:
#   /        página de entrada con los planes            /app/   demo en el navegador (cada visitante tiene la suya)
#   /vivo/   demo en vivo con servidor (presentaciones)  /api     función de Firebase
# Todo con la marca ficticia "Café Demo". Uso: sh tools/paquete_demo.sh <salida.tgz>
set -e
cd "$(dirname "$0")/.."
SAL="${1:-mesa-demo.tgz}"; case "$SAL" in /*) ;; *) SAL="$(pwd)/$SAL";; esac
T=$(mktemp -d); P="$T/mesa-demo"; mkdir -p "$P/tools"
sh tools/build_firebase.sh >/dev/null
cp -r firebase "$P/" && rm -rf "$P/firebase/functions/node_modules" "$P/firebase/functions/.env"* "$P/firebase/.firebaserc"
cp tools/plataforma-pin.js "$P/tools/"
cp demo/fotos-demo.json "$P/firebase/functions/lib/"
cp demo/catalogo-demo.json "$P/firebase/functions/lib/catalogo.json"  # carta de ejemplo (precios ficticios)
python3 tools/marca_demo.py "$P/firebase/functions/lib" >/dev/null
H="$P/firebase/hosting"; mkdir -p "$H"
OUT="$H/app" PLAN=PREMIUM EMBED_MODELOS=NO sh tools/build_demo.sh >/dev/null
python3 tools/marca_demo.py "$H/app" >/dev/null
cp -r public "$H/vivo" && rm -rf "$H/vivo/imagenes" "$H/vivo/modelos"; rm -f "$H/vivo/prueba.html" "$H/vivo/assets/prueba-staging.js" "$H/vivo/_redirects"
mkdir -p "$H/vivo/modelos" && cp demo/modelos/*.glb "$H/vivo/modelos/"
# Extensión Migrador e-Kuatia'i (Upgrade) para descargar desde la demo, con el dominio de la demo autorizado.
mkdir -p "$H/extension" && node tools/extension_local.js - https://mesapyae-demo.web.app --out "$T/migrador-ekuatiai" --zip "$H/extension/migrador-ekuatiai.zip" >/dev/null
cp extension/instalar-ekuatiai.html "$H/extension/instalar.html" && cp -r extension/guia "$H/extension/"  # guía de instalación (el aviso de la caja lleva acá)
cp extension/privacidad-ekuatiai.html "$H/extension/privacidad.html"  # política de privacidad de la extensión
printf "window.MESA_CONFIG = { apiUrl: '/api' };\n" > "$H/vivo/assets/config.js"
sed -i 's#"start_url": "/"#"start_url": "./"#; s#"scope": "/"#"scope": "./"#; s#"id": "/"#"id": "/vivo/"#' "$H/vivo/manifest.webmanifest"
python3 tools/marca_demo.py "$H/vivo" >/dev/null
{
  printf '<!doctype html>\n<html lang="es">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
  printf '<meta name="description" content="Probá Mesa Pya%se: pedidos por QR, cocina, cajas, menú 3D, reseñas y tarjeta de sellos.">\n<link rel="icon" href="app/assets/mesapyae-icono.png">\n' "'"
  sed -n '1,/<\/style>/p' demo/landing-planes.html
  printf '</head>\n<body>\n'
  sed -n '/<\/style>/,$p' demo/landing-planes.html | sed '1d'
  printf '</body>\n</html>\n'
} > "$H/index.html"
mkdir -p "$H/video" && cp demo/video/presentacion-mesa-pyae.mp4 demo/video/presentacion-mesa-pyae.jpg "$H/video/"
(cd "$T" && tar czf "$SAL" mesa-demo)
rm -rf "$T"
echo "Paquete: $SAL"
