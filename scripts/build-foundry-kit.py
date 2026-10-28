"""Original Foundry architectural kit and clean PBR floor, authored for NEXUS.

Run: blender -b -P scripts/build-foundry-kit.py
No external models, textures, fonts or commercial-game content are used.
The kit adds detail to existing collision volumes; it never supplies hidden cover.
"""
import bpy
import math
import os
import json
import hashlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public/game-assets/forge/foundry")
os.makedirs(OUT, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

def linear(c):
    return c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4

def material(name, color, metal=0, rough=.5, emission=0):
    rgb = tuple(linear(int(color[i:i+2], 16) / 255) for i in (1, 3, 5))
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*rgb, 1)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*rgb, 1)
    p.inputs['Metallic'].default_value = metal
    p.inputs['Roughness'].default_value = rough
    if emission:
        p.inputs['Emission Color'].default_value = (*rgb, 1)
        p.inputs['Emission Strength'].default_value = emission
    return m

navy = material('Forge / enamel navy', '#1B2945', .25, .55)
steel = material('Forge / brushed alloy', '#63788C', .68, .38)
graphite = material('Forge / graphite', '#303747', .32, .68)
orange = material('Forge / industrial orange', '#FF9759', .15, .48)
teal = material('Forge / research teal', '#397F8D', .35, .3)
cyan = material('Forge / cyan light', '#4ADCF2', .12, .3, 1.2)
yellow = material('Forge / safety yellow', '#FFD36B', .12, .6)
glass = material('Forge / optical blue', '#294D6D', .35, .14)

def root(name):
    o = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(o)
    return o

def bevel(o, amount=.035):
    mod = o.modifiers.new('Manufactured edge radius', 'BEVEL')
    mod.width = amount
    mod.segments = 3
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier=mod.name)
    mod = o.modifiers.new('Weighted normals', 'WEIGHTED_NORMAL')
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return o

def block(parent, name, p, size, mat, radius=.035):
    bpy.ops.mesh.primitive_cube_add(size=1, location=p)
    o = bpy.context.object
    o.name = name
    o.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if radius:
        bevel(o, min(radius, min(size) * .24))
    o.data.materials.append(mat)
    o.parent = parent
    return o

def cylinder(parent, name, p, radius, depth, mat, axis='Z', vertices=24):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=p)
    o = bpy.context.object
    o.name = name
    if axis == 'X':
        o.rotation_euler.y = math.pi / 2
    if axis == 'Y':
        o.rotation_euler.x = math.pi / 2
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bevel(o, .015)
    for p in o.data.polygons:
        p.use_smooth = abs(p.normal.z) < .9
    o.data.materials.append(mat)
    o.parent = parent
    return o

def tube(parent, name, points, radius, mat):
    curve = bpy.data.curves.new(name, 'CURVE')
    curve.dimensions = '3D'
    curve.bevel_depth = radius
    curve.bevel_resolution = 2
    spline = curve.splines.new('BEZIER')
    spline.bezier_points.add(len(points) - 1)
    for b, p in zip(spline.bezier_points, points):
        b.co = p
        b.handle_left_type = b.handle_right_type = 'AUTO'
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    obj.parent = parent
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target='MESH')
    obj.select_set(False)
    return obj

def finish(part):
    # Merge each material in each reusable part. Runtime instancing then keeps
    # repeated columns/vents at a bounded draw-call cost.
    for mat in list(bpy.data.materials):
        items = [o for o in part.children_recursive if o.type == 'MESH' and o.data.materials and o.data.materials[0] == mat]
        if not items:
            continue
        bpy.ops.object.select_all(action='DESELECT')
        for o in items:
            o.select_set(True)
        bpy.context.view_layer.objects.active = items[0]
        bpy.ops.object.join()
        items[0].name = part.name + ' / ' + mat.name

column = root('service-column')
block(column, 'Steel spine', (0, 0, 2.7), (.38, .38, 5.4), steel)
for z in (.28, 2.6, 5.1):
    block(column, 'Collar', (0, 0, z), (.6, .5, .26), navy, .06)
block(column, 'Orange enamel insert', (0, -.208, 2.8), (.22, .045, 3.8), orange)
for x in (-.23, .23):
    tube(column, 'Service conduit', [(x, .17, .2), (x, .22, .8), (x, .22, 4.8), (x, .05, 5.4)], .038, graphite)
