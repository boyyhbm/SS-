"""Original provisional FOLD: ZERO art. Run with Blender, no external assets.
The export is for the playable foundation, not final premium character production.
"""
import bpy, math, os, json, hashlib
from mathutils import Vector
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT=os.path.join(ROOT,'public/game-assets/forge')
os.makedirs(OUT,exist_ok=True)
def clean():
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    for action in list(bpy.data.actions):bpy.data.actions.remove(action)
def mat(name,color,metal=0,rough=.4,emission=0):
    m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough
    if emission:p.inputs['Emission Color'].default_value=(*color,1);p.inputs['Emission Strength'].default_value=emission
    return m
ivory=mat('Warm ceramic',(.84,.85,.8),.08,.4);dark=mat('Graphite polymer',(.045,.065,.1),.2,.48)
steel=mat('Machined alloy',(.2,.29,.36),.65,.34);cyan=mat('Cyan energy',(.06,.7,.87),.18,.3,.7)
coral=mat('Coral energy',(.95,.24,.15),.14,.34,.5);yellow=mat('Safety yellow',(1,.62,.15),.1,.4)
def block(name,p,s,m,bevel=.05):
    bpy.ops.mesh.primitive_cube_add(size=1,location=p);o=bpy.context.object;o.name=name
    o.dimensions=s;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bevel:
        mod=o.modifiers.new('Machined radii','BEVEL');mod.width=min(bevel,min(s)*.27);mod.segments=3
        bpy.ops.object.modifier_apply(modifier=mod.name)
        mod=o.modifiers.new('Weighted normals','WEIGHTED_NORMAL');bpy.ops.object.modifier_apply(modifier=mod.name)
    o.data.materials.append(m);return o
def cylinder(name,p,r,depth,m,vertices=16):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=r,depth=depth,location=p)
    o=bpy.context.object;o.name=name;o.data.materials.append(m)
    mod=o.modifiers.new('Rim bevel','BEVEL');mod.width=.018;mod.segments=2;bpy.ops.object.modifier_apply(modifier=mod.name)
    return o
