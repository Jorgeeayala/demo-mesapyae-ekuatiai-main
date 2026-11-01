"""Aplica la marca y los datos de un local de la matriz a una copia de las pantallas base (public/).
Uso: python3 tools/marca_local.py <carpeta-del-sitio> <local>

Lo usa el build de Netlify (tools/netlify_build.sh con MESA_LOCAL=<local>): cada local tiene su propio sitio
de Netlify conectado al mismo repositorio, y este paso cambia nombre, logo, íconos, colores, dirección, puntos,
cajas, conexión con su servidor y suma los archivos propios del local (locales/<local>/extra/).

public/ es la base neutra de Mesa Pya'e: usa textos marcadores ("Tu Local Gastronómico", "Dirección del local",
"Salón principal", "Para llevar"…) que este paso reemplaza. Sale con código 1 si queda algún marcador
o, en un local que no es Andrade, alguna mención de Andrade."""
import json, os, re, shutil, sys

RAIZ = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
SITIO, SLUG = sys.argv[1], sys.argv[2]
DL = os.path.join(RAIZ, 'locales', SLUG)
L = json.load(open(os.path.join(DL, 'local.json'), encoding='utf-8'))

def limpio(s):  # los textos van dentro de comillas simples de JavaScript: sin ' ni caracteres peligrosos
    return re.sub(r'[<>"\\`]', '', str(s or '')).replace("'", '’').strip()

NOMBRE, CORTO, DIRECCION = limpio(L['nombre']), limpio(L['nombre_corto']), limpio(L['direccion'])
S = (L.get('puntos') or {}).get('salon') or {}
T = (L.get('puntos') or {}).get('para_llevar') or {}
CON_TK = T.get('activo', True) is not False
C = L.get('cajas') or {}
S_NOM, S_CORTO = limpio(S.get('nombre') or 'Salón principal'), limpio(S.get('corto') or 'Salón')
T_NOM, T_CORTO, T_LUGAR = limpio(T.get('nombre') or 'Para llevar'), limpio(T.get('corto') or 'Para llevar'), limpio(T.get('lugar') or 'el mostrador')
CA, CB = limpio(C.get('A') or 'Caja 01 — Salón'), limpio(C.get('B') or 'Caja 02 — Para llevar')
de_lugar = ('del ' + T_LUGAR[3:]) if T_LUGAR.startswith('el ') else ('de ' + T_LUGAR)

# (marcador de la base, texto del local). Van de lo más largo a lo más corto.
REEMPLAZOS = [
    ('Dirección del local', DIRECCION),
    ('Tu Local Gastronómico', NOMBRE),
    ("Mesa Pya'e · Tu Local", "Mesa Pya'e · " + CORTO),
    ('"short_name": "Tu Local"', '"short_name": "' + CORTO + '"'),
    ('content="Tu Local"', 'content="' + CORTO + '"'),
    ('alt="Tu Local"', 'alt="' + CORTO + '"'),
    # Puntos y cajas
    ('Para llevar: ventas', T_NOM + ': ventas'),
    ('Salón principal: cobros', S_NOM + ': cobros'),
    ('Salón principal (Caja 01)', S_NOM + ' (Caja 01)'),
    ('> Para llevar (Caja 02)', '> ' + T_CORTO + ' (Caja 02)'),
    ('<strong>Para llevar (mostrador)</strong>', '<strong>' + T_NOM + '</strong>'),
    ('Caja 01 — Salón', CA),
    ('Caja 02 — Para llevar', CB),
    ('Caja 01 · Salón', CA.replace(' — ', ' · ')),
    ('Caja 02 · Para llevar', CB.replace(' — ', ' · ')),
    ("'Salón': r.pedidos", "'" + S_CORTO + "': r.pedidos"),
    ("'Para llevar': r.pedidos", "'" + T_CORTO + "': r.pedidos"),
    (".replace('A_CAFE', 'Salón').replace('B_TAKEAWAY', 'Para llevar')", ".replace('A_CAFE', '" + S_CORTO + "').replace('B_TAKEAWAY', '" + T_CORTO + "')"),
    ("['A_CAFE', 'Salón'], ['B_TAKEAWAY', 'Para llevar']", "['A_CAFE', '" + S_CORTO + "'], ['B_TAKEAWAY', '" + T_CORTO + "']"),
    # Lugar de retiro del para llevar
    ('del mostrador', de_lugar),
    ('en el mostrador', 'en ' + T_LUGAR),
]
MARCADORES = ['Tu Local', 'Dirección del local']

