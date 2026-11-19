"""Turn a third-party car model into a game car (parts, pivots, wheels, materials), driven by a mapping.

    blender -b --factory-startup -P art/import_car.py -- <id> [--preview out.png] [--views DIR]

Reads art/imports/<id>.json (every box and point is in the GAME frame: x left, y up, z forward,
metres, origin = chassis origin):

    {
      "source": "art/sources/<id>/model.glb",          # .glb/.gltf/.fbx/.obj/.blend
      "credit": "Model by ... (Sketchfab), CC BY 4.0",
      "forward": "+X",                                  # Blender axis the nose points along in the source
      "length": 4.49,                                   # overall length in metres (rescale)
      "drop": ["(?i)badge"],                            # objects to delete (regex on object or material name)
      "materials": {"paint": ["(?i)body"], "glass": ["(?i)transp"]},   # rename source materials (textures kept)
      "object_materials": {"(?i)bumper": "trim_matte"},                # per-object material copy, renamed
      "wheels": {"FL": ["(?i)wheel.*_FL"], ...},       # objects making up each wheel
      "calipers": ["(?i)caliper|brake"],               # wheel objects that do not spin
      "tire_material": ["(?i)tire"],                   # material of the spinning wheel meshes named tire_XX
      "parts":  {"hood": ["(?i)hood"], ...},           # whole objects -> part (joined)
      "split":  {"door_FL": {"from": "body", "box": [x0, x1, y0, y1, z0, z1]}, ...},  # faces in a box -> part
      "restyle": [{"material": "underbody", "box": [...], "to": "trim_matte"}],  # faces of a material in a box
      "merge": {"trunk": ["trunk_skin"]},                              # parts joined after the splits
      "split_sides": {"lights_F": ["light_FL", "light_FR"]},          # a part cut into left / right halves
      "paint_color": [0.9, 0.05, 0.03],                                 # linear RGB override for `paint`
      "max_triangles": 80000,
      "max_texture": 1024
    }

Everything that is not a named part, a wheel or dropped is joined into `body`. The chassis origin is
put where the physics expects it: above the wheel centres by the suspension's rest length (read from
src/vehicle/cars/<id>.json). Output: art/blend/<id>.blend, art/build/<id>.glb and
art/build/<id>.measure.json (wheel centres, radius, body and cabin boxes for scripts/fit-car-config.mjs);
then `node scripts/optimize-models.mjs` writes public/models/<id>.glb.
"""
import json
import os
import re
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

from lib.importer import apply_all_transforms, load_any, orient_and_scale, quick_render, scene_bbox, tri_count, world_bbox  # noqa: E402

PARTS = ["hood", "trunk", "door_FL", "door_FR", "door_RL", "door_RR", "bumper_F", "bumper_R",
         "light_FL", "light_FR", "light_RL", "light_RR", "mirror_L", "mirror_R"]
G = 9.81


def args():
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    opt = lambda k: a[a.index(k) + 1] if k in a else None  # noqa: E731
    return a[0], opt("--preview"), opt("--views")


def any_match(patterns, *names):
    return any(re.search(p, n or "") for p in patterns for n in names)


def g2b(x, y, z):
    """Game frame (x left, y up, z forward) to Blender (x left, -y forward, z up) after orient."""
    return Vector((x, -z, y))


def b2g(v):
    return [round(v.x, 4), round(v.z, 4), round(-v.y, 4)]


def meshes():
    return [o for o in bpy.data.objects if o.type == "MESH"]


# ---- materials -------------------------------------------------------------------------------------

def rename_materials(rules, per_object):
    """Rename source materials to the names the game reacts to; textures are kept. Several source
    materials mapped to one name are merged onto the first. Per-object overrides get a renamed copy."""
    for pat, new in per_object.items():
        for o in meshes():
            if not re.search(pat, o.name):
                continue
            for slot in o.material_slots:
                if slot.material and slot.material.name != new:
                    m = slot.material.copy()
                    m.name = new
                    slot.material = m
    chosen = {}
    for m in list(bpy.data.materials):
        target = next((k for k, pats in rules.items() if any_match(pats, m.name)), None)
        if target is None or m.name in per_object.values():
            continue
        if target in chosen:
            for o in meshes():
                for slot in o.material_slots:
                    if slot.material == m:
                        slot.material = chosen[target]
        else:
            m.name = target
            chosen[target] = m



