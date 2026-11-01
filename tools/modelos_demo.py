"""Genera modelos 3D de EJEMPLO (.glb) para la demo del Menú 3D, sin dependencias externas.
En producción cada local reemplaza estos archivos por escaneos reales de sus platos."""
import json, struct, math, os, sys
import numpy as np

OUT = sys.argv[1] if len(sys.argv) > 1 else 'demo/modelos'

def lathe(profile, segs=48):
    """Superficie de revolución alrededor del eje Y. profile: [(radio, altura)] de abajo hacia arriba."""
    pos, nor, idx = [], [], []
    n = len(profile)
    for i in range(segs + 1):
        a = 2 * math.pi * i / segs; c, s = math.cos(a), math.sin(a)
        for j, (r, y) in enumerate(profile):
            pos.append((r * c, y, r * s))
            # normal 2D del perfil (perpendicular al tramo), rotada
            r0, y0 = profile[max(j - 1, 0)]; r1, y1 = profile[min(j + 1, n - 1)]
            dr, dy = r1 - r0, y1 - y0; nr, ny = dy, -dr; L = math.hypot(nr, ny) or 1
            nor.append((nr / L * c, ny / L, nr / L * s))
    for i in range(segs):
        for j in range(n - 1):
            a = i * n + j; b = (i + 1) * n + j
            idx += [a, b, a + 1, a + 1, b, b + 1]
    return np.array(pos, 'f4'), np.array(nor, 'f4'), np.array(idx, 'u4')

def disco(r, y, segs=48, abajo=False):
    pos = [(0, y, 0)]; nor = [(0, -1 if abajo else 1, 0)]
    for i in range(segs + 1):
        a = 2 * math.pi * i / segs; pos.append((r * math.cos(a), y, r * math.sin(a))); nor.append(nor[0])
    idx = []
    for i in range(1, segs + 1): idx += ([0, i + 1, i] if not abajo else [0, i, i + 1])
    return np.array(pos, 'f4'), np.array(nor, 'f4'), np.array(idx, 'u4')

def disco_uv(r, y, cx, cy, rx, ry, segs=96):
    """Disco hacia arriba con la foto cenital del plato: el borde del disco cae en el borde del plato en la foto."""
    pos = [(0, y, 0)]; uv = [(cx, cy)]
    for i in range(segs + 1):
        a = 2 * math.pi * i / segs; c, s_ = math.cos(a), math.sin(a)
        pos.append((r * c, y, r * s_)); uv.append((cx + c * rx, cy + s_ * ry))
    idx = []
    for i in range(1, segs + 1): idx += [0, i + 1, i]
    return np.array(pos, 'f4'), np.array([(0, 1, 0)] * len(pos), 'f4'), np.array(idx, 'u4'), np.array(uv, 'f4')

def con_uv_plano(m, x0, x1, z0, z1):
    """Agrega UV proyectando desde arriba (x→u, z→v)."""
    p, n, i = m[:3]
    u = (p[:, 0] - x0) / (x1 - x0); v = (p[:, 2] - z0) / (z1 - z0)
    return p, n, i, np.stack([u, v], 1).astype('f4')

def caja(sx, sy, sz, cx=0, cy=0, cz=0, redondeo=0.0):
    pos, nor, idx, uvs = [], [], [], []
    caras = [((1, 0, 0), (0, 1, 0), (0, 0, 1)), ((-1, 0, 0), (0, 1, 0), (0, 0, -1)), ((0, 1, 0), (0, 0, 1), (1, 0, 0)),
             ((0, -1, 0), (0, 0, -1), (1, 0, 0)), ((0, 0, 1), (1, 0, 0), (0, 1, 0)), ((0, 0, -1), (-1, 0, 0), (0, 1, 0))]
    h = np.array([sx, sy, sz]) / 2
    for nrm, u, v in caras:
        nrm, u, v = map(np.array, (nrm, u, v)); base = len(pos)
        for du, dv in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            p = (nrm + u * du + v * dv) * h + (cx, cy, cz); pos.append(p); nor.append(nrm); uvs.append(((du + 1) / 2, (dv + 1) / 2))
        # orientación: u x v debe apuntar como la normal
        if np.dot(np.cross(u, v), nrm) > 0: idx += [base, base + 1, base + 2, base, base + 2, base + 3]
        else: idx += [base, base + 2, base + 1, base, base + 3, base + 2]
    return np.array(pos, 'f4'), np.array(nor, 'f4'), np.array(idx, 'u4'), np.array(uvs, 'f4')

def mover(m, dx=0, dy=0, dz=0, sy=1.0):
    p, n, i = m; p = p.copy(); p[:, 1] *= sy; p += (dx, dy, dz); return p, n, i

def unir(*ms):
    P, N, I, off = [], [], [], 0
    for m in ms:
        p, n, i = m[:3]; P.append(p); N.append(n); I.append(i + off); off += len(p)
    return np.concatenate(P), np.concatenate(N), np.concatenate(I)

