"""Shared helpers. Design coordinates are the game's chassis frame: +X left, +Y up, +Z forward (metres).
Blender is Z-up with the car facing -Y, so C(x, y, z) = (x, -z, y). The glTF exporter (Y-up) maps it back."""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Vector


def C(x, y, z):
    return Vector((x, -z, y))


def C_arr(a):
    a = np.asarray(a, dtype=np.float64)
    return np.stack([a[..., 0], -a[..., 2], a[..., 1]], axis=-1)


def lerp(a, b, t):
    return a + (b - a) * t


def smoothstep(e0, e1, x):
    t = min(max((x - e0) / (e1 - e0), 0.0), 1.0)
    return t * t * (3 - 2 * t)


def link(obj, collection=None):
    (collection or bpy.context.scene.collection).objects.link(obj)
    return obj


def mesh_object(name, verts_chassis, faces, materials=(), mat_index=None, smooth=True, collection=None):
    """Create an object from chassis-frame vertices. `faces` may mix tris, quads and n-gons."""
    me = bpy.data.meshes.new(name)
    v = C_arr(verts_chassis).tolist()
    me.from_pydata(v, [], [list(f) for f in faces])
    me.update()
    for m in materials:
        me.materials.append(m)
    if mat_index is not None:
        me.polygons.foreach_set("material_index", list(mat_index))
    if smooth:
        me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
    obj = bpy.data.objects.new(name, me)
    return link(obj, collection)


def set_active(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def apply_modifiers(obj):
    set_active(obj)
    for m in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def subdivide(obj, levels=2, creases=True):
    m = obj.modifiers.new("subd", "SUBSURF")
    m.levels = levels
    m.render_levels = levels
    m.use_creases = creases
    m.quality = 3
    apply_modifiers(obj)


def boolean(obj, cutter, op="DIFFERENCE"):
    m = obj.modifiers.new("bool", "BOOLEAN")
    m.operation = op
    m.object = cutter
    m.solver = "EXACT"
    try:
        m.material_mode = "TRANSFER"
    except Exception:
        pass
    apply_modifiers(obj)


def delete(obj):
    bpy.data.objects.remove(obj, do_unlink=True)


def separate_by_material(obj):
    """Split an object into one object per material slot; returns {material name: object}."""
    set_active(obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.separate(type="MATERIAL")
    bpy.ops.object.mode_set(mode="OBJECT")
    out = {}
    for o in bpy.context.selected_objects:
        used = {p.material_index for p in o.data.polygons}
        if not used:
            continue
        idx = used.pop()
        mat = o.data.materials[idx] if idx < len(o.data.materials) else None
        name = mat.name if mat else o.name
        # Keep only the material actually used.
        keep = mat
        o.data.materials.clear()
        if keep:
            o.data.materials.append(keep)
        for p in o.data.polygons:
            p.material_index = 0
        o.name = name
        o.data.name = name
        out[name] = o
    return out


def set_origin(obj, chassis_point):
    """Move the object origin to a chassis-frame point without moving the geometry."""
    bpy.context.view_layer.update()
    kids = [(c, c.matrix_world.copy()) for c in obj.children]
    target = C(*chassis_point)
    delta = target - obj.location
    obj.data.transform(__import__("mathutils").Matrix.Translation(-delta))
    obj.location = target
    bpy.context.view_layer.update()
    for c, mw in kids:
        c.matrix_world = mw
    bpy.context.view_layer.update()
    obj["chassis_pivot"] = [float(chassis_point[0]), float(chassis_point[1]), float(chassis_point[2])]


def origin_to_center(obj):
    bb = np.array([v.co[:] for v in obj.data.vertices])
    if len(bb) == 0:
        return
    c = (bb.min(axis=0) + bb.max(axis=0)) / 2 + np.array(obj.location)
    set_origin(obj, (c[0], c[2], -c[1]))


def parent_keep(child, parent):
    bpy.context.view_layer.update()
    mw = child.matrix_world.copy()
    child.parent = parent
    child.matrix_parent_inverse = parent.matrix_world.inverted()
    child.matrix_world = mw


def bm_from(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    return bm


def bm_to(bm, obj):
    bm.to_mesh(obj.data)
    obj.data.update()
    bm.free()


def tri_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


# ---------------------------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------------------------

def srgb(h):
    def lin(c):
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (lin(((h >> 16) & 255) / 255), lin(((h >> 8) & 255) / 255), lin((h & 255) / 255), 1.0)


def material(name, color=0x808080, metallic=0.0, roughness=0.5, coat=0.0, coat_rough=0.05, alpha=1.0,
             emission=None, emission_strength=1.0, image=None, alpha_image=None, normal_image=None, uv_scale=None,
             specular=None):
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name)
    try:
        mat.use_nodes = True
    except Exception:
        pass
    nt = mat.node_tree
    b = nt.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = srgb(color) if isinstance(color, int) else color
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = roughness
    if specular is not None and "Specular IOR Level" in b.inputs:
        b.inputs["Specular IOR Level"].default_value = specular
    if coat > 0 and "Coat Weight" in b.inputs:
        b.inputs["Coat Weight"].default_value = coat
        b.inputs["Coat Roughness"].default_value = coat_rough
    if emission is not None:
        b.inputs["Emission Color"].default_value = srgb(emission) if isinstance(emission, int) else emission
        b.inputs["Emission Strength"].default_value = emission_strength
    if alpha < 1.0 or alpha_image is not None:
        b.inputs["Alpha"].default_value = alpha
        try:
            mat.surface_render_method = "BLENDED" if alpha_image is None else "DITHERED"
        except Exception:
            pass
    if image is not None:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = image
        nt.links.new(tex.outputs["Color"], b.inputs["Base Color"])
        if alpha_image is image:
            nt.links.new(tex.outputs["Alpha"], b.inputs["Alpha"])
    if normal_image is not None:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = normal_image
        normal_image.colorspace_settings.name = "Non-Color"
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(tex.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], b.inputs["Normal"])
    return mat


def image_from_array(name, rgba):
    """rgba: float array (h, w, 4) in 0..1 (sRGB values for colour images)."""
    h, w, _ = rgba.shape
    img = bpy.data.images.new(name, width=w, height=h, alpha=True)
    img.pixels.foreach_set(np.ascontiguousarray(rgba[::-1]).ravel().astype(np.float32))
    img.pack()
    img.file_format = "PNG"
    return img


# ---------------------------------------------------------------------------------------------
# Primitive builders (chassis frame)
# ---------------------------------------------------------------------------------------------

def box(name, center, size, mat, bevel=0.0, rot=(0, 0, 0), collection=None):
    sx, sy, sz = (s / 2 for s in size)
    v = [(-sx, -sy, -sz), (sx, -sy, -sz), (sx, sy, -sz), (-sx, sy, -sz),
         (-sx, -sy, sz), (sx, -sy, sz), (sx, sy, sz), (-sx, sy, sz)]
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (2, 3, 7, 6), (1, 2, 6, 5), (0, 4, 7, 3)]
    v = rotate(np.array(v), rot) + np.array(center)
    o = mesh_object(name, v, f, [mat], smooth=False, collection=collection)
    if bevel > 0:
        m = o.modifiers.new("bev", "BEVEL")
        m.width = bevel
        m.segments = 2
        m.limit_method = "ANGLE"
        apply_modifiers(o)
        set_smooth_by_angle(o)
    return o