def export(name):
    # Join meshes before export. Material slots remain distinct, while rigid
    # bone weights and the single armature survive for character animation.
    meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:o.select_set(True)
    if meshes:
        bpy.context.view_layer.objects.active=meshes[0]
        bpy.ops.object.join()
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,name+'.glb'),export_format='GLB',export_animations=True,export_yup=True,export_animation_mode='ACTIONS',export_bake_animation=True)
def character(name,accent,broad):
    clean();parts=[]
    parts.append((block('thorax',(0,0,1.27),(.54 if broad else .45,.32,.42),ivory,.11),'Spine'))
    parts.append((block('chest-inlay',(0,-.174,1.31),(.3,.04,.17),accent),'Spine'))
    parts.append((block('waist',(0,0,.98),(.32,.27,.14),dark),'Hips'))
    parts.append((block('helmet',(0,0,1.69),(.36 if broad else .3,.32,.34),ivory,.09),'Head'))
    parts.append((block('visor',(0,-.169,1.71),(.31 if broad else .25,.034,.11),accent,.025),'Head'))
    for side in [-1,1]:
        tag='L' if side<0 else 'R';x=side*.13
        parts.append((block('thigh-'+tag,(x,0,.75),(.19,.22,.38),dark),'UpperLeg'+tag))
        parts.append((block('thigh-armor-'+tag,(x,-.115,.77),(.16,.05,.24),ivory),'UpperLeg'+tag))
        parts.append((block('shin-'+tag,(x,0,.34),(.18,.21,.37),ivory),'LowerLeg'+tag))
        parts.append((block('boot-'+tag,(x,-.07,.08),(.22,.37,.16),dark),'LowerLeg'+tag))
        parts.append((block('knee-'+tag,(x,-.13,.55),(.19,.09,.12),accent),'LowerLeg'+tag))
        x=side*(.34 if broad else .29)
        parts.append((block('pauldron-'+tag,(x,0,1.4),(.27 if broad else .21,.33,.22),accent),'UpperArm'+tag))
        parts.append((block('arm-'+tag,(x,0,1.19),(.15,.18,.33),dark),'UpperArm'+tag))
        parts.append((block('forearm-'+tag,(x,-.045,.92),(.18,.22,.28),ivory),'LowerArm'+tag))
        parts.append((block('hand-'+tag,(x,-.06,.76),(.13,.15,.14),dark),'LowerArm'+tag))
    if broad:
        for x in [-.17,.17]:parts.append((cylinder('back-cell',(x,.2,1.29),.1,.32,steel),'Spine'))
    else:
        parts.append((block('aerial',(0,.08,1.94),(.07,.1,.19),accent),'Head'))
    arm=bpy.data.armatures.new(name+' skeleton');rig=bpy.data.objects.new(name+' rig',arm);bpy.context.collection.objects.link(rig)
    bpy.context.view_layer.objects.active=rig;rig.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
    bones=[('Hips',(0,0,.95),(0,0,1.08),None),('Spine',(0,0,1.08),(0,0,1.5),'Hips'),('Head',(0,0,1.5),(0,0,1.86),'Spine')]
    for side in [-1,1]:
        tag='L' if side<0 else 'R';x=side*.13;a=side*(.34 if broad else .29)
        bones += [('UpperLeg'+tag,(x,0,.95),(x,0,.55),'Hips'),('LowerLeg'+tag,(x,0,.55),(x,0,.08),'UpperLeg'+tag),('UpperArm'+tag,(a,0,1.48),(a,0,1.05),'Spine'),('LowerArm'+tag,(a,0,1.05),(a,-.06,.74),'UpperArm'+tag)]
    for n,h,t,parent in bones:
        b=arm.edit_bones.new(n);b.head=h;b.tail=t
        if parent:b.parent=arm.edit_bones[parent]
    bpy.ops.object.mode_set(mode='OBJECT')
    for obj,bone in parts:
        group=obj.vertex_groups.new(name=bone);group.add(list(range(len(obj.data.vertices))),1,'REPLACE')
        mod=obj.modifiers.new('Rigid skin','ARMATURE');mod.object=rig;obj.parent=rig
    # Authored skeletal clips. Animation blending happens in ForgeAnimation.
    for clip in ['Idle','Walk','Sprint','Jump','Slide','Shoot','Reload','Hit','Victory','Defeat']:
        action=bpy.data.actions.new(clip);rig.animation_data_create();rig.animation_data.action=action
        for frame,phase in [(1,0),(9,math.pi/2),(17,math.pi),(25,math.pi*1.5),(33,math.pi*2)]:
            for p in rig.pose.bones:
                p.rotation_mode='XYZ';p.rotation_euler=(0,0,0)
                if clip in ['Walk','Sprint']:
                    amount=.38 if clip=='Walk' else .65
                    if p.name.startswith('UpperLeg'):p.rotation_euler.x=math.sin(phase)*(1 if p.name.endswith('L') else -1)*amount
                    if p.name.startswith('LowerLeg'):p.rotation_euler.x=max(0,math.sin(phase)*(1 if p.name.endswith('L') else -1))*.45
                    if p.name.startswith('UpperArm'):p.rotation_euler.x=math.sin(phase)*(1 if p.name.endswith('R') else -1)*.3
                if clip=='Idle' and p.name=='Spine':p.rotation_euler.y=math.sin(phase)*.015
                if clip=='Slide' and p.name=='Spine':p.rotation_euler.x=.45
                if clip=='Jump' and p.name.startswith('UpperLeg'):p.rotation_euler.x=.45*math.sin(phase/2)
                if clip in ['Shoot','Reload'] and p.name.startswith('UpperArm'):p.rotation_euler.x=-1.1+(math.sin(phase)*.08)
                if clip=='Hit' and p.name=='Spine':p.rotation_euler.x=math.sin(phase/2)*.14
                if clip=='Victory' and p.name=='UpperArmR':p.rotation_euler.x=-2.5
                if clip=='Defeat' and p.name=='Spine':p.rotation_euler.x=.4
                p.keyframe_insert('rotation_euler',frame=frame,group=p.name)
        action.use_fake_user=True
    rig.animation_data.action=None
    bpy.context.scene.frame_set(1);export(name)
