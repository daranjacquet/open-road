"""Mid-engined supercar: wedge nose with a valley between raised wings, cab-forward canopy,
side intakes scooped into the doors, louvred engine cover, wide rear haunches, big wing,
diffuser with centre exits. About 4.55 m x 2.02 m x 1.17 m, wheelbase 2.62 m.

Chassis frame: ground at y = -0.47 at rest, wheel centres at y = -0.125, axles at z = +1.30 / -1.32.
"""
import math

import numpy as np

from lib.panelrules import make_panel

GROUND = -0.47
AXLES = (1.30, -1.32)
WHEEL_R = 0.345
WHEEL_Y = -0.125
TRACK_HALF = (0.83, 0.82)

FLOOR, SILL = -0.37, -0.29


def col(z, **k):
    base = dict(z=z, floor=FLOOR, Wf=0.86, sill=SILL, W=0.93, char=0.02, sh=0.2, Wsh=0.91,
                belt=0.25, Wb=0.84, roof=0.27, Wr=0.6, crown=0.0, rocker=0.04)
    base.update(k)
    return base


COLUMNS = [
    col(-2.27, gz=-2.24, floor=-0.30, Wf=0.82, W=0.92, char=0.0, sh=0.22, Wsh=0.9, belt=0.27, Wb=0.84, roof=0.29, Wr=0.66),  # 0 rear face
    col(-2.20, gz=-2.18, floor=-0.33, W=0.97, Wsh=0.95, char=0.02, sh=0.26, belt=0.33, Wb=0.89, roof=0.35, Wr=0.68),   # 1 tail / ducktail
    col(-1.95, W=0.995, Wsh=0.97, char=0.03, sh=0.3, belt=0.38, Wb=0.9, roof=0.395, Wr=0.66),                        # 2
    col(-1.62, W=1.005, Wsh=0.975, char=0.04, sh=0.33, belt=0.41, Wb=0.89, roof=0.43, Wr=0.62),                       # 3 rear arch back
    col(-1.32, W=1.005, Wsh=0.97, char=0.05, sh=0.34, belt=0.42, Wb=0.87, roof=0.47, Wr=0.6, crown=0.01),             # 4 rear arch centre
    col(-1.02, W=0.99, Wsh=0.955, char=0.06, sh=0.34, belt=0.42, Wb=0.84, roof=0.53, Wr=0.58, crown=0.02),            # 5 rear arch front
    col(-0.70, W=0.95, Wl=0.82, Wsh=0.93, char=0.08, sh=0.33, belt=0.40, Wb=0.79, gz=-0.62, roof=0.62, Wr=0.56, crown=0.02),   # 6 side intake / engine cover start
    col(-0.38, W=0.935, Wl=0.83, Wsh=0.91, char=0.09, sh=0.32, belt=0.37, Wb=0.76, gz=-0.36, roof=0.685, Wr=0.56, crown=0.025),  # 7 door rear edge
    col(-0.05, W=0.93, Wl=0.86, Wsh=0.9, char=0.08, sh=0.3, belt=0.345, Wb=0.76, gz=-0.08, roof=0.70, Wr=0.57, crown=0.025),   # 8
    col(0.32, W=0.935, Wsh=0.9, char=0.06, sh=0.28, belt=0.32, Wb=0.77, gz=0.18, roof=0.68, Wr=0.58, crown=0.02),     # 9 roof front
    col(0.62, W=0.95, Wsh=0.91, char=0.05, sh=0.27, belt=0.305, Wb=0.79, gz=0.55, roof=0.48, Wr=0.66, crown=0.012),   # 10 screen mid
    col(0.90, W=0.965, Wsh=0.925, char=0.04, sh=0.28, belt=0.31, Wb=0.82, gz=0.9, roof=0.30, Wr=0.72, crown=0.004),   # 11 cowl / door front
    col(1.05, W=0.975, Wsh=0.935, char=0.04, sh=0.29, belt=0.32, Wb=0.84, roof=0.24, Wr=0.62, valley=True, crown=0.0),  # 12 front wing peak
    col(1.30, W=0.98, Wsh=0.935, char=0.03, sh=0.27, belt=0.31, Wb=0.84, roof=0.20, Wr=0.6, valley=True),             # 13 front arch centre
    col(1.62, W=0.97, Wsh=0.92, char=0.01, sh=0.2, belt=0.24, Wb=0.82, roof=0.13, Wr=0.58, valley=True),              # 14 front arch front
    col(1.95, W=0.94, Wsh=0.89, char=-0.03, sh=0.09, belt=0.12, Wb=0.78, roof=0.06, Wr=0.56, valley=True, floor=-0.36),  # 15
    col(2.17, gz=2.14, Wf=0.8, W=0.88, Wsh=0.83, char=-0.07, sh=0.0, belt=0.03, Wb=0.72, roof=0.01, Wr=0.52, valley=True,
        floor=-0.35, sill=-0.3),                                                                                     # 16 nose edge
    col(2.25, gz=2.21, Wf=0.74, W=0.8, Wsh=0.74, char=-0.1, sh=-0.05, belt=-0.03, Wb=0.66, roof=-0.04, Wr=0.48,
        floor=-0.33, sill=-0.3, rocker=0.03),                                                                        # 17 nose face
]

