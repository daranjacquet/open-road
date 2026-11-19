"""Off-roader ("4x4"): upright box body, near-vertical windscreen, flat roof with a rack, round lamps,
black flared arches, steel bumpers, side steps, snorkel and a spare wheel on the tailgate.
About 4.80 m x 2.02 m (over flares) x 1.96 m, wheelbase 2.85 m, 27 cm of ground clearance.

Chassis frame: ground at y = -0.72 at rest, wheel centres at y = -0.31, axles at z = +1.45 / -1.40.
"""
import math

import numpy as np

from lib.panelrules import make_panel

GROUND = -0.72
AXLES = (1.45, -1.40)
WHEEL_R = 0.405
WHEEL_Y = -0.315
TRACK_HALF = (0.84, 0.84)

FLOOR, SILL = -0.45, -0.36


def col(z, **k):
    base = dict(z=z, floor=FLOOR, Wf=0.90, sill=SILL, W=0.95, char=0.12, sh=0.43, Wsh=0.948,
                belt=0.47, Wb=0.935, roof=0.49, Wr=0.86, crown=0.0, rocker=0.04)
    base.update(k)
    return base


COLUMNS = [
    col(-2.21, gz=-2.19, floor=-0.42, Wf=0.86, W=0.92, Wsh=0.92, Wb=0.905, belt=0.47, roof=1.12, Wr=0.80, crown=0.0),  # 0 rear face
    col(-2.17, gz=-2.155, W=0.945, Wsh=0.944, Wb=0.93, roof=1.175, Wr=0.845, crown=0.01),   # 1
    col(-1.98, gz=-1.98, W=0.95, roof=1.2, crown=0.015),                                    # 2
    col(-1.87, gz=-1.87, roof=1.2, crown=0.015),                                            # 3 rear arch back
    col(-1.40, gz=-1.40, roof=1.2, crown=0.015),                                            # 4 rear arch centre
    col(-0.93, gz=-0.93, roof=1.2, crown=0.015),                                            # 5 rear door rear edge
    col(-0.45, gz=-0.45, roof=1.2, crown=0.015),                                            # 6
    col(-0.02, gz=-0.02, roof=1.2, crown=0.015),                                            # 7 B-pillar rear
    col(0.10, gz=0.10, roof=1.2, crown=0.015),                                              # 8 B-pillar front
    col(0.58, gz=0.55, roof=1.2, crown=0.015),                                              # 9
    col(0.96, gz=0.80, roof=1.185, Wr=0.85, crown=0.012),                                   # 10 windscreen top
    col(1.06, gz=1.06, belt=0.475, roof=0.48, Wr=0.86),                                    # 11 cowl / door front
    col(1.14, belt=0.47, roof=0.49, Wr=0.80),                                               # 12 bonnet rear
    col(1.45, belt=0.468, roof=0.49, Wr=0.80),                                              # 13 front arch centre
    col(1.92, belt=0.465, roof=0.488, Wr=0.80),                                             # 14 front arch front
    col(2.26, gz=2.25, W=0.945, Wsh=0.94, Wb=0.925, belt=0.46, roof=0.48, Wr=0.79),          # 15 bonnet front edge
    col(2.34, gz=2.31, floor=-0.42, Wf=0.86, W=0.92, Wsh=0.915, Wb=0.9, belt=0.445, roof=0.46, Wr=0.77),  # 16 front face
]

LAYOUT = dict(
    n_columns=len(COLUMNS),
    rear_bumper_end=2,
    trunk=(1, 2),
    rear_window=(10 ** 6, 0),
    roof=(1, 10),
    quarter_window=(2, 5),
    rear_door=(5, 7),
    b_pillar=(7, 8),
    front_door=(8, 11),
    windshield=(10, 11),
    cowl=(11, 12),
    hood=(12, 15),
    front_bumper_start=16,
    fender=(11, 16),
    extra={(1, 9): "trunk", (1, 10): "trunk", (1, 11): "trunk", (1, 12): "glass_rear", (1, 13): "glass_rear",
           (0, 9): "trunk", (0, 10): "trunk", (0, 11): "trunk", (0, 12): "glass_rear", (0, 13): "glass_rear",
           (0, 3): "trunk", (0, 4): "trunk", (0, 5): "trunk", (0, 6): "trunk", (0, 7): "trunk", (0, 8): "trunk"},
    nose_is_bumper=False,
)

# The tailgate (rear face) is one door: rear face cap is part of it.
_panel = make_panel(LAYOUT)


def panel(i, j, side):
    p = _panel(i, j, side)
    if i == 0 and j <= 2:
        return "bumper_R"
    return p


def _rear_cap(j, side):
    return "trunk" if j >= 3 else "bumper_R"


def _front_ring1(j, side):
    return "bumper_F" if j <= 5 else "front_panel"


def _front_ring2(j, side):
    return "bumper_F" if j <= 3 else "front_panel"


