"""Build the editable Alive Pyramid set and its Unreal exchange assets in Blender."""
import json
from math import cos, pi, sin
from pathlib import Path

import bpy
from mathutils import Vector

DESTINATION = Path(__file__).resolve().parents[1] / "AssetSource" / "Warehouse"
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.name = "Daft Punk Pyramid · Coachella / Alive"
scene.unit_settings.system = 'METRIC'
scene.world = bpy.data.worlds.new("Sahara night")
scene.world.color = (.035, .042, .070)
scene["Reference"] = "User-supplied Alive Pyramid concert photos, with split podium, black A-frame, and full-height triangle grids."
stage = bpy.data.collections.new("Alive Pyramid / Stage")
scene.collection.children.link(stage)
podium = bpy.data.collections.new("Alive Pyramid / Podium")
scene.collection.children.link(podium)
geometry = stage
palette = {}


def material(name, rgb, roughness=.54, metallic=0, emission=0):
    slot = "Alive_" + name
    mat = bpy.data.materials.new(slot)
    mat.diffuse_color = (*rgb, 1)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*rgb, 1)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["Emission Color"].default_value = (*rgb, 1)
    shader.inputs["Emission Strength"].default_value = emission
    palette[slot] = dict(blender_name=slot, base_color=rgb, roughness=roughness, metallic=metallic,
                         emission_color=rgb if emission else (0, 0, 0), emission_strength=emission)
    return mat


def mesh(name, vertices, faces, mat):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    data.materials.append(mat)
    obj = bpy.data.objects.new(name, data)
    geometry.objects.link(obj)
    return obj


def box(name, center, size, mat, bevel=0):
    x, y, z = (dimension / 2 for dimension in size)
    verts = [(-x,-y,-z),(x,-y,-z),(x,y,-z),(-x,y,-z),(-x,-y,z),(x,-y,z),(x,y,z),(-x,y,z)]
    faces = [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]
    obj = mesh(name, verts, faces, mat)
    obj.location = center
    if bevel:
        edge = obj.modifiers.new("Machined edge", 'BEVEL')
        edge.width = bevel
        edge.segments = 2
        obj.modifiers.new("Face normals", 'WEIGHTED_NORMAL')
    return obj


def bar(name, start, end, width, mat, depth=None):
    start, end = Vector(start), Vector(end)
    direction = end - start
    obj = box(name, (start + end) / 2, (width, depth or width, direction.length), mat)
    obj.rotation_euler = direction.to_track_quat('Z', 'Y').to_euler()


def face(name, points, mat):
    return mesh(name, points, [tuple(range(len(points)))], mat)


black = material("BlackAnodized", (.009,.011,.018), .44,.42)
steel = material("Gunmetal", (.043,.048,.066), .39,.61)
deck = material("StageDeck", (.025,.031,.045), .51,.14)
drape = material("NightDrape", (.003,.005,.012), .95)
panel = material("PanelGlass", (.016,.020,.034), .40,.31)
white = material("TubeWhite", (.78,1,.90), .36,0,4.4)
blue = material("TubeIce", (.21,.69,1), .33,0,3.8)
pink = material("TubeRose", (1,.27,.41), .33,0,3.45)
warm = material("ApexAmber", (1,.29,.044), .38,0,3.9)
amber_dim = material("ApexShade", (1,.104,.021), .40,0,1.75)
beam_blue = material("HazeIce", (.23,.40,1), .74,0,.50)
beam_pink = material("HazePink", (1,.24,.43), .74,0,.42)
def preview_beam(haze):
    spec=palette[haze.name]
    spec["beam"]=True
    tree=haze.node_tree
    tree.nodes.clear()
    uv=tree.nodes.new("ShaderNodeTexCoord")
    coordinates=tree.nodes.new("ShaderNodeSeparateXYZ")
    tree.links.new(uv.outputs["UV"],coordinates.inputs[0])

    def math(operator, first, second=None):
        node=tree.nodes.new("ShaderNodeMath")
        node.operation=operator
        for index,value in enumerate((first,second)):
            if isinstance(value,bpy.types.NodeSocket):
                tree.links.new(value,node.inputs[index])
            elif value is not None:
                node.inputs[index].default_value=value
        return node.outputs[0]

    intensity=[]
    for channel,exponent in (("X",2.45),("Y",.85)):
        distance=math('ABSOLUTE',math('SUBTRACT',math('MULTIPLY',coordinates.outputs[channel],2),1))
        intensity.append(math('POWER',math('SUBTRACT',1,distance),exponent))
    emission=tree.nodes.new("ShaderNodeEmission")
    emission.inputs["Color"].default_value=(*spec["emission_color"],1)
    tree.links.new(math('MULTIPLY',math('MULTIPLY',*intensity),spec["emission_strength"]),emission.inputs["Strength"])
    transparent=tree.nodes.new("ShaderNodeBsdfTransparent")
    add=tree.nodes.new("ShaderNodeAddShader")
    tree.links.new(transparent.outputs[0],add.inputs[0])
    tree.links.new(emission.outputs[0],add.inputs[1])
    output=tree.nodes.new("ShaderNodeOutputMaterial")
    tree.links.new(add.outputs[0],output.inputs["Surface"])