def glass_setup():
    """Plain tinted glass: the game draws cracks on it, a source texture would only fight that (and
    some, single-channel ones, cannot be written as WebP)."""
    m = bpy.data.materials.get("glass")
    if not (m and m.use_nodes):
        return
    nt = m.node_tree
    b = nt.nodes.get("Principled BSDF")
    for n in list(nt.nodes):
        if n.type in ("TEX_IMAGE", "MIX", "MATH", "SEPARATE_COLOR", "MIX_RGB"):
            nt.nodes.remove(n)
    if b:
        b.inputs["Base Color"].default_value = (0.05, 0.06, 0.07, 1.0)
        b.inputs["Alpha"].default_value = 0.35
        b.inputs["Roughness"].default_value = 0.05
        b.inputs["Metallic"].default_value = 0.0
    m.surface_render_method = "BLENDED"


def paint_setup(color):
    """Clear-coated body paint, optionally recoloured."""
    m = bpy.data.materials.get("paint")
    if not (m and m.use_nodes):
        return
    b = m.node_tree.nodes.get("Principled BSDF")
    if not b:
        return
    b.inputs["Coat Weight"].default_value = 1.0
    b.inputs["Coat Roughness"].default_value = 0.04
    # Source roughness/metal maps tend to make paint fully matte (washed out under the sun): use a
    # satin metallic paint under the clear coat instead.
    for sock in ("Roughness", "Metallic"):
        for link in list(b.inputs[sock].links):
            m.node_tree.links.remove(link)
    b.inputs["Roughness"].default_value = 0.38
    b.inputs["Metallic"].default_value = 0.35
    if color:
        b.inputs["Base Color"].default_value = (*color, 1.0)


def shrink_textures(max_size):
    for img in bpy.data.images:
        w, h = img.size
        if max(w, h) > max_size:
            k = max_size / max(w, h)
            img.scale(max(1, int(w * k)), max(1, int(h * k)))


# ---- objects ---------------------------------------------------------------------------------------

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


def split_faces(src, test, name, material=None):
    """Move the faces of `src` whose centre passes `test(Vector)` (and, if given, that use the
    material named `material`) into a new object `name`."""
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = src
    src.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bm = bmesh.from_edit_mesh(src.data)
    n = 0
    mats = [m.name if m else "" for m in src.data.materials]
    for f in bm.faces:
        ok = test(f.calc_center_median())
        if ok and material is not None:
            ok = f.material_index < len(mats) and mats[f.material_index] == material
        f.select = ok
        n += f.select
    bmesh.update_edit_mesh(src.data)
    if n == 0:
        bpy.ops.object.mode_set(mode="OBJECT")
        print(f"[import] split {name}: no faces")
        return None
    bpy.ops.mesh.separate(type="SELECTED")
    bpy.ops.object.mode_set(mode="OBJECT")
    new = [o for o in bpy.context.selected_objects if o != src][0]
    new.name = name
    new.data.name = name
    return new


def restyle(rules):
    """Give faces of one material inside a box another material (a renamed copy, textures kept), e.g. so
    the outer roof or grille counts as the visible shell the crumple rays measure."""
    for r in rules:
        test = in_box(r["box"])
        for o in meshes():
            names = [m.name if m else "" for m in o.data.materials]
            if r["material"] not in names:
                continue
            src_i = names.index(r["material"])
            target = bpy.data.materials.get(r["to"])
            if target is None:
                target = o.data.materials[src_i].copy()
                target.name = r["to"]
            if target.name not in names:
                o.data.materials.append(target)
            dst_i = [m.name if m else "" for m in o.data.materials].index(target.name)
            mw = o.matrix_world
            n = 0
            for f in o.data.polygons:
                if f.material_index == src_i and test(mw @ f.center):
                    f.material_index = dst_i
                    n += 1
            if n:
                print(f"[import] restyle {o.name}: {n} faces {r['material']} -> {r['to']}")


