"""Small parts: mirrors, handles, wipers, exhaust tips, plates, badges, spoilers, splitters, antenna,
and surface queries to place them flush on the body."""
import math

import bpy
import numpy as np
from mathutils import Vector

from .util import C, apply_modifiers, box, cylinder, mesh_object, parent_keep, rotate, set_smooth_by_angle
from .wheels import lathe


def hit(objs, origin, direction, dist=3.0):
    """Ray-cast in chassis frame against objects; returns (point, normal) in chassis frame or None."""
    best = None
    o_w = C(*origin)
    d_w = C(*direction).normalized()
    for ob in objs:
        mi = ob.matrix_world.inverted()
        o_l = mi @ o_w
        d_l = (mi.to_3x3() @ d_w).normalized()
        ok, loc, nrm, _ = ob.ray_cast(o_l, d_l, distance=dist)
        if ok:
            lw = ob.matrix_world @ loc
            dd = (lw - o_w).length
            if best is None or dd < best[0]:
                nw = (ob.matrix_world.to_3x3() @ nrm).normalized()
                best = (dd, lw, nw)
    if not best:
        return None
    _, p, n = best
    return np.array([p.x, p.z, -p.y]), np.array([n.x, n.z, -n.y])


def rounded_box(name, center, size, mat, levels=2, rot=(0, 0, 0)):
    o = box(name, center, size, mat, rot=rot)
    m = o.modifiers.new("subd", "SUBSURF")
    m.levels = levels
    apply_modifiers(o)
    for p in o.data.polygons:
        p.use_smooth = True
    return o


def mirror(name, side, anchor, mats, paint="paint"):
    """Wing mirror: aero housing on a stalk with a chrome glass. anchor = point on the door at belt line."""
    s = side
    ax, ay, az = anchor
    housing = rounded_box(name, (ax + s * 0.13, ay + 0.06, az - 0.02), (0.2, 0.11, 0.12), mats[paint])
    stalk = box(name + "_stalk", (ax + s * 0.045, ay + 0.02, az + 0.0), (0.09, 0.025, 0.06), mats["trim_matte"])
    glass = box(name + "_glass", (ax + s * 0.13, ay + 0.06, az - 0.082), (0.17, 0.085, 0.01), mats["chrome"])
    for c in (stalk, glass):
        parent_keep(c, housing)
    return housing


def handle(name, point, normal, mats, length=0.17, mat="chrome"):
    p = np.array(point) + np.array(normal) * 0.004
    yaw = math.atan2(normal[0], normal[2])
    o = rounded_box(name, tuple(p), (0.02, 0.028, length), mats[mat], levels=2, rot=(0, yaw - math.pi / 2 + math.pi / 2, 0))
    return o


def wiper(name, start, end, mats):
    a, b = np.array(start), np.array(end)
    mid = (a + b) / 2
    d = b - a
    L = float(np.linalg.norm(d))
    yaw = math.atan2(d[0], d[2])
    pitch = -math.atan2(d[1], math.hypot(d[0], d[2]))
    return box(name, tuple(mid), (0.018, 0.012, L), mats["trim_matte"], rot=(pitch, yaw, 0))


def exhaust_tip(name, center, radius, length, mats, oval=1.0):
    """Hollow tip pointing backwards (-Z) with a sooty inside."""
    prof = [(radius * 0.8, 0.0), (radius, 0.0), (radius, -length), (radius * 1.04, -length - 0.004),
            (radius * 0.92, -length - 0.006), (radius * 0.88, -length + 0.01), (radius * 0.88, -0.02)]
    v, f, _ = lathe([(r, a) for r, a in prof], 28)
    v = np.array(v)[:, [1, 2, 0]]  # lathe axis X -> Z
    v[:, 0] *= oval
    v = v + np.array(center)
    o = mesh_object(name, v, f, [mats["exhaust"]])
    set_smooth_by_angle(o, 40)
    inner = cylinder(name + "_soot", (center[0], center[1], center[2] - length * 0.6), radius * 0.86, 0.01, "z", mats["soot"], segments=20)
    parent_keep(inner, o)
    return o