for haze in (beam_blue,beam_pink):
    preview_beam(haze)
core = material("PodiumCore", (.78,.86,1), .35,0,2.8)
curtain_levels = [
    material("CurtainDim", (.05,.08,.40), .65,0,.70),
    material("CurtainIndigo", (.17,.19,1), .62,0,1.30),
    material("CurtainCyan", (.08,.56,1), .56,0,2.30),
    material("CurtainPink", (.68,.13,.70), .62,0,1.3),
    material("CurtainWhite", (.64,.83,1), .60,0,1.65),
]

box("Front of house floor", (0,-3,-1.90), (35,25,.24), deck)
box("Night scrim", (0,6.98,2.63), (26,.22,10), drape)
box("LED curtain / perforated black backplane", (0,5.32,2.28), (16.3,.15,7.2), black)
# The curtain remains behind the opening. Its overlapping light bands read through the rig.
pixels = {mat: ([], []) for mat in curtain_levels}
for row in range(63):
    z=-.90+row*.102
    for col in range(153):
        x=(col-76)*.102
        band = .66*sin(x*.95+z*1.70)+.36*cos(x*1.80-z*.72)
        if band>.73:
            level=4
        elif band>.26:
            level=2
        elif band<-.67:
            level=3
        else:
            level=1 if (col+row)%4 else 0
        verts, faces = pixels[curtain_levels[level]]
        i=len(verts)
        r=.013+.003*(level%3)
        verts.extend(((x-r,5.19,z-r),(x+r,5.19,z-r),(x+r,5.19,z+r),(x-r,5.19,z+r)))
        faces.append((i,i+1,i+2,i+3))
for mat, (verts, faces) in pixels.items():
    mesh("Rear LED curtain / "+mat.name,verts,faces,mat)

# The outer rig is a structural black triangle around the small illuminated upper crown.
foot, tip = 5.30, 5.45
for side in (-1,1):
    for depth in (2.22,2.62):
        bar("Heavy inclined A-frame chord",(side*foot,depth,-1.40),(0,depth+.15,tip),.153,black)
        bar("Inclined inner A-frame chord",(side*(foot-.32),depth,-1.40),(0,depth+.15,tip-.35),.105,steel)
    for j in range(17):
        t=j/17
        a=(side*foot*(1-t),2.195+(.15*t),-1.40+(tip+1.40)*t)
        t2=(j+1)/17
        b=(side*(foot-.32)*(1-t2),2.195+(.15*t2),-1.40+(tip+1.05)*t2)
        bar("Inclined truss lacing",a,b,.062,steel)
        bar("Inclined truss cross tie",a,(a[0],a[1]+.43,a[2]),.067,black)
    for idx,t in enumerate((.18,.40,.60,.82)):
        x=side*(foot*(1-t)-.30)
        z=-1.40+(tip+1.4)*t
        box("Moving head / mounting yoke",(x,2.15,z),(.35,.34,.36),black,.038)
        box("Moving head / lens",(x,1.97,z),(.234,.045,.17),blue if idx%2 else white,.022)

