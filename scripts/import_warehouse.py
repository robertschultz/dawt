import re
"""Import the world-aligned warehouse booth from the editable Blender project."""
import json
import os
from pathlib import Path

import unreal as ue

def asset_name(name, extension):
    return re.sub(r'(?<=[a-z0-9])(?=[A-Z])', '-', name).lower() + extension


root = Path(ue.Paths.convert_relative_path_to_full(ue.Paths.project_dir()))
source = root.parent / "assets" / "warehouse"
tool = ue.AssetToolsHelpers.get_asset_tools()
editor = ue.EditorAssetLibrary
nodes = ue.MaterialEditingLibrary
folder = "/Game/Dot/Warehouse"
materials_folder = folder + "/Materials"


def beam_emission(asset, color):
    def node(kind, x, y):
        return nodes.create_material_expression(asset, getattr(ue, "MaterialExpression" + kind), x, y)

    def link(source, target, name=""):
        if not nodes.connect_material_expressions(source, "", target, name):
            raise RuntimeError(f"Could not wire {name} in {asset.get_name()}")

    uv = node("TextureCoordinate", -1250, 200)
    envelopes = []
    for axis, exponent in (("r", 2.45), ("g", .85)):
        row = 200 + len(envelopes) * 200
        channel = node("ComponentMask", -1070, row)
        for component in ("r", "g", "b", "a"):
            channel.set_editor_property(component, component == axis)
        link(uv, channel)
        double = node("Multiply", -900, row)
        double.set_editor_property("const_b", 2.0)
        link(channel, double, "A")
        center = node("Subtract", -725, row)
        center.set_editor_property("const_b", 1.0)
        link(double, center, "A")
        magnitude = node("Abs", -550, row)
        link(center, magnitude)
        peak = node("OneMinus", -390, row)
        link(magnitude, peak)
        smooth = node("Power", -240, row)
        smooth.set_editor_property("const_exponent", exponent)
        link(peak, smooth, "Base")
        envelopes.append(smooth)
    shape = node("Multiply", -70, 250)
    link(envelopes[0], shape, "A")
    link(envelopes[1], shape, "B")
    shaded = node("Multiply", 110, 210)
    link(shape, shaded, "A")
    link(color, shaded, "B")
    nodes.connect_material_property(shaded, "", ue.MaterialProperty.MP_EMISSIVE_COLOR)


def material(name, spec):
    asset_name = "WH_" + "".join(char if char.isascii() and char.isalnum() else "_" for char in name)
    asset_path = f"{materials_folder}/{asset_name}"
    asset = editor.load_asset(asset_path) if editor.does_asset_exist(asset_path) else tool.create_asset(
        asset_name, materials_folder, ue.Material, ue.MaterialFactoryNew()
    )
    if " / Atmosphere " in spec.get("blender_name", ""):
        asset.set_editor_property("two_sided", True)
        asset.set_editor_property("shading_model", ue.MaterialShadingModel.MSM_UNLIT)
    if spec.get("beam"):
        asset.set_editor_property("blend_mode",ue.BlendMode.BLEND_ADDITIVE)
        asset.set_editor_property("shading_model",ue.MaterialShadingModel.MSM_UNLIT)
        asset.set_editor_property("two_sided",True)
        nodes.delete_all_material_expressions(asset)
    color = ue.MaterialProperty.MP_BASE_COLOR
    expression = nodes.get_material_property_input_node(asset, color) or nodes.create_material_expression(
        asset, ue.MaterialExpressionConstant3Vector, -330, -100
    )
    expression.set_editor_property("constant", ue.LinearColor(*spec["base_color"][:3], 1))
    nodes.connect_material_property(expression, "", color)
    for row, (key, target) in enumerate((
        ("roughness", ue.MaterialProperty.MP_ROUGHNESS), ("metallic", ue.MaterialProperty.MP_METALLIC)
    )):
        expression = nodes.get_material_property_input_node(asset, target) or nodes.create_material_expression(
            asset, ue.MaterialExpressionConstant, -330, row * 90
        )
        expression.set_editor_property("r", spec[key])
        nodes.connect_material_property(expression, "", target)
    emission = spec.get("emission_color", (0, 0, 0))
    if max(emission[:3]) > 0:
        target = ue.MaterialProperty.MP_EMISSIVE_COLOR
        expression = nodes.get_material_property_input_node(asset, target) or nodes.create_material_expression(
            asset, ue.MaterialExpressionConstant3Vector, -330, 220
        )
        strength = min(6, spec.get("emission_strength", 1))
        expression.set_editor_property("constant", ue.LinearColor(*(n * strength for n in emission[:3]), 1))
        if spec.get("beam"):
            beam_emission(asset,expression)
        else:
            nodes.connect_material_property(expression, "", target)
    nodes.recompile_material(asset)
    editor.save_loaded_asset(asset)
    return asset


