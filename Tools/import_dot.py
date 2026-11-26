from pathlib import Path
import unreal as ue

project = Path(ue.Paths.convert_relative_path_to_full(ue.Paths.project_dir()))
tools = ue.AssetToolsHelpers.get_asset_tools()
editor = ue.EditorAssetLibrary
material_nodes = ue.MaterialEditingLibrary

surfaces = [
    ('Tinted pearl silicone', 'PearlSilicone', (.49,.535,.96), .38, 0),
    ('Graphite eye gasket', 'EyeGasket', (.012,.015,.021), .56, 0),
    ('Black optical glass', 'OpticalGlass', (.00045,.00050,.00060), .54, 0),
    ('Warm white ceramic', 'WhiteCeramic', (.93,.934,.943), .39, 0),
    ('Satin polymer', 'SatinPolymer', (.80,.82,.85), .46, 0),
    ('Recess and markings', 'Recess', (.26,.285,.32), .48, .17),
    ('Smoke silicone', 'SmokeSilicone', (.24,.255,.278), .57, 0),
    ('Silver-gray cushion knit', 'CushionKnit', (.61,.62,.66), .69, 0),
    ('Bead-blasted aluminum', 'Aluminum', (.55,.605,.682), .31, .78),
]

def material(name, color, roughness, metallic, stage=False):
    folder = '/Game/Dot/Materials'
    existing = editor.load_asset(f'{folder}/{name}') if editor.does_asset_exist(f'{folder}/{name}') else None
    mat = existing or tools.create_asset(name, folder, ue.Material, ue.MaterialFactoryNew())
    color_node = material_nodes.get_material_property_input_node(mat,ue.MaterialProperty.MP_BASE_COLOR)
    if not color_node:
        color_node = material_nodes.create_material_expression(mat, ue.MaterialExpressionVectorParameter, -440, -125)
    color_node.set_editor_property('parameter_name', 'Tint')
    color_node.set_editor_property('default_value', ue.LinearColor(*color, 1))
    material_nodes.connect_material_property(color_node, 'RGB', ue.MaterialProperty.MP_BASE_COLOR)
    for i, (value, prop) in enumerate(((roughness,ue.MaterialProperty.MP_ROUGHNESS),(metallic,ue.MaterialProperty.MP_METALLIC))):
        node = material_nodes.get_material_property_input_node(mat,prop)
        if not node or not isinstance(node,ue.MaterialExpressionConstant):
            node = material_nodes.create_material_expression(mat, ue.MaterialExpressionConstant, -390, 40+i*105)
        node.set_editor_property('r',value)
        material_nodes.connect_material_property(node, '', prop)
    if name in ('OpticalGlass','EyeGasket'):
        spec=material_nodes.get_material_property_input_node(mat,ue.MaterialProperty.MP_SPECULAR)
        if not spec:
            spec=material_nodes.create_material_expression(mat,ue.MaterialExpressionConstant,-400,285)
        spec.set_editor_property('r',.031 if name=='OpticalGlass' else .05)
        material_nodes.connect_material_property(spec,'',ue.MaterialProperty.MP_SPECULAR)
    if stage:
        mat.set_editor_property('two_sided', True)
        fade = material_nodes.get_material_property_input_node(mat,ue.MaterialProperty.MP_EMISSIVE_COLOR)
        if not fade or not isinstance(fade,ue.MaterialExpressionMultiply):
            fade = material_nodes.create_material_expression(mat, ue.MaterialExpressionMultiply, -165, 120)
        fade.set_editor_property('const_b', .045)
        material_nodes.connect_material_expressions(color_node, 'RGB', fade, 'A')
        material_nodes.connect_material_property(fade, '', ue.MaterialProperty.MP_EMISSIVE_COLOR)
    material_nodes.recompile_material(mat)
    editor.save_loaded_asset(mat)
    return mat

def canonical(name):
    return ''.join(char.lower() for char in name if char.isalnum())

lookup = [(canonical(label), material(name, color, roughness, metallic))
          for label, name, color, roughness, metallic in surfaces]
material('StageSurface', (.035,.052,.090), .82, 0, stage=True)

for name, expected_slots in [('DotBody', 3), ('DotHeadphones', 6)]:
    task = ue.AssetImportTask()
    task.set_editor_property('filename', str(project / 'AssetSource' / f'{name}.fbx'))
    task.set_editor_property('destination_path', '/Game/Dot/Meshes')
    task.set_editor_property('destination_name', name)
    task.set_editor_property('automated', True)
    task.set_editor_property('replace_existing', True)
    task.set_editor_property('save', True)
    fbx = ue.FbxImportUI()
    fbx.set_editor_property('automated_import_should_detect_type', False)
    fbx.set_editor_property('mesh_type_to_import', ue.FBXImportType.FBXIT_STATIC_MESH)
    fbx.set_editor_property('import_mesh', True)
    fbx.set_editor_property('import_materials', False)
    fbx.set_editor_property('import_textures', False)
    data = fbx.static_mesh_import_data
    data.set_editor_property('combine_meshes', True)
    data.set_editor_property('auto_generate_collision', False)
    data.set_editor_property('generate_lightmap_u_vs', False)
    data.set_editor_property('normal_import_method', ue.FBXNormalImportMethod.FBXNIM_IMPORT_NORMALS)
    task.set_editor_property('options', fbx)
    tools.import_asset_tasks([task])
    path = f'/Game/Dot/Meshes/{name}'
    mesh = editor.load_asset(path)
    if not mesh:
        raise RuntimeError(f'Unreal did not import {path}')
    slots = mesh.get_editor_property('static_materials')
    assert len(slots) == expected_slots, (name, len(slots), expected_slots)
    for index, slot in enumerate(slots):
        imported = str(slot.get_editor_property('imported_material_slot_name'))
        matches = [mat for candidate, mat in lookup if candidate in canonical(imported)]
        if len(matches) != 1:
            raise RuntimeError(f'Cannot map material slot {imported} in {name}')
        mesh.set_material(index, matches[0])
    mesh.set_editor_property('light_map_coordinate_index', 0)
    editor.save_loaded_asset(mesh)
    bounds = mesh.get_bounds()
    ue.log(f'DOT_ASSET {name} slots={len(slots)} origin={bounds.origin} extent={bounds.box_extent}')

level = '/Game/Dot/DotStage'
levels = ue.get_editor_subsystem(ue.LevelEditorSubsystem)
if not editor.does_asset_exist(level):
    assert levels.new_level(level, is_partitioned_world=False)
assert editor.does_asset_exist(level)
ue.log('DOT_IMPORT_COMPLETE')