def plate(name, center, facing, mats, w=0.52, h=0.115):
    """facing: +1 front plate (normal +Z), -1 rear plate."""
    yaw = 0 if facing > 0 else math.pi
    o = box(name, center, (w, h, 0.006), mats["plate"], rot=(0, yaw, 0))
    # UV: map the front face to the full texture.
    me = o.data
    layer = me.uv_layers.new(name="UVMap")
    co = np.array([v.co[:] for v in me.vertices])
    mn, mx = co.min(axis=0), co.max(axis=0)
    for p in me.polygons:
        for li in p.loop_indices:
            vco = co[me.loops[li].vertex_index]
            u = (vco[0] - mn[0]) / max(mx[0] - mn[0], 1e-6)
            v = (vco[2] - mn[2]) / max(mx[2] - mn[2], 1e-6)
            layer.data[li].uv = (u if facing > 0 else 1 - u, v)
    return o


def badge(name, center, radius, axis, mats):
    return cylinder(name, center, radius, 0.006, axis, mats["chrome"], segments=24)


def lip_spoiler(name, z_edge, y_top, half_w, mats, mat="carbon", height=0.035, depth=0.09, kick=0.025):
    """Thin wedge across the boot edge."""
    xs = np.linspace(-half_w, half_w, 13)
    verts, faces = [], []
    for x in xs:
        curve = 1 - (abs(x) / half_w) ** 4 * 0.04
        y0 = y_top * curve
        prof = [(y0 - 0.004, z_edge + depth * 0.4), (y0 + height * 0.25, z_edge + depth * 0.5),
                (y0 + height + kick * 0.3, z_edge - depth * 0.45), (y0 + height * 0.5, z_edge - depth * 0.5),
                (y0 - 0.004, z_edge - depth * 0.35)]
        for (y, z) in prof:
            verts.append((x, y, z))
    n = 5
    for i in range(len(xs) - 1):
        for k in range(n):
            k1 = (k + 1) % n
            faces.append((i * n + k, i * n + k1, (i + 1) * n + k1, (i + 1) * n + k))
    faces.append(tuple(range(n - 1, -1, -1)))
    last = (len(xs) - 1) * n
    faces.append(tuple(last + k for k in range(n)))
    o = mesh_object(name, np.array(verts), faces, [mats[mat]])
    set_smooth_by_angle(o, 35)
    return o


def wing(name, z, y, half_w, chord, mats, mat="carbon", posts_x=0.55, post_bottom=None):
    """Rear wing with end plates and posts."""
    xs = np.linspace(-half_w, half_w, 9)
    verts, faces = [], []
    prof = [(0.0, chord * 0.5), (0.012, chord * 0.25), (0.016, -chord * 0.1), (0.022, -chord * 0.5),
            (0.0, -chord * 0.48), (-0.006, 0.0)]
    for x in xs:
        for (dy, dz) in prof:
            verts.append((x, y + dy, z + dz))
    n = len(prof)
    for i in range(len(xs) - 1):
        for k in range(n):
            k1 = (k + 1) % n
            faces.append((i * n + k, i * n + k1, (i + 1) * n + k1, (i + 1) * n + k))
    faces.append(tuple(range(n - 1, -1, -1)))
    last = (len(xs) - 1) * n
    faces.append(tuple(last + k for k in range(n)))
    o = mesh_object(name, np.array(verts), faces, [mats[mat]])
    set_smooth_by_angle(o, 35)
    for s in (1, -1):
        ep = box(f"{name}_end{'L' if s > 0 else 'R'}", (s * (half_w + 0.004), y + 0.02, z - 0.01), (0.008, 0.11, chord * 1.15), mats[mat])
        parent_keep(ep, o)
        if post_bottom is not None:
            ph = y - post_bottom
            post = box(f"{name}_post{'L' if s > 0 else 'R'}", (s * posts_x, post_bottom + ph / 2, z + 0.02), (0.02, ph, 0.08), mats["trim_matte"])
            parent_keep(post, o)
    return o