DESIGN = dict(
    columns=COLUMNS,
    panel=panel,
    front_caps=[(0.9, 0.003, _front_ring1, 0.0), (0.72, 0.006, _front_ring2, 0.05), (0.5, 0.006, "grille", 0.13)],
    rear_caps=[(0.92, -0.003, _rear_cap), (0.78, -0.004, "trunk", 0.12), (0.62, -0.004, "glass_rear", 0.3)],
    ring_crease={3: 0.6, 4: 0.6, 6: 0.85, 7: 0.7, 8: 1.0, 11: 0.9},
    col_crease={0: 1.0, 1: 0.7, len(COLUMNS) - 1: 1.0, len(COLUMNS) - 2: 0.7, 11: 0.6, 10: 0.8},
    arches=[(AXLES[0], WHEEL_Y, 0.47), (AXLES[1], WHEEL_Y, 0.47)],
    arch_inner=0.40,
)

PAINT = 0x5B6450
CALIPER = 0x2A2C30
WHEEL = dict(R=WHEEL_R, W=0.285, rim_r=0.215, rim_style="y6", rim_mat="rim_bronze", disc_r=0.165, tread="at")

FINISH = dict(
    materials={"bumper_F": "trim_matte", "bumper_R": "trim_matte"},
    parents={"glass_rear": "trunk"},
    headlight_style="round",
)

ENGINE_BAY = [dict(kind="front", centre=(0, 0.1, 1.72), size=(0.78, 0.55, 0.78), radiator_z=2.2, strut_x=0.66, strut_y=0.38, strut_z=1.5)]

INTERIOR = dict(floor_y=-0.3, mid_z=-0.45, length=2.4, half_w=0.8, dash_y=0.42, dash_z=0.85,
                drive_x=0.42, seat_y=-0.04, seat_z=-0.05, rear_seat_z=-0.95)


