"""Cabin seen through the glass: dashboard with gauges, steering wheel, seats, console, rear bench."""
import math

import numpy as np

from .details import rounded_box
from .util import box, cylinder, parent_keep, mesh_object, set_smooth_by_angle


def steering_wheel(name, center, radius, tilt, mats):
    segs, tube = 36, 0.016
    verts, faces = [], []
    for i in range(segs):
        a = i / segs * 2 * math.pi
        for k in range(8):
            b = k / 8 * 2 * math.pi
            r = radius + tube * math.cos(b)
            verts.append((r * math.cos(a), r * math.sin(a), tube * math.sin(b)))
    for i in range(segs):
        for k in range(8):
            i1, k1 = (i + 1) % segs, (k + 1) % 8
            faces.append((i * 8 + k, i1 * 8 + k, i1 * 8 + k1, i * 8 + k1))
    v = np.array(verts)
    c, s = math.cos(tilt), math.sin(tilt)
    v = v @ np.array([[1, 0, 0], [0, c, -s], [0, s, c]]).T + np.array(center)
    o = mesh_object(name, v, faces, [mats["alcantara"]])
    hub = cylinder(name + "_hub", tuple(center), radius * 0.3, 0.05, "z", mats["interior"], rot=(tilt, 0, 0))
    parent_keep(hub, o)
    for a in (0.0, math.pi, -math.pi / 2):
        sx, sy = math.cos(a) * radius * 0.6, math.sin(a) * radius * 0.6
        sp = np.array([sx, sy * c, sy * s]) + np.array(center)
        spoke = box(f"{name}_spoke{a:.1f}", tuple(sp), (0.03 if a == -math.pi / 2 else radius * 0.75, 0.02 if a != -math.pi / 2 else radius * 0.7, 0.02), mats["interior"], rot=(tilt, 0, 0))
        parent_keep(spoke, o)
    set_smooth_by_angle(o, 50)
    return o


def seat(name, center, mats, width=0.5, sport=True):
    x, y, z = center
    base = rounded_box(name, (x, y, z), (width, 0.12, 0.5), mats["leather"])
    back = rounded_box(name + "_back", (x, y + 0.33, z - 0.27), (width, 0.6, 0.12), mats["leather"], rot=(math.radians(-14), 0, 0))
    head = rounded_box(name + "_head", (x, y + 0.7, z - 0.37), (width * 0.55, 0.16, 0.1), mats["leather"], rot=(math.radians(-14), 0, 0))
    parts = [back, head]
    if sport:
        for s in (1, -1):
            bol = rounded_box(f"{name}_bol{'L' if s > 0 else 'R'}", (x + s * width * 0.48, y + 0.32, z - 0.25), (0.08, 0.5, 0.16), mats["leather"], rot=(math.radians(-14), 0, 0))
            parts.append(bol)
    for p in parts:
        parent_keep(p, base)
    return base


def build(design, mats):
    """design keys: floor_y, dash_z, dash_y, seat_z (front), rear_seat_z (or None), half_w, drive_side_x."""
    root = box("interior", (0, design["floor_y"] + 0.02, design["mid_z"]), (design["half_w"] * 2, 0.04, design["length"]), mats["interior"])
    dash = rounded_box("interior_dash", (0, design["dash_y"], design["dash_z"]), (design["half_w"] * 2 - 0.05, 0.2, 0.42), mats["interior"])
    gauges = box("interior_gauges", (design["drive_x"], design["dash_y"] + 0.09, design["dash_z"] - 0.17), (0.32, 0.12, 0.01), mats["gauges"], rot=(math.radians(-20), 0, 0))
    console = rounded_box("interior_console", (0, design["floor_y"] + 0.18, design["seat_z"] + 0.15), (0.2, 0.25, 0.8), mats["interior"])
    sw = steering_wheel("interior_wheel", (design["drive_x"], design["dash_y"] - 0.02, design["dash_z"] - 0.32), 0.18, math.radians(-62), mats)
    seats = [seat("interior_seatL", (design["drive_x"], design["seat_y"], design["seat_z"]), mats),
             seat("interior_seatR", (-design["drive_x"], design["seat_y"], design["seat_z"]), mats)]
    parts = [dash, gauges, console, sw] + seats
    if design.get("rear_seat_z") is not None:
        bench = rounded_box("interior_bench", (0, design["seat_y"], design["rear_seat_z"]), (design["half_w"] * 2 - 0.25, 0.14, 0.5), mats["leather"])
        bback = rounded_box("interior_bench_back", (0, design["seat_y"] + 0.33, design["rear_seat_z"] - 0.28), (design["half_w"] * 2 - 0.25, 0.55, 0.12), mats["leather"], rot=(math.radians(-18), 0, 0))
        parts += [bench, bback]
    for p in parts:
        parent_keep(p, root)
    return root
