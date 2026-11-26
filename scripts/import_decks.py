import re
"""Import the matching Blender DJ deck and record into the Dot Unreal project."""
from pathlib import Path
import unreal as ue

def asset_name(name, extension):
    return re.sub(r'(?<=[a-z0-9])(?=[A-Z])', '-', name).lower() + extension


project = Path(ue.Paths.convert_relative_path_to_full(ue.Paths.project_dir()))
tools = ue.AssetToolsHelpers.get_asset_tools()
editor = ue.EditorAssetLibrary
nodes = ue.MaterialEditingLibrary
palette = {
    'Lilac':((.52,.55,.75),.34,.06),'Rubber':((.038,.048,.073),.69,0),
    'Pearl':((.82,.84,.92),.28,.06),'Ink':((.025,.034,.055),.40,.12),
    'Alloy':((.43,.48,.60),.29,.77),'SignalIce':((.38,.75,.78),.39,.04),
    'SignalLilac':((.53,.44,.85),.35,.05),'Porcelain':((.84,.85,.89),.40,.03),
    'GraphitePrint':((.09,.11,.16),.52,.04),'SilverPrint':((.63,.67,.73),.48,.10),
    'PaleLilac':((.66,.69,.85),.35,.06),'PadUnlit':((.18,.19,.28),.62,0),
    'DisplayGlass':((.036,.045,.075),.34,.04),'Vinyl':((.009,.010,.015),.60,.02),
    'RecordGroove':((.017,.019,.027),.64,.02),'Label':((.27,.32,.53),.56,.02)
}
folder = '/Game/Dot/Materials'
def material(key, color, roughness, metallic):
    name = 'Deck_'+key
    location = f'{folder}/{name}'
    mat = editor.load_asset(location) if editor.does_asset_exist(location) else tools.create_asset(name,folder,ue.Material,ue.MaterialFactoryNew())
    color_node = nodes.get_material_property_input_node(mat,ue.MaterialProperty.MP_BASE_COLOR)
    if not color_node:
        color_node = nodes.create_material_expression(mat,ue.MaterialExpressionConstant3Vector,-350,-120)
    color_node.set_editor_property('constant',ue.LinearColor(*color,1))
    nodes.connect_material_property(color_node,'',ue.MaterialProperty.MP_BASE_COLOR)
    for i,(val,prop) in enumerate(((roughness,ue.MaterialProperty.MP_ROUGHNESS),(metallic,ue.MaterialProperty.MP_METALLIC))):
        n=nodes.get_material_property_input_node(mat,prop)
        if not n:
            n=nodes.create_material_expression(mat,ue.MaterialExpressionConstant,-350,30+i*100)
        n.set_editor_property('r',val)
        nodes.connect_material_property(n,'',prop)
    if key in ('Vinyl','RecordGroove'):
        n=nodes.get_material_property_input_node(mat,ue.MaterialProperty.MP_SPECULAR)
        if not n:
            n=nodes.create_material_expression(mat,ue.MaterialExpressionConstant,-350,245)
        n.set_editor_property('r',.09)
        nodes.connect_material_property(n,'',ue.MaterialProperty.MP_SPECULAR)
    if key.startswith('Signal'):
        n=nodes.get_material_property_input_node(mat,ue.MaterialProperty.MP_EMISSIVE_COLOR)
        if not n:
            n=nodes.create_material_expression(mat,ue.MaterialExpressionMultiply,-125,12)
        nodes.connect_material_expressions(color_node,'',n,'A')
        n.set_editor_property('const_b',.18)
        nodes.connect_material_property(n,'',ue.MaterialProperty.MP_EMISSIVE_COLOR)
    nodes.recompile_material(mat)
    editor.save_loaded_asset(mat)
    return mat
materials={f'deck_{key.lower()}':material(key,*values) for key,values in palette.items()}

for name in ('DotDecks','DotRecord'):
    task=ue.AssetImportTask()
    options=ue.FbxImportUI()
    settings=options.static_mesh_import_data
    for key,value in dict(automated_import_should_detect_type=False,mesh_type_to_import=ue.FBXImportType.FBXIT_STATIC_MESH,
                          import_mesh=True,import_materials=False,import_textures=False).items():
        options.set_editor_property(key,value)
    for key,value in dict(combine_meshes=True,auto_generate_collision=False,
                          generate_lightmap_u_vs=False,normal_import_method=ue.FBXNormalImportMethod.FBXNIM_IMPORT_NORMALS).items():
        settings.set_editor_property(key,value)
    for key,value in dict(filename=str(project.parent / 'assets' / asset_name(name, '.fbx')),destination_path='/Game/Dot/Meshes',
                          destination_name=name,automated=True,replace_existing=True,save=True,options=options).items():
        task.set_editor_property(key,value)
    tools.import_asset_tasks([task])
    mesh=editor.load_asset(f'/Game/Dot/Meshes/{name}')
    assert mesh
    slots=mesh.get_editor_property('static_materials')
    for i, slot in enumerate(slots):
        imported=str(slot.get_editor_property('imported_material_slot_name')).lower()
        assert imported in materials,imported
        mesh.set_material(i,materials[imported])
    editor.save_loaded_asset(mesh)
    ue.log(f'DOT_DECK_ASSET {name} slots={len(slots)} bounds={mesh.get_bounds()}')

ue.log('DOT_DECK_IMPORT_COMPLETE')
