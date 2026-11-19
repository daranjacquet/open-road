"""Turn a third-party car model into a game car (parts, pivots, wheels, materials), driven by a mapping.

    blender -b --factory-startup -P art/import_car.py -- <id> [--preview out.png]

Reads art/imports/<id>.json:

    {
      "source": "art/sources/<id>/scene.gltf",       # .glb/.gltf/.fbx/.obj/.blend
      "forward": "-Y",                                  # which Blender axis the car's nose points along
      "length": 4.49,                                   # overall length in metres (rescale)
      "drop": ["(?i)logo|badge|emblem|plane"],          # objects to delete (regex on object or material name)
      "materials": {"paint": ["(?i)body|paint"], "glass": ["(?i)glass|window"], ...},
      "parts":  {"hood": ["(?i)hood|bonnet"], "door_FL": ["..."], ...},   # whole objects -> part
      "split":  {"door_FL": {"from": "body", "box": [x0, x1, y0, y1, z0, z1]}, ...},  # faces in a box -> part
      "wheels": {"FL": ["(?i)wheel.*fl"], ...},          # objects making up each wheel (or "auto")
      "tire_material": ["(?i)tire|tyre|rubber"],
      "max_triangles": 80000
    }

Everything that is not a named part, a wheel or dropped is joined into `body`. Output: art/blend/<id>.blend
and art/build/<id>.glb; then `node scripts/optimize-models.mjs` writes public/models/<id>.glb.
"""
import json
import os
import re
import sys

import bpy
import bmesh
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

from lib.importer import apply_all_transforms, load_any, orient_and_scale, quick_render, scene_bbox, tri_count, world_bbox  # noqa: E402

PARTS = ["hood", "trunk", "door_FL", "door_FR", "door_RL", "door_RR", "bumper_F", "bumper_R",
         "light_FL", "light_FR", "light_RL", "light_RR", "mirror_L", "mirror_R"]
# Game palette: the loader adds scuffs to `paint` and cracks to `glass*` by material name.
PALETTE = {
    "paint": dict(color=(0.05, 0.18, 0.55), metallic=0.6, roughness=0.25, coat=1.0),
    "glass": dict(color=(0.08, 0.1, 0.12), metallic=0.0, roughness=0.05, alpha=0.35),
    "glass_dark": dict(color=(0.02, 0.02, 0.03), metallic=0.0, roughness=0.05, alpha=0.75),
    "chrome": dict(color=(0.9, 0.9, 0.9), metallic=1.0, roughness=0.12),
    "trim_matte": dict(color=(0.03, 0.03, 0.035), metallic=0.0, roughness=0.6),
    "tire": dict(color=(0.025, 0.025, 0.025), metallic=0.0, roughness=0.9),
    "rim": dict(color=(0.55, 0.56, 0.58), metallic=0.9, roughness=0.3),
    "light_lens": dict(color=(0.9, 0.92, 0.95), metallic=0.0, roughness=0.05, alpha=0.5),
    "light_red": dict(color=(0.6, 0.02, 0.02), metallic=0.0, roughness=0.15),
    "light_amber": dict(color=(0.9, 0.45, 0.02), metallic=0.0, roughness=0.15),
    "interior": dict(color=(0.04, 0.04, 0.045), metallic=0.0, roughness=0.8),
    "underbody": dict(color=(0.02, 0.02, 0.02), metallic=0.0, roughness=0.9),
}


def args():
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    return a[0], (a[a.index("--preview") + 1] if "--preview" in a else None)


def any_match(patterns, *names):
    return any(re.search(p, n or "") for p in patterns for n in names)


def palette_material(name):
    m = bpy.data.materials.get(name)
    if m:
        return m
    spec = PALETTE[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*spec["color"], 1.0)
    b.inputs["Metallic"].default_value = spec["metallic"]
    b.inputs["Roughness"].default_value = spec["roughness"]
    if spec.get("coat"):
        b.inputs["Coat Weight"].default_value = spec["coat"]
    if spec.get("alpha", 1.0) < 1.0:
        b.inputs["Alpha"].default_value = spec["alpha"]
        m.surface_render_method = "BLENDED"
    return m


