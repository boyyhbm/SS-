"""Original tileable, clean workshop-floor PBR set; no external source images."""
from PIL import Image, ImageDraw
import math
import os
import json
import hashlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public/game-assets/forge/foundry')
os.makedirs(OUT, exist_ok=True)
resources = []
for size in (256, 512, 1024):
    color = Image.new('RGB', (size, size))
    normal = Image.new('RGB', (size, size))
    rough = Image.new('L', (size, size))
    c, n, r = color.load(), normal.load(), rough.load()
    for y in range(size):
        for x in range(size):
            u, v = x / size * math.tau, y / size * math.tau
            grain = math.sin(u * 83) * math.sin(v * 77) + .4 * math.cos(u * 53 + v * 61)
            value = round(177 + grain * 2)
            c[x, y] = (value, value + 2, value)
            n[x, y] = (round(128 + math.cos(u * 83) * math.sin(v * 77) * 4), round(128 + math.sin(u * 83) * math.cos(v * 77) * 4), 255)
            r[x, y] = round(223 + grain * 3)
    draw = ImageDraw.Draw(color)
    for p in range(0, size, size // 2):
        draw.line((p, 0, p, size), fill=(131, 139, 142), width=max(1, size // 400))
        draw.line((0, p, size, p), fill=(131, 139, 142), width=max(1, size // 400))
    for p in (size // 32, size // 2 + size // 32):
        for q in (size // 32, size // 2 + size // 32):
            radius = max(1, size // 240)
            draw.ellipse((p-radius, q-radius, p+radius, q+radius), fill=(116, 126, 130))
    for kind, image in [('color', color), ('normal', normal), ('roughness', rough)]:
        filename = f'floor-{kind}-{size}.png'
        path = os.path.join(OUT, filename)
        image.save(path, optimize=True)
        data = open(path, 'rb').read()
        resources.append({'file': '/game-assets/forge/foundry/' + filename, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
manifest = {'author': 'NEXUS project', 'source': 'scripts/build-foundry-textures.py', 'license': 'Original project textures; commercial use permitted by the project owner', 'commercialUsePermitted': True, 'colorSpace': {'color': 'sRGB', 'normal': 'linear', 'roughness': 'linear'}, 'resources': resources}
with open(os.path.join(OUT, 'textures.json'), 'w') as f:
    json.dump(manifest, f, indent=2)
    f.write('\n')
