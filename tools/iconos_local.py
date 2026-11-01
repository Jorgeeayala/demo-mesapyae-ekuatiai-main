"""Genera los íconos de la app (pantalla de inicio del celular) a partir del logo del local.
Uso: python3 tools/iconos_local.py <local>
Lee locales/<local>/logo.png y crea icon-192.png, icon-512.png y apple-touch-icon.png
(logo centrado sobre el fondo crema de Mesa Pya'e, con margen para el recorte redondo de Android)."""
import json, os, sys
from PIL import Image

slug = sys.argv[1]
D = os.path.join(os.path.dirname(__file__), '..', 'locales', slug)
local = json.load(open(os.path.join(D, 'local.json'), encoding='utf-8'))
fondo = (local.get('colores') or {}).get('fondo_icono', '#F3EDE1')
logo = Image.open(os.path.join(D, 'logo.png')).convert('RGBA')
bbox = logo.getbbox()
if bbox: logo = logo.crop(bbox)
for nombre, lado in (('icon-192.png', 192), ('icon-512.png', 512), ('apple-touch-icon.png', 180)):
    lienzo = Image.new('RGBA', (lado, lado), fondo)
    util = int(lado * 0.70)  # zona segura de los íconos "maskable"
    l = logo.copy(); l.thumbnail((util, util), Image.LANCZOS)
    lienzo.alpha_composite(l, ((lado - l.width) // 2, (lado - l.height) // 2))
    lienzo.convert('RGB').save(os.path.join(D, nombre), optimize=True)
    print('  ' + nombre)
print('Íconos generados en locales/' + slug)