character('pilot-cyan',cyan,False);character('pilot-coral',coral,True)
clean()
# Vector R9: original compact energy-assisted carbine, forward along Blender +Y.
block('receiver',(0,.1,0),(.16,.5,.18),ivory,.04);block('lower-rail',(0,.12,-.11),(.12,.44,.09),dark)
block('barrel-shroud',(0,.56,.02),(.11,.4,.12),dark);block('energy-rail',(0,.48,.09),(.045,.54,.025),cyan,.008)
block('muzzle',(0,.82,.02),(.13,.1,.13),steel,.025);block('muzzle-aperture',(0,.875,.02),(.07,.015,.065),dark,.008)
block('stock',(0,-.27,-.005),(.12,.28,.15),dark);block('butt',(0,-.43,-.005),(.17,.06,.25),ivory)
grip=block('grip',(0,-.035,-.19),(.09,.14,.22),dark);grip.rotation_euler.x=-.25
mag=block('magazine',(0,.18,-.22),(.09,.16,.26),steel);mag.rotation_euler.x=.13
block('sight-base',(0,.06,.12),(.09,.16,.06),dark);block('sight',(0,.06,.16),(.065,.06,.035),cyan,.008)
for x in [-.083,.083]:
    for i in range(5):block('cooling-fin',(x,.34+i*.06,.025),(.018,.025,.095),steel,.004)
block('glove-right',(.04,-.04,-.23),(.13,.16,.13),dark)
block('glove-left',(-.03,.43,-.1),(.13,.2,.12),dark)
block('sleeve-right',(.16,-.25,-.3),(.16,.36,.16),ivory)
block('sleeve-left',(-.16,.18,-.23),(.16,.4,.16),ivory)
export('vector-r9')
clean();block('ceramic-shell',(0,0,0),(.94,.92,.94),ivory,.1)
for x in [-.44,.44]:
    block('frame',(x,0,0),(.12,1,1),dark,.025)
    block('light-strip',(x,-.505,0),(.045,.018,.75),cyan,.008)
for y in [-.41,.41]:block('mechanism',(0,y,0),(.68,.12,1),steel,.03)
block('inlay',(0,-.48,0),(.52,.035,.62),dark,.07)
for z in [-.17,0,.17]:block('indicator',(0,-.508,z),(.24,.018,.04),yellow,.008)
export('forge-module')
clean();block('base',(0,0,.15),(.6,.6,.3),dark)
block('pedestal',(0,0,.65),(.28,.28,.9),ivory,.07)
o=block('interface',(0,0,1.1),(.52,.2,.45),dark,.06);o.rotation_euler.x=math.radians(15)
block('screen',(0,-.12,1.1),(.4,.025,.3),cyan,.025)
export('fold-node')
files=[]
for name in ['pilot-cyan','pilot-coral','vector-r9','forge-module','fold-node']:
    p=os.path.join(OUT,name+'.glb');files.append({'file':'/game-assets/forge/'+name+'.glb','bytes':os.path.getsize(p),'sha256':hashlib.sha256(open(p,'rb').read()).hexdigest()})
with open(os.path.join(OUT,'manifest.json'),'w') as f:json.dump({'title':'FOLD: ZERO foundation assets','author':'NEXUS project','source':'scripts/build-forge-assets.py','license':'Original project assets; no external copyrighted game content','status':'Provisional first-playable art, not final premium assets','resources':files},f,indent=2)
