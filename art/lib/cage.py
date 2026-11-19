"""Control-cage car bodies.

A body is a grid of COLUMNS (rear to front) x RING points. Each column gives the LEFT half of a
cross-section as 15 points from the bottom centre to the roof centre (index j):

    0 bottom centre   1 floor mid   2 floor edge   3 rocker corner   4 sill
    5 lower side      6 character   7 shoulder     8 belt (window sill)
    9 glass low      10 glass high  11 roof rail   12 roof edge (windshield edge)
   13 roof inner     14 roof centre

The right half is mirrored. Faces between columns i, i+1 and ring bands j, j+1 get a panel name from
the design's `panel(i, j, side)` rule, which becomes a material slot; after Catmull-Clark subdivision
(creases keep character lines sharp) the mesh is split by material, so panel outlines follow clean
edge loops. Both ends are closed with two inner rings and an n-gon (front fascia / rear panel).
"""
import bmesh
import bpy
import numpy as np

from .util import C_arr, link

H = 15  # half-ring points
RING = 2 * H - 2  # full ring points


def full_ring(half):
    """Left half (x >= 0) j = 0..14, then the mirrored right half j = 13..1."""
    pts = list(half)
    for j in range(H - 2, 0, -1):
        x, y, z = half[j]
        pts.append((-x, y, z))
    return pts


def band_of(k):
    """Face band k..k+1 -> (j band index, side)."""
    if k < H - 1:
        return k, "L"
    return RING - 1 - k, "R"


def ring_index_j(k):
    return k if k <= H - 1 else RING - k


def build_cage(name, columns_half, panel, front_caps, rear_caps, ring_crease=None, col_crease=None,
               panel_order=None):
    """Create the cage object.

    columns_half: list of half rings (15 (x, y, z) each), rear to front.
    panel(i, j, side) -> panel name for the face band between column i and i+1, ring band j.
    front_caps / rear_caps: list of (scale, dz, panel_name_for_ring_band) for the inner cap rings, the
        last entry's panel is also used for the closing n-gon.
    ring_crease: {j: crease} for longitudinal edges along ring line j.
    col_crease: {i: crease} for edges around column i.
    """
    rings = [full_ring(h) for h in columns_half]
    n_col = len(rings)
    verts = []
    for r in rings:
        verts.extend(r)
    faces, names = [], []

    def add_face(f, nm):
        faces.append(f)
        names.append(nm)

    for i in range(n_col - 1):
        for k in range(RING):
            k1 = (k + 1) % RING
            a, b = i * RING + k, i * RING + k1
            c, d = (i + 1) * RING + k1, (i + 1) * RING + k
            j, side = band_of(k)
            add_face((a, b, c, d), panel(i, j, side))

    def cap(ring_start, caps, front):
        prev = ring_start
        ring_pts = np.array(verts[ring_start:ring_start + RING])
        centre = ring_pts.mean(axis=0)
        for cap_def in caps:
            s, dz, nm = cap_def[0], cap_def[1], cap_def[2]
            dy = cap_def[3] if len(cap_def) > 3 else 0.0
            start = len(verts)
            for p in ring_pts:
                q = centre + (p - centre) * s
                q[2] += dz
                q[1] += dy
                verts.append(tuple(q))
            for k in range(RING):
                k1 = (k + 1) % RING
                a, b = prev + k, prev + k1
                c, d = start + k1, start + k
                j, side = band_of(k)
                pname = nm(j, side) if callable(nm) else nm
                add_face((a, b, c, d) if front else (a, d, c, b), pname)
            prev = start
        last_nm = caps[-1][2]
        last_nm = last_nm(7, "L") if callable(last_nm) else last_nm
        # Close with a quad grid of "rungs" joining left and right points of the innermost ring
        # (an n-gon would subdivide into a star-shaped pole).
        K = 4
        inner = np.array(verts[prev:prev + RING])
        bulge = caps[-1][1] * 0.6
        rungs = []
        for j in range(H):
            kl = j
            kr = 0 if j == 0 else (H - 1 if j == H - 1 else RING - j)
            if j in (0, H - 1):
                rungs.append([prev + kl] * (K + 2))
                continue
            row = [prev + kl]
            pl, pr = inner[kl], inner[kr]
            for t in range(1, K + 1):
                u = t / (K + 1)
                q = pl + (pr - pl) * u
                q = q.copy()
                q[2] += bulge * np.sin(np.pi * u)
                row.append(len(verts))
                verts.append(tuple(q))
            row.append(prev + kr)
            rungs.append(row)
        for j in range(H - 1):
            a_row, b_row = rungs[j], rungs[j + 1]
            for t in range(K + 1):
                quad = [a_row[t], a_row[t + 1], b_row[t + 1], b_row[t]]
                uniq = []
                for v in quad:
                    if v not in uniq:
                        uniq.append(v)
                if len(uniq) >= 3:
                    add_face(tuple(uniq), last_nm)

    cap((n_col - 1) * RING, front_caps, True)
    cap(0, rear_caps, False)

    # Material slots, one per panel name.
    order = list(panel_order or [])
    for nm in names:
        if nm not in order:
            order.append(nm)
    mats = []
    for nm in order:
        m = bpy.data.materials.get("panel:" + nm) or bpy.data.materials.new("panel:" + nm)
        mats.append(m)
    idx = [order.index(nm) for nm in names]

    me = bpy.data.meshes.new(name)
    me.from_pydata(C_arr(verts).tolist(), [], [list(f) for f in faces])
    me.update()
    for m in mats:
        me.materials.append(m)
    me.polygons.foreach_set("material_index", idx)
    me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
    obj = bpy.data.objects.new(name, me)
    link(obj)

    # Outward orientation + creases.
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    crease = bm.edges.layers.float.get("crease_edge") or bm.edges.layers.float.new("crease_edge")
    bm.verts.ensure_lookup_table()
    n_grid = n_col * RING
    for e in bm.edges:
        a, b = e.verts[0].index, e.verts[1].index
        if a >= n_grid or b >= n_grid:
            continue
        ia, ka = divmod(a, RING)
        ib, kb = divmod(b, RING)
        if ka == kb and ring_crease:  # longitudinal edge along a ring line
            w = ring_crease.get(ring_index_j(ka), 0.0)
            if w:
                e[crease] = w
        elif ia == ib and col_crease and ia in col_crease:
            e[crease] = col_crease[ia]
    bm.to_mesh(me)
    bm.free()
    return obj
