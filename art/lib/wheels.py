"""Parametric wheels: tyre (with tread normal map or modelled all-terrain blocks), multi-spoke rims,
brake discs and calipers. Built at the origin, axle along chassis X; `outer` = +1 (left wheels) or -1."""
import math

import numpy as np

from .util import mesh_object, set_smooth_by_angle


def lathe(profile, segments, a0=0.0, a1=2 * math.pi, closed=True, uv_repeat=None):
    """Revolve (radius, axial) points about X. Returns verts, faces, uvs-per-face-corner (or None)."""
    n = len(profile)
    seg = segments if closed else segments + 1
    angs = [a0 + (a1 - a0) * k / segments for k in range(seg)]
    verts = []
    for r, ax in profile:
        for t in angs:
            verts.append((ax, r * math.cos(t), r * math.sin(t)))
    faces, uvs = [], []
    for i in range(n - 1):
        for k in range(segments):
            k1 = (k + 1) % seg if closed else k + 1
            faces.append((i * seg + k, i * seg + k1, (i + 1) * seg + k1, (i + 1) * seg + k))
            if uv_repeat:
                u0, u1 = k / segments * uv_repeat, (k + 1) / segments * uv_repeat
                v0, v1 = i / (n - 1), (i + 1) / (n - 1)
                uvs.append([(u0, v0), (u1, v0), (u1, v1), (u0, v1)])
    return verts, faces, uvs


def _apply_uv(obj, uvs):
    me = obj.data
    layer = me.uv_layers.new(name="UVMap")
    for p, quad in zip(me.polygons, uvs):
        for li, uv in zip(p.loop_indices, quad):
            layer.data[li].uv = uv


def tyre(name, R, W, rim_r, mat_tread, mat_side, segments=72, style="road"):
    hw = W / 2
    side_h = R - rim_r
    prof = [
        (rim_r - 0.004, -hw * 0.86),
        (rim_r + 0.006, -hw * 0.98),
        (rim_r + side_h * 0.35, -hw * 1.02),
        (rim_r + side_h * 0.75, -hw * 0.99),
        (R - 0.012, -hw * 0.9),
        (R - 0.002, -hw * 0.78),
        (R, -hw * 0.6),
        (R, hw * 0.6),
        (R - 0.002, hw * 0.78),
        (R - 0.012, hw * 0.9),
        (rim_r + side_h * 0.75, hw * 0.99),
        (rim_r + side_h * 0.35, hw * 1.02),
        (rim_r + 0.006, hw * 0.98),
        (rim_r - 0.004, hw * 0.86),
    ]
    v, f, uv = lathe(prof, segments, uv_repeat=1.0)
    mats = [mat_side, mat_tread]
    idx = []
    for k in range(len(f)):
        band = k // segments
        idx.append(1 if 5 <= band <= 7 else 0)
    # Tread UVs: u around (repeat 6 so the texture density works), v across the tread band.
    o = mesh_object(name, np.array(v), f, mats, mat_index=idx)
    tread_uv = []
    for k, q in enumerate(uv):
        band = k // segments
        vv0 = (band - 5) / 3 if 5 <= band <= 7 else 0
        vv1 = (band - 4) / 3 if 5 <= band <= 7 else 0
        tread_uv.append([(q[0][0] * 6, vv0), (q[1][0] * 6, vv0), (q[2][0] * 6, vv1), (q[3][0] * 6, vv1)])
    _apply_uv(o, tread_uv)
    if style == "at":
        _at_blocks(o, R, W, segments)
    return o