finish(column)

vent = root('vent-bank')
block(vent, 'Inset casing', (0, 0, 0), (1.8, .12, 1), navy, .07)
for z in (-.34, -.2, -.06, .08, .22, .36):
    blade = block(vent, 'Louver', (0, -.095, z), (1.58, .09, .07), steel, .015)
    blade.rotation_euler.x = .25
for x in (-.82, .82):
    for z in (-.4, .4):
        cylinder(vent, 'Fastener', (x, -.07, z), .032, .04, graphite, 'Y', 12)
finish(vent)

pipes = root('pipe-bank')
for x in (-.58, 0, .58):
    tube(pipes, 'Bent heat exchanger', [(x, 0, -.85), (x, -.08, -.65), (x, -.08, .6), (x + .18, 0, .85)], .115, steel)
    for z in (-.5, .44):
        cylinder(pipes, 'Machined joint', (x, -.08, z), .145, .13, orange)
block(pipes, 'Lower service rail', (0, .075, -.65), (1.85, .1, .15), navy)
block(pipes, 'Upper service rail', (0, .075, .65), (1.85, .1, .15), navy)
finish(pipes)

lab = root('research-inset')
block(lab, 'Instrument housing', (0, 0, 0), (2.4, .12, 1.5), navy, .09)
block(lab, 'Optical panel', (-.27, -.078, .05), (1.5, .045, 1.16), glass)
for x in (-.8, -.5, -.2, .1):
    block(lab, 'Signal trace', (x, -.106, .04), (.025, .008, .75 - abs(x) * .4), cyan, .002)
for z in (-.4, -.1, .2, .5):
    block(lab, 'Instrument switch', (.91, -.097, z), (.18, .035, .08), teal)
block(lab, 'Header rail', (0, -.082, .66), (2.1, .04, .06), teal)
finish(lab)

frame = root('bulkhead-frame')
for x in (-.85, .85):
    block(frame, 'Jamb', (x, 0, 1.15), (.2, .16, 2.3), steel)
    block(frame, 'Enamel guard', (x, -.09, .45), (.22, .05, .65), orange)
block(frame, 'Lintel', (0, 0, 2.3), (1.9, .2, .22), navy, .06)
block(frame, 'Status light', (0, -.112, 2.3), (.6, .03, .055), cyan, .008)
finish(frame)

crown = root('core-crown')
for z in (-.22, .22):
    bpy.ops.mesh.primitive_torus_add(major_radius=2.2, minor_radius=.12, major_segments=64, minor_segments=8, location=(0, 0, z))
    o = bpy.context.object
    o.name = 'Reactor induction ring'
    o.data.materials.append(navy)
    o.parent = crown
for i in range(8):
    a = i * math.pi / 4
    o = block(crown, 'Induction clamp', (math.cos(a) * 2.15, math.sin(a) * 2.15, 0), (.32, .5, .48), steel, .06)
    o.rotation_euler.z = a
    block(crown, 'Energy window', (math.cos(a) * 2.19, math.sin(a) * 2.19, -.27), (.15, .15, .025), cyan, .025)
finish(crown)

bpy.ops.object.select_all(action='SELECT')
filename = os.path.join(OUT, 'foundry-kit.glb')
bpy.ops.export_scene.gltf(filepath=filename, export_format='GLB', export_yup=True, export_animations=False)

def entry(file):
    b = open(file, 'rb').read()
    return {'file': '/game-assets/forge/foundry/' + os.path.basename(file), 'bytes': len(b), 'sha256': hashlib.sha256(b).hexdigest()}

manifest = {
    'title': 'THE FOUNDRY / Industrial + Research architectural kit',
    'author': 'NEXUS project',
    'source': 'scripts/build-foundry-kit.py',
    'license': 'Original project assets; commercial use permitted by the project owner',
    'commercialUsePermitted': True,
    'resources': [entry(filename)],
    'parts': ['service-column', 'vent-bank', 'pipe-bank', 'research-inset', 'bulkhead-frame', 'core-crown'],
}
with open(os.path.join(OUT, 'manifest.json'), 'w') as f:
    json.dump(manifest, f, indent=2)
    f.write('\n')