def in_box(box):
    x0, x1, y0, y1, z0, z1 = box
    a = g2b(x0, y0, z0)
    b = g2b(x1, y1, z1)
    lo = Vector((min(a.x, b.x), min(a.y, b.y), min(a.z, b.z)))
    hi = Vector((max(a.x, b.x), max(a.y, b.y), max(a.z, b.z)))
    return lambda c: lo.x <= c.x <= hi.x and lo.y <= c.y <= hi.y and lo.z <= c.z <= hi.z


def default_pivot(name, o):
    lo, hi = world_bbox(o)
    c = (lo + hi) / 2
    if name.startswith("door_"):
        x = hi.x if c.x > 0 else lo.x
        return Vector((x, lo.y, c.z))  # front edge (nose is -Y), outer side, mid height
    if name == "hood":
        return Vector((c.x, hi.y, hi.z))  # rear edge, at the windscreen
    if name == "trunk":
        return Vector((c.x, lo.y, hi.z))  # front edge, at the rear window
    return c


# ---- wheels ----------------------------------------------------------------------------------------

def rebuild_wheels(spec):
    """Each wheel's objects become tire_XX (spinning) and caliper_XX (fixed) at the origin, axle along
    X. Returns wheel centres (Blender frame), radius and width."""
    out = {}
    radius = []
    width = []
    for tag, pats in spec["wheels"].items():
        objs = [o for o in meshes() if any_match(pats, o.name)]
        if not objs:
            raise RuntimeError(f"wheel {tag}: no objects match {pats}")
        spin = [o for o in objs if not any_match(spec.get("calipers", ["(?i)caliper"]), o.name)]
        fixed = [o for o in objs if o not in spin]
        lo, hi = scene_bbox(spin)
        c = (lo + hi) / 2
        out[tag] = c
        radius.append((hi.z - lo.z) / 2)
        width.append(hi.x - lo.x)
        for group, name in ((spin, f"tire_{tag}"), (fixed, f"caliper_{tag}")):
            o = join(group, name)
            if o is None:
                continue
            o.data.transform(Matrix.Translation(-c))
            o["wheel"] = tag
    return out, sum(radius) / len(radius), sum(width) / len(width)


def rest_length(car_id):
    """Suspension length at rest (front axle) from the physics config: maxLen - static compression."""
    cfg = json.load(open(os.path.join(ROOT, "src", "vehicle", "cars", f"{car_id}.json")))
    s = cfg["suspensionFront"]
    lf = cfg["wheels"]["FL"][2] - cfg["com"][2]
    L = cfg["wheels"]["FL"][2] - cfg["wheels"]["RL"][2]
    front_load = cfg["mass"] * G * (1 - lf / L) / 2
    return s["maxLen"] - front_load / s["k"]


# ---- measurements for the physics config -------------------------------------------------------------

def percentile(vals, q):
    vals = sorted(vals)
    if not vals:
        return 0.0
    return vals[min(len(vals) - 1, int(q * len(vals)))]


