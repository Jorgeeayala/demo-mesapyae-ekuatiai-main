#!/bin/sh
# Genera dist-demo/: las mismas páginas, con el núcleo corriendo en el navegador (sin backend).
set -e
cd "$(dirname "$0")/.."
OUT="${OUT:-dist-demo}"
MODS="${MODULOS:-}"
rm -rf "$OUT" && cp -r public "$OUT" && rm -rf "$OUT/imagenes" "$OUT/modelos" && cp demo/demo-backend.js "$OUT/assets/"  # imagenes/: fotos propias del local, no van a la demo
cp core/core.js "$OUT/assets/core.js"
cp core/carta-ia.js "$OUT/assets/carta-ia.js"
cp core/atencion-wa.js "$OUT/assets/atencion-wa.js"
mkdir -p "$OUT/modelos" && cp demo/modelos/*.glb "$OUT/modelos/"  # modelos 3D de ejemplo (solo demo)
# Los mismos modelos embebidos (para visores que no sirven archivos .glb). EMBED_MODELOS=NO en sitios web reales.
[ "${EMBED_MODELOS:-SI}" = "NO" ] || python3 - "$OUT" <<'PY'
import base64, glob, os, sys, json
out = sys.argv[1]; m = {}
for f in sorted(glob.glob('demo/modelos/*.glb')):
    m['modelos/' + os.path.basename(f)] = base64.b64encode(open(f, 'rb').read()).decode()
open(os.path.join(out, 'assets', 'modelos-demo.js'), 'w').write('window.MODELOS_DEMO = ' + json.dumps(m) + ';\n')
PY
python3 - "$OUT" <<'PY'
import json, os, sys
m = json.load(open('demo/fotos-demo.json'))
u = {k: 'https://images.unsplash.com/' + v + '?auto=format&fit=crop&w=720&q=70' for k, v in m.items() if not k.startswith('_')}
open(os.path.join(sys.argv[1], 'assets', 'fotos-demo.js'), 'w').write('window.FOTOS_DEMO = ' + json.dumps(u) + ';\n')
PY
printf 'var CATALOGO_DEMO = ' > "$OUT/assets/catalogo.js" && cat demo/catalogo-demo.json >> "$OUT/assets/catalogo.js" && printf ';\n' >> "$OUT/assets/catalogo.js"
MODJS=$(printf '%s' "$MODS" | awk -F, '{for(i=1;i<=NF;i++){printf "%s\"%s\"", (i>1?",":""), $i}}')
printf "window.MESA_CONFIG = { apiUrl: '/api', demo: true, plan: '%s', modulos: [%s] };\n" "${PLAN:-}" "$MODJS" > "$OUT/assets/config.js"
for f in "$OUT"/*.html; do
  sed -i 's#<script src="assets/config.js"></script>#<script src="assets/config.js"></script>\n<script src="assets/core.js"></script>\n<script src="assets/carta-ia.js"></script>\n<script src="assets/atencion-wa.js"></script>\n<script src="assets/catalogo.js"></script>\n<script src="assets/fotos-demo.js"></script>\n<script src="assets/demo-backend.js"></script>\n<script src="assets/modelos-demo.js"></script>#' "$f"
  if [ "${EMBED_MODELOS:-SI}" = "NO" ]; then sed -i "/modelos-demo.js/d" "$f"; fi
done
rm -f "$OUT/manifest.webmanifest" "$OUT/tarjeta.webmanifest" "$OUT/prueba.html" "$OUT/assets/prueba-staging.js"
sed -i '/webmanifest/d' "$OUT"/*.html
echo "$OUT/ listo"
