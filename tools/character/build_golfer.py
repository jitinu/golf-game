"""Blender 4.2 + MPFB2 headless script: builds a CC0 MakeHuman golfer on a Mixamo skeleton and exports GLB.

Run: blender -b --python build_golfer.py -- /out/golfer.raw.glb
"""
import importlib
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector
from mathutils.kdtree import KDTree


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
    "muscle": 0.7,       # fit, athletic (not bodybuilder)
    "weight": 0.47,
    "proportions": 0.88,
    "height": 0.66,
})
macro["race"] = {"asian": 0.0, "caucasian": 1.0, "african": 0.0}

basemesh = HumanService.create_human(macro_detail_dict=macro)

# Fine targets on top of the macros: athletic V-shaped torso and shoulders, defined jaw/cheekbones instead of the
# soft default face, a slightly thicker neck, and hands with separated, longer fingers so the grip reads.
DETAIL_TARGETS = {
    "torso-vshape-incr": 0.35,
    "measure-shoulder-dist-incr": 0.2,
    "torso-muscle-pectoral-incr": 0.15,
    "torso-muscle-dorsi-incr": 0.15,
    "neck-scale-horiz-incr": 0.15,
    "neck-scale-depth-incr": 0.1,
    "head-oval": 0.3,
    "chin-bones-incr": 0.25,
    "chin-prominent-incr": 0.1,
    "forehead-temple-decr": 0.1,
    "nose-scale-vert-decr": 0.05,
    "mouth-upperlip-volume-incr": 0.1,
}
for side in ("l", "r"):
    DETAIL_TARGETS.update({
        f"{side}-cheek-bones-incr": 0.2,
        f"{side}-upperarm-muscle-incr": 0.2,
        f"{side}-lowerarm-muscle-incr": 0.15,
        f"{side}-upperarm-shoulder-muscle-incr": 0.15,
        f"{side}-hand-fingers-distance-incr": 0.15,
        f"{side}-hand-fingers-length-incr": 0.1,
    })
