"""E4 · Sitio único: arma UN sitio con todos los locales, cada uno en su carpeta (/<local>/menu, /<local>/caja…).
Uso: python3 tools/sitio_unico.py <salida> [local ...]
     Sin locales: todos los que tienen servidor (locales/<local>/local.json → sitio.api_url), menos "ejemplo".

Cada carpeta es una copia de public/ con la marca del local (tools/marca_local.py) y estos ajustes, solo en la copia
(las pantallas base y los sitios propios de cada local no cambian):
  - la API del local va por /<local>/api (una regla de _redirects por local hacia su servidor);
  - lo que el navegador guarda (sesión del personal, tarjeta del club, preferencias) lleva el nombre del local,
    así dos locales en el mismo celular no se mezclan;
  - la app instalable (manifest y service worker) queda dentro de /<local>/.
La raíz del sitio no lista clientes: redirige a la página de Mesa Pya'e (MESA_PORTADA, por defecto la demo pública).
Sale con código 1 si algún local falla (marca incompleta, datos inválidos)."""
import json, os, re, shutil, subprocess, sys, tempfile

RAIZ = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
SALIDA = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else sys.exit('Uso: python3 tools/sitio_unico.py <salida> [local ...]')
PORTADA = os.environ.get('MESA_PORTADA', 'https://mesapyae-demo.web.app')
PAGINAS = ['menu', 'cocina', 'pedidos', 'caja', 'admin', 'tarjeta', 'resena']
API = re.compile(r'^https://southamerica-east1-[a-z][a-z0-9-]{4,28}[a-z0-9]\.cloudfunctions\.net/api$')


def con_servidor():
    out = []
    for local in sorted(os.listdir(os.path.join(RAIZ, 'locales'))):
        f = os.path.join(RAIZ, 'locales', local, 'local.json')
        if local == 'ejemplo' or not os.path.isfile(f): continue
        if API.match(str((json.load(open(f, encoding='utf-8')).get('sitio') or {}).get('api_url') or '')): out.append(local)
    return out


def ajustar(carpeta, slug):
    """Cambios de la copia del local para vivir en /<slug>/ dentro del sitio único."""
    for raiz, _, archivos in os.walk(carpeta):
        for f in archivos:
            if not f.endswith(('.html', '.js', '.webmanifest')): continue
            p = os.path.join(raiz, f)
            s = open(p, encoding='utf-8').read(); o = s
            s = s.replace("'mesapyae.", "'mesapyae." + slug + ".")           # lo guardado en el navegador, por local
            s = s.replace("register('/sw.js')", "register('sw.js')")         # app instalable dentro de /<slug>/
            if f.endswith('.webmanifest'):
                s = re.sub(r'"(id|start_url|scope)": "/"', r'"\1": "./"', s)
                s = s.replace('"id": "/tarjeta.html"', '"id": "tarjeta.html"')
            if s != o: open(p, 'w', encoding='utf-8').write(s)
    cfg = os.path.join(carpeta, 'assets', 'config.js')
    s = open(cfg, encoding='utf-8').read()
    s2 = s.replace('"apiUrl": "/api"', '"apiUrl": "/' + slug + '/api"')
    if s2 == s: raise SystemExit('config.js de ' + slug + ' sin apiUrl esperado')
    open(cfg, 'w', encoding='utf-8').write(s2)
    r = os.path.join(carpeta, '_redirects')
    if os.path.exists(r): os.remove(r)  # las reglas van todas juntas en la raíz


def armar(locales):
    if os.path.exists(SALIDA): shutil.rmtree(SALIDA)
    os.makedirs(SALIDA)
    reglas, malos = [], []
    for slug in locales:
        if not re.match(r'^[a-z0-9-]{3,40}$', slug) or slug in ('assets', 'extension', 'api', 'app'):
            malos.append(slug + ' (nombre de carpeta no permitido)'); continue
        fj = os.path.join(RAIZ, 'locales', slug, 'local.json')
        if not os.path.isfile(fj): malos.append(slug + ' (no existe locales/' + slug + '/local.json)'); continue
        j = json.load(open(fj, encoding='utf-8'))
        api = str((j.get('sitio') or {}).get('api_url') or '')
        if not API.match(api): malos.append(slug + ' (sin servidor en sitio.api_url)'); continue
        tmp = os.path.join(tempfile.mkdtemp(), 'site')
        shutil.copytree(os.path.join(RAIZ, 'public'), tmp)
        r = subprocess.run(['python3', os.path.join(RAIZ, 'tools', 'marca_local.py'), tmp, slug], capture_output=True, text=True)
        if r.returncode != 0: malos.append(slug + ': ' + (r.stdout + r.stderr).strip()[-300:]); continue
        ajustar(tmp, slug)
        shutil.move(tmp, os.path.join(SALIDA, slug))
        reglas.append('/%s/api  %s  200!' % (slug, api))
        reglas.append('/%s  /%s/  301' % (slug, slug))
        reglas += ['/%s/%s  /%s/%s.html  200' % (slug, p, slug, p) for p in PAGINAS]
        print('  ✔ /%s/  →  %s' % (slug, api))
    reglas.append('/  %s  302' % PORTADA)
    with open(os.path.join(SALIDA, '_redirects'), 'w') as f: f.write('\n'.join(reglas) + '\n')
    with open(os.path.join(SALIDA, 'index.html'), 'w', encoding='utf-8') as f:
        f.write('<!doctype html><meta charset="utf-8"><title>Mesa Pya\'e</title><meta http-equiv="refresh" content="0;url=%s"><a href="%s">Mesa Pya\'e</a>\n' % (PORTADA, PORTADA))
    if malos:
        print('ERROR en %d local(es):' % len(malos))
        for m in malos: print('   ', m)
        sys.exit(1)
    print('Sitio único con %d local(es) en %s' % (len(locales), SALIDA))


if __name__ == '__main__':
    armar(sys.argv[2:] or con_servidor())
