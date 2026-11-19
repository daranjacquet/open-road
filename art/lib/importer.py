"""Helpers to bring a third-party car model into the game's conventions (see art/import_car.py)."""
import math
import os

import bpy
from mathutils import Matrix, Vector


def load_any(path):
    """Import a .glb/.gltf/.fbx/.obj or append everything from a .blend into the current scene."""
    ext = os.path.splitext(path)[1].lower()
    if ext in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=path)
    elif ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=path)
    elif ext == ".obj":
        bpy.ops.wm.obj_import(filepath=path)
    elif ext == ".blend":
        with bpy.data.libraries.load(path, link=False) as (src, dst):
            dst.objects = list(src.objects)
        for o in dst.objects:
            if o is not None:
                bpy.context.scene.collection.objects.link(o)
    else:
        raise ValueError(f"unsupported model format: {ext}")


def tri_count(o):
    me = o.data
    me.calc_loop_triangles()
    return len(me.loop_triangles)


def world_bbox(o):
    pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def scene_bbox(objs):
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        a, b = world_bbox(o)
        lo = Vector(map(min, lo, a))
        hi = Vector(map(max, hi, b))
    return lo, hi


def apply_all_transforms():
    """Bake every object's world transform into its mesh and clear parenting (flat, world-space meshes)."""
    bpy.context.view_layer.update()
    for o in list(bpy.data.objects):
        if o.type != "MESH":
            continue
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
    for o in list(bpy.data.objects):
        if o.type != "MESH":
            continue
        if o.data.users > 1:
            o.data = o.data.copy()
        o.data.transform(o.matrix_world)
        o.matrix_world = Matrix.Identity(4)
    for o in list(bpy.data.objects):
        if o.type != "MESH":
            bpy.data.objects.remove(o, do_unlink=True)


def orient_and_scale(forward="-Y", length=None, ground=True):
    """Turn the car so it faces Blender -Y (the game's +Z after export), scale it to `length` metres,
    centre it on X/Y and put the lowest point (tyres) on Z = 0."""
    rot = {"-Y": 0.0, "+Y": math.pi, "+X": -math.pi / 2, "-X": math.pi / 2}[forward]
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    m = Matrix.Rotation(rot, 4, "Z")
    for o in meshes:
        o.data.transform(m)
        o.data.update()
    bpy.context.view_layer.update()
    lo, hi = scene_bbox(meshes)
    k = 1.0
    if length:
        k = length / (hi.y - lo.y)
    c = (lo + hi) / 2
    t = Matrix.Translation((-c.x * k, -c.y * k, -lo.z * k if ground else 0)) @ Matrix.Scale(k, 4)
    for o in meshes:
        o.data.transform(t)
        o.data.update()
    bpy.context.view_layer.update()
    return scene_bbox(meshes)


def quick_render(path, lo, hi, view=(1.0, -1.0, 0.45)):
    """Workbench three-quarter render of the whole scene."""
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"
    scene.render.resolution_x = 1200
    scene.render.resolution_y = 800
    c = (lo + hi) / 2
    r = (hi - lo).length * 1.2
    cam_data = bpy.data.cameras.new("preview")
    cam = bpy.data.objects.new("preview", cam_data)
    scene.collection.objects.link(cam)
    d = Vector(view).normalized()
    cam.location = c + d * r
    cam.rotation_euler = (c - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam_data.lens = 50
    scene.camera = cam
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)
