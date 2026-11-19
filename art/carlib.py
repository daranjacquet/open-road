"""Geometry helpers for the parametric car generator (runs inside Blender's Python, uses numpy).

Frame used everywhere in this file ("chassis frame"): +Y up, +Z forward, +X left, metres.
Blender is Z-up with forward = -Y, so `to_blender` maps (x, y, z) -> (x, -z, y); the glTF exporter
then maps back to the chassis frame (Y-up), so the GLB the game loads is already in chassis frame.
"""
import math
import numpy as np


def key_curve(keys):
    """Cubic Hermite through (x, value) keyframes with finite-difference tangents; flat extrapolation."""
    xs = [k[0] for k in keys]
    ys = [k[1] for k in keys]
    n = len(keys)
    m = [0.0] * n
    for i in range(n):
        i0, i1 = max(i - 1, 0), min(i + 1, n - 1)
        m[i] = 0.0 if i1 == i0 else (ys[i1] - ys[i0]) / (xs[i1] - xs[i0])

    def f(x):
        if x <= xs[0]:
            return ys[0]
        if x >= xs[-1]:
            return ys[-1]
        i = 0
        while i < n - 2 and x > xs[i + 1]:
            i += 1
        h = xs[i + 1] - xs[i]
        t = (x - xs[i]) / h
        t2, t3 = t * t, t * t * t
        return ((2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i]
                + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1])

    return f


def closed_bspline(ctrl, per_span):
    """Closed uniform quadratic B-spline through control points, `per_span` samples per span."""
    n = len(ctrl)
    out = []
    for i in range(n):
        p0, p1, p2 = ctrl[i], ctrl[(i + 1) % n], ctrl[(i + 2) % n]
        for s in range(per_span):
            t = s / per_span
            a = 0.5 * (1 - t) ** 2
            b = 0.5 * (-2 * t * t + 2 * t + 1)
            c = 0.5 * t * t
            out.append((a * p0[0] + b * p1[0] + c * p2[0], a * p0[1] + b * p1[1] + c * p2[1]))
    return out


def loft(z_min, z_max, stations, per_span, section, end_round):
    """Closed tube along Z. Returns (positions[N,3], faces[M,3], ring). Faces point outwards."""
    first = section(z_min)
    n_half = len(first)
    ring = (n_half * 2 - 2) * per_span
    pos = np.zeros((stations * ring, 3), dtype=np.float64)
    for i in range(stations):
        u = i / (stations - 1)
        w = 0.5 - 0.5 * math.cos(math.pi * u)
        z = z_min + (z_max - z_min) * (0.5 * u + 0.5 * w)
        half = section(z)
        ctrl = [None] * (n_half * 2 - 2)
        for k in range(n_half):
            ctrl[k] = (half[k][0], half[k][1])
        for k in range(1, n_half - 1):
            ctrl[n_half - 1 + k] = (-half[n_half - 1 - k][0], half[n_half - 1 - k][1])
        pts = closed_bspline(ctrl, per_span)
        d_end = min(z - z_min, z_max - z)
        f = 1.0
        if d_end < end_round:
            r = 1 - d_end / end_round
            f = math.sqrt(max(0.0, 1 - r * r))
        cy = sum(p[1] for p in pts) / ring
        for j, p in enumerate(pts):
            pos[i * ring + j] = (p[0] * f, cy + (p[1] - cy) * f, z)
    faces = []
    for i in range(stations - 1):
        for j in range(ring):
            j1 = (j + 1) % ring
            a, b = i * ring + j, i * ring + j1
            c, d = (i + 1) * ring + j, (i + 1) * ring + j1
            faces.append((a, c, b))
            faces.append((b, c, d))
    faces = np.array(faces, dtype=np.int64)
    # Orientation check on the top-centre quad of the middle station.
    mid = stations // 2
    j = ring // 2
    a = pos[mid * ring + j]
    bb = pos[mid * ring + (j + 1) % ring]
    cc = pos[(mid + 1) * ring + j]
    n = np.cross(cc - a, bb - a)
    if n[1] < 0:
        faces = faces[:, [0, 2, 1]]
    return pos, faces, ring


def vertex_normals(pos, faces):
    """Area-weighted smooth vertex normals (same as three.js computeVertexNormals)."""
    p0, p1, p2 = pos[faces[:, 0]], pos[faces[:, 1]], pos[faces[:, 2]]
    fn = np.cross(p1 - p0, p2 - p0)
    nrm = np.zeros_like(pos)
    for k in range(3):
        np.add.at(nrm, faces[:, k], fn)
    ln = np.linalg.norm(nrm, axis=1, keepdims=True)
    ln[ln == 0] = 1
    return nrm / ln


def to_blender(v):
    """Chassis frame (x, y, z) -> Blender frame; the glTF exporter maps it back."""
    a = np.asarray(v, dtype=np.float64)
    if a.ndim == 1:
        return (a[0], -a[2], a[1])
    return np.stack([a[:, 0], -a[:, 2], a[:, 1]], axis=1)


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_to_linear(h):
    return (srgb_to_linear(((h >> 16) & 255) / 255), srgb_to_linear(((h >> 8) & 255) / 255), srgb_to_linear((h & 255) / 255), 1.0)
