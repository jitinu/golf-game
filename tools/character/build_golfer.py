"""Blender 4.2 + MPFB2 headless script: builds a CC0 MakeHuman golfer on a Mixamo skeleton and exports GLB.

Run: blender -b --python build_golfer.py -- /out/golfer.raw.glb
"""
import importlib
import os
import sys

import bpy


def dynamic_import(absolute_package_str, key):
    for amod in list(sys.modules):
        if amod.endswith(absolute_package_str):
            mod = importlib.import_module(amod)
            return getattr(mod, key)
    raise ValueError(absolute_package_str)


HumanService = dynamic_import("mpfb.services.humanservice", "HumanService")
AssetService = dynamic_import("mpfb.services.assetservice", "AssetService")
ExportService = dynamic_import("mpfb.services.exportservice", "ExportService")
ObjectService = dynamic_import("mpfb.services.objectservice", "ObjectService")
TargetService = dynamic_import("mpfb.services.targetservice", "TargetService")

out_path = sys.argv[sys.argv.index("--") + 1]

# Fresh scene
bpy.ops.wm.read_homefile(use_empty=True)

macro = TargetService.get_default_macro_info_dict()
macro.update({
    "gender": 1.0,
    "age": 0.5,          # ~25 y
    "muscle": 0.62,
    "weight": 0.5,
    "proportions": 0.75,
    "height": 0.62,
})
macro["race"] = {"asian": 0.0, "caucasian": 1.0, "african": 0.0}

basemesh = HumanService.create_human(macro_detail_dict=macro)

skin = AssetService.find_asset_absolute_path("young_caucasian_male.mhmat", asset_subdir="skins")
HumanService.set_character_skin(skin, basemesh, skin_type="GAMEENGINE")

HumanService.add_builtin_rig(basemesh, "mixamo")

assets = [
    ("eyes", "high-poly.mhclo", "Eyes"),
    ("eyebrows", "eyebrow002.mhclo", "Eyebrows"),
    ("eyelashes", "eyelashes02.mhclo", "Eyelashes"),
    ("teeth", "teeth_base.mhclo", "Teeth"),
    ("hair", "short02.mhclo", "Hair"),
    ("clothes", "namuhekam_male_polo_shirt.mhclo", "Clothes"),
    ("clothes", "toigo_wool_pants.mhclo", "Clothes"),
    ("clothes", "shoes05.mhclo", "Clothes"),
]
for subdir, fname, atype in assets:
    path = AssetService.find_asset_absolute_path(fname, asset_subdir=subdir)
    if path is None:
        raise RuntimeError(f"missing asset {fname}")
    HumanService.add_mhclo_asset(path, basemesh, asset_type=atype, material_type="GAMEENGINE", subdiv_levels=1)

DATA = os.environ.get("MPFB_DATA", os.path.expanduser("~/.config/blender/4.2/extensions/.user/user_default/mpfb/data"))
PBR_EXTRAS = {
    # material name fragment: (normal map, roughness map, roughness value, opaque)
    "polo": (f"{DATA}/clothes/namuhekam_male_polo_shirt/Polo_Normal_OpenGL.png",
             f"{DATA}/clothes/namuhekam_male_polo_shirt/Polo_Roughness.png", 0.85, True),
    "short02": (f"{DATA}/hair/short02/short02_normal.png", None, 0.55, False),
    "shoes05": (None, None, 0.6, True),
    "wool_pants": (None, None, 0.9, True),
    "body": (None, None, 0.55, True),
    "teeth": (None, None, 0.35, True),
    "high-poly": (None, None, 0.1, True),
    "eyebrow": (None, None, 0.6, False),
    "eyelashes": (None, None, 0.6, False),
}


def wire_pbr(material):
    tree = material.node_tree
    if tree is None:
        return
    bsdf = next((n for n in tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        return
    for key, (normal_path, rough_path, rough_value, opaque) in PBR_EXTRAS.items():
        if key not in material.name:
            continue
        bsdf.inputs["Roughness"].default_value = rough_value
        if opaque:
            for link in list(tree.links):
                if link.to_node == bsdf and link.to_socket.name == "Alpha":
                    tree.links.remove(link)
            bsdf.inputs["Alpha"].default_value = 1.0
            material.blend_method = "OPAQUE"
        else:
            material.blend_method = "BLEND"
        if normal_path and os.path.exists(normal_path) and not bsdf.inputs["Normal"].is_linked:
            img = bpy.data.images.load(normal_path)
            img.colorspace_settings.name = "Non-Color"
            tex = tree.nodes.new("ShaderNodeTexImage")
            tex.image = img
            nm = tree.nodes.new("ShaderNodeNormalMap")
            nm.inputs["Strength"].default_value = 1.0
            tree.links.new(tex.outputs["Color"], nm.inputs["Color"])
            tree.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
        if rough_path and os.path.exists(rough_path):
            img = bpy.data.images.load(rough_path)
            img.colorspace_settings.name = "Non-Color"
            tex = tree.nodes.new("ShaderNodeTexImage")
            tex.image = img
            tree.links.new(tex.outputs["Color"], bsdf.inputs["Roughness"])


for material in bpy.data.materials:
    wire_pbr(material)

# Subdivide the body once so the head/hands read smooth at close range.
if not any(m.type == "SUBSURF" for m in basemesh.modifiers):
    mod = basemesh.modifiers.new("Subdivision", "SUBSURF")
    mod.levels = 1
    mod.render_levels = 1

export_root = ExportService.create_character_copy(basemesh, name_suffix="_export")
export_basemesh = ObjectService.find_object_of_type_amongst_nearest_relatives(export_root, "Basemesh")
ExportService.bake_modifiers_remove_helpers(
    export_basemesh, bake_masks=True, bake_subdiv=True, remove_helpers=True, also_proxy=True
)

# Rename meshes by role so the runtime can classify materials.
children = ObjectService.get_list_of_children(export_root)
for child in children:
    otype = ObjectService.get_object_type(child) or ""
    if child.type == "MESH":
        child.name = otype if otype else child.name
        for slot in child.material_slots:
            if slot.material:
                slot.material.name = f"{otype}_{slot.material.name}".replace("_export", "")

# Downscale big textures to 2K for the web.
for img in bpy.data.images:
    if img.size[0] > 2048 or img.size[1] > 2048:
        img.scale(min(img.size[0], 2048), min(img.size[1], 2048))

bpy.ops.object.select_all(action="DESELECT")
export_root.select_set(True)
for child in children:
    child.select_set(True)
bpy.context.view_layer.objects.active = export_root

bpy.ops.export_scene.gltf(
    filepath=out_path,
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_yup=True,
    export_skins=True,
    export_animations=False,
    export_morph=False,
    export_image_format="AUTO",
    export_texcoords=True,
    export_normals=True,
    export_tangents=False,
    export_materials="EXPORT",
    export_def_bones=False,
    export_rest_position_armature=True,
)

for child in children:
    if child.type == "MESH":
        me = child.evaluated_get(bpy.context.evaluated_depsgraph_get()).data
        print(f"MESH {child.name}: {len(me.polygons)} polys, mats={[s.material.name for s in child.material_slots if s.material]}")
print(f"Wrote {out_path}")
