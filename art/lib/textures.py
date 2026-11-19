"""Procedural textures baked into images (numpy) and packed into the .blend / GLB."""
import math

import numpy as np

from .util import image_from_array


def honeycomb(name="honeycomb", size=256, cells=8, wall=0.16):
    """Black hexagon mesh with alpha holes (for grilles and intakes)."""
    yy, xx = np.mgrid[0:size, 0:size] / size * cells
    # Hex grid distance (pointy-top), cheap approximation via two offset lattices.
    def hexdist(x, y):
        x = x * 1.0
        y = y * 1.1547
        q = np.abs((x % 1.0) - 0.5)
        r = np.abs((y % 1.0) - 0.5)
        return np.maximum(q * 0.866 + r * 0.5, r)
    d1 = hexdist(xx, yy)
    d2 = hexdist(xx + 0.5, yy + 0.433)
    d = np.minimum(d1, d2)
    edge = d > (0.5 - wall)
    rgba = np.zeros((size, size, 4), dtype=np.float32)
    rgba[..., 0:3] = 0.03
    rgba[..., 3] = np.where(edge, 1.0, 0.0)
    return image_from_array(name, rgba)


def carbon(name="carbon", size=256, tows=16):
    """2x2 twill carbon weave (sRGB colour)."""
    yy, xx = np.mgrid[0:size, 0:size] / size * tows
    ix, iy = np.floor(xx).astype(int), np.floor(yy).astype(int)
    fx, fy = xx - ix, yy - iy
    over = ((ix + iy) // 2) % 2 == 0
    shade_h = 0.5 + 0.5 * np.sin(fy * math.pi) ** 0.6
    shade_v = 0.5 + 0.5 * np.sin(fx * math.pi) ** 0.6
    s = np.where(over, shade_h, shade_v)
    c = 0.03 + 0.09 * s
    rgba = np.ones((size, size, 4), dtype=np.float32)
    rgba[..., 0] = c
    rgba[..., 1] = c
    rgba[..., 2] = c * 1.08
    return image_from_array(name, rgba)


def tread_normal(name="tread", w=512, h=128, kind="road"):
    """Tangent-space normal map for the tyre tread: u around the tyre, v across it."""
    v = np.linspace(0, 1, h)[:, None]
    u = np.linspace(0, 1, w)[None, :]
    height = np.zeros((h, w), dtype=np.float32)
    if kind == "road":
        for g in (0.27, 0.5, 0.73):  # circumferential grooves
            height -= np.exp(-((v - g) / 0.018) ** 2)
        sipes = (np.sin((u * 72 + v * 3) * 2 * math.pi) > 0.92) & ((v < 0.25) | (v > 0.75))
        height -= sipes * 0.5
    else:  # all-terrain blocks
        bx = (np.floor(u * 40) + np.floor(v * 4)) % 2
        groove_u = np.abs(((u * 40) % 1.0) - 0.5) > 0.42
        groove_v = np.abs(((v * 4) % 1.0) - 0.5) > 0.40
        height = -0.8 * (groove_u | groove_v) + 0.1 * bx
    gy, gx = np.gradient(height)
    n = np.stack([-gx * 6, -gy * 6, np.ones_like(height)], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    rgba = np.ones((h, w, 4), dtype=np.float32)
    rgba[..., 0:3] = n * 0.5 + 0.5
    return image_from_array(name, rgba)


def plate(name="plate", w=256, h=56, seed=7):
    """EU-style number plate: white with a blue band and dark glyph blocks."""
    rng = np.random.default_rng(seed)
    rgba = np.ones((h, w, 4), dtype=np.float32)
    rgba[..., 0:3] = 0.92
    rgba[:, :22, 0:3] = (0.05, 0.18, 0.62)
    rgba[2:-2, 0:2, 0:3] = 0.1
    x = 34
    for k in range(7):
        gw = 22 if k != 2 else 10
        if k == 2:
            x += 14
            continue
        glyph = rng.random((5, 3)) > 0.35
        glyph[0, :] = True
        for gy in range(5):
            for gx in range(3):
                if glyph[gy, gx]:
                    y0 = 10 + gy * 8
                    x0 = x + gx * 7
                    rgba[y0:y0 + 7, x0:x0 + 6, 0:3] = 0.05
        x += gw + 6
    rgba[0:2, :, 0:3] = 0.1
    rgba[-2:, :, 0:3] = 0.1
    rgba[:, -2:, 0:3] = 0.1
    return image_from_array(name, rgba)


def gauges(name="gauges", w=256, h=96):
    """Instrument cluster: two dials on black."""
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    rgba = np.zeros((h, w, 4), dtype=np.float32)
    rgba[..., 3] = 1
    for cx in (w * 0.28, w * 0.72):
        d = np.hypot(xx - cx, yy - h / 2)
        ring = (d > 36) & (d < 40)
        ticks = (d > 30) & (d < 36) & (np.abs(np.sin(np.arctan2(yy - h / 2, xx - cx) * 10)) < 0.12)
        rgba[ring | ticks, 0:3] = 0.85
        rgba[(d < 3), 0:3] = (0.9, 0.2, 0.1)
    return image_from_array(name, rgba)