def remap_materials(rules):
    """Every slot goes to a palette material (first rule that matches the material or object name)."""
    unmatched = set()
    for o in bpy.data.objects:
        if o.type != "MESH":
            continue
        for slot in o.material_slots:
            src = slot.material.name if slot.material else ""
            target = next((k for k, pats in rules.items() if any_match(pats, src, o.name)), None)
            if target is None:
                unmatched.add(src)
                target = "trim_matte"
            slot.material = palette_material(target)
    if unmatched:
        print("[import] materials without a rule (-> trim_matte):", sorted(unmatched))


def join(objs, name):
    objs = [o for o in objs if o and o.type == "MESH"]
    if not objs:
        return None
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = name
    o.data.name = name
    return o


def split_box(src, box, name):
    """Move the faces of `src` whose centres fall inside box (Blender axes) into a new object."""
    x0, x1, y0, y1, z0, z1 = box
    bm = bmesh.new()
    bm.from_mesh(src.data)
    out = bmesh.new()
    sel = [f for f in bm.faces if x0 <= f.calc_center_median().x <= x1 and y0 <= f.calc_center_median().y <= y1 and z0 <= f.calc_center_median().z <= z1]
    if not sel:
        print(f"[import] split {name}: no faces in box")
        return None
    me = bpy.data.meshes.new(name)
    tmp = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(tmp)
    # Copy selected faces into the new mesh.
    vmap = {}
    for f in sel:
        for v in f.verts:
            if v not in vmap:
                vmap[v] = out.verts.new(v.co)
    out.verts.ensure_lookup_table()
    uv_src = bm.loops.layers.uv.active
    uv_dst = out.loops.layers.uv.new("UVMap") if uv_src else None
    for f in sel:
        nf = out.faces.new([vmap[v] for v in f.verts])
        nf.material_index = f.material_index
        nf.smooth = f.smooth
        if uv_src:
            for la, lb in zip(f.loops, nf.loops):
                lb[uv_dst].uv = la[uv_src].uv
    out.to_mesh(me)
    for m in src.data.materials:
        me.materials.append(m)
    bmesh.ops.delete(bm, geom=sel, context="FACES")
    bm.to_mesh(src.data)
    bm.free()
    out.free()
    return tmp


def set_pivot(o, pivot_blender):
    """Store the hinge point for the game (chassis frame: x, z, -y of Blender)."""
    o["chassis_pivot"] = [pivot_blender.x, pivot_blender.z, -pivot_blender.y]


def default_pivot(name, o):
    lo, hi = world_bbox(o)
    c = (lo + hi) / 2
    if name.startswith("door_"):
        # Front edge (nose is -Y), outer side, mid height.
        x = hi.x if c.x > 0 else lo.x
        return Vector((x, lo.y, c.z))
    if name == "hood":
        return Vector((c.x, hi.y, hi.z))  # rear edge, at the windscreen
    if name == "trunk":
        return Vector((c.x, lo.y, hi.z))  # front edge, at the rear window
    return c


def wheel_objects(rules):
    """Objects per wheel: from regex rules, or 'auto' by position (the four lowest clusters at the corners)."""
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    out = {}
    for tag in ("FL", "FR", "RL", "RR"):
        pats = rules.get(tag, []) if isinstance(rules, dict) else []
        if pats:
            out[tag] = [o for o in meshes if any_match(pats, o.name)]
    if len(out) == 4:
        return out
    # Auto: objects entirely below 70 % of the lowest-half height, grouped by corner.
    lo, hi = scene_bbox(meshes)
    limit = lo.z + (hi.z - lo.z) * 0.55
    for o in meshes:
        a, b = world_bbox(o)
        if b.z > limit or (b - a).length > 1.2:
            continue
        c = (a + b) / 2
        if abs(c.y) < (hi.y - lo.y) * 0.2:
            continue
        tag = ("F" if c.y < 0 else "R") + ("L" if c.x > 0 else "R")
        out.setdefault(tag, []).append(o)
    return out