def shark_fin(name, center, mats, mat="paint"):
    v = []
    L, Hh, Wd = 0.16, 0.06, 0.05
    for t in np.linspace(0, 1, 7):
        y = Hh * (1 - t) ** 0.8 * math.sin(math.pi * min(1, t * 1.2 + 0.05))
        w = Wd / 2 * (1 - t * 0.8)
        z = -L * t
        v.extend([(-w, 0.0, z), (w, 0.0, z), (0.0, y + 0.002, z)])
    f = []
    for i in range(6):
        a = i * 3
        b = a + 3
        f.extend([(a, b, b + 2, a + 2), (a + 1, a + 2, b + 2, b + 1), (a, a + 1, b + 1, b)])
    f.append((0, 2, 1))
    v = np.array(v) + np.array(center)
    o = mesh_object(name, v, f, [mats[mat]])
    set_smooth_by_angle(o, 50)
    return o


def strip(name, pts, half_t, height, mats, mat):
    """A rectangular-section strip following points (chassis frame), e.g. side skirts, splitter edges."""
    pts = np.array(pts, dtype=np.float64)
    verts, faces = [], []
    for i, p in enumerate(pts):
        d = pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]
        d /= max(np.linalg.norm(d), 1e-9)
        side = np.cross(d, [0, 1, 0])
        if np.linalg.norm(side) < 1e-6:
            side = np.array([1.0, 0, 0])
        side /= np.linalg.norm(side)
        for (s, h) in ((-1, 0), (1, 0), (1, height), (-1, height)):
            verts.append(tuple(p + side * s * half_t + np.array([0, h, 0])))
    n = 4
    for i in range(len(pts) - 1):
        for k in range(n):
            k1 = (k + 1) % n
            faces.append((i * n + k, i * n + k1, (i + 1) * n + k1, (i + 1) * n + k))
    faces.append((3, 2, 1, 0))
    last = (len(pts) - 1) * n
    faces.append((last, last + 1, last + 2, last + 3))
    o = mesh_object(name, np.array(verts), faces, [mats[mat]])
    set_smooth_by_angle(o, 40)
    return o


def unused():
    return bpy, Vector, rotate


def delete_obj(o):
    bpy.data.objects.remove(o, do_unlink=True)


def arch_flare(name, side, az, ay, R0, width, thick, mat, a0=-10, a1=190, x_in=0.93):
    """Box-section band around a wheel arch (bolt-on flare)."""
    angs = np.radians(np.linspace(a0, a1, 30))
    verts, faces = [], []
    for a in angs:
        for (r, x) in ((R0, x_in), (R0 + width, x_in), (R0 + width, x_in + thick), (R0 + width * 0.35, x_in + thick)):
            verts.append((side * x, ay + r * math.sin(a), az + r * math.cos(a)))
    n = 4
    for i in range(len(angs) - 1):
        for k in range(n):
            k1 = (k + 1) % n
            faces.append((i * n + k, i * n + k1, (i + 1) * n + k1, (i + 1) * n + k))
    faces.append((3, 2, 1, 0))
    last = (len(angs) - 1) * n
    faces.append((last, last + 1, last + 2, last + 3))
    o = mesh_object(name, np.array(verts), faces, [mat])
    from .util import bm_from, bm_to
    import bmesh
    bm = bm_from(o)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm_to(bm, o)
    set_smooth_by_angle(o, 40)
    return o


def tube(name, pts, radius, mat, segments=16):
    """Circular tube swept along a polyline (chassis frame)."""
    pts = np.array(pts, dtype=np.float64)
    verts, faces = [], []
    for i, p in enumerate(pts):
        d = pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]
        d /= np.linalg.norm(d)
        up = np.array([0, 1.0, 0]) if abs(d[1]) < 0.9 else np.array([1.0, 0, 0])
        a = np.cross(d, up)
        a /= np.linalg.norm(a)
        b = np.cross(d, a)
        for k in range(segments):
            t = k / segments * 2 * math.pi
            verts.append(tuple(p + radius * (math.cos(t) * a + math.sin(t) * b)))
    for i in range(len(pts) - 1):
        for k in range(segments):
            k1 = (k + 1) % segments
            faces.append((i * segments + k, i * segments + k1, (i + 1) * segments + k1, (i + 1) * segments + k))
    faces.append(tuple(range(segments - 1, -1, -1)))
    last = (len(pts) - 1) * segments
    faces.append(tuple(last + k for k in range(segments)))
    o = mesh_object(name, np.array(verts), faces, [mat])
    from .util import bm_from, bm_to
    import bmesh
    bm = bm_from(o)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm_to(bm, o)
    set_smooth_by_angle(o, 50)
    return o
