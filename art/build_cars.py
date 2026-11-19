"""Build the Open Road cars in Blender and export them as GLB.

    blender -b --factory-startup -P art/build_cars.py -- --out public/models [--only sport] [--blend art/blend]

Each car is a lofted, densely tessellated shell (20-40k triangles) split into named panels:
body, hood, trunk, door_FL/FR, bumper_F/R, glass_front/rear/L/R, plus separate lights, mirrors,
exhausts, a wheel set and an interior block. Part origins sit at their hinge/pivot, so the game can
open, dent and detach them. Edit art/specs.py and re-run to change a car.
"""
import math
import os
import sys

import bmesh  # noqa: F401  (kept for artists extending the script)
import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from carlib import (  # noqa: E402
    hex_to_linear, key_curve, loft, to_blender, vertex_normals,
)
from specs import SPECS  # noqa: E402

# Wheel geometry shared by the three cars is read from the game's car JSON files.
import json  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = os.path.join(ROOT, "public", "models")
    blend = os.path.join(ROOT, "art", "blend")
    only = None
    i = 0
    while i < len(argv):
        if argv[i] == "--out":
            out = argv[i + 1]; i += 2
        elif argv[i] == "--blend":
            blend = argv[i + 1]; i += 2
        elif argv[i] == "--only":
            only = argv[i + 1]; i += 2
        else:
            i += 1
    return out, blend, only


# --------------------------------------------------------------------------------------------
# Materials (the game re-skins them by name, these make the .blend look right on its own)
# --------------------------------------------------------------------------------------------

def make_material(name, color, metallic=0.0, roughness=0.5, alpha=1.0, emissive=None, coat=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = coat
    if alpha < 1.0:
        bsdf.inputs["Alpha"].default_value = alpha
        try:
            mat.surface_render_method = "BLENDED"
        except Exception:
            pass
    if emissive is not None:
        bsdf.inputs["Emission Color"].default_value = emissive
        bsdf.inputs["Emission Strength"].default_value = 0.4
    return mat


def make_materials(paint_hex):
    return {
        "paint": make_material("paint", hex_to_linear(paint_hex), 0.3, 0.42, coat=0.55),
        "glass": make_material("glass", hex_to_linear(0x16212C), 0.1, 0.04, alpha=0.55),
        "headlight": make_material("headlight", hex_to_linear(0xD8DDE6), 0.0, 0.2, emissive=hex_to_linear(0xFFF2D0)),
        "taillight": make_material("taillight", hex_to_linear(0x8A0D10), 0.0, 0.25, emissive=hex_to_linear(0xFF1C1C)),
        "trim": make_material("trim", hex_to_linear(0x14161A), 0.2, 0.7),
        "tire": make_material("tire", hex_to_linear(0x151515), 0.0, 0.92),
        "rim": make_material("rim", hex_to_linear(0xC9CED6), 0.95, 0.28),
        "disc": make_material("disc", hex_to_linear(0x3B3D42), 0.8, 0.5),
        "interior": make_material("interior", hex_to_linear(0x101114), 0.0, 0.9),
    }


def material_for(part, mats):
    if part.startswith("glass"):
        return mats["glass"]
    if part in ("light_FL", "light_FR"):
        return mats["headlight"]
    if part in ("light_RL", "light_RR"):
        return mats["taillight"]
    return mats["paint"]


# --------------------------------------------------------------------------------------------
# Mesh helpers
# --------------------------------------------------------------------------------------------

def new_object(name, verts_chassis, faces, mat, location_chassis=(0, 0, 0), normals=None, colors=None, parent=None):
    """Create a mesh object. `verts_chassis` are relative to `location_chassis` (the object origin)."""
    mesh = bpy.data.meshes.new(name)
    v = to_blender(np.asarray(verts_chassis, dtype=np.float64))
    face_list = faces.tolist() if isinstance(faces, np.ndarray) else [list(f) for f in faces]
    mesh.from_pydata(v.tolist(), [], face_list)
    mesh.update()
    for p in mesh.polygons:
        p.use_smooth = True
    if normals is not None:
        mesh.normals_split_custom_set_from_vertices(to_blender(np.asarray(normals)).tolist())
    if colors is not None:
        attr = mesh.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
        flat = np.concatenate([colors, np.ones((len(colors), 1))], axis=1).ravel()
        attr.data.foreach_set("color", flat.tolist())
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    obj.location = to_blender(location_chassis)
    bpy.context.scene.collection.objects.link(obj)
    if parent is not None:
        obj.parent = parent
        # Keep the world placement: express the location relative to the parent.
        obj.location = tuple(np.array(to_blender(location_chassis)) - np.array(parent.location))
    return obj


def box_geometry(size):
    sx, sy, sz = (s / 2 for s in size)
    v = np.array([[-sx, -sy, -sz], [sx, -sy, -sz], [sx, sy, -sz], [-sx, sy, -sz],
                  [-sx, -sy, sz], [sx, -sy, sz], [sx, sy, sz], [-sx, sy, sz]])
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (2, 3, 7, 6), (1, 2, 6, 5), (0, 4, 7, 3)]
    return v, f


