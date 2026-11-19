"""Render a 2x2 preview sheet of the current scene (for checking shapes from scripts)."""
import os

import bpy
import numpy as np
from mathutils import Vector

from .util import C


def _camera(name, loc, target, ortho=None, lens=50):
    cam_data = bpy.data.cameras.new(name)
    cam_data.lens = lens
    if ortho:
        cam_data.type = "ORTHO"
        cam_data.ortho_scale = ortho
    cam = bpy.data.objects.new(name, cam_data)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = C(*loc)
    d = C(*target) - cam.location
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    return cam


def _setup(engine):
    sc = bpy.context.scene
    sc.render.engine = engine
    sc.render.resolution_x = 960
    sc.render.resolution_y = 600
    sc.render.film_transparent = False
    if engine == "BLENDER_WORKBENCH":
        sh = sc.display.shading
        sh.light = "STUDIO"
        sh.color_type = "MATERIAL"
        sh.show_cavity = True
        sh.cavity_type = "BOTH"
        sh.show_shadows = True
        sh.show_specular_highlight = True
        sc.display.shading.background_type = "VIEWPORT"
    else:
        world = bpy.data.worlds.get("pv") or bpy.data.worlds.new("pv")
        sc.world = world
        world.use_nodes = True
        bg = world.node_tree.nodes.get("Background")
        bg.inputs[0].default_value = (0.75, 0.8, 0.88, 1)
        bg.inputs[1].default_value = 1.0
        if not bpy.data.objects.get("pv_sun"):
            sun = bpy.data.objects.new("pv_sun", bpy.data.lights.new("pv_sun", "SUN"))
            sun.data.energy = 3.5
            sun.rotation_euler = (0.9, 0.3, 0.6)
            bpy.context.scene.collection.objects.link(sun)
        if not bpy.data.objects.get("pv_floor"):
            bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, 0.0))
            fl = bpy.context.object
            fl.name = "pv_floor"
            m = bpy.data.materials.new("pv_floor")
            m.use_nodes = True
            m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.35, 0.36, 0.38, 1)
            fl.data.materials.append(m)


def render_sheet(path, ground_y=0.0, engine="BLENDER_WORKBENCH", length=4.8, extra_views=None):
    """Four views: front 3/4, rear 3/4, side (ortho), front (ortho). ground_y: chassis y of the ground."""
    _setup(engine)
    if engine != "BLENDER_WORKBENCH":
        fl = bpy.data.objects.get("pv_floor")
        if fl:
            fl.location = C(0, ground_y, 0)
    L = length
    views = extra_views or [
        ("front34", (L * 0.75, 1.5, L * 1.05), (0, 0.15, 0.2), None, 45),
        ("rear34", (-L * 0.8, 1.7, -L * 1.0), (0, 0.15, -0.2), None, 45),
        ("side", (L * 2.2, 0.25, 0), (0, 0.25, 0), L * 1.18, 50),
        ("front", (0, 0.3, L * 2.2), (0, 0.3, 0), 2.6, 50),
    ]
    tiles = []
    tmp = os.path.dirname(path)
    sc = bpy.context.scene
    for name, loc, tgt, ortho, lens in views:
        cam = _camera("pv_" + name, loc, tgt, ortho, lens)
        sc.camera = cam
        f = os.path.join(tmp, f"_pv_{name}.png")
        sc.render.filepath = f
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(f)
        a = np.array(img.pixels[:], dtype=np.float32).reshape(img.size[1], img.size[0], 4)
        tiles.append(a)
        bpy.data.images.remove(img)
        bpy.data.objects.remove(cam, do_unlink=True)
        os.remove(f)
    # Pixel rows are bottom-up: the first block ends at the bottom of the sheet.
    sheet = np.concatenate([np.concatenate([tiles[2], tiles[3]], axis=1), np.concatenate([tiles[0], tiles[1]], axis=1)], axis=0)
    h, w, _ = sheet.shape
    out = bpy.data.images.new("sheet", w, h, alpha=True)
    out.pixels.foreach_set(sheet.ravel())
    out.filepath_raw = path
    out.file_format = "PNG"
    out.save()
    bpy.data.images.remove(out)
    return path


def look(path, loc, target, lens=45, engine="BLENDER_EEVEE", ground_y=0.0, res=(1100, 700)):
    """Single perspective render."""
    _setup(engine)
    if engine != "BLENDER_WORKBENCH":
        fl = bpy.data.objects.get("pv_floor")
        if fl:
            fl.location = C(0, ground_y, 0)
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = res
    cam = _camera("pv_look", loc, target, None, lens)
    sc.camera = cam
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)
    return path


def unused(_v: Vector):
    return _v
