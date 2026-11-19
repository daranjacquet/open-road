"""List what is inside a third-party car model before mapping it to the game's parts.

    blender -b --factory-startup -P art/inspect_model.py -- path/to/model.(glb|gltf|fbx|obj|blend) [--render out.png]

Prints every mesh object with its materials, triangle count and world bounding box (Blender axes:
Z up), the overall size, and optionally renders a quick three-quarter preview.
"""
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from lib.importer import load_any, tri_count, world_bbox  # noqa: E402


def main():
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if not a:
        print("usage: -- model_file [--render out.png]")
        return
    path = a[0]
    render = a[a.index("--render") + 1] if "--render" in a else None
    bpy.ops.wm.read_factory_settings(use_empty=True)
    load_any(path)
    bpy.context.view_layer.update()
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    total = 0
    print(f"{'object':40s} {'tris':>7s}  {'size x y z (m)':>22s}  {'centre':>22s}  materials")
    for o in sorted(meshes, key=lambda o: o.name):
        a0, a1 = world_bbox(o)
        lo = Vector(map(min, lo, a0))
        hi = Vector(map(max, hi, a1))
        t = tri_count(o)
        total += t
        size = a1 - a0
        c = (a0 + a1) / 2
        mats = ",".join(s.material.name if s.material else "-" for s in o.material_slots)
        print(f"{o.name[:40]:40s} {t:7d}  {size.x:6.2f} {size.y:6.2f} {size.z:6.2f}  {c.x:6.2f} {c.y:6.2f} {c.z:6.2f}  {mats}")
    size = hi - lo
    print(f"\n{len(meshes)} meshes, {total} triangles, {len(bpy.data.materials)} materials")
    print(f"overall size x {size.x:.2f}  y {size.y:.2f}  z {size.z:.2f} m, min {tuple(round(v, 2) for v in lo)} max {tuple(round(v, 2) for v in hi)}")
    if render:
        from lib.importer import quick_render
        quick_render(render, lo, hi)
        print("preview:", render)


main()