N = len(COLUMNS)
LAYOUT = dict(
    n_columns=N,
    rear_bumper_end=2,
    trunk=(10 ** 6, 0),
    rear_window=(5, 6),
    roof=(6, 9),
    rear_door=(10 ** 6, 0),
    front_door=(7, 11),
    windshield=(9, 11),
    hood=(11, 16),
    front_bumper_start=15,
    fender=(11, 15),
    side_intake=({5, 6}, {4, 5, 6, 7}),
    vent=({2, 3, 4}, {10, 11, 12, 13}),
    tail_light=({1}, {8, 9}),
    head_light=({15}, {6, 7, 8}),
    extra={(1, 10): "trunk", (1, 11): "trunk", (1, 12): "trunk", (1, 13): "trunk",
           (2, 9): "trunk", (3, 9): "trunk", (4, 9): "trunk",
           (5, 9): "trunk", (5, 10): "trunk", (5, 11): "trunk",
           (6, 8): "body", (6, 9): "body", (6, 10): "body"},
)
_panel = make_panel(LAYOUT)


def panel(i, j, side):
    return _panel(i, j, side)


def _front_ring1(j, side):
    return "intake_F" if 3 <= j <= 6 else "bumper_F"


def _rear_ring1(j, side):
    return "light_R" + side if j in (7, 8) else ("diffuser" if j <= 4 else "bumper_R")


DESIGN = dict(
    columns=COLUMNS,
    panel=panel,
    front_caps=[(0.88, 0.003, _front_ring1, -0.01), (0.66, 0.004, "bumper_F", -0.02), (0.42, 0.004, "grille", -0.05)],
    rear_caps=[(0.9, -0.003, _rear_ring1), (0.7, -0.004, "bumper_R", -0.02), (0.48, -0.004, "rear_mesh", 0.02)],
    ring_crease={4: 0.5, 6: 0.85, 7: 0.5, 8: 0.9, 11: 0.6},
    col_crease={0: 0.7, N - 1: 0.8, N - 2: 0.6},
    arches=[(AXLES[0], WHEEL_Y, 0.375), (AXLES[1], WHEEL_Y, 0.385)],
    arch_inner=0.45,
)

PAINT = 0xF06A0C
CALIPER = 0xE5B10A
WHEEL = dict(R=WHEEL_R, W=0.27, rim_r=0.255, rim_style="ten", spokes=10, rim_mat="rim", disc_r=0.205, tread="road")

FINISH = dict(
    materials={"roof": "carbon", "diffuser": "carbon"},
    headlight_style="projector",
)

ENGINE_BAY = [dict(kind="frunk", centre=(0, -0.08, 1.72), size=(1.0, 0.25, 0.7), radiator_z=None),
              dict(kind="rear", centre=(0, 0.06, -1.45), size=(0.8, 0.42, 1.0), radiator_z=None)]

