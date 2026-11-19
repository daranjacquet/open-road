"""Build the Open Road cars in Blender.

    blender -b --factory-startup -P art/build_cars.py -- [--only sedan] [--preview DIR] [--no-export]

For each car in art/cars/: control-cage body (subdivision surface, booleans), split panels with real
gaps, glass, light units, grilles, wheels, details and a cabin. Saves art/blend/<car>.blend and exports
art/build/<car>.glb (uncompressed; scripts/optimize-models.mjs compresses into public/models/).
"""
import importlib
import os
import sys
import time

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
ROOT = os.path.dirname(HERE)

from lib import assemble, engine_bay, interior, materials  # noqa: E402
from lib.body import build_body  # noqa: E402
from lib.preview import look, render_sheet  # noqa: E402
from lib.util import set_origin, tri_count  # noqa: E402
from lib.wheels import build_wheel  # noqa: E402

CARS = ["sedan", "offroad", "supercar"]


def args():
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = {"only": None, "preview": None, "export": True, "levels": 3}
    i = 0
    while i < len(a):
        if a[i] == "--only":
            out["only"] = a[i + 1]; i += 2
        elif a[i] == "--preview":
            out["preview"] = a[i + 1]; i += 2
        elif a[i] == "--no-export":
            out["export"] = False; i += 1
        elif a[i] == "--levels":
            out["levels"] = int(a[i + 1]); i += 2
        else:
            i += 1
    return out


def build(car_id, opt):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mod = importlib.import_module(f"cars.{car_id}")
    t0 = time.time()
    mats = materials.make(paint=mod.PAINT, caliper=mod.CALIPER)
    parts = build_body(mod.DESIGN, levels=opt["levels"])
    parts = assemble.finish(parts, mats, mod.FINISH)
    mod.details(parts, mats)
    cab = interior.build(mod.INTERIOR, mats)
    from lib.util import parent_keep
    parent_keep(cab, parts["body"])
    for bay in getattr(mod, "ENGINE_BAY", []):
        engine_bay.build(bay, mats, parts["body"])
    for tag, outer in (("FL", 1), ("FR", -1), ("RL", 1), ("RR", -1)):
        for o in build_wheel(tag, outer, mod.WHEEL, mats):
            o["wheel"] = tag
    # Every top-level object gets a pivot property (the game re-centres meshes on it).
    bpy.context.view_layer.update()
    for o in bpy.data.objects:
        if o.type == "MESH" and "chassis_pivot" not in o.keys():
            loc = o.matrix_world.translation
            o["chassis_pivot"] = [loc.x, loc.z, -loc.y]
        if o.type == "MESH":
            o["part_name"] = o.name  # survives glTF name de-duplication and meshopt node splits
    tris = sum(tri_count(o) for o in bpy.data.objects if o.type == "MESH")
    print(f"[cars] {car_id}: {len(bpy.data.objects)} objects, {tris} triangles, built in {time.time() - t0:.1f}s")
    os.makedirs(os.path.join(HERE, "blend"), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "blend", f"{car_id}.blend"), compress=True)
    if opt["preview"]:
        os.makedirs(opt["preview"], exist_ok=True)
        # Put the wheels where the suspension holds them, just for the pictures.
        from lib.util import C
        wheel_pos = {}
        for o in bpy.data.objects:
            tag = o.get("wheel")
            if tag and o.parent is None:
                front = tag[0] == "F"
                x = mod.TRACK_HALF[0 if front else 1] * (1 if tag[1] == "L" else -1)
                wheel_pos[o.name] = o.location.copy()
                o.location = C(x, -0.24 if not hasattr(mod, "WHEEL_Y") else mod.WHEEL_Y, mod.AXLES[0 if front else 1])
        render_sheet(os.path.join(opt["preview"], f"{car_id}_sheet.png"), length=5.0)
        g = mod.GROUND
        look(os.path.join(opt["preview"], f"{car_id}_hero.png"), (4.3, g + 1.35, 4.6), (0, g + 0.55, 0.3), lens=40, ground_y=g)
        look(os.path.join(opt["preview"], f"{car_id}_rear.png"), (-3.6, g + 1.6, -5.0), (0, g + 0.6, -0.4), lens=40, ground_y=g)
        for n in ("pv_floor",):
            ob = bpy.data.objects.get(n)
            if ob:
                bpy.data.objects.remove(ob, do_unlink=True)
        for n, loc in wheel_pos.items():
            bpy.data.objects[n].location = loc
    if opt["export"]:
        os.makedirs(os.path.join(HERE, "build"), exist_ok=True)
        path = os.path.join(HERE, "build", f"{car_id}.glb")
        bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_yup=True, export_apply=True,
                                  export_extras=True, export_cameras=False, export_lights=False,
                                  export_texcoords=True, export_normals=True)
        print(f"[cars] {car_id}: exported {path} ({os.path.getsize(path) // 1024} kB)")


def main():
    opt = args()
    for car in CARS:
        if opt["only"] and car != opt["only"]:
            continue
        if not os.path.exists(os.path.join(HERE, "cars", f"{car}.py")):
            print(f"[cars] {car}: no design yet, skipped")
            continue
        build(car, opt)


main()