def measure(parts, wheels, radius, width):
    """Boxes in the game frame: the lower body (sill to belt line), the cabin (belt to roof) and the
    overall shell, robust to mirrors and wings sticking out (percentiles)."""
    shell = [o for n, o in parts.items() if n == "body" or n.startswith(("door", "hood", "trunk", "bumper"))]
    pts = []
    for o in shell:
        mw = o.matrix_world
        for v in o.data.vertices:
            pts.append(mw @ v.co)
    glass = [o for n, o in parts.items() if n.startswith("glass")]
    glo, ghi = scene_bbox(glass) if glass else (None, None)
    belt = glo.z if glo else percentile([p.z for p in pts], 0.6)
    xs = [abs(p.x) for p in pts if p.z < belt]
    # Between the axles (doors): the side the core sits behind, without arch flares.
    zf = -max(c.y for c in wheels.values())
    zr = -min(c.y for c in wheels.values())
    mid = [abs(p.x) for p in pts if p.z < belt and zr + 0.5 < -p.y < zf - 0.5 and p.z > belt - 0.5]
    lower = {
        "halfX": percentile(xs, 0.985),
        "halfXMid": percentile(mid, 0.9) if mid else percentile(xs, 0.9),
        "y0": percentile([p.z for p in pts], 0.01),
        "y1": belt,
        "z0": -percentile([p.y for p in pts], 0.995),
        "z1": -percentile([p.y for p in pts], 0.005),
    }
    cab = [p for p in pts if p.z >= belt]
    cabin = {
        "halfX": percentile([abs(p.x) for p in cab], 0.95) if cab else lower["halfX"] * 0.8,
        "y0": belt,
        "y1": percentile([p.z for p in cab], 0.995) if cab else belt + 0.4,
        "z0": -(ghi.y if ghi else 0),
        "z1": -(glo.y if glo else 0),
    }
    return {
        "wheels": {k: b2g(v) for k, v in wheels.items()},
        "wheelRadius": round(radius, 4),
        "wheelWidth": round(width, 4),
        "lower": {k: round(v, 4) for k, v in lower.items()},
        "cabin": {k: round(v, 4) for k, v in cabin.items()},
    }


# ---- views to place the split boxes ------------------------------------------------------------------