INTERIOR = dict(floor_y=-0.29, mid_z=0.2, length=1.5, half_w=0.66, dash_y=0.12, dash_z=0.72,
                drive_x=0.33, seat_y=-0.22, seat_z=-0.05, rear_seat_z=None)


def details(parts, mats):
    from lib import details as D
    from lib.panels import bounds
    from lib.util import box, parent_keep

    body = parts["body"]
    # Louvres over the engine vent.
    v = parts.get("vent")
    if v is not None:
        mn, mx = bounds(v)
        for k in range(7):
            z = mn[2] + (mx[2] - mn[2]) * (0.1 + 0.8 * k / 6)
            h = D.hit([v], (0, 1.5, z), (0, -1, 0))
            y = h[0][1] if h else mx[1]
            lv = box(f"louvre{k}", (0, y + 0.012, z), ((mx[0] - mn[0]) * 0.9, 0.008, 0.035), mats["trim_gloss"], rot=(math.radians(-25), 0, 0))
            parent_keep(lv, v)

    # Rear wing on swan-neck posts.
    w = D.wing("wing", -2.02, 0.66, 0.86, 0.3, mats, "carbon", posts_x=0.42, post_bottom=0.36)
    parent_keep(w, body)

    # Centre-exit exhausts and diffuser fins.
    rear_objs = [parts["bumper_R"]] + [parts[n] for n in ("rear_mesh", "diffuser") if n in parts]
    for x in (0.13, -0.13):
        h = D.hit(rear_objs, (x, -0.2, -3.0), (0, 0, 1))
        zt = h[0][2] if h else -2.22
        t = D.exhaust_tip(f"exhaust_{'L' if x > 0 else 'R'}", (x, -0.2, zt + 0.03), 0.055, 0.075, mats, oval=1.3)
        parent_keep(t, parts["bumper_R"])
    for x in np.linspace(-0.7, 0.7, 8):
        f = box(f"fin_{x:+.2f}", (x, -0.3, -2.12), (0.008, 0.1, 0.36), mats["carbon"])
        parent_keep(f, parts["bumper_R"])

    # Front splitter and side blades.
    pts = []
    for x in np.linspace(-0.82, 0.82, 17):
        h = D.hit([parts["bumper_F"]], (x, -0.3, 3.0), (0, 0, -1))
        z = h[0][2] if h else 2.2
        pts.append((x, -0.355, z + 0.015))
    spl = D.strip("splitter", pts, 0.06, 0.016, mats, "carbon")
    parent_keep(spl, parts["bumper_F"])
    for s in (1, -1):
        pts = [(s * 0.9, -0.34, z) for z in np.linspace(-0.95, 0.85, 9)]
        sk = D.strip(f"skirt_{'L' if s > 0 else 'R'}", pts, 0.035, 0.045, mats, "carbon")
        parent_keep(sk, body)

    # Mirrors on stalks from the doors.
    for s, door in ((1, "door_FL"), (-1, "door_FR")):
        h = D.hit([parts[door]], (s * 1.5, 0.36, 0.62), (-s, 0, 0))
        anchor = tuple(h[0]) if h else (s * 0.85, 0.36, 0.62)
        m = D.mirror(f"mirror_{'L' if s > 0 else 'R'}", s, anchor, mats, paint="carbon")
        parent_keep(m, parts[door])

    # Rear plate under the tail lights, front plate on the nose.
    h = D.hit(rear_objs, (0, 0.02, -3.0), (0, 0, 1))
    if h:
        pl = D.plate("plate_R", (0, 0.02, h[0][2] - 0.006), -1, mats)
        parent_keep(pl, parts["bumper_R"])
    # Bonnet badge and wipers.
    h = D.hit([parts["hood"]], (0, 1.0, 1.9), (0, -1, 0))
    if h:
        b = D.badge("badge_F", (0, h[0][1] + 0.003, 1.9), 0.03, "y", mats)
        parent_keep(b, parts["hood"])
    D.wiper("wiper_L", (0.45, 0.31, 0.9), (-0.25, 0.36, 0.78), mats)
    return {}