def rebuild_wheels(groups, tire_rules):
    """Each wheel becomes tire_XX + rim_XX at the origin, axle along X; returns wheel centres."""
    centres = {}
    for tag, objs in groups.items():
        lo, hi = scene_bbox(objs)
        c = (lo + hi) / 2
        centres[tag] = c
        tire, rim = [], []
        for o in objs:
            # Split by material: tyre rubber vs everything else.
            names = [s.material.name if s.material else "" for s in o.material_slots]
            if all(any_match(tire_rules, n) for n in names):
                tire.append(o)
            elif not any(any_match(tire_rules, n) for n in names):
                rim.append(o)
            else:
                bpy.ops.object.select_all(action="DESELECT")
                o.select_set(True)
                bpy.context.view_layer.objects.active = o
                bpy.ops.object.mode_set(mode="EDIT")
                bpy.ops.mesh.separate(type="MATERIAL")
                bpy.ops.object.mode_set(mode="OBJECT")
                for p in bpy.context.selected_objects:
                    pn = [s.material.name if s.material else "" for s in p.material_slots]
                    (tire if any(any_match(tire_rules, n) for n in pn) else rim).append(p)
        for group, name in ((tire, f"tire_{tag}"), (rim, f"rim_{tag}")):
            o = join(group, name)
            if o is None:
                continue
            o.data.transform(Matrix.Translation(-c))
            o["chassis_pivot"] = [0.0, 0.0, 0.0]
            o["wheel"] = tag
    return centres


def decimate_to(max_tris):
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    total = sum(tri_count(o) for o in meshes)
    if total <= max_tris:
        return total
    ratio = max_tris / total
    for o in meshes:
        if tri_count(o) < 400:
            continue
        mod = o.modifiers.new("dec", "DECIMATE")
        mod.ratio = ratio
        mod.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return sum(tri_count(o) for o in meshes)


def main():
    car_id, preview = args()
    spec = json.load(open(os.path.join(HERE, "imports", f"{car_id}.json")))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    load_any(os.path.join(ROOT, spec["source"]))
    apply_all_transforms()
    # Drop logos, ground planes, cameras' leftovers.
    for o in list(bpy.data.objects):
        mats = [s.material.name if s.material else "" for s in o.material_slots] if o.type == "MESH" else []
        if any_match(spec.get("drop", []), o.name, *mats):
            bpy.data.objects.remove(o, do_unlink=True)
    lo, hi = orient_and_scale(spec.get("forward", "-Y"), spec.get("length"))
    remap_materials(spec["materials"])
    wheels = rebuild_wheels(wheel_objects(spec.get("wheels", "auto")), spec.get("tire_material", ["(?i)tire|tyre"]))

    parts = {}
    for name, pats in spec.get("parts", {}).items():
        objs = [o for o in bpy.data.objects if o.type == "MESH" and "wheel" not in o.keys() and any_match(pats, o.name)]
        if objs:
            parts[name] = join(objs, name)
    rest = [o for o in bpy.data.objects if o.type == "MESH" and "wheel" not in o.keys() and o.name not in parts]
    body = join(rest, "body")
    parts["body"] = body
    for name, s in spec.get("split", {}).items():
        src = parts.get(s.get("from", "body"))
        o = split_box(src, s["box"], name) if src else None
        if o:
            parts[name] = o
    for name, o in parts.items():
        o["part_name"] = name
        set_pivot(o, default_pivot(name, o) if name != "body" else Vector((0, 0, 0)))
    tris = decimate_to(spec.get("max_triangles", 80000))

    # Report what the physics config needs: wheel centres and overall size, in the game frame.
    game = {k: [round(v.x, 3), round(v.z, 3), round(-v.y, 3)] for k, v in wheels.items()}
    print(f"[import] {car_id}: {tris} triangles, size {tuple(round(x, 2) for x in (hi - lo))}, parts {sorted(parts)}")
    print("[import] wheel centres (game frame x, y, z):", json.dumps(game))
    print("[import] missing parts:", [p for p in PARTS if p not in parts])

    os.makedirs(os.path.join(HERE, "blend"), exist_ok=True)
    os.makedirs(os.path.join(HERE, "build"), exist_ok=True)
    bpy.context.preferences.filepaths.save_version = 0
    blend = os.path.join(HERE, "blend", f"{car_id}.blend")
    if os.path.exists(blend):
        os.remove(blend)
    bpy.ops.wm.save_as_mainfile(filepath=blend, compress=True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(HERE, "build", f"{car_id}.glb"), export_format="GLB", export_extras=True, export_yup=True, export_apply=True)
    if preview:
        quick_render(preview, *scene_bbox([o for o in bpy.data.objects if o.type == "MESH"]))


main()