def rot_y(v, a):
    c, s = math.cos(a), math.sin(a)
    r = np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
    return v @ r.T


def cylinder_geometry(radius, length, axis="z", segments=16, open_ended=False):
    ang = np.linspace(0, 2 * math.pi, segments, endpoint=False)
    ring = np.stack([radius * np.cos(ang), radius * np.sin(ang)], axis=1)
    h = length / 2
    verts, faces = [], []
    for z in (-h, h):
        for p in ring:
            verts.append((p[0], p[1], z))
    n = segments
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
    if not open_ended:
        verts.append((0, 0, -h)); verts.append((0, 0, h))
        for i in range(n):
            j = (i + 1) % n
            faces.append((2 * n, j, i))
            faces.append((2 * n + 1, n + i, n + j))
    v = np.array(verts)
    if axis == "x":
        v = v[:, [2, 0, 1]]
    elif axis == "y":
        v = v[:, [0, 2, 1]]
    return v, faces


def merge_geometry(parts):
    verts, faces, off = [], [], 0
    for v, f in parts:
        verts.append(v)
        faces.extend([tuple(i + off for i in face) for face in f])
        off += len(v)
    return np.concatenate(verts), faces


def lathe_x(profile, segments=36):
    """Revolve (radius, axial) profile points about the X axis."""
    ang = np.linspace(0, 2 * math.pi, segments, endpoint=False)
    verts, faces = [], []
    n = len(profile)
    for r, a in profile:
        for t in ang:
            verts.append((a, r * math.cos(t), r * math.sin(t)))
    for i in range(n - 1):
        for k in range(segments):
            k1 = (k + 1) % segments
            faces.append((i * segments + k, i * segments + k1, (i + 1) * segments + k1, (i + 1) * segments + k))
    return np.array(verts), faces


# --------------------------------------------------------------------------------------------
# Shell
# --------------------------------------------------------------------------------------------