usados = set()
for raiz, _, archivos in os.walk(SITIO):
    for f in archivos:
        if not f.endswith(('.html', '.js', '.webmanifest', '.css')): continue
        p = os.path.join(raiz, f)
        s = open(p, encoding='utf-8').read(); o = s
        for a, b in REEMPLAZOS:
            if a in s: usados.add(a); s = s.replace(a, b)
        if s != o: open(p, 'w', encoding='utf-8').write(s)

A = os.path.join(SITIO, 'assets')
# Logo, íconos y adorno del local (sin íconos propios quedan los de Mesa Pya'e)
shutil.copy(os.path.join(DL, 'logo.png'), os.path.join(A, 'logo-local.png'))
for f in ('icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'hoja.png'):
    origen = os.path.join(DL, f)
    if os.path.exists(origen): shutil.copy(origen, os.path.join(A, f))

# Colores: principal reemplaza los tonos de marca; secundario, el acento.
def oscurecer(h, f=0.75):
    r, g, b = (int(h[i:i + 2], 16) for i in (1, 3, 5))
    return '#%02X%02X%02X' % (int(r * f), int(g * f), int(b * f))
col = L.get('colores') or {}
css = os.path.join(A, 'app.css')
s = open(css, encoding='utf-8').read()
if col.get('principal'):
    osc = col.get('principal_oscuro') or oscurecer(col['principal'])
    s = re.sub(r'--tierra: #[0-9A-Fa-f]{6};', '--tierra: ' + col['principal'] + ';', s, count=1)
    s = re.sub(r'--tierra-osc: #[0-9A-Fa-f]{6};', '--tierra-osc: ' + osc + ';', s, count=1)
    for m in ('tarjeta.webmanifest',):  # la tarjeta del cliente usa el color de marca en la barra del celular
        p = os.path.join(SITIO, m)
        if os.path.exists(p):
            t = re.sub(r'"theme_color": "#[0-9A-Fa-f]{6}"', '"theme_color": "' + osc + '"', open(p, encoding='utf-8').read())
            open(p, 'w', encoding='utf-8').write(t)
if col.get('secundario'):
    s = re.sub(r'--arcilla: #[0-9A-Fa-f]{6};', '--arcilla: ' + col['secundario'] + ';', s, count=1)
open(css, 'w', encoding='utf-8').write(s)

# Conexión con el servidor del local y datos para las pantallas
sitio = L.get('sitio') or {}
fb = sitio.get('firebase') or {}
cfg = {'apiUrl': '/api', 'firebase': {
    'apiKey': fb.get('apiKey', ''), 'authDomain': (fb['projectId'] + '.firebaseapp.com') if fb.get('projectId') else '',
    'projectId': fb.get('projectId', ''), 'appId': fb.get('appId', '')}}
local_js = {'slug': SLUG, 'nombre': NOMBRE, 'corto': CORTO, 'sinTakeaway': not CON_TK}
with open(os.path.join(A, 'config.js'), 'w', encoding='utf-8') as f:
    # Dirección directa del servidor (pública, la misma de _redirects): la usa la carta con IA, que tarda más
    # que los 26 s que Netlify espera en un proxy.
    if sitio.get('api_url'): cfg['apiDirecta'] = sitio['api_url']
    f.write('/* Generado por tools/marca_local.py para el local "' + SLUG + '". No editar a mano. */\n')
    f.write('window.MESA_CONFIG = ' + json.dumps(cfg, ensure_ascii=False) + ';\n')
    f.write('window.MESA_LOCAL = ' + json.dumps(local_js, ensure_ascii=False) + ';\n')
if sitio.get('api_url'):
    with open(os.path.join(SITIO, '_redirects'), 'w') as f: f.write('/api  %s  200!\n' % sitio['api_url'])

# Archivos propios del local (ej. la página de prueba de Andrade)
extra = os.path.join(DL, 'extra')
if os.path.isdir(extra):
    shutil.copytree(extra, SITIO, dirs_exist_ok=True)

faltan = [a for a, _ in REEMPLAZOS if a not in usados]
quedan = []
patron = r'.{0,40}(' + '|'.join(re.escape(m) for m in MARCADORES) + ('' if SLUG == 'andrade' else '|Andrade|casita') + r').{0,40}'
for raiz, _, archivos in os.walk(SITIO):
    for f in archivos:
        if f.endswith(('.html', '.js', '.webmanifest')):
            t = open(os.path.join(raiz, f), encoding='utf-8').read()
            for m in re.finditer(patron, t): quedan.append(f + ': ' + m.group(0).strip())
print('Marca de "%s" aplicada en %s.' % (NOMBRE, SITIO))
if faltan: print('  aviso: marcadores que ya no están en las pantallas (revisar esta tabla):', faltan)
if quedan:
    print('ERROR: quedan %d textos sin reemplazar:' % len(quedan))
    for q in quedan[:30]: print('   ', q)
    sys.exit(1)
