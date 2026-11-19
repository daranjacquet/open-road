"""Light units built from a lens region cut out of the body: clear (or red) lens, chrome reflector bowl
behind it, emissive LED signature and projector modules."""
import math

import numpy as np

from .panels import bounds, gap_and_flange, push_along_normals
from .util import box, cylinder, parent_keep


def _duplicate(obj, name):
    o = obj.copy()
    o.data = obj.data.copy()
    o.name = name
    o.data.name = name
    obj.users_collection[0].objects.link(o)
    return o


def headlight(lens, mats, side, style="projector"):
    """lens: separated light region object (front). Returns the lens object (children attached)."""
    name = lens.name
    lens.data.materials.clear()
    lens.data.materials.append(mats["lens_clear"])
    lens.data.materials.append(mats["glass_rubber"])
    gap_and_flange(lens, gap=0.004, depth=0.03, flange_mat_index=1)

    bowl = _duplicate(lens, name + "_bowl")
    bowl.data.materials.clear()
    bowl.data.materials.append(mats["housing"])
    bowl.data.materials.append(mats["housing"])
    push_along_normals(bowl, -0.045)
    parent_keep(bowl, lens)

    mn, mx = bounds(lens)
    c = (mn + mx) / 2
    w = mx[0] - mn[0]
    h = mx[1] - mn[1]
    zf = mx[2] - 0.035
    # Average surface point and normal of the lens: the LED strip sits just behind the glass.
    me = lens.data
    co = np.array([v.co[:] for v in me.vertices]) + np.array(lens.location)
    nr = np.array([v.normal[:] for v in me.vertices])
    pc = co.mean(axis=0)
    nc = nr.mean(axis=0)
    nc /= max(np.linalg.norm(nc), 1e-6)
    pc = pc - nc * 0.018
    p_ch = (pc[0], pc[2], -pc[1])
    led = box(name + "_drl", (p_ch[0], p_ch[1] + h * 0.18, p_ch[2]), (w * 0.6, 0.01, 0.012), mats["led_white"])
    parts = [led]
    if style == "projector":
        for k, f in enumerate((0.3, 0.68)):
            x = mn[0] + w * f if side > 0 else mx[0] - w * f
            ring = cylinder(f"{name}_proj{k}", (x, c[1] - h * 0.1, zf - 0.025), min(h * 0.28, 0.035), 0.05, "z", mats["reflector"], segments=24)
            lensd = cylinder(f"{name}_projlens{k}", (x, c[1] - h * 0.1, zf + 0.001), min(h * 0.2, 0.026), 0.006, "z", mats["led_white"], segments=24)
            parts.extend([ring, lensd])
    else:  # round classic lamp (off-roader)
        r = min(w, h) * 0.42
        ring = cylinder(f"{name}_ring", (c[0], c[1], zf - 0.02), r, 0.04, "z", mats["reflector"], segments=32)
        led_ring = cylinder(f"{name}_halo", (c[0], c[1], zf + 0.004), r * 0.92, 0.004, "z", mats["led_white"], segments=32)
        core = cylinder(f"{name}_core", (c[0], c[1], zf + 0.006), r * 0.55, 0.004, "z", mats["housing"], segments=32)
        parts.extend([ring, led_ring, core])
    for p in parts:
        parent_keep(p, lens)
    return lens


def taillight(lens, mats, side, bars=2):
    name = lens.name
    lens.data.materials.clear()
    lens.data.materials.append(mats["lens_red"])
    lens.data.materials.append(mats["glass_rubber"])
    gap_and_flange(lens, gap=0.004, depth=0.025, flange_mat_index=1)
    bowl = _duplicate(lens, name + "_bowl")
    bowl.data.materials.clear()
    bowl.data.materials.append(mats["housing"])
    bowl.data.materials.append(mats["housing"])
    push_along_normals(bowl, -0.035)
    parent_keep(bowl, lens)
    mn, mx = bounds(lens)
    c = (mn + mx) / 2
    w, h = mx[0] - mn[0], mx[1] - mn[1]
    zb = mn[2] + 0.03
    for k in range(bars):
        y = mn[1] + h * (0.3 + 0.4 * k / max(bars - 1, 1))
        bar = box(f"{name}_bar{k}", (c[0], y, zb), (w * 0.8, 0.01, 0.012), mats["led_red"])
        parent_keep(bar, lens)
    return lens


def unused():
    return math, np