def build_shell(spec):
    yb, belt, top = key_curve(spec["yb"]), key_curve(spec["belt"]), key_curve(spec["top"])
    W, Wr, crown_c = key_curve(spec["half_width"]), key_curve(spec["roof_half_width"]), key_curve(spec["crown"])
    arches = spec["arches"]

    def lerp(a, b, t):
        return a + (b - a) * t

    def section(z):
        y0 = yb(z)
        bl = belt(z)
        tp = max(top(z), bl)
        w = W(z)
        wr = min(Wr(z), w)
        hb = tp - bl
        crown = crown_c(z)

        def lift(y):
            out = y
            for az, ay, ar in arches:
                dz = z - az
                if abs(dz) < ar:
                    out = max(out, ay + math.sqrt(ar * ar - dz * dz))
            return out

        low_side = min(bl - 0.1, y0 + 0.5)
        pts = [
            [0, y0], [0.3 * w, y0], [0.62 * w, y0],
            [0.86 * w, lift(y0 + 0.03)], [w, lift(y0 + 0.13)],
            [w, lift(lerp(y0 + 0.13, low_side, 0.55))], [w, lift(low_side)],
            [w * 0.996, bl - 0.025], [w * 0.978, bl + 0.004],
            [lerp(w * 0.96, wr, 0.42), bl + hb * 0.4 + 0.004],
            [lerp(w * 0.96, wr, 0.85), bl + hb * 0.8 + 0.006],
            [wr, tp - min(hb * 0.08, 0.03)],
            [wr * 0.8, tp + 0.004 + crown * 0.4],
            [wr * 0.42, tp + crown * 0.85],
            [0, tp + crown],
        ]
        for k in range(4, 8):
            pts[k][1] = max(pts[k][1], pts[k - 1][1] + (0.01 if k == 7 else 0.004))
        return [tuple(p) for p in pts]

    pos, faces, ring = loft(spec["z_min"], spec["z_max"], 168, 4, section, 0.07)
    nrm = vertex_normals(pos, faces)

    # Classify faces by centroid and averaged normal.
    p0, p1, p2 = pos[faces[:, 0]], pos[faces[:, 1]], pos[faces[:, 2]]
    cen = (p0 + p1 + p2) / 3
    fnr = (nrm[faces[:, 0]] + nrm[faces[:, 1]] + nrm[faces[:, 2]]) / 3
    names = np.empty(len(faces), dtype=object)
    classify = spec["classify"]
    for i in range(len(faces)):
        names[i] = classify(cen[i, 0], cen[i, 1], cen[i, 2], fnr[i, 0], fnr[i, 1], fnr[i, 2]) or "body"

    # Which vertices are shared between panels (their edges get a dark "panel gap" tint).
    vert_parts = [set() for _ in range(len(pos))]
    for fi, f in enumerate(faces):
        for v in f:
            vert_parts[v].add(names[fi])
    return pos, faces, nrm, names, vert_parts


def add_panels(spec, mats):
    pos, faces, nrm, names, vert_parts = build_shell(spec)
    objects = {}
    for part in sorted(set(names)):
        idx = np.nonzero(names == part)[0]
        sub = faces[idx]
        used = np.unique(sub)
        remap = -np.ones(len(pos), dtype=np.int64)
        remap[used] = np.arange(len(used))
        v = pos[used]
        pv = spec["pivots"].get(part)
        if pv is None:
            pv = (v.min(axis=0) + v.max(axis=0)) / 2
        pv = np.array(pv, dtype=np.float64)
        col = np.ones((len(used), 3))
        if not part.startswith("glass"):
            seam = np.array([len(vert_parts[u]) > 1 for u in used])
            col[seam] = 0.22
        obj = new_object(part, v - pv, remap[sub], material_for(part, mats), tuple(pv), normals=nrm[used], colors=col)
        objects[part] = obj
    return objects


# --------------------------------------------------------------------------------------------
# Details
# --------------------------------------------------------------------------------------------

def add_extras(spec, mats, objects):
    ib_c, ib_h = spec["interior"]
    v, f = box_geometry([h * 2 for h in ib_h])
    objects["interior"] = new_object("interior", v, f, mats["interior"], ib_c)

    mv, mf = box_geometry((0.16, 0.1, 0.07))
    parents = spec.get("mirror_parent")
    pnames = parents if parents else ("door_FL", "door_FR")
    for i, c in enumerate(spec["mirrors"]):
        nm = "mirror_L" if i == 0 else "mirror_R"
        objects[nm] = new_object(nm, mv, mf, mats["paint"], c, parent=objects.get(pnames[i]))

    for name, kind, center, size, yaw, mat, parent in spec["extras"]:
        if kind == "box":
            v, f = box_geometry(size)
        else:
            v, f = cylinder_geometry(size[0], size[1], axis="z", segments=14)
        v = rot_y(v, yaw)
        objects[name] = new_object(name, v, f, mats[mat], center, parent=objects.get(parent))


