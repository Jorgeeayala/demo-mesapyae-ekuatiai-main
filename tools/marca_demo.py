"""Aplica la marca ficticia "Café Demo" a una demo ya generada (para publicarla en sitios públicos).
Uso: python3 tools/marca_demo.py <carpeta-de-la-demo>"""
import os, re, sys, json, shutil
D = sys.argv[1]
REEMPLAZOS = [
    ('Dirección del local', 'Av. de los Ejemplos 1234 · Asunción'), ('Tu Local Gastronómico', 'Café Demo'),
    ("Mesa Pya'e · Tu Local", "Mesa Pya'e · Café Demo"), ('"short_name": "Tu Local"', '"short_name": "Café Demo"'),
    ('content="Tu Local"', 'content="Café Demo"'), ('alt="Tu Local"', 'alt="Café Demo"'),
    ('Para llevar (mostrador)', 'Para llevar (ventanilla)'), ('del mostrador', 'de la ventanilla'), ('en el mostrador', 'en la ventanilla'),
]
for raiz, _, archivos in os.walk(D):
    for f in archivos:
        if not f.endswith(('.html', '.js', '.webmanifest')) or f in ('catalogo.js', 'modelos-demo.js'): continue
        p = os.path.join(raiz, f); s = open(p, encoding='utf-8').read(); o = s
        for a, b in REEMPLAZOS: s = s.replace(a, b)
        if s != o: open(p, 'w', encoding='utf-8').write(s)
assets = os.path.join(D, 'assets')
if os.path.isdir(assets):
    shutil.copy('demo/logo-demo.png', os.path.join(assets, 'logo-local.png'))
    shutil.copy('demo/transparente.png', os.path.join(assets, 'hoja.png'))
quedan = []
for raiz, _, archivos in os.walk(D):
    for f in archivos:
        if f.endswith(('.html', '.js')) and f not in ('catalogo.js',):
            s = open(os.path.join(raiz, f), encoding='utf-8').read()
            for m in re.finditer(r'.{0,40}(Andrade|Tu Local|Dirección del local).{0,40}', s): quedan.append(f + ': ' + m.group(0))
print('Marca demo aplicada. Menciones restantes de Andrade o marcadores:', len(quedan))
for q in quedan[:20]: print('  ', q)
