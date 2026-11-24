"""Look at an aircraft model in the game frame before writing its import mapping.

    blender -b --factory-startup -P art/explore_plane.py -- <model> <forward> <length> <outdir> [drop-regex]

Prints every object's box in the game frame (x left, y up, z forward, metres, ground at y = 0)
and renders side, top and front orthographic views with a grid (red every metre, blue every 0.5 m),
objects in random colours.
"""
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from lib.importer import apply_all_transforms, load_any, orient_and_scale, scene_bbox, tri_count, world_bbox  # noqa: E402

a = sys.argv[sys.argv.index("--") + 1:]
src, forward, length, outdir = a[0], a[1], float(a[2]), a[3]
drop = a[4] if len(a) > 4 else None
bpy.ops.wm.read_factory_settings(use_empty=True)
load_any(src)
if drop:
    import re
    for o in [o for o in bpy.data.objects if o.type == "MESH" and re.search(drop, o.name)]:
        bpy.data.objects.remove(o, do_unlink=True)
apply_all_transforms()
orient_and_scale(forward, length)
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
for o in sorted(meshes, key=lambda o: o.name):
    lo, hi = world_bbox(o)
    mats = ",".join(s.material.name for s in o.material_slots if s.material)
    # Blender (x left, -y forward, z up) -> game (x, z, -y)
    print(f"{o.name:12} {tri_count(o):6} tris  x {lo.x:6.2f}..{hi.x:6.2f}  y {lo.z:5.2f}..{hi.z:5.2f}  z {-hi.y:6.2f}..{-lo.y:6.2f}  [{mats}]")
os.makedirs(outdir, exist_ok=True)
scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.color_type = "RANDOM"
scene.render.resolution_x = 1800
scene.render.resolution_y = 1000
lo, hi = scene_bbox(meshes)
marks = []
red = bpy.data.materials.new("mark_red")
red.diffuse_color = (1, 0, 0, 1)
blue = bpy.data.materials.new("mark_blue")
blue.diffuse_color = (0, 0.3, 1, 1)
for i in range(-16, 17):
    v = i * 0.5
    for axis in ("x", "y", "z"):
        bpy.ops.mesh.primitive_cube_add(size=1)
        m = bpy.context.active_object
        m.data.materials.append(red if i % 2 == 0 else blue)
        m.color = (1, 0, 0, 1) if i % 2 == 0 else (0, 0.3, 1, 1)
        t = 0.008 if i % 2 else 0.016
        if axis == "y":
            m.location = (0, v, 0)
            m.scale = (20, t, 20)
        elif axis == "z":
            m.location = (0, 0, v)
            m.scale = (20, 20, t)
        else:
            m.location = (v, 0, 0)
            m.scale = (t, 20, 20)
        marks.append(m)
cam_data = bpy.data.cameras.new("ortho")
cam_data.type = "ORTHO"
cam = bpy.data.objects.new("ortho", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
c = (lo + hi) / 2
views = {
    "side_left": ((hi.x + 20, c.y, c.z), (1.5708, 0, 1.5708), ("x",)),
    "top": ((c.x, c.y, hi.z + 20), (0, 0, 0), ("z",)),
    "front": ((c.x, lo.y - 20, c.z), (1.5708, 0, 0), ("y",)),
}
for name, (loc, rot, hide) in views.items():
    cam.location = loc
    cam.rotation_euler = rot
    cam_data.ortho_scale = max(hi.y - lo.y, hi.x - lo.x) * 1.08
    cam_data.clip_end = 200
    for m in marks:
        axis = "x" if m.scale.x < 0.1 else "y" if m.scale.y < 0.1 else "z"
        m.hide_render = axis in hide
    scene.render.filepath = os.path.join(outdir, f"{name}.png")
    bpy.ops.render.render(write_still=True)
print("views in", outdir)