def add_wheels(car_cfg, mats, objects):
    R = car_cfg["wheel"]["radius"]
    Wd = car_cfg["wheel"]["width"]
    rim_r = R * 0.68
    hw = Wd / 2
    prof = [(rim_r * 0.96, -hw * 0.92), (rim_r * 1.02, -hw), (R * 0.9, -hw * 0.98), (R * 0.975, -hw * 0.82),
            (R, -hw * 0.45), (R, hw * 0.45), (R * 0.975, hw * 0.82), (R * 0.9, hw * 0.98),
            (rim_r * 1.02, hw), (rim_r * 0.96, hw * 0.92)]
    tire_v, tire_f = lathe_x(prof, 36)
    for tag, outer in (("FL", 1), ("FR", -1), ("RL", 1), ("RR", -1)):
        rim_parts = [cylinder_geometry(rim_r, Wd * 0.8, axis="x", segments=28, open_ended=True)]
        for s in range(5):
            a = s / 5 * 2 * math.pi
            bv, bf = box_geometry((0.03, rim_r * 0.9, rim_r * 0.2))
            c, sn = math.cos(-a), math.sin(-a)
            rx = np.array([[1, 0, 0], [0, c, -sn], [0, sn, c]])
            bv = bv @ rx.T + np.array([outer * (hw * 0.55 + 0.012), math.cos(a) * rim_r * 0.5, math.sin(a) * rim_r * 0.5])
            rim_parts.append((bv, bf))
        cv, cf = cylinder_geometry(rim_r * 0.2, 0.05, axis="x", segments=16)
        rim_parts.append((cv + np.array([outer * (hw * 0.55 + 0.02), 0, 0]), cf))
        rv, rf = merge_geometry(rim_parts)
        fv, ff = cylinder_geometry(rim_r * 0.96, 0.02, axis="x", segments=28)
        dv, df = cylinder_geometry(rim_r * 0.82, 0.025, axis="x", segments=28)
        dark_v, dark_f = merge_geometry([(fv + np.array([outer * hw * 0.55, 0, 0]), ff), (dv + np.array([-outer * hw * 0.25, 0, 0]), df)])
        objects["tire_" + tag] = new_object("tire_" + tag, tire_v, tire_f, mats["tire"])
        objects["rim_" + tag] = new_object("rim_" + tag, rv, rf, mats["rim"])
        objects["disc_" + tag] = new_object("disc_" + tag, dark_v, dark_f, mats["disc"])


# --------------------------------------------------------------------------------------------

def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def export_glb(path):
    kwargs = dict(filepath=path, export_format="GLB", export_yup=True, export_apply=True, export_normals=True,
                  export_cameras=False, export_lights=False)
    props = {p.identifier for p in bpy.ops.export_scene.gltf.get_rna_type().properties}
    if "export_vertex_color" in props:
        kwargs["export_vertex_color"] = "ACTIVE"
    if "export_active_vertex_color_when_no_material" in props:
        kwargs["export_active_vertex_color_when_no_material"] = True
    if "export_all_vertex_colors" in props:
        kwargs["export_all_vertex_colors"] = True
    bpy.ops.export_scene.gltf(**kwargs)


def build_car(car_id, out_dir, blend_dir):
    clear_scene()
    spec = SPECS[car_id]
    with open(os.path.join(ROOT, "src", "vehicle", "cars", f"{car_id}.json")) as fh:
        car_cfg = json.load(fh)
    mats = make_materials(spec["paint"])
    objects = add_panels(spec, mats)
    add_extras(spec, mats, objects)
    add_wheels(car_cfg, mats, objects)
    os.makedirs(out_dir, exist_ok=True)
    os.makedirs(blend_dir, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(blend_dir, f"{car_id}.blend"), compress=True)
    glb = os.path.join(out_dir, f"{car_id}.glb")
    export_glb(glb)
    tris = sum(len(o.data.polygons) for n, o in objects.items() if o.data.color_attributes)
    print(f"[open-road] {car_id}: {len(objects)} objects, ~{tris} shell triangles -> {glb} ({os.path.getsize(glb) // 1024} kB)")


def main():
    out, blend, only = parse_args()
    for car_id in SPECS:
        if only and car_id != only:
            continue
        build_car(car_id, out, blend)


main()
