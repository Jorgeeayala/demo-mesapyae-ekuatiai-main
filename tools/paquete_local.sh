#!/bin/sh
# Arma el paquete para publicar el servidor de un local (Firebase) desde Cloud Shell, sin sitio web (las pantallas van por Netlify).
# Uso: sh tools/paquete_local.sh <salida.tgz> [local]
#   [local]: carpeta de locales/ (local nuevo de la matriz). Sin él: Andrade, como siempre.
# En Cloud Shell:  tar xzf <archivo> && cd mesa-local && sh firebase/desplegar.sh <id-del-proyecto>
set -e
cd "$(dirname "$0")/.."
SAL="${1:-mesa-local.tgz}"; case "$SAL" in /*) ;; *) SAL="$(pwd)/$SAL";; esac
T=$(mktemp -d); P="$T/mesa-local"; mkdir -p "$P/tools"
sh tools/build_firebase.sh $2 >/dev/null
cp -r firebase "$P/" && rm -rf "$P/firebase/functions/node_modules" "$P/firebase/functions/.env"* "$P/firebase/.firebaserc" "$P/firebase/hosting"
cp tools/plataforma-pin.js "$P/tools/"
(cd "$P/firebase/functions" && find . -type f -not -path './node_modules/*' | sort | xargs md5sum > ../MD5SUMS)
(cd "$T" && tar czf "$SAL" mesa-local)
rm -rf "$T"
# Deja firebase/functions/lib como estaba (Andrade), para no mezclar el catálogo de otro local en el repositorio.
[ -n "$2" ] && sh tools/build_firebase.sh >/dev/null
echo "Paquete: $SAL"
