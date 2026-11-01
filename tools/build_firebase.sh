#!/bin/sh
# Copia el núcleo, el adaptador Firestore y el catálogo dentro de firebase/functions/lib (lo que se publica).
# Con un local: sh tools/build_firebase.sh <local>  → usa locales/<local>/catalogo.json y local.json (ej. andrade).
# Sin argumento: la base neutra de Mesa Pya'e, sin carta (data/catalogo-base.json).
set -e
cd "$(dirname "$0")/.."
mkdir -p firebase/functions/lib
cp core/core.js core/carta-ia.js core/atencion-wa.js server/env-node.js firebase/firestore-backend.js firebase/functions/lib/
rm -f firebase/functions/lib/local.json
if [ -n "$1" ]; then
  D="locales/$1"
  [ -f "$D/local.json" ] || { echo "No existe $D/local.json"; exit 1; }
  node tools/validar_local.js "$1"
  cp "$D/catalogo.json" firebase/functions/lib/catalogo.json
  node -e "const l=require('./$D/local.json');const s={slug:l.slug,nombre:l.nombre,mesas:l.mesas,puntos:l.puntos,cajas:l.cajas,config:l.config||{}};process.stdout.write(JSON.stringify(s,null,2))" > firebase/functions/lib/local.json
  echo "firebase/functions/lib listo para el local $1"
else
  cp data/catalogo-base.json firebase/functions/lib/catalogo.json
  echo "firebase/functions/lib listo"
fi
