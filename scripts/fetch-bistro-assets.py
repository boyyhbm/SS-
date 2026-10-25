"""Offline art conversion, not needed to install or run NEXUS. Only CC BY geometry/materials; no audio."""
import concurrent.futures, hashlib, io, json, pathlib, re, urllib.parse, urllib.request
from PIL import Image
ROOT = pathlib.Path('.asset-cache/bistro')
BASE = 'https://raw.githubusercontent.com/Jamsers/Bistro-Demo-Tweaked/main/'
MODELS = {'S1B1': 'Section01', 'S1B2': 'Section01', 'S2B1': 'Section02', 'BistroProps': 'Section02', 'S5B1': 'Section05', 'S3B1': 'Section03', 'S1Details': 'Section01'}
ROOT.mkdir(parents=True, exist_ok=True)
evidence = {}
manifest_path = pathlib.Path('public/game-assets/manifest.json')
reviewed = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
pinned = {f['path']: f['sha256'] for source in reviewed.get('sources', [])
          if source.get('key') == 'district' for f in source.get('files', [])}
def download(path):
    target = ROOT / 'files' / path
    if not target.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(urllib.request.urlopen(BASE + urllib.parse.quote(path), timeout=90).read())
    data = target.read_bytes()
    if path in pinned and hashlib.sha256(data).hexdigest() != pinned[path]:
        raise ValueError(f'Reviewed Bistro source changed: {path}; inspect content and license before updating the manifest.')
    evidence[path] = {'path': path, 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}
    return data
def text(path): return download(path).decode()
models, materials = {}, {}
for name, section in MODELS.items():
    download(f'Meshes/{section}/{name}.glb')
    source = text(f'Scenes/{section}/{name}.tscn')
    refs = dict((identifier, path) for path, identifier in re.findall(r'\[ext_resource[^\n]*path="res://([^\"]+)"[^\n]*id="([^\"]+)"', source))
    assigned = {}
    for block in re.split(r'\n(?=\[node )', source):
        node = re.search(r'\[node name="([^\"]+)"', block)
        material = re.search(r'surface_material_override/0 = ExtResource\("([^\"]+)"\)', block)
        if node and material: assigned[node.group(1)] = refs[material.group(1)]
    models[name] = {'source': f'Meshes/{section}/{name}.glb', 'materials': assigned}
    for path in set(assigned.values()):
        if path in materials: continue
        material = text(path)
        textures = dict((identifier, texture) for texture, identifier in re.findall(r'\[ext_resource[^\n]*path="res://([^\"]+)"[^\n]*id="([^\"]+)"', material))
        info = {'name': pathlib.Path(path).stem}
        for prop in ['albedo_texture', 'normal_texture', 'roughness_texture', 'metallic_texture', 'emission_texture']:
            match = re.search(r'^' + prop + r' = ExtResource\("([^\"]+)"\)', material, re.M)
            if match: info[prop] = textures[match.group(1)]
        for prop in ['roughness', 'metallic', 'normal_scale', 'emission_energy_multiplier']:
            match = re.search(r'^' + prop + r' = ([0-9.]+)', material, re.M)
            if match: info[prop] = float(match.group(1))
        scale = re.search(r'uv1_scale = Vector3\(([^)]+)\)', material)
        if scale: info['scale'] = [float(n) for n in scale.group(1).split(',')[:2]]
        materials[path] = info
paths = sorted(set(value for m in materials.values() for key,value in m.items() if key.endswith('_texture')))
def convert(path):
    raw = download(path)
    image = Image.open(io.BytesIO(raw)).convert('RGBA')
    image.thumbnail((1024,1024),Image.Resampling.LANCZOS)
    filename = hashlib.sha256(path.encode()).hexdigest()[:16] + '.webp'
    target = ROOT / 'converted' / filename
    target.parent.mkdir(exist_ok=True)
    image.save(target, lossless='_Normal' in path, quality=90, method=5)
    return path, str(target)
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool: converted = dict(pool.map(convert, paths))
for filename in ['LICENSE-ASSETS', 'ATTRIBUTION', 'README.md']: download(filename)
(ROOT / 'descriptor.json').write_text(json.dumps({'models':models,'materials':materials,'textures':converted,'evidence':list(evidence.values()),'license':'CC-BY-4.0','source':BASE,'author':'Amazon Lumberyard; Godot port Logan Preshaw; modifications John James Gutib (Jamsers). NEXUS reconstructs materials, normalizes building pivots, builds LOD and Meshopt/WebP exports.'},indent=2))
print(f'Bistro: {len(models)} authored assets, {len(materials)} materials, {len(paths)} textures. No audio imported.')