def _at_blocks(tyre_obj, R, W, segments):
    """Chunky all-terrain tread blocks (two staggered rows plus shoulder lugs)."""
    import bmesh
    from .util import bm_from, bm_to
    bm = bm_from(tyre_obj)
    n = 36
    for row, (x0, x1, phase) in enumerate(((-W * 0.46, -W * 0.03, 0.0), (W * 0.03, W * 0.46, 0.5))):
        for k in range(n):
            a = (k + phase) / n * 2 * math.pi
            da = 2 * math.pi / n * 0.62
            r0, r1 = R - 0.004, R + 0.014
            pts = []
            for (aa, rr) in ((a - da / 2, r0), (a + da / 2, r0), (a + da / 2, r1), (a - da / 2, r1)):
                pts.append((aa, rr))
            vs = []
            for x in (x0, x1):
                for aa, rr in pts:
                    co = (x, rr * math.cos(aa), rr * math.sin(aa))
                    vs.append(bm.verts.new((co[0], -co[2], co[1])))
            faces = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
            for fi in faces:
                face = bm.faces.new([vs[i] for i in fi])
                face.material_index = 1
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm_to(bm, tyre_obj)


def spoke_block(r0, r1, w0, w1, t0, t1, x_face, dish, angle, outer):
    """A tapered spoke from radius r0 (hub) to r1 (rim) around the X axis."""
    verts = []
    for (r, w, t, d) in ((r0, w0, t0, dish), (r1, w1, t1, 0.0)):
        for (sw, st) in ((-1, 0), (1, 0), (1, 1), (-1, 1)):
            y = sw * w / 2
            x = outer * (x_face + d - st * t)
            # Point at radius r along angle, offset sideways by y.
            ca, sa = math.cos(angle), math.sin(angle)
            verts.append((x, r * ca - y * sa, r * sa + y * ca))
    faces = [(0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (3, 2, 1, 0), (4, 5, 6, 7)]
    return verts, faces


def rim(name, R_rim, W, mat, outer, style="double5", spokes=None):
    hw = W / 2
    face = hw * 0.62  # axial position of the spoke face (towards the outside)
    verts, faces = [], []

    def add(v, f):
        off = len(verts)
        verts.extend(v)
        faces.extend([tuple(i + off for i in ff) for ff in f])

    # Barrel and lip
    prof = [(R_rim - 0.012, -hw * 0.95), (R_rim - 0.006, -hw * 0.6), (R_rim - 0.02, -hw * 0.1),
            (R_rim - 0.02, hw * 0.45), (R_rim - 0.004, hw * 0.7), (R_rim + 0.014, hw * 0.78),
            (R_rim + 0.016, hw * 0.86), (R_rim - 0.004, hw * 0.88)]
    prof = [(r, a * outer) for r, a in prof]
    if outer < 0:
        prof = list(reversed(prof))
    v, f, _ = lathe(prof, 64)
    add(v, f)
    hub_r = 0.075
    if style == "double5":
        for k in range(5):
            base = k / 5 * 2 * math.pi
            for off in (-0.13, 0.13):
                v, f = spoke_block(hub_r, R_rim - 0.015, 0.03, 0.022, 0.03, 0.018, face, 0.035, base + off * 0.9, outer)
                add(v, f)
    elif style == "y6":
        for k in range(6):
            base = k / 6 * 2 * math.pi
            v, f = spoke_block(hub_r, R_rim * 0.62, 0.05, 0.045, 0.04, 0.035, face, 0.025, base, outer)
            add(v, f)
            for off in (-0.16, 0.16):
                v, f = spoke_block(R_rim * 0.6, R_rim - 0.012, 0.03, 0.026, 0.035, 0.03, face, 0.008, base + off, outer)
                add(v, f)
    else:  # "ten": ten slender spokes, centre lock
        for k in range(spokes or 10):
            base = k / (spokes or 10) * 2 * math.pi
            v, f = spoke_block(hub_r * 0.85, R_rim - 0.012, 0.024, 0.018, 0.026, 0.014, face, 0.045, base, outer)
            add(v, f)
    # Hub disc
    hv, hf, _ = lathe([(0.0, outer * (face + 0.03)), (hub_r, outer * (face + 0.03)), (hub_r, outer * (face - 0.02))], 24)
    add(hv, hf)
    o = mesh_object(name, np.array(verts), faces, [mat])
    set_smooth_by_angle(o, 30)
    return o


def lug_nuts(name, outer, x_face, mat, count=5, r=0.055, centre_lock=False):
    verts, faces = [], []

    def add(v, f):
        off = len(verts)
        verts.extend(v)
        faces.extend([tuple(i + off for i in ff) for ff in f])

    if centre_lock:
        v, f, _ = lathe([(0.0, outer * (x_face + 0.065)), (0.035, outer * (x_face + 0.065)),
                         (0.042, outer * (x_face + 0.03)), (0.042, outer * (x_face + 0.0))], 6)
        add(v, f)
    else:
        for k in range(count):
            a = k / count * 2 * math.pi
            cy, cz = r * math.cos(a), r * math.sin(a)
            v, f, _ = lathe([(0.0, outer * (x_face + 0.045)), (0.011, outer * (x_face + 0.045)), (0.011, outer * (x_face + 0.02))], 6)
            v = [(x, y + cy, z + cz) for (x, y, z) in v]
            add(v, f)
    o = mesh_object(name, np.array(verts), faces, [mat])
    set_smooth_by_angle(o, 30)
    return o


def disc(name, r, outer, mat, W):
    x0 = -outer * W * 0.05
    prof = [(0.09, x0 + outer * 0.02), (r, x0 + outer * 0.014), (r, x0 - outer * 0.014), (0.09, x0 - outer * 0.014),
            (0.08, x0 + outer * 0.05), (0.0, x0 + outer * 0.05)]
    v, f, _ = lathe(prof, 48)
    o = mesh_object(name, np.array(v), f, [mat])
    set_smooth_by_angle(o, 30)
    return o


def caliper(name, r_disc, outer, mat, W, angle=math.radians(150)):
    """Four-piston-style caliper hugging the disc edge (does not spin)."""
    x0 = -outer * W * 0.05
    span = 0.42
    verts, faces = [], []
    segs = 8
    r_in, r_out = r_disc - 0.07, r_disc + 0.012
    for k in range(segs + 1):
        a = angle - span / 2 + span * k / segs
        for (r, x) in ((r_in, x0 - outer * 0.03), (r_out, x0 - outer * 0.03), (r_out, x0 + outer * 0.035), (r_in, x0 + outer * 0.035)):
            verts.append((x, r * math.cos(a), r * math.sin(a)))
    for k in range(segs):
        for s in range(4):
            a0, a1 = k * 4 + s, k * 4 + (s + 1) % 4
            b0, b1 = (k + 1) * 4 + s, (k + 1) * 4 + (s + 1) % 4
            faces.append((a0, a1, b1, b0))
    faces.append((3, 2, 1, 0))
    last = segs * 4
    faces.append((last, last + 1, last + 2, last + 3))
    o = mesh_object(name, np.array(verts), faces, [mat])
    set_smooth_by_angle(o, 25)
    return o


def build_wheel(tag, outer, spec, mats):
    """Returns the list of objects for one wheel, named <part>_<tag>."""
    R, W, rim_r = spec["R"], spec["W"], spec["rim_r"]
    style = spec.get("rim_style", "double5")
    tyre_mat = mats["tire_at"] if spec.get("tread") == "at" else mats["tire"]
    objs = [
        tyre(f"tire_{tag}", R, W, rim_r, tyre_mat, mats["sidewall"], style=spec.get("tread", "road")),
        rim(f"rim_{tag}", rim_r, W, mats[spec.get("rim_mat", "rim")], outer, style, spec.get("spokes")),
        lug_nuts(f"nuts_{tag}", outer, W / 2 * 0.62, mats["chrome"], centre_lock=style == "ten"),
        disc(f"disc_{tag}", spec.get("disc_r", rim_r - 0.04), outer, mats["disc"], W),
        caliper(f"caliper_{tag}", spec.get("disc_r", rim_r - 0.04), outer, mats["caliper"], W,
                angle=math.radians(150 if tag[0] == "F" else 30)),
    ]
    return objs
