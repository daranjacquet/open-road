"""Turn a third-party aircraft model into the game's aircraft (parts, hinges, materials).

    blender -b --factory-startup -P art/import_plane.py -- <id> [--views DIR]

Reads art/imports/<id>.json. Every point and box is in the GAME frame (x left, y up, z forward,
metres) with the ground at y = 0, BEFORE the model is moved so that `origin` (the centre of gravity)
sits at (0, 0, 0):

    {
      "source": "art/sources/plane/model.glb", "credit": "...",
      "forward": "+X", "length": 7.92,              # source nose axis, overall length (rescale)
      "origin": [0, 1.15, 1.25],                    # centre of gravity (becomes the body origin)
      "materials": {"paint": ["^Meshpart2Mtl$"]},   # rename source materials (textures kept)
      "parts": {"prop": ["Object_11"]},             # whole objects -> part
      "split": {"wheelL": {"from": "body", "box": [x0, x1, y0, y1, z0, z1]}},     # faces in a box
      "controls": {"aileronL": {"from": "wingL", "x": [3.3, 5.8], "hinge": [[x, z], [x, z]],
                   "y": [y0, y1]}},                 # faces behind a hinge line -> hinged part
      "parents": {"aileronL": "wingL"},             # part hierarchy in the game
      "spin": {"prop": [0, 0, 1], "wheelL": [1, 0, 0]}   # axes the game spins these about
    }

Each object gets the glTF extras `part_name`, `chassis_pivot` (its hinge or bolt point, game frame),
`hinge_axis` (unit, game frame, for control surfaces and spinning parts) and `parent_part`.
Output: art/blend/<id>.blend, art/build/<id>.glb.
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

from lib.importer import apply_all_transforms, load_any, orient_and_scale, scene_bbox, tri_count, world_bbox  # noqa: E402


def args():
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    opt = lambda k: a[a.index(k) + 1] if k in a else None  # noqa: E731
    return a[0], opt("--views")


def g2b(x, y, z):
    """Game frame (x left, y up, z forward) to Blender (x left, -y forward, z up)."""
    return Vector((x, -z, y))


def b2g(v):
    return [round(v.x, 4), round(v.z, 4), round(-v.y, 4)]


def meshes():
    return [o for o in bpy.data.objects if o.type == "MESH"]


def any_match(patterns, *names):
    return any(re.search(p, n or "") for p in patterns for n in names)


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


def split_faces(src, test, name):
    """Move the faces of `src` whose centre (game frame) passes `test` into a new object `name`."""
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = src
    src.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bm = bmesh.from_edit_mesh(src.data)
    n = 0
    for f in bm.faces:
        c = f.calc_center_median()
        f.select = test(c.x, c.z, -c.y)
        n += f.select
    bmesh.update_edit_mesh(src.data)
    if n == 0:
        bpy.ops.object.mode_set(mode="OBJECT")
        print(f"[plane] split {name}: no faces")
        return None
    bpy.ops.mesh.separate(type="SELECTED")
    bpy.ops.object.mode_set(mode="OBJECT")
    new = [o for o in bpy.context.selected_objects if o != src][0]
    new.name = name
    new.data.name = name
    print(f"[plane] {name}: {n} faces from {src.name}")
    return new


def in_box(box):
    x0, x1, y0, y1, z0, z1 = box
    return lambda x, y, z: x0 <= x <= x1 and y0 <= y <= y1 and z0 <= z <= z1


def behind_hinge(spec):
    """Faces between two spans whose centre lies behind the hinge line (towards the trailing edge)."""
    (xa, za), (xb, zb) = spec["hinge"]
    lo, hi = sorted(spec["x"])
    y0, y1 = spec.get("y", [-99, 99])

    def test(x, y, z):
        ax = abs(x)
        if not (lo <= ax <= hi and y0 <= y <= y1):
            return False
        t = (ax - abs(xa)) / (abs(xb) - abs(xa))
        return z < za + (zb - za) * t
    return test


def cut_along_hinge(src, spec, name):
    """Slice the mesh along the hinge line and at the span limits, so the surface comes out with
    clean edges instead of whole faces that straddle the hinge."""
    side = 1 if name.endswith("L") else -1 if name.endswith("R") else 0
    (xa, za), (xb, zb) = spec["hinge"]
    if side:
        xa, xb = side * abs(xa), side * abs(xb)
    a = Vector((xa, -za, 0))
    b = Vector((xb, -zb, 0))
    d = (b - a).normalized()
    n = Vector((-d.y, d.x, 0))
    bm = bmesh.new()
    bm.from_mesh(src.data)
    planes = [(a, n)]
    if side:
        for x in spec["x"]:
            planes.append((Vector((side * x, 0, 0)), Vector((1, 0, 0))))
    for co, no in planes:
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=co, plane_no=no)
    bm.to_mesh(src.data)
    bm.free()
    src.data.update()


def rename_materials(rules):
    for m in list(bpy.data.materials):
        for target, pats in rules.items():
            if any_match(pats, m.name):
                existing = bpy.data.materials.get(target)
                if existing and existing != m:
                    for o in meshes():
                        for slot in o.material_slots:
                            if slot.material == m:
                                slot.material = existing
                else:
                    m.name = target
                break


def erase_marks(spec):
    """Paint over registrations and logos in a texture: each box (pixels, top-left origin) takes the
    median colour of its border."""
    for name, boxes in spec.items():
        img = bpy.data.images.get(name)
        if not img:
            continue
        w, h = img.size
        px = list(img.pixels)
        for x0, y0, x1, y1 in boxes:
            border = []
            for x in range(x0, x1):
                for y in (y0, y1 - 1):
                    i = ((h - 1 - y) * w + x) * 4
                    border.append(px[i:i + 4])
            for y in range(y0, y1):
                for x in (x0, x1 - 1):
                    i = ((h - 1 - y) * w + x) * 4
                    border.append(px[i:i + 4])
            border.sort(key=lambda c: c[0] + c[1] + c[2])
            fill = border[len(border) * 3 // 4]
            for y in range(y0, y1):
                for x in range(x0, x1):
                    i = ((h - 1 - y) * w + x) * 4
                    px[i:i + 4] = fill
        img.pixels = px
        img.update()
        print(f"[plane] erased {len(boxes)} marks in {name}")


def hinge_of(o, kind):
    """Pivot and axis (Blender frame) of a hinged or spinning part."""
    vs = [o.matrix_world @ v.co for v in o.data.vertices]
    if kind == "surface":
        # The hinge is the part's forward edge (Blender -Y is forward): at its inner and outer ends.
        xs = sorted(v.x for v in vs)
        inner = [v for v in vs if abs(v.x - xs[0]) < 0.08 or abs(v.x - xs[-1]) < 0.08]
        a_side = [v for v in inner if abs(v.x - xs[0]) < 0.08]
        b_side = [v for v in inner if abs(v.x - xs[-1]) < 0.08]
        a = min(a_side, key=lambda v: v.y)
        b = min(b_side, key=lambda v: v.y)
        ay = sum(v.z for v in a_side) / len(a_side)
        by = sum(v.z for v in b_side) / len(b_side)
        a = Vector((a.x, a.y, ay))
        b = Vector((b.x, b.y, by))
        return (a + b) / 2, (b - a).normalized()
    if kind == "rudder":
        zs = sorted(v.z for v in vs)
        lowv = [v for v in vs if v.z < zs[0] + 0.1]
        highv = [v for v in vs if v.z > zs[-1] - 0.1]
        a = min(lowv, key=lambda v: v.y)
        b = min(highv, key=lambda v: v.y)
        a = Vector((0, a.y, a.z))
        b = Vector((0, b.y, b.z))
        return (a + b) / 2, (b - a).normalized()
    lo, hi = world_bbox(o)
    return (lo + hi) / 2, None


def main():
    pid, views = args()
    spec = json.load(open(os.path.join(HERE, "imports", f"{pid}.json")))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    load_any(os.path.join(ROOT, spec["source"]))
    apply_all_transforms()
    orient_and_scale(spec.get("forward", "-Y"), spec.get("length"))
    rename_materials(spec.get("materials", {}))
    erase_marks(spec.get("erase", {}))
    # Images no material uses any more are not exported.
    for img in list(bpy.data.images):
        if img.users == 0:
            bpy.data.images.remove(img)

    parts = {}
    for name, pats in spec.get("parts", {}).items():
        objs = [o for o in meshes() if any_match(pats, o.name)]
        if objs:
            parts[name] = join(objs, name)
    rest = [o for o in meshes() if o.name not in parts]
    parts["body"] = join(rest, "body")
    for name, s in spec.get("split", {}).items():
        src = parts.get(s.get("from", "body"))
        o = split_faces(src, in_box(s["box"]), name) if src else None
        if o:
            parts[name] = o
    for name, s in spec.get("controls", {}).items():
        src = parts.get(s["from"])
        if not src:
            continue
        cut_along_hinge(src, s, name)
        o = split_faces(src, behind_hinge(s), name)
        if o:
            parts[name] = o

    # Move the centre of gravity to the origin.
    ox, oy, oz = spec["origin"]
    shift = Matrix.Translation(-g2b(ox, oy, oz))
    for o in meshes():
        o.data.transform(shift)
        o.data.update()
    bpy.context.view_layer.update()

    hinged = {"surface": [k for k in spec.get("controls", {})], "rudder": spec.get("rudder", [])}
    for name, o in parts.items():
        o["part_name"] = name
        kind = "surface" if name in hinged["surface"] else "rudder" if name in hinged["rudder"] else "other"
        piv, axis = hinge_of(o, kind) if name != "body" else (Vector((0, 0, 0)), None)
        spin = spec.get("spin", {}).get(name)
        if spin:
            lo, hi = world_bbox(o)
            piv = (lo + hi) / 2
            axis = g2b(*spin)
        o["chassis_pivot"] = b2g(piv)
        if axis is not None:
            o["hinge_axis"] = b2g(axis)
        o["parent_part"] = spec.get("parents", {}).get(name, "")
        print(f"[plane] {name:10} {tri_count(o):6} tris pivot {b2g(piv)} axis {b2g(axis) if axis is not None else '-'}")

    if views:
        render_views(views)
    os.makedirs(os.path.join(HERE, "blend"), exist_ok=True)
    os.makedirs(os.path.join(HERE, "build"), exist_ok=True)
    bpy.context.preferences.filepaths.save_version = 0
    blend = os.path.join(HERE, "blend", f"{pid}.blend")
    if os.path.exists(blend):
        os.remove(blend)
    bpy.ops.wm.save_as_mainfile(filepath=blend, compress=True)
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(HERE, "build", f"{pid}.glb"),
        export_format="GLB",
        export_extras=True,
        export_yup=True,
        export_apply=True,
        export_image_format="WEBP",
        export_image_quality=82,
    )
    print(f"[plane] {pid}: {sum(tri_count(o) for o in meshes())} triangles, parts {sorted(parts)}")


def render_views(outdir):
    """Top, side and rear views, each part in its own colour."""
    os.makedirs(outdir, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.color_type = "OBJECT"
    scene.render.resolution_x = 1800
    scene.render.resolution_y = 1000
    import colorsys
    objs = meshes()
    for i, o in enumerate(objs):
        r, g, b = colorsys.hsv_to_rgb((i * 0.618) % 1, 0.65, 0.95)
        o.color = (r, g, b, 1)
    lo, hi = scene_bbox(objs)
    cam_data = bpy.data.cameras.new("ortho")
    cam_data.type = "ORTHO"
    cam = bpy.data.objects.new("ortho", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    c = (lo + hi) / 2
    for name, loc, rot in (
        ("top", (c.x, c.y, hi.z + 20), (0, 0, 0)),
        ("side_left", (hi.x + 20, c.y, c.z), (1.5708, 0, 1.5708)),
        ("rear", (c.x, hi.y + 20, c.z), (1.5708, 0, 3.1416)),
        ("under", (c.x, c.y, lo.z - 20), (3.1416, 0, 0)),
    ):
        cam.location = loc
        cam.rotation_euler = rot
        cam_data.ortho_scale = max(hi.y - lo.y, hi.x - lo.x) * 1.08
        cam_data.clip_end = 200
        scene.render.filepath = os.path.join(outdir, f"{name}.png")
        bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)


main()
