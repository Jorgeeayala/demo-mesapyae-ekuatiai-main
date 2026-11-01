#!/bin/sh
# Genera los archivos del proyecto Apps Script a partir del núcleo y el catálogo.
set -e
cd "$(dirname "$0")/.."
cp core/core.js alternativas/apps-script/gas/Core.js
printf '/* Generado por tools/build_gas.sh desde locales/andrade/catalogo.json — no editar a mano. */\nvar CATALOGO_ANDRADE = ' > alternativas/apps-script/gas/Catalogo.js
cat locales/andrade/catalogo.json >> alternativas/apps-script/gas/Catalogo.js
printf ';\n' >> alternativas/apps-script/gas/Catalogo.js
echo "alternativas/apps-script/gas/ listo: Core.js, Catalogo.js, Code.js, appsscript.json"