def ortho_views(outdir):
    """Side, top and front orthographic renders with a 0.25 m grid of thin markers (red every 1 m)."""
    os.makedirs(outdir, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.color_type = "MATERIAL"
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 900
    lo, hi = scene_bbox(meshes())
    marks = []
    red = bpy.data.materials.new("mark_red")
    red.diffuse_color = (1, 0, 0, 1)
    blue = bpy.data.materials.new("mark_blue")
    blue.diffuse_color = (0, 0.3, 1, 1)
    for i in range(-12, 13):
        v = i * 0.25
        for axis in ("x", "y", "z"):
            bpy.ops.mesh.primitive_cube_add(size=1)
            m = bpy.context.active_object
            m.data.materials.append(red if i % 4 == 0 else blue)
            t = 0.006 if i % 4 else 0.012
            if axis == "y":  # game z (forward): vertical lines in side/top views
                m.location = (0, v, 0)
                m.scale = (5, t, 5)
            elif axis == "z":  # game y (up): horizontal lines in side/front views
                m.location = (0, 0, v)
                m.scale = (5, 5, t)
            else:  # game x (left): lines in top/front views
                m.location = (v, 0, 0)
                m.scale = (t, 5, 5)
            m.display_type = "SOLID"
            marks.append(m)
    cam_data = bpy.data.cameras.new("ortho")
    cam_data.type = "ORTHO"
    cam = bpy.data.objects.new("ortho", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    c = (lo + hi) / 2
    views = {
        "side_left": ((hi.x + 10, c.y, c.z), (1.5708, 0, 1.5708), ("x",)),
        "top": ((c.x, c.y, hi.z + 10), (0, 0, 0), ("z",)),
        "front": ((c.x, lo.y - 10, c.z), (1.5708, 0, 0), ("y",)),
    }
    for name, (loc, rot, hide) in views.items():
        cam.location = loc
        cam.rotation_euler = rot
        cam_data.ortho_scale = max(hi.y - lo.y, hi.x - lo.x) * 1.15
        cam_data.clip_end = 100
        # Markers that would sit between camera and car on this axis are hidden.
        for m in marks:
            axis = "x" if m.scale.x < 0.1 else "y" if m.scale.y < 0.1 else "z"
            m.hide_render = axis in hide
        scene.render.filepath = os.path.join(outdir, f"{name}.png")
        bpy.ops.render.render(write_still=True)
    for m in marks:
        bpy.data.objects.remove(m, do_unlink=True)
    bpy.data.objects.remove(cam, do_unlink=True)


# ---- main ------------------------------------------------------------------------------------------

def main():
    car_id, preview, views = args()
    spec = json.load(open(os.path.join(HERE, "imports", f"{car_id}.json")))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    load_any(os.path.join(ROOT, spec["source"]))
    apply_all_transforms()
    for o in list(meshes()):
        mats = [s.material.name if s.material else "" for s in o.material_slots]
        if any_match(spec.get("drop", []), o.name, *mats):
            bpy.data.objects.remove(o, do_unlink=True)
    orient_and_scale(spec.get("forward", "-Y"), spec.get("length"))
    rename_materials(spec.get("materials", {}), spec.get("object_materials", {}))
    paint_setup(spec.get("paint_color"))
    glass_setup()
    # Images no material uses any more are not exported.
    for img in list(bpy.data.images):
        if img.users == 0:
            bpy.data.images.remove(img)
    wheels, radius, width = rebuild_wheels(spec)

    # Chassis origin: above the wheel centres by the suspension's rest length.
    wheel_z = sum(c.z for c in wheels.values()) / 4
    lift = wheel_z + rest_length(car_id)
    shift = Matrix.Translation((0, 0, -lift))
    for o in meshes():
        if "wheel" not in o.keys():
            o.data.transform(shift)
    for k in wheels:
        wheels[k] = wheels[k] - Vector((0, 0, lift))
    bpy.context.view_layer.update()

    restyle(spec.get("restyle", []))
    parts = {}
    for name, pats in spec.get("parts", {}).items():
        objs = [o for o in meshes() if "wheel" not in o.keys() and any_match(pats, o.name)]
        if objs:
            parts[name] = join(objs, name)
    rest = [o for o in meshes() if "wheel" not in o.keys() and o.name not in parts]
    parts["body"] = join(rest, "body")
    for name, s in spec.get("split", {}).items():
        src = parts.get(s.get("from", "body"))
        o = split_faces(src, in_box(s["box"]), name, s.get("material")) if src else None
        if o:
            parts[name] = o
    # Leftovers of a part that was cut into named pieces (e.g. lenses left in "glass_all") go back
    # into the body, under a neutral name.
    for name in spec.get("leftover_to_body", []):
        o = parts.pop(name, None)
        if o:
            parts["body"] = join([parts["body"], o], "body")
    for name, sources in spec.get("merge", {}).items():
        objs = [parts.pop(n) for n in [name, *sources] if n in parts]
        if objs:
            parts[name] = join(objs, name)
    for name, (left, right) in spec.get("split_sides", {}).items():
        src = parts.pop(name, None)
        if not src:
            continue
        lo_part = split_faces(src, lambda c: c.x > 0, left)
        src.name = right
        src.data.name = right
        parts[right] = src
        if lo_part:
            parts[left] = lo_part
    for name, o in parts.items():
        o["part_name"] = name
        piv = Vector((0, 0, 0)) if name == "body" else default_pivot(name, o)
        o["chassis_pivot"] = [piv.x, piv.z, -piv.y]
    for o in meshes():
        if "wheel" in o.keys():
            o["part_name"] = o.name
            o["chassis_pivot"] = [0.0, 0.0, 0.0]

    if views:
        ortho_views(views)
    total = sum(tri_count(o) for o in meshes())
    shrink_textures(spec.get("max_texture", 1024))
    m = measure(parts, wheels, radius, width)
    print(f"[import] {car_id}: {total} triangles, parts {sorted(parts)}")
    print("[import] missing parts:", [p for p in PARTS if p not in parts])
    print("[import] measure:", json.dumps(m))

    os.makedirs(os.path.join(HERE, "blend"), exist_ok=True)
    os.makedirs(os.path.join(HERE, "build"), exist_ok=True)
    json.dump(m, open(os.path.join(HERE, "build", f"{car_id}.measure.json"), "w"), indent=2)
    bpy.context.preferences.filepaths.save_version = 0
    blend = os.path.join(HERE, "blend", f"{car_id}.blend")
    if os.path.exists(blend):
        os.remove(blend)
    bpy.ops.wm.save_as_mainfile(filepath=blend, compress=True)
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(HERE, "build", f"{car_id}.glb"),
        export_format="GLB",
        export_extras=True,
        export_yup=True,
        export_apply=True,
        export_image_format="WEBP",
        export_image_quality=82,
    )
    if preview:
        quick_render(preview, *scene_bbox(meshes()))


main()