# The lit mist uses soft additive material in Unreal, behind the performance bay.
def light_shaft(start, end, width, mat):
    a,b=Vector(start),Vector(end)
    direction=b-a
    across=Vector((direction.z,0,-direction.x)).normalized()
    obj=face("Moving head / haze shaft",
             [a-across*.028,a+across*.028,b+across*width,b-across*width],mat)
    layer=obj.data.uv_layers.new(name="Beam profile")
    for loop,uv in zip(layer.data,((0,0),(1,0),(1,1),(0,1))):
        loop.uv=uv


for side in (-1,1):
    for source, target, width, color in [
        ((1.35,2.06,3.52),(.28,4.94,5.44),.43,beam_blue),
        ((2.11,2.07,2.65),(5.66,5.09,4.80),.36,beam_pink if side>0 else beam_blue),
        ((3.25,2.06,1.05),(6.61,5.17,3.74),.58,beam_blue),
        ((4.12,2.07,-.23),(2.8,4.80,3.93),.49,beam_pink if side<0 else beam_blue),
    ]:
        light_shaft((side*source[0],*source[1:]),(side*target[0],*target[1:]),width,color)

# Dense, continuous equilateral arrays occupy the two wings.
spacing=1.11
rise=spacing*3**.5/2
for side in (-1,1):
    grid={}
    for row in range(8):
        z=-1.36+row*rise
        near=5.15*(1-(z+1.36)/7.39)+.46
        for col in range(9):
            x=.18+(col+.5*(row%2))*spacing
            if near<=x<=8.45:
                grid[row,col]=(side*x,3.72,z)
    for (row,col),a in grid.items():
        for key in ((row,col+1),(row+1,col),(row+1,col+2*(row%2)-1)):
            b=grid.get(key)
            if b is None:
                continue
            bar("Wing lattice / charcoal carrier",a,b,.054,black)
            ca,cb=Vector(a),Vector(b)
            ca.y-=.039
            cb.y-=.039
            color=blue if (col+2*row)%7==0 else pink if (col+row)%11==0 else white
            bar("Wing lattice / luminous tube",ca,cb,.021,color)
    for x in (side*7.95, side*8.56):
        bar("Wing tower chord",(x,4.03,-1.55),(x,4.03,5.73),.082,steel)
    for row in range(11):
        z=-1.4+row*.64
        bar("Wing tower brace",(side*7.95,4.03,z),(side*8.56,4.03,z+.64),.051,steel)
for z in (5.50,5.90):
    bar("Overhead black truss",(-8.60,4.08,z),(8.60,4.08,z),.13,black)
for j in range(27):
    start=-8.56+j*.63
    bar("Overhead truss lacing",(start,4.02,5.50),(start+.63,4.02,5.90),.043,steel)

peak=(0,2.31,4.46)
ridge=(0,1.95,3.35)
for side, color in ((-1,warm),(1,amber_dim)):
    edge=(side*.98,2.58,3.50)
    face("Apex / folded LED facet",(edge,ridge,peak) if side<0 else (ridge,edge,peak),color)
    bar("Apex shadow frame",peak,edge,.049,black)
    bar("Apex lower frame",edge,ridge,.052,black)
    bar("Apex suspension",peak,(side*.60,2.63,5.62),.013,steel)
bar("Apex center spine",peak,ridge,.058,black)

# The podium replaces the normal table. Keep its deck at the existing crates' height.
geometry=podium
deck_outline=[(-2.47,-.90655),(0,-1.24),(2.47,-.90655),(2.47,.23),(-2.47,.23)]
deck_vertices=[(x,y,z) for z in (.798,.881) for x,y in deck_outline]
mesh("Podium / shared crate deck",deck_vertices,
     [(4,3,2,1,0),(5,6,7,8,9)]+[(i,(i+1)%5,(i+1)%5+5,i+5) for i in range(5)],black)
