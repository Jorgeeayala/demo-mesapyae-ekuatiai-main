"""Arma un modelo 3D (.glb) de un sándwich/pan alargado a partir de UNA foto lateral del plato.
Sirve para mostrarle a un local cómo se vería su plato en el Menú 3D antes de escanearlo.
(El resultado final ideal es un escaneo 3D real; esto es una vista previa.)

Uso: python3 tools/modelo_desde_foto.py foto.jpg salida.glb --caja x0,y0,x1,y1 --techo "x:y,x:y,..." [--largo 0.23] [--ancho 0.09]
  --caja   recorte del sándwich en la foto (píxeles), de punta a punta y de arriba (pan) a abajo (base)
  --techo  puntos del borde superior del pan en la foto (píxeles), de izquierda a derecha
"""
import argparse, io, json, math, struct
import numpy as np
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument('foto'); ap.add_argument('salida')
ap.add_argument('--caja', required=True); ap.add_argument('--techo', required=True)
ap.add_argument('--tapa', help='recorte x0,y0,x1,y1 de una zona de pan limpia para la tapa (opcional)')
ap.add_argument('--piso', help='puntos x:y del borde inferior del pan (opcional; si no, recto)')
ap.add_argument('--largo', type=float, default=0.23); ap.add_argument('--ancho', type=float, default=0.09)
a = ap.parse_args()
x0, y0, x1, y1 = [int(v) for v in a.caja.split(',')]
techo = sorted((float(p.split(':')[0]), float(p.split(':')[1])) for p in a.techo.split(','))
im = Image.open(a.foto).convert('RGB')
s = a.largo / (x1 - x0)                      # metros por píxel
A, B = a.largo / 2, a.ancho / 2
H = (y1 - min(y for _, y in techo)) * s      # alto máximo

def top_px(px): return float(np.interp(px, [p for p, _ in techo], [y for _, y in techo]))
piso = sorted((float(p.split(':')[0]), float(p.split(':')[1])) for p in a.piso.split(',')) if a.piso else [(x0, y1), (x1, y1)]
def bajo(x):  # altura del borde inferior (metros) — sube en las puntas como en la foto
    px = x0 + (x / A + 1) / 2 * (x1 - x0)
    return max(0.0, (y1 - float(np.interp(px, [p for p, _ in piso], [y for _, y in piso]))) * s)
def alto(x):  # alto del borde superior en la posición x (metros)
    px = x0 + (x / A + 1) / 2 * (x1 - x0)
    return max(0.01, (y1 - top_px(px)) * s)

# Textura: arriba el costado (foto), abajo una franja de la superficie del pan
lado = im.crop((x0, y0, x1, y1)).resize((1024, 640), Image.LANCZOS)
ty = int(min(y for _, y in techo))
tc = [int(v) for v in a.tapa.split(',')] if a.tapa else [x0 + int(0.3 * (x1 - x0)), ty + int(0.2 * (y1 - y0)), x1 - int(0.3 * (x1 - x0)), ty + int(0.35 * (y1 - y0))]
pan = im.crop(tuple(tc)); tapa = Image.new('RGB', (1024, 384))
pw = 1024 // 2  # la zona de pan se repite en espejo para cubrir la tapa sin costuras
pz = pan.resize((pw, 384), Image.LANCZOS)
tapa.paste(pz, (0, 0)); tapa.paste(pz.transpose(Image.FLIP_LEFT_RIGHT), (pw, 0))
atlas = Image.new('RGB', (1024, 1024)); atlas.paste(lado, (0, 0)); atlas.paste(tapa, (0, 640))
buf = io.BytesIO(); atlas.save(buf, 'JPEG', quality=86); jpg = buf.getvalue()
V_LADO = 640 / 1024

N, n_exp = 120, 4.0
def borde(t):  # superelipse: punto del contorno en planta
    c, s_ = math.cos(t), math.sin(t)
    return A * math.copysign(abs(c) ** (2 / n_exp), c), B * math.copysign(abs(s_) ** (2 / n_exp), s_)
ring = [borde(2 * math.pi * i / N) for i in range(N + 1)]

pos, nor, uv, idx = [], [], [], []
def tri(i0, i1, i2): idx.extend([i0, i1, i2])
# Costado: de la base (y=0) al borde superior alto(x); u = posición a lo largo, v = altura en la foto
FIL = 12
for i, (x, z) in enumerate(ring):
    h = alto(x); h0 = bajo(x); ex, ez = x / A, z / B; L = math.hypot(ex, ez) or 1
    for j in range(FIL + 1):
        y = h0 + (h - h0) * j / FIL
        pos.append((x, y, z)); nor.append((ex / L, 0, ez / L))
        px_y = y1 - y / s
        uv.append(((x / A + 1) / 2, (px_y - y0) / (y1 - y0) * V_LADO))