def rotate(v, rot):
    rx, ry, rz = rot
    v = np.asarray(v, dtype=np.float64)
    if rx:
        c, s = math.cos(rx), math.sin(rx)
        v = v @ np.array([[1, 0, 0], [0, c, -s], [0, s, c]]).T
    if ry:
        c, s = math.cos(ry), math.sin(ry)
        v = v @ np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]]).T
    if rz:
        c, s = math.cos(rz), math.sin(rz)
        v = v @ np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]]).T
    return v


def cylinder(name, center, radius, length, axis, mat, segments=24, rot=(0, 0, 0), caps=True, radius2=None, collection=None):
    """Cylinder (or cone frustum with radius2) along 'x', 'y' or 'z' (chassis axes)."""
    r2 = radius if radius2 is None else radius2
    ang = np.linspace(0, 2 * math.pi, segments, endpoint=False)
    v = []
    for t, r in ((-length / 2, radius), (length / 2, r2)):
        for a in ang:
            v.append((r * math.cos(a), r * math.sin(a), t))
    f = [(i, (i + 1) % segments, segments + (i + 1) % segments, segments + i) for i in range(segments)]
    if caps:
        f.append(tuple(range(segments - 1, -1, -1)))
        f.append(tuple(range(segments, 2 * segments)))
    v = np.array(v)
    if axis == "x":
        v = v[:, [2, 0, 1]]
    elif axis == "y":
        v = v[:, [0, 2, 1]]
    v = rotate(v, rot) + np.array(center)
    o = mesh_object(name, v, f, [mat], collection=collection)
    set_smooth_by_angle(o, 40)
    return o


def set_smooth_by_angle(obj, angle_deg=35):
    """Flat-shade sharp edges, smooth the rest (via split normals)."""
    bm = bm_from(obj)
    lim = math.radians(angle_deg)
    for e in bm.edges:
        if len(e.link_faces) == 2 and e.calc_face_angle(0) > lim:
            e.smooth = False
    for f in bm.faces:
        f.smooth = True
    bm_to(bm, obj)


def join(objs, name):
    set_active(objs[0])
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = name
    o.data.name = name
    return o