box("Podium / rear fascia",(0,.020,-.29),(4.93,.25,2.27),black)
for side in (-1,1):
    lower_inner=Vector((0,-2.64,-1.77))
    upper_inner=Vector((0,-1.24,.855))
    lower_outer=Vector((side*4.14,-2.64+.135*4.14,-1.77))
    upper_outer=Vector((side*2.47,-1.24+.135*2.47,.855))

    def point(u, v, bias=0):
        position=lower_inner.lerp(lower_outer,u).lerp(upper_inner.lerp(upper_outer,u),v)
        position.y-=bias
        return position

    def panel_path(name, points, mat, bias):
        vertices=[point(u,v,bias) for u,v in points]
        face(name,vertices if side>0 else vertices[::-1],mat)

    panel_path("Sloped podium / folded graphite surface",[(0,0),(1,0),(1,1),(0,1)],panel,0)
    panel_path("Sloped podium / luminous center",[(.016,.09),(.19,.15),(.32,.47),(.25,.957),(.016,.957)],core,.028)
    for v in (0,1):
        bar("Podium frame transom",point(0,v,.013),point(1,v,.013),.056,black)
    bar("Podium diagonal edge",point(.992,.01,.013),point(.992,.999,.013),.086,black)
    bar("Outer contour / warm-white line",point(.961,.045,.047),point(.961,.957,.047),.040,pink)
    for i,u in enumerate((.32,.43,.53,.64,.75,.88)):
        end=u-.11 if i%2 else u-.055
        bar("Podium light trace / upper rail",point(u,.96,.052),point(end,.54,.052),.039,white if i%3 else blue)
        bar("Podium light trace / lower rail",point(end,.54,.052),point(u+.055,.059,.052),.032,pink if i%3==1 else white)
    bar("Podium light trace / side sweep",point(.12,.46,.059),point(.954,.54,.059),.032,white)
    bar("Podium face seam",lower_inner,upper_inner,.055,black)
    bar("Podium side return",lower_outer,(side*2.46,.17,-1.77),.070,black)
    face("Podium / side enclosure",
         [lower_outer,(side*2.46,.17,-1.77),(side*2.46,.17,.84),upper_outer] if side>0
         else [upper_outer,(side*2.46,.17,.84),(side*2.46,.17,-1.77),lower_outer], black)

# Preview rig is independent of the FBX stage.
review = bpy.data.collections.new("Blender review")
scene.collection.children.link(review)
cam_data=bpy.data.cameras.new("Front of house")
camera=bpy.data.objects.new("Front of house",cam_data)
review.objects.link(camera)
camera.location=(0,-13.3,2.5)
camera.rotation_euler=(Vector((0,2.2,1.9))-camera.location).to_track_quat('-Z','Y').to_euler()
cam_data.lens=28
scene.camera=camera
scene.render.resolution_x=1440
scene.render.resolution_y=900
for name, loc, target, color, energy, size in [
    ("Front wash",(-3,-2,5),(0,2,2),(.63,.72,1),620,4),
    ("Wing wash",(5,4,3),(1,4,2),(.17,.28,1),420,2.5),
    ("Roof bounce",(-4,5,4),(0,1,1),(1,.19,.12),330,2),
]:
    lamp=bpy.data.lights.new(name,'AREA')
    lamp.color=color
    lamp.energy=energy
    lamp.size=size
    ob=bpy.data.objects.new(name,lamp)
    review.objects.link(ob)
    ob.location=loc
    ob.rotation_euler=(Vector(target)-ob.location).to_track_quat('-Z','Y').to_euler()

bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(DESTINATION/"DotAlivePyramid.blend"), compress=True)

for collection, filename in ((stage,"VenueAlivePyramid"),(podium,"AlivePyramidPodium")):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in collection.objects:
        obj.select_set(True)
    bpy.ops.export_scene.fbx(filepath=str(DESTINATION/(filename+".fbx")), use_selection=True,
        object_types={'MESH'}, apply_unit_scale=True, apply_scale_options='FBX_SCALE_UNITS',
        axis_forward='-Y', axis_up='Z', bake_anim=False, add_leaf_bones=False, mesh_smooth_type='FACE')
(DESTINATION/"AlivePyramidMaterials.json").write_text(json.dumps(palette, indent=2)+"\n")