TargetService.bulk_load_targets(basemesh, [{"target": name, "value": value} for name, value in DETAIL_TARGETS.items()])

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
TEX = os.environ.get("GOLFER_TEX", os.path.join(os.path.dirname(os.path.abspath(__file__)), "out", "tex"))
# Generated golf-apparel base colours (make_textures.py) replace the generic CC0 diffuse maps.
BASECOLOR_OVERRIDES = {
    "polo": f"{TEX}/polo_basecolor.png",
    "wool_pants": f"{TEX}/pants_basecolor.png",
}
PBR_EXTRAS = {
    # material name fragment: (normal map, roughness map, roughness value, opaque)
    "polo": (f"{DATA}/clothes/namuhekam_male_polo_shirt/Polo_Normal_OpenGL.png",
             f"{DATA}/clothes/namuhekam_male_polo_shirt/Polo_Roughness.png", 0.85, True),
    "short02": (f"{DATA}/hair/short02/short02_normal.png", None, 0.55, False),
    "wool_pants": (f"{TEX}/pants_normal.png", None, 0.82, True),
    "shoes05": (f"{TEX}/shoe_normal.png", None, 0.6, True),
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
        override = BASECOLOR_OVERRIDES.get(key)
        if override and os.path.exists(override):
            base = bsdf.inputs["Base Color"]
            for link in list(tree.links):
                if link.to_socket == base:
                    tree.links.remove(link)
            tex = tree.nodes.new("ShaderNodeTexImage")
            tex.image = bpy.data.images.load(override)
            tree.links.new(tex.outputs["Color"], base)


for material in bpy.data.materials:
    wire_pbr(material)


def simple_material(name, color, roughness, metallic=0.0, texture=None):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    bsdf = next(n for n in material.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if texture and os.path.exists(texture):
        tex = material.node_tree.nodes.new("ShaderNodeTexImage")
        tex.image = bpy.data.images.load(texture)
        material.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    return material


def bind_to_bone(obj, rig, bone_name, frame):
    """Rigid attachment: geometry authored in `frame`'s local space, every vertex fully weighted to one bone."""
    group = obj.vertex_groups.new(name=bone_name)
    group.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
    modifier = obj.modifiers.new("Armature", "ARMATURE")
    modifier.object = rig
    obj.matrix_world = frame.matrix_world @ obj.matrix_world
    obj.parent = rig
    obj.matrix_parent_inverse = rig.matrix_world.inverted()


def group_weight(vertex, group_indices):
    return sum(g.weight for g in vertex.groups if g.group in group_indices)


def evaluated_vertices(obj):
    """Vertices with shape keys (MakeHuman macro/targets) and modifiers applied, as the exporter sees them."""
    return obj.evaluated_get(bpy.context.evaluated_depsgraph_get()).data.vertices


def cull_mesh_under_clothing(
    mesh_obj,
    clothing_objs,
    margin,
    side_factor=0.1,
    protected_groups=None,
    unprotected_groups=None,
    distance_only_groups=None,
    distance_only_margin=None,
    hem_boundary_points=None,
    hem_guard=0.06,
    max_z=None,
    min_z=None,
    label="mesh",
):
    """Remove mesh faces fully enclosed by evaluated clothing meshes."""
    if not clothing_objs:
        print(f"{label} clothing cull: no clothing meshes found")
        return 0, len(mesh_obj.data.polygons)

    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated_clothing = [(obj.evaluated_get(depsgraph), obj.matrix_world.copy()) for obj in clothing_objs]
    protected_groups = protected_groups or set()
    unprotected_groups = unprotected_groups or set()
    distance_only_groups = distance_only_groups or set()
    distance_only_margin = margin if distance_only_margin is None else distance_only_margin
    hem_boundary_points = hem_boundary_points or []
    covered = []
    for vertex in mesh_obj.data.vertices:
        if (
            any(group_weight(vertex, {group_index}) > 0.5 for group_index in protected_groups)
            and not any(group_weight(vertex, {group_index}) > 0.5 for group_index in unprotected_groups)
        ):
            covered.append(False)
            continue
        world_vertex = mesh_obj.matrix_world @ vertex.co
        distance_only = any(group_weight(vertex, {group_index}) > 0.5 for group_index in distance_only_groups)
        is_covered = False
        for clothing, clothing_world in evaluated_clothing:
            clothing_local = clothing_world.inverted() @ world_vertex
            hit, nearest_local, normal_local, _ = clothing.closest_point_on_mesh(
                clothing_local, distance=margin, depsgraph=depsgraph
            )
            if not hit:
                continue
            nearest_world = clothing_world @ nearest_local
            normal_world = (clothing_world.to_3x3().inverted().transposed() @ normal_local).normalized()
            offset = world_vertex - nearest_world
            distance = offset.length
            if hem_boundary_points and any((nearest_world - hem_point).length <= hem_guard for hem_point in hem_boundary_points):
                is_covered = False
                break
            coverage_margin = distance_only_margin if distance_only else margin
            if distance < coverage_margin and (
                distance_only or normal_world.dot(offset) < -side_factor * distance
            ):
                is_covered = True
                break
        covered.append(is_covered)

    bm = bmesh.new()
    bm.from_mesh(mesh_obj.data)
    faces_to_delete = [
        face for face in bm.faces
        if all(covered[vertex.index] for vertex in face.verts)
        and (max_z is None or all(vertex.co.z < max_z for vertex in face.verts))
        or (min_z is not None and all(vertex.co.z > min_z for vertex in face.verts))
    ]
    deleted_count = len(faces_to_delete)
    kept_count = len(bm.faces) - deleted_count
    if faces_to_delete:
        bmesh.ops.delete(bm, geom=faces_to_delete, context="FACES")
        bm.to_mesh(mesh_obj.data)
        mesh_obj.data.update()
    bm.free()
    print(f"{label} clothing cull: deleted {deleted_count} faces, kept {kept_count} faces")
    return deleted_count, kept_count


def clear_clothing_head_weights(clothing):
    """Keep clothing deformation driven by the torso and limbs, not head/neck bones."""
    target_groups = [
        group
        for group in clothing.vertex_groups
        if group.name.lower().endswith("head")
        or group.name.lower().endswith("neck")
        or group.name.lower().endswith("mixamorig:head")
        or group.name.lower().endswith("mixamorig:neck")
    ]
    if not target_groups:
        return
    target_indices = {group.index for group in target_groups}
    torso_group = next(
        (group for group in clothing.vertex_groups if group.name.lower().endswith("spine2")),
        None,
    )
    for vertex in clothing.data.vertices:
        removed_weight = sum(
            weight.weight for weight in vertex.groups if weight.group in target_indices
        )
        for group in target_groups:
            if any(weight.group == group.index for weight in vertex.groups):
                group.remove([vertex.index])
        remaining = [weight for weight in vertex.groups if weight.group not in target_indices]
        total = sum(weight.weight for weight in remaining)
        if torso_group is not None and removed_weight > 0:
            torso_group.add([vertex.index], removed_weight, "ADD")
            remaining = [weight for weight in vertex.groups if weight.group not in target_indices]
            total = sum(weight.weight for weight in remaining)
        if total > 0:
            for weight in remaining:
                clothing.vertex_groups[weight.group].add(
                    [vertex.index], weight.weight / total, "REPLACE"
                )
        elif torso_group is not None:
            torso_group.add([vertex.index], 1.0, "REPLACE")


def lower_hem_boundary_points(clothing):
    """Return world-space points along the lower boundary of a clothing mesh."""
    evaluated = clothing.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.data
    if not mesh.vertices:
        return []
    midpoint = (min(vertex.co.z for vertex in mesh.vertices) + max(vertex.co.z for vertex in mesh.vertices)) * 0.5
    source = bmesh.new()
    source.from_mesh(mesh)
    points = [
        clothing.matrix_world @ vertex.co
        for edge in source.edges
        if edge.is_boundary and all(vertex.co.z < midpoint for vertex in edge.verts)
        for vertex in edge.verts
    ]
    source.free()
    return points


def polo_weight_transfer_data(polo):
    """Build nearest-vertex lookup and deform weights from evaluated polo geometry."""
    evaluated = polo.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.data
    tree = KDTree(len(mesh.vertices))
    normal_matrix = polo.matrix_world.to_3x3().inverted().transposed()
    normals = []
    for vertex in mesh.vertices:
        tree.insert(polo.matrix_world @ vertex.co, vertex.index)
        normals.append((normal_matrix @ vertex.normal).normalized())
    tree.balance()
    group_names = {group.index: group.name for group in polo.vertex_groups}
    weights = [
        [
            (group_names[group.group], group.weight)
            for group in vertex.groups
            if group.group in group_names
        ]
        for vertex in mesh.vertices
    ]
    return tree, weights, normals


def copy_polo_weights_nearby(
    mesh_obj,
    transfer_data,
    max_distance=0.05,
    target_group_indices=None,
    require_inner_side=True,
):
    """Make skin under the polo deform with the nearest polo vertex."""
    if transfer_data is None:
        return 0
    tree, polo_weights, polo_normals = transfer_data
    polo_group_names = {
        name
        for weights in polo_weights
        for name, _ in weights
    }
    target_groups = {
        group.name: group
        for group in mesh_obj.vertex_groups
        if group.name in polo_group_names
    }
    copied = 0
    for vertex in mesh_obj.data.vertices:
        if target_group_indices is not None and not any(
            group.group in target_group_indices and group.weight > 0.5
            for group in vertex.groups
        ):
            continue
        world_vertex = mesh_obj.matrix_world @ vertex.co
        nearest_point, nearest, distance = tree.find(world_vertex)
        if distance > max_distance:
            continue
        offset = world_vertex - nearest_point
        if (
            require_inner_side
            and polo_normals[nearest].dot(offset) >= -0.1 * distance
        ):
            continue
        for group in list(vertex.groups):
            target_group = mesh_obj.vertex_groups[group.group]
            if target_group.name in polo_group_names:
                target_group.remove([vertex.index])
        mapped_weights = [
            (target_groups[name], weight)
            for name, weight in polo_weights[nearest]
            if name in target_groups and weight > 0
        ]
        total = sum(weight for _, weight in mapped_weights)
        if total <= 0:
            continue
        for group, weight in mapped_weights:
            group.add([vertex.index], weight / total, "REPLACE")
        copied += 1
    print(f"{mesh_obj.name} polo weight transfer: copied {copied} vertices")
    return copied


def push_vertices_under_polo(mesh_obj, transfer_data, max_distance=0.05, amount=0.012):
    """Move pants vertices under the polo slightly inward to prevent hem poke-through."""
    if transfer_data is None:
        return 0
    tree, _, _ = transfer_data
    pushed = 0
    for vertex in mesh_obj.data.vertices:
        world_vertex = mesh_obj.matrix_world @ vertex.co
        _, _, distance = tree.find(world_vertex)
        if distance > max_distance:
            continue
        normal = vertex.normal.normalized()
        if normal.length_squared == 0:
            continue
        vertex.co -= normal * amount
        pushed += 1
    if pushed:
        mesh_obj.data.update()
    print(f"{mesh_obj.name} polo inward push: moved {pushed} vertices")
    return pushed


def cull_body_under_clothing(body, clothing_objs, margin):
    """Remove body faces fully enclosed by the evaluated polo or pants meshes."""
    protected_groups = {
        group.index
        for group in body.vertex_groups
        if group.name.lower().endswith("head") or "hand" in group.name.lower()
    }
    neck_groups = {group.index for group in body.vertex_groups if group.name.lower().endswith("neck")}
    shoulder_groups = {group.index for group in body.vertex_groups if "shoulder" in group.name.lower()}
    upper_arm_groups = {
        group.index
        for group in body.vertex_groups
        if group.name.lower().endswith("leftarm") or group.name.lower().endswith("rightarm")
    }
    hip_groups = {group.index for group in body.vertex_groups if group.name.lower().endswith("hips")}
    torso_groups = {
        group.index
        for group in body.vertex_groups
        if any(group.name.lower().endswith(name) for name in ("spine", "spine1", "spine2"))
    }
    return cull_mesh_under_clothing(
        body,
        clothing_objs,
        margin,
        side_factor=0.1,
        protected_groups=protected_groups,
        unprotected_groups=neck_groups,
        distance_only_groups=(
            neck_groups
            | shoulder_groups
            | upper_arm_groups
            | hip_groups
            | torso_groups
        ),
        distance_only_margin=0.1,
        label="Body",
    )


def add_glove(body, tex_dir):
    """Left-hand golf glove: hand-weighted skin faces get a white leather material slot."""
    hand_groups = {g.index for g in body.vertex_groups if "LeftHand" in g.name}
    if not hand_groups:
        return
    glove = simple_material("Clothes_glove", (0.9, 0.88, 0.84), 0.55, texture=f"{tex_dir}/glove_basecolor.png")
    body.data.materials.append(glove)
    slot = len(body.data.materials) - 1
    verts = body.data.vertices
    covered = [group_weight(v, hand_groups) > 0.55 for v in verts]
    for poly in body.data.polygons:
        if all(covered[i] for i in poly.vertices):
            poly.material_index = slot


def add_belt(pants, rig, forward, tex_dir):
    """Belt swept around the trouser waistline (top edge loop of the pants), with a metal buckle at the front."""
    source = bmesh.new()
    source.from_mesh(pants.evaluated_get(bpy.context.evaluated_depsgraph_get()).data)
    top = max(v.co.z for v in source.verts)
    loop = [v.co.copy() for v in source.verts if v.is_boundary and v.co.z > top - 0.05]
    source.free()
    if len(loop) < 8:
        return None
    center = sum(loop, Vector()) / len(loop)
    loop.sort(key=lambda p: math.atan2(p.y - center.y, p.x - center.x))
    bm = bmesh.new()
    upper, lower = [], []
    for p in loop:
        out = Vector((p.x - center.x, p.y - center.y, 0.0)).normalized() * 0.004
        upper.append(bm.verts.new(Vector((p.x, p.y, top + 0.004)) + out))
        lower.append(bm.verts.new(Vector((p.x, p.y, top - 0.034)) + out))
    count = len(loop)
    uv_layer = bm.loops.layers.uv.new("UVMap")
    for i in range(count):
        j = (i + 1) % count
        face = bm.faces.new((lower[i], lower[j], upper[j], upper[i]))
        for loop_item, uv in zip(face.loops, ((i, 0.0), (i + 1, 0.0), (i + 1, 1.0), (i, 1.0))):
            loop_item[uv_layer].uv = (uv[0] * 8.0 / count, uv[1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new("belt")
    bm.to_mesh(mesh)
    bm.free()
    belt = bpy.data.objects.new("Clothes_belt", mesh)
    bpy.context.scene.collection.objects.link(belt)
    solidify = belt.modifiers.new("Solidify", "SOLIDIFY")
    solidify.thickness = 0.006
    solidify.offset = 1.0
    belt.data.materials.append(simple_material("Clothes_belt", (0.24, 0.16, 0.12), 0.45, texture=f"{tex_dir}/belt_basecolor.png"))
    bind_to_bone(belt, rig, "mixamorig:Hips", pants)

    front = max(loop, key=lambda p: (p.y - center.y) * forward)
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(front.x, front.y + forward * 0.01, top - 0.015))
    buckle = bpy.context.active_object
    buckle.name = "Clothes_buckle"
    buckle.scale = (0.05, 0.008, 0.03)
    bpy.ops.object.transform_apply(scale=True)
    bevel = buckle.modifiers.new("Bevel", "BEVEL")
    bevel.width = 0.003
    bevel.segments = 3
    buckle.data.materials.append(simple_material("Clothes_buckle", (0.75, 0.75, 0.72), 0.3, metallic=1.0))
    bind_to_bone(buckle, rig, "mixamorig:Hips", pants)
    return [belt, buckle]


def head_vertices(body):
    head_groups = {g.index for g in body.vertex_groups if g.name.endswith("Head")}
    return [v.co.copy() for v in evaluated_vertices(body) if group_weight(v, head_groups) > 0.8]


def facing_sign(body, eyes):
    """+1/-1 along Blender Y: the eyes sit in front of the skull centroid."""
    head = head_vertices(body)
    eye_verts = evaluated_vertices(eyes)
    head_center = sum(head, Vector()) / len(head)
    eye_center = sum((v.co for v in eye_verts), Vector()) / len(eye_verts)
    return -1.0 if eye_center.y < head_center.y else 1.0


def add_cap(body, rig, eyes, tex_dir):
    """Golf cap fitted to the skull: dome sized to the skull band above the hairline, curved front brim, top button."""
    head = head_vertices(body)
    if not head:
        return None
    forward = facing_sign(body, eyes)
    top = max(v.z for v in head)
    cut = top - 0.078
    band = [v for v in head if v.z > cut]
    center = sum(band, Vector()) / len(band)
    center.z = cut
    rx = max(abs(v.x - center.x) for v in band) + 0.022
    ry = max(abs(v.y - center.y) for v in band) + 0.022
    rz = (top - cut) + 0.028

    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=40, v_segments=20, radius=1.0)
    for v in bm.verts:
        v.co = Vector((center.x + v.co.x * rx, center.y + v.co.y * ry, center.z + v.co.z * rz))
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < cut], context="VERTS")
    # Flatten the cut edge so the hairline sits level.
    edge_verts = [v for v in bm.verts if v.is_boundary]
    for v in edge_verts:
        v.co.z = cut
    # Brim: sweep the front 120 degrees of the rim outward and slightly down.
    front_verts = sorted(
        [v for v in edge_verts if (v.co.y - center.y) * forward > 0.25 * ry],
        key=lambda v: math.atan2(v.co.x - center.x, (v.co.y - center.y) * forward),
    )
    outer = []
    for v in front_verts:
        angle = math.atan2(v.co.x - center.x, (v.co.y - center.y) * forward)
        reach = 0.07 * max(0.0, math.cos(angle * 1.1))
        direction = Vector((v.co.x - center.x, v.co.y - center.y, 0.0)).normalized()
        outer.append(bm.verts.new(v.co + direction * reach + Vector((0.0, 0.0, -0.012 * (reach / 0.07)))))
    for i in range(len(front_verts) - 1):
        bm.faces.new((front_verts[i], front_verts[i + 1], outer[i + 1], outer[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.verts.index_update()
    mesh = bpy.data.meshes.new("cap")
    bm.to_mesh(mesh)
    bm.free()
    cap = bpy.data.objects.new("Clothes_cap", mesh)
    bpy.context.scene.collection.objects.link(cap)
    bpy.context.view_layer.objects.active = cap
    cap.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02)
    bpy.ops.object.mode_set(mode="OBJECT")
    solidify = cap.modifiers.new("Solidify", "SOLIDIFY")
    solidify.thickness = 0.004
    solidify.offset = 1.0
    cap.data.materials.append(simple_material("Clothes_cap", (0.92, 0.92, 0.9), 0.75, texture=f"{tex_dir}/cap_basecolor.png"))
    bind_to_bone(cap, rig, "mixamorig:Head", body)

    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.011, location=(center.x, center.y, center.z + rz + 0.002))
    button = bpy.context.active_object
    button.name = "Clothes_cap_button"
    button.data.materials.append(simple_material("Clothes_cap_button", (0.92, 0.92, 0.9), 0.7))
    bind_to_bone(button, rig, "mixamorig:Head", body)
    return [cap, button]

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
        # MPFB leaves asset subdivision at viewport level 0; clothing and shoes export one level smoothed so fabric
        # folds and toe boxes are not faceted at the address camera.
        if otype == "Clothes":
            for modifier in child.modifiers:
                if modifier.type == "SUBSURF":
                    modifier.levels = 1
        child.name = otype if otype else child.name
        for slot in child.material_slots:
            if slot.material:
                slot.material.name = f"{otype}_{slot.material.name}".replace("_export", "")


if bpy.context.object and bpy.context.object.mode != "OBJECT":
    bpy.ops.object.mode_set(mode="OBJECT")
bpy.ops.object.select_all(action="DESELECT")


def child_with_material(fragment):
    return next((c for c in children if any(s.material and fragment in s.material.name for s in c.material_slots)), None)


pants_obj = child_with_material("wool_pants")
eyes_obj = child_with_material("high-poly")
culling_polo = child_with_material("polo")
culling_clothes = [obj for obj in (culling_polo, pants_obj) if obj is not None]
if culling_polo is not None:
    clear_clothing_head_weights(culling_polo)
    polo_transfer_data = polo_weight_transfer_data(culling_polo)
else:
    polo_transfer_data = None
cull_body_under_clothing(export_basemesh, culling_clothes, 0.05)
add_glove(export_basemesh, TEX)
extras = []
if eyes_obj is not None:
    facing = facing_sign(export_basemesh, eyes_obj)
    if pants_obj is not None:
        extras += add_belt(pants_obj, export_root, facing, TEX) or []
        cull_pants_clothing = [culling_polo] if culling_polo is not None else []
        cull_mesh_under_clothing(
            pants_obj,
            cull_pants_clothing,
            0.03,
            side_factor=0.1,
            hem_boundary_points=lower_hem_boundary_points(culling_polo) if culling_polo is not None else [],
            label="Pants",
        )
        copy_polo_weights_nearby(
            pants_obj,
            polo_transfer_data,
            require_inner_side=False,
        )
        push_vertices_under_polo(pants_obj, polo_transfer_data)
        copy_polo_weights_nearby(
            export_basemesh,
            polo_transfer_data,
            max_distance=0.025,
            target_group_indices=(
                {
                    group.index
                    for group in export_basemesh.vertex_groups
                    if group.name.lower().endswith("neck")
                    or "shoulder" in group.name.lower()
                    or group.name.lower().endswith("leftarm")
                    or group.name.lower().endswith("rightarm")
                    or group.name.lower().endswith("hips")
                    or group.name.lower().endswith("spine2")
                }
            ),
        )
        copy_polo_weights_nearby(
            export_basemesh,
            polo_transfer_data,
            max_distance=0.03,
            target_group_indices={
                group.index
                for group in export_basemesh.vertex_groups
                if group.name.lower().endswith("spine2")
            },
            require_inner_side=False,
        )
    extras += add_cap(export_basemesh, export_root, eyes_obj, TEX) or []
children = list(children) + extras

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