def glb(nombre, partes):
    """partes: [(malla, (r,g,b), rugosidad)]"""
    blob = b''; views = []; accs = []; mats = []; prims = []
    def add(data, target):
        nonlocal blob
        while len(blob) % 4: blob += b'\0'
        views.append({'buffer': 0, 'byteOffset': len(blob), 'byteLength': len(data), 'target': target}); blob += data
        return len(views) - 1
    images = []; textures = []
    for k, parte in enumerate(partes):
        malla, color, rug = parte[0], parte[1], parte[2]
        uri = parte[3] if len(parte) > 3 else None
        p, n, i = malla[0], malla[1], malla[2]
        vp = add(p.tobytes(), 34962); vn = add(n.tobytes(), 34962); vi = add(i.tobytes(), 34963)
        attrs = {'POSITION': len(accs), 'NORMAL': len(accs) + 1}
        accs.append({'bufferView': vp, 'componentType': 5126, 'count': len(p), 'type': 'VEC3', 'min': p.min(0).tolist(), 'max': p.max(0).tolist()})
        accs.append({'bufferView': vn, 'componentType': 5126, 'count': len(n), 'type': 'VEC3'})
        ind = len(accs); accs.append({'bufferView': vi, 'componentType': 5125, 'count': len(i), 'type': 'SCALAR'})
        pbr = {'baseColorFactor': list(color) + [1.0], 'metallicFactor': 0.0, 'roughnessFactor': rug}
        if uri and len(malla) > 3:
            vt = add(malla[3].tobytes(), 34962)
            attrs['TEXCOORD_0'] = len(accs); accs.append({'bufferView': vt, 'componentType': 5126, 'count': len(malla[3]), 'type': 'VEC2'})
            images.append({'uri': uri}); textures.append({'source': len(images) - 1, 'sampler': 0})
            pbr['baseColorTexture'] = {'index': len(textures) - 1}
        mats.append({'name': 'm%d' % k, 'pbrMetallicRoughness': pbr, 'doubleSided': True})
        prims.append({'attributes': attrs, 'indices': ind, 'material': k})
    gl = {'asset': {'version': '2.0', 'generator': 'Mesa Pyae modelos de ejemplo'}, 'scene': 0, 'scenes': [{'nodes': [0]}],
          'nodes': [{'mesh': 0, 'name': nombre}], 'meshes': [{'primitives': prims, 'name': nombre}], 'materials': mats, 'accessors': accs,
          'bufferViews': views, 'buffers': [{'byteLength': len(blob)}]}
    if images:
        gl['images'] = images; gl['textures'] = textures; gl['samplers'] = [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 33071, 'wrapT': 33071}]
    js = json.dumps(gl, separators=(',', ':')).encode()
    while len(js) % 4: js += b' '
    while len(blob) % 4: blob += b'\0'
    total = 12 + 8 + len(js) + 8 + len(blob)
    data = struct.pack('<III', 0x46546C67, 2, total) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(blob), 0x004E4942) + blob
    os.makedirs(OUT, exist_ok=True)
    open(os.path.join(OUT, nombre + '.glb'), 'wb').write(data)
    print(nombre, len(data), 'bytes')

def col(h): return tuple(int(h[i:i + 2], 16) / 255 for i in (1, 3, 5))

# Espresso: plato, taza con asa y café con crema (unidades en metros, tamaño real)
plato = lathe([(0.0, 0.0), (0.06, 0.0), (0.072, 0.008), (0.075, 0.012), (0.07, 0.013), (0.03, 0.006), (0.0, 0.006)])
taza = lathe([(0.0, 0.006), (0.022, 0.006), (0.028, 0.012), (0.034, 0.035), (0.036, 0.062), (0.033, 0.062), (0.031, 0.036), (0.025, 0.014), (0.0, 0.014)])
CREMA = 'https://images.unsplash.com/photo-1615486780246-76e6bb33e8b5?auto=format&fit=crop&w=1024&h=1024&q=80'  # foto cenital de café con crema
cafe = disco_uv(0.0318, 0.055, 0.503, 0.495, 0.235, 0.235)
asa = []
for t in range(0, 13):
    a = -math.pi / 2 + math.pi * t / 12
    asa.append(caja(0.006, 0.006, 0.006, 0.036 + 0.014 * math.cos(a), 0.036 + 0.013 * math.sin(a), 0))
glb('espresso', [(plato, col('#F7F2E8'), 0.35), (taza, col('#FBF8F2'), 0.3), (unir(*asa), col('#FBF8F2'), 0.3), (cafe, (1, 1, 1), 0.35, CREMA)])

# Pizza personal: masa, salsa, queso y rodajas de pepperoni
PIZZA = 'https://images.unsplash.com/photo-1604382354936-07c5d9983bd3?auto=format&fit=crop&w=1024&h=1024&q=80'  # foto cenital de una pizza real
# Masa: base y canto dorado; arriba, la foto real de la pizza (borde de la foto = borde de la masa)
masa = lathe([(0.0, 0.0), (0.118, 0.0), (0.125, 0.006), (0.126, 0.013), (0.124, 0.016)], 96)
fondo = disco(0.118, 0.0, 96, abajo=True)
cara = disco_uv(0.124, 0.016, 0.527, 0.526, 0.362, 0.348)
glb('pizza', [(masa, col('#C98B4A'), 0.85), (fondo, col('#B97A3C'), 0.9), (cara, (1, 1, 1), 0.7, PIZZA)])

# Panini: dos panes, relleno y marcas de plancha
pan_inf = caja(0.16, 0.022, 0.09, 0, 0.011, 0); relleno = caja(0.15, 0.014, 0.085, 0, 0.029, 0)
lechuga = caja(0.155, 0.004, 0.092, 0, 0.038, 0); pan_sup = caja(0.16, 0.024, 0.09, 0, 0.052, 0)
marcas = unir(*[caja(0.005, 0.0015, 0.088, x, 0.0643, 0)[:3] for x in (-0.06, -0.03, 0.0, 0.03, 0.06)])
PAN = 'https://images.unsplash.com/photo-1612136435731-ad3e522eac01?auto=format&fit=crop&w=1024&h=1024&q=80'  # textura real de pan tostado
glb('panini', [(pan_inf, (1, 1, 1), 0.85, PAN), (relleno, col('#E9D8C2'), 0.6), (lechuga, col('#6E9E3F'), 0.6), (pan_sup, (1, 1, 1), 0.85, PAN), (marcas, col('#2E1A0C'), 0.95)])