for i in range(N):
    for j in range(FIL):
        a0 = i * (FIL + 1) + j; b0 = (i + 1) * (FIL + 1) + j
        tri(a0, a0 + 1, b0); tri(b0, a0 + 1, b0 + 1)
# Tapa: domo suave sobre el contorno, textura de superficie del pan
base = len(pos); G = 24
for i, (x, z) in enumerate(ring):
    for k in range(G + 1):
        f = k / G  # 0 = borde, 1 = centro
        xx = x * (1 - f * 0.0); zz = z * (1 - f)
        h = alto(xx) + 0.010 * (1 - (1 - f) ** 2)
        pos.append((xx, h, zz)); nor.append((0, 1, 0))
        uv.append(((xx / A + 1) / 2, V_LADO + (zz / B + 1) / 2 * (1 - V_LADO)))
for i in range(N):
    for k in range(G):
        a0 = base + i * (G + 1) + k; b0 = base + (i + 1) * (G + 1) + k
        tri(a0, b0, a0 + 1); tri(b0, b0 + 1, a0 + 1)
P = np.array(pos, 'f4'); Nn = np.array(nor, 'f4'); UV = np.array(uv, 'f4'); I = np.array(idx, 'u4')
# normales suaves de la tapa
# Base: disco plano color pan
bp = [(0, 0.0005, 0)] + [(x, bajo(x) + 0.0005, z) for x, z in ring]
bi = []
for i in range(1, N + 1): bi += [0, i, i + 1]
BP = np.array(bp, 'f4'); BN = np.array([(0, -1, 0)] * len(bp), 'f4'); BI = np.array(bi, 'u4')

blob = b''; views = []
def add(data, target=None):
    global blob
    while len(blob) % 4: blob += b'\0'
    v = {'buffer': 0, 'byteOffset': len(blob), 'byteLength': len(data)}
    if target: v['target'] = target
    views.append(v); blob += data; return len(views) - 1
acc = []
def accessor(arr, typ, target):
    v = add(arr.tobytes(), target); d = {'bufferView': v, 'componentType': 5125 if arr.dtype == np.uint32 else 5126, 'count': len(arr), 'type': typ}
    if typ == 'VEC3' and target == 34962: d['min'] = arr.min(0).tolist(); d['max'] = arr.max(0).tolist()
    acc.append(d); return len(acc) - 1
p0 = accessor(P, 'VEC3', 34962); n0 = accessor(Nn, 'VEC3', 34962); t0 = accessor(UV, 'VEC2', 34962); i0 = accessor(I, 'SCALAR', 34963)
p1 = accessor(BP, 'VEC3', 34962); n1 = accessor(BN, 'VEC3', 34962); i1 = accessor(BI, 'SCALAR', 34963)
img = add(jpg)
gl = {'asset': {'version': '2.0', 'generator': 'Mesa Pyae modelo desde foto'}, 'scene': 0, 'scenes': [{'nodes': [0]}],
      'nodes': [{'mesh': 0, 'name': 'plato'}],
      'meshes': [{'primitives': [{'attributes': {'POSITION': p0, 'NORMAL': n0, 'TEXCOORD_0': t0}, 'indices': i0, 'material': 0},
                                 {'attributes': {'POSITION': p1, 'NORMAL': n1}, 'indices': i1, 'material': 1}]}],
      'materials': [{'pbrMetallicRoughness': {'baseColorTexture': {'index': 0}, 'metallicFactor': 0, 'roughnessFactor': 0.8}, 'doubleSided': True},
                    {'pbrMetallicRoughness': {'baseColorFactor': [0.85, 0.72, 0.5, 1], 'metallicFactor': 0, 'roughnessFactor': 0.9}}],
      'images': [{'bufferView': img, 'mimeType': 'image/jpeg'}], 'textures': [{'source': 0, 'sampler': 0}],
      'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 33071, 'wrapT': 33071}],
      'accessors': acc, 'bufferViews': views, 'buffers': [{'byteLength': len(blob)}]}
js = json.dumps(gl, separators=(',', ':')).encode()
while len(js) % 4: js += b' '
while len(blob) % 4: blob += b'\0'
out = struct.pack('<III', 0x46546C67, 2, 28 + len(js) + len(blob)) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(blob), 0x004E4942) + blob
open(a.salida, 'wb').write(out)
atlas.save(a.salida.replace('.glb', '-textura.jpg'), quality=86)
print(a.salida, len(out), 'bytes', 'alto %.3f m' % H)
