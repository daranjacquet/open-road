"""Turn split panel regions into believable parts: real panel gaps with flanges, inset glass,
light units with lenses and housings, grilles."""
import math

import bmesh
import numpy as np
from mathutils import Vector

from .util import bm_from, bm_to


def _boundary_dirs(bm):
    """Inward tangent direction for each boundary vertex (pointing into the panel)."""
    dirs = {}
    for v in bm.verts:
        bedges = [e for e in v.link_edges if e.is_boundary]
        if not bedges:
            continue
        n = v.normal
        acc = Vector((0, 0, 0))
        for e in bedges:
            o = e.other_vert(v)
            ed = (o.co - v.co)
            if ed.length == 0:
                continue
            t = n.cross(ed).normalized()
            # Orient towards the face that owns the edge.
            f = e.link_faces[0]
            if (f.calc_center_median() - v.co).dot(t) < 0:
                t = -t
            acc += t
        if acc.length > 0:
            dirs[v] = acc.normalized()
    return dirs


def gap_and_flange(obj, gap=0.0025, depth=0.016, flange_mat_index=1):
    """Pull the panel edge in by `gap` and fold a flange `depth` metres into the car."""
    bm = bm_from(obj)
    bm.normal_update()
    dirs = _boundary_dirs(bm)
    normals = {v: v.normal.copy() for v in dirs}
    for v, d in dirs.items():
        v.co += d * gap
    bedges = [e for e in bm.edges if e.is_boundary]
    for e in bedges:
        e.smooth = False  # keep the panel's own normals at the fold into the flange
    if bedges:
        ret = bmesh.ops.extrude_edge_only(bm, edges=bedges)
        new_verts = [e for e in ret["geom"] if isinstance(e, bmesh.types.BMVert)]
        new_faces = set()
        for v in new_verts:
            # Each new vertex was created from a boundary vertex: find it through the new edge.
            src = None
            for e in v.link_edges:
                o = e.other_vert(v)
                if o in normals:
                    src = o
                    break
            n = normals.get(src, Vector((0, 0, 0))) if src else Vector((0, 0, 0))
            dv = dirs.get(src, Vector((0, 0, 0))) if src else Vector((0, 0, 0))
            v.co += -n * depth + dv * depth * 0.25
            for f in v.link_faces:
                new_faces.add(f)
        for f in new_faces:
            f.material_index = flange_mat_index
            f.smooth = False
    bm_to(bm, obj)


def push_along_normals(obj, dist):
    bm = bm_from(obj)
    bm.normal_update()
    for v in bm.verts:
        v.co += v.normal * dist
    bm_to(bm, obj)


def glass_pane(obj, inset=0.012, frame=0.008, flange_mat_index=1):
    """Sink a glass region below the body surface and give it a dark rubber edge."""
    push_along_normals(obj, -inset)
    gap_and_flange(obj, gap=frame, depth=0.012, flange_mat_index=flange_mat_index)


def planar_uv(obj, axis_u, axis_v, scale=1.0):
    """Planar UV projection: u = p . axis_u * scale, v = p . axis_v * scale (Blender-space axes)."""
    me = obj.data
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    uv = me.uv_layers.active.data
    au, av = np.array(axis_u), np.array(axis_v)
    co = np.array([v.co[:] for v in me.vertices])
    i = 0
    for p in me.polygons:
        for li in p.loop_indices:
            vi = me.loops[li].vertex_index
            uv[li].uv = (float(co[vi] @ au * scale), float(co[vi] @ av * scale))
            i += 1


def bounds(obj):
    co = np.array([v.co[:] for v in obj.data.vertices]) + np.array(obj.location)
    # back to chassis frame: (x, y, z) = (bx, bz, -by)
    ch = np.stack([co[:, 0], co[:, 2], -co[:, 1]], axis=1)
    return ch.min(axis=0), ch.max(axis=0)


def solidify(obj, thickness, offset=-1.0, rim_mat_offset=0):
    m = obj.modifiers.new("solid", "SOLIDIFY")
    m.thickness = thickness
    m.offset = offset
    m.use_even_offset = True
    m.material_offset_rim = rim_mat_offset
    from .util import apply_modifiers
    apply_modifiers(obj)


def angle(deg):
    return math.radians(deg)