def details(parts, mats):
    from lib import details as D
    from lib.util import box, cylinder, parent_keep
    from lib.wheels import build_wheel

    body = parts["body"]

    # Round headlamps with chrome bezels on the front face, indicators on the wings.
    for s in (1, -1):
        h = D.hit([parts["bumper_F"], body, parts.get("grille", body)], (s * 0.66, 0.26, 3.2), (0, 0, -1))
        z = h[0][2] if h else 2.33
        nm = f"light_F{'L' if s > 0 else 'R'}"
        lamp = cylinder(nm, (s * 0.66, 0.26, z + 0.012), 0.11, 0.03, "z", mats["lens_clear"], segments=40)
        bez = cylinder(nm + "_bezel", (s * 0.66, 0.26, z + 0.008), 0.128, 0.035, "z", mats["chrome"], segments=40)
        refl = cylinder(nm + "_bowl", (s * 0.66, 0.26, z - 0.02), 0.105, 0.03, "z", mats["reflector"], segments=40)
        halo = cylinder(nm + "_halo", (s * 0.66, 0.26, z + 0.0), 0.092, 0.006, "z", mats["led_white"], segments=40)
        core = cylinder(nm + "_core", (s * 0.66, 0.26, z + 0.004), 0.05, 0.01, "z", mats["housing"], segments=24)
        for c in (bez, refl, halo, core):
            parent_keep(c, lamp)
        parent_keep(lamp, body)
        ind = box(f"indicator_{'L' if s > 0 else 'R'}", (s * 0.8, 0.5, 2.05), (0.16, 0.05, 0.1), mats["lens_amber"])
        parent_keep(ind, body)

    # Grille slats.
    g = parts.get("grille")
    if g is not None:
        from lib.panels import bounds
        mn, mx = bounds(g)
        for k in range(3):
            y = mn[1] + (mx[1] - mn[1]) * (0.25 + 0.25 * k)
            slat = box(f"grille_slat{k}", (0, y, mx[2] + 0.004), ((mx[0] - mn[0]) * 0.7, 0.03, 0.025), mats["paint"])
            parent_keep(slat, g)

    # Tail lamps: vertical units on the rear corners.
    for s in (1, -1):
        h = D.hit([parts["trunk"], body], (s * 0.84, 0.2, -3.0), (0, 0, 1))
        z = h[0][2] if h else -2.2
        nm = f"light_R{'L' if s > 0 else 'R'}"
        lamp = box(nm, (s * 0.84, 0.15, z - 0.012), (0.12, 0.34, 0.03), mats["lens_red"])
        for k in range(3):
            bar = box(f"{nm}_bar{k}", (s * 0.84, 0.03 + 0.1 * k, z - 0.004), (0.09, 0.02, 0.01), mats["led_red"])
            parent_keep(bar, lamp)
        parent_keep(lamp, body)

    # Black flared arches (bolted to the wings / quarters).
    for (az, tag) in ((AXLES[0], "F"), (AXLES[1], "R")):
        for s in (1, -1):
            R0 = 0.47
            fl = D.arch_flare(f"flare_{tag}{'L' if s > 0 else 'R'}", s, az, WHEEL_Y, R0, 0.09, 0.06, mats["trim_matte"])
            parent_keep(fl, body)

    # Side steps.
    for s in (1, -1):
        st = box(f"step_{'L' if s > 0 else 'R'}", (s * 0.97, -0.47, -0.4), (0.16, 0.035, 1.75), mats["satin_alu"])
        parent_keep(st, body)

    # Roof rack: side rails, cross bars, light bar.
    roof = parts.get("roof", body)
    for s in (1, -1):
        rail = box(f"rack_rail_{'L' if s > 0 else 'R'}", (s * 0.78, 1.27, -0.7), (0.04, 0.04, 2.3), mats["trim_matte"])
        parent_keep(rail, roof)
        for z in (-1.75, 0.3):
            foot = box(f"rack_foot_{'L' if s > 0 else 'R'}{z:+.1f}", (s * 0.78, 1.235, z), (0.05, 0.05, 0.06), mats["trim_matte"])
            parent_keep(foot, roof)
    for k, z in enumerate(np.linspace(-1.7, 0.25, 6)):
        bar = box(f"rack_bar{k}", (0, 1.27, z), (1.56, 0.025, 0.04), mats["trim_matte"])
        parent_keep(bar, roof)
    lb = box("light_bar", (0, 1.3, 0.38), (1.0, 0.07, 0.07), mats["housing"])
    lbl = box("light_bar_lens", (0, 1.3, 0.418), (0.96, 0.05, 0.005), mats["led_white"])
    parent_keep(lbl, lb)
    parent_keep(lb, roof)

    # Snorkel up the right A-pillar.
    pts = [(-0.96, 0.25, 1.75), (-0.98, 0.45, 1.3), (-0.975, 0.75, 1.02), (-0.95, 1.1, 0.9), (-0.92, 1.24, 0.86)]
    sn = D.tube("snorkel", pts, 0.045, mats["trim_matte"])
    cap = cylinder("snorkel_head", (-0.92, 1.27, 0.86), 0.06, 0.12, "z", mats["trim_matte"], segments=20)
    parent_keep(cap, sn)
    parent_keep(sn, body)

    # Wing mirrors (squarer housings).
    for s, door in ((1, "door_FL"), (-1, "door_FR")):
        h = D.hit([parts[door]], (s * 1.5, 0.52, 0.95), (-s, 0, 0))
        anchor = tuple(h[0]) if h else (s * 0.95, 0.52, 0.95)
        m = D.mirror(f"mirror_{'L' if s > 0 else 'R'}", s, anchor, mats, paint="trim_matte")
        parent_keep(m, parts[door])

    # Door handles.
    for door, z in (("door_FL", 0.25), ("door_FR", 0.25), ("door_RL", -0.82), ("door_RR", -0.82)):
        s = 1 if door.endswith("L") else -1
        h = D.hit([parts[door]], (s * 1.5, 0.36, z), (-s, 0, 0))
        if h:
            hd = D.handle(f"handle_{door[-2:]}", h[0], h[1], mats, mat="trim_matte", length=0.2)
            parent_keep(hd, parts[door])

    # Spare wheel on the tailgate.
    tg = parts["trunk"]
    h = D.hit([tg], (0, 0.45, -3.0), (0, 0, 1))
    z = h[0][2] if h else -2.21
    spare = build_wheel("spare", 1, WHEEL, mats)
    from mathutils import Euler
    for o in spare:
        o.rotation_euler = Euler((0, 0, math.pi / 2))
        o.location = (0, -(z - 0.16), 0.45)
    bpy_spare = spare[0]
    for o in spare[1:]:
        parent_keep(o, bpy_spare)
    bpy_spare.name = "spare_wheel"
    parent_keep(bpy_spare, tg)

    # Steel bumpers get tow hooks and a skid plate.
    for s in (1, -1):
        hk = box(f"tow_{'L' if s > 0 else 'R'}", (s * 0.5, -0.32, 2.4), (0.06, 0.06, 0.08), mats["caliper"])
        parent_keep(hk, parts["bumper_F"])
    skid = box("skid_plate", (0, -0.45, 2.05), (1.2, 0.02, 0.5), mats["satin_alu"], rot=(math.radians(10), 0, 0))
    parent_keep(skid, parts["bumper_F"])

    # Plates.
    h = D.hit([parts["bumper_F"]], (0, -0.2, 3.2), (0, 0, -1))
    if h:
        pl = D.plate("plate_F", (0, -0.2, h[0][2] + 0.005), 1, mats)
        parent_keep(pl, parts["bumper_F"])
    h = D.hit([parts["bumper_R"], tg], (0, -0.22, -3.2), (0, 0, 1))
    if h:
        pl = D.plate("plate_R", (0, -0.22, h[0][2] - 0.005), -1, mats)
        parent_keep(pl, parts["bumper_R"])
    # Wipers.
    D.wiper("wiper_L", (0.7, 0.5, 1.03), (0.0, 0.85, 0.96), mats)
    D.wiper("wiper_R", (-0.05, 0.5, 1.03), (-0.7, 0.85, 0.96), mats)
    return {}