def token(name):
    return "".join(char.lower() for char in name if char.isascii() and char.isalnum())


studio_folder = "/Game/Dot/Materials"
studio_path = studio_folder + "/StudioSolid"
studio = editor.load_asset(studio_path) if editor.does_asset_exist(studio_path) else tool.create_asset(
    "StudioSolid", studio_folder, ue.Material, ue.MaterialFactoryNew()
)
studio.set_editor_property("shading_model", ue.MaterialShadingModel.MSM_UNLIT)
studio.set_editor_property("two_sided", True)
tone = nodes.get_material_property_input_node(studio, ue.MaterialProperty.MP_EMISSIVE_COLOR) or nodes.create_material_expression(
    studio, ue.MaterialExpressionVectorParameter, -300, 0
)
tone.set_editor_property("parameter_name", "Color")
tone.set_editor_property("default_value", ue.LinearColor(.013, .018, .028, 1))
nodes.connect_material_property(tone, "RGB", ue.MaterialProperty.MP_EMISSIVE_COLOR)
nodes.recompile_material(studio)
editor.save_loaded_asset(studio)


palette = json.loads((source / "warehouse-materials.json").read_text())
palette.update(json.loads((source / "dot-record-materials.json").read_text()))
palette.update(json.loads((source / "club-venue-materials.json").read_text()))
palette.update(json.loads((source / "crate-refined-materials.json").read_text()))
palette.update(json.loads((source / "boiler-room-materials.json").read_text()))
palette.update(json.loads((source / "california-venue-materials.json").read_text()))
palette.update(json.loads((source / "alive-pyramid-materials.json").read_text()))
specifications = {token(name): (name, spec) for name, spec in palette.items()}
materials = {}

mesh_names = ("WarehouseShell", "BoothFurniture", "BoothFourCrates",
              "BrowseSleeve", "BrowseSleeveEmpty", "BoothRecord",
              "VenueFestival", "VenueNightclub", "VenueBoilerRoom", "VenueRooftop", "VenueDesert",
              "VenueArcade", "VenuePier", "VenueListening", "VenueObservatory",
              "VenueEndUp", "VenueTunnel", "VenuePublicWorks",
              "VenueSanFrancisco", "VenueLosAngeles", "VenueRoseBowl", "VenueAlivePyramid",
              "AlivePyramidPodium")
requested = os.environ.get("DOT_WAREHOUSE_MESHES", "").split()
if set(requested).difference(mesh_names):
    raise ValueError("Unknown warehouse mesh in DOT_WAREHOUSE_MESHES.")

for name in requested or mesh_names:
    task = ue.AssetImportTask()
    options = ue.FbxImportUI()
    options.set_editor_property("automated_import_should_detect_type", False)
    options.set_editor_property("mesh_type_to_import", ue.FBXImportType.FBXIT_STATIC_MESH)
    options.set_editor_property("import_materials", False)
    options.set_editor_property("import_textures", False)
    settings = options.static_mesh_import_data
    for key, value in (
        ("combine_meshes", True), ("auto_generate_collision", False), ("generate_lightmap_u_vs", False),
        ("normal_import_method", ue.FBXNormalImportMethod.FBXNIM_IMPORT_NORMALS),
    ):
        settings.set_editor_property(key, value)
    task.filename = str(source / asset_name(name, ".fbx"))
    task.destination_path = folder
    task.destination_name = name
    task.automated = task.replace_existing = task.save = True
    task.options = options
    tool.import_asset_tasks([task])
    mesh = editor.load_asset(f"{folder}/{name}")
    if not mesh:
        raise RuntimeError(f"Could not import {name}")
    for index, slot in enumerate(mesh.get_editor_property("static_materials")):
        raw = str(slot.get_editor_property("imported_material_slot_name"))
        key = token(raw)
        if key not in specifications:
            raise RuntimeError(f"{name}: missing palette material {raw}")
        if key not in materials:
            materials[key] = material(*specifications[key])
        mesh.set_material(index, materials[key])
    editor.save_loaded_asset(mesh)
    ue.log(f"DOT_WAREHOUSE_ASSET {name} bounds={mesh.get_bounds()}")

ue.log("DOT_WAREHOUSE_IMPORT_COMPLETE")
