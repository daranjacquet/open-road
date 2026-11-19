"""Sport saloon ("berline sportive"): four doors, long bonnet, short boot with a lip spoiler,
flared arches, carbon roof. About 4.79 m x 1.90 m x 1.43 m, wheelbase 2.86 m.

Chassis frame: ground at y = -0.58 at rest, wheel centres at y = -0.24, axles at z = +/-1.43.
"""

import numpy as np

GROUND = -0.58
AXLES = (1.43, -1.43)
WHEEL_R = 0.34
TRACK_HALF = (0.80, 0.80)  # wheel centre |x|, front / rear

# Shared lower-body profile values.
FLOOR = -0.44
SILL = -0.33

def col(z, **k):
    base = dict(z=z, floor=FLOOR, Wf=0.83, sill=SILL, W=0.925, char=0.10, sh=0.36, Wsh=0.915,
                belt=0.42, Wb=0.875, roof=0.43, Wr=0.70, crown=0.0)
    base.update(k)
    return base


COLUMNS = [
    # --- rear face and boot -------------------------------------------------------------------
    col(-2.47, gz=-2.43, floor=-0.37, Wf=0.70, sill=-0.30, W=0.80, char=0.06, sh=0.33, Wsh=0.79, belt=0.40, Wb=0.74,
        roof=0.425, Wr=0.56, rocker=0.04),                                   # 0 rear face outline
    col(-2.40, gz=-2.39, floor=-0.42, Wf=0.78, sill=-0.32, W=0.885, char=0.07, sh=0.37, Wsh=0.875, belt=0.455, Wb=0.83,
        roof=0.475, Wr=0.62),                                                # 1 boot lip
    col(-2.15, floor=-0.44, Wf=0.82, W=0.93, char=0.08, sh=0.38, Wsh=0.92, belt=0.46, Wb=0.86, roof=0.48, Wr=0.66),
    col(-1.88, W=0.965, Wsh=0.94, belt=0.465, Wb=0.87, roof=0.485, Wr=0.67),  # 3 rear arch back
    col(-1.58, W=0.975, Wsh=0.945, belt=0.47, Wb=0.875, roof=0.48, Wr=0.66),   # 4 boot front / rear screen base
    # --- greenhouse ----------------------------------------------------------------------------
    col(-1.30, W=0.965, Wsh=0.94, belt=0.47, Wb=0.875, gz=-1.22, roof=0.64, Wr=0.635, crown=0.01),  # 5
    col(-1.02, W=0.935, Wsh=0.922, belt=0.465, Wb=0.87, gz=-0.86, roof=0.80, Wr=0.62, crown=0.02),   # 6 rear door rear edge
    col(-0.55, W=0.918, Wsh=0.915, belt=0.455, Wb=0.865, gz=-0.48, roof=0.845, Wr=0.62, crown=0.025),  # 7
    col(-0.06, W=0.915, Wsh=0.912, belt=0.445, Wb=0.862, gz=-0.07, roof=0.855, Wr=0.625, crown=0.025),  # 8 B-pillar rear
    col(0.06, W=0.915, Wsh=0.912, belt=0.443, Wb=0.862, gz=0.04, roof=0.855, Wr=0.625, crown=0.025),   # 9 B-pillar front
    col(0.48, W=0.915, Wsh=0.913, belt=0.435, Wb=0.862, gz=0.22, roof=0.83, Wr=0.63, crown=0.02),   # 10 roof front
    col(0.76, W=0.928, Wsh=0.915, belt=0.428, Wb=0.864, gz=0.58, roof=0.66, Wr=0.68, crown=0.015),  # 11 windscreen mid
    col(1.00, W=0.935, Wsh=0.92, belt=0.42, Wb=0.866, gz=0.98, roof=0.43, Wr=0.73, crown=0.01),     # 12 cowl / door front
    # --- bonnet and front ------------------------------------------------------------------------
    col(1.10, W=0.95, Wsh=0.93, belt=0.415, Wb=0.865, roof=0.43, Wr=0.72, crown=0.012),   # 13 bonnet rear edge
    col(1.40, W=0.965, Wsh=0.94, belt=0.40, Wb=0.86, roof=0.415, Wr=0.71, crown=0.014),      # 14 front arch centre
    col(1.80, W=0.955, Wsh=0.93, belt=0.34, Wb=0.845, roof=0.355, Wr=0.69, crown=0.012),     # 15 front arch front
    col(2.08, gz=2.04, W=0.925, Wsh=0.895, char=0.05, sh=0.26, belt=0.27, Wb=0.81, roof=0.29, Wr=0.65, crown=0.008, floor=-0.43),  # 16
    col(2.25, gz=2.17, Wf=0.78, W=0.875, char=0.02, sh=0.19, Wsh=0.85, belt=0.205, Wb=0.76, roof=0.215, Wr=0.6, crown=0.004,
        floor=-0.42, sill=-0.33),                                           # 17 bonnet leading edge
    col(2.31, gz=2.21, Wf=0.72, W=0.80, char=0.0, sh=0.13, Wsh=0.78, belt=0.145, Wb=0.70, roof=0.155, Wr=0.52, floor=-0.40,
        sill=-0.33, rocker=0.04),                                            # 18 front face outline
]

N = len(COLUMNS)
C_BOOT_LIP, C_BOOT_FRONT = 1, 4
C_RDOOR_REAR, C_BPILLAR_R, C_BPILLAR_F, C_ROOF_FRONT, C_COWL = 6, 8, 9, 10, 12
C_BONNET_REAR, C_BONNET_FRONT = 13, 17
C_FBUMPER = 15


def panel(i, j, side):
    s = side  # 'L' or 'R'
    # Underbody / sills
    if j <= 2:
        return "underbody"
    # Rear bumper and rear face
    if i < 2 and j <= 8:
        return "bumper_R"
    if i == 0:
        return "bumper_R"
    # Front bumper
    if i >= C_FBUMPER + 1 and j <= 8:
        if j in (6, 7) and i == C_FBUMPER + 1:
            return "light_F" + s
        return "bumper_F"
    if i >= C_BONNET_FRONT:
        return "bumper_F"
    if i == C_FBUMPER and j <= 5:
        return "bumper_F"
    # Tail lights wrap the rear corners
    if i in (1, 2) and j in (7, 8):
        return "light_R" + s
    if i == 1 and j == 9:
        return "light_R" + s
    # Boot lid
    if C_BOOT_LIP <= i < C_BOOT_FRONT and 9 <= j <= 13:
        return "trunk"
    # Bonnet
    if C_BONNET_REAR <= i < C_BONNET_FRONT and 9 <= j <= 13:
        return "hood"
    if C_COWL <= i < C_BONNET_REAR and 9 <= j <= 13:
        return "cowl"
    # Glasshouse
    if C_BOOT_FRONT <= i < C_RDOOR_REAR and j >= 12:
        return "glass_rear"
    if C_ROOF_FRONT <= i < C_COWL and j >= 12:
        return "glass_front"
    if C_RDOOR_REAR <= i < C_ROOF_FRONT and j >= 11:
        return "roof"
    if C_BOOT_FRONT <= i < C_COWL and j == 11:
        return "pillar_trim" if C_BPILLAR_R <= i < C_BPILLAR_F else "body"
    if 8 <= j <= 10:
        if C_RDOOR_REAR <= i < C_BPILLAR_R:
            return "glass_R" + s
        if C_BPILLAR_F <= i < C_COWL:
            return "glass_F" + s
        if C_BPILLAR_R <= i < C_BPILLAR_F:
            return "pillar_trim"
        if i == C_RDOOR_REAR - 1:
            return "glass_Q" + s  # small rear quarter window in the C-pillar
    # Doors
    if 3 <= j <= 7:
        if C_RDOOR_REAR <= i < C_BPILLAR_R + 1 and not (i == C_BPILLAR_R):
            return "door_R" + s
        if i == C_BPILLAR_R:
            return "door_R" + s
        if C_BPILLAR_F <= i < C_COWL:
            return "door_F" + s
        if C_COWL <= i < C_FBUMPER + 1 and j >= 4:
            return "fender_F" + s
    return "body"


def _cap_front(j, side):
    # Outer ring of the front face: lower intakes at the corners, the rest is bumper.
    if 2 <= j <= 4:
        return "intake_F"
    return "bumper_F"


def _cap_rear(j, side):
    if j <= 3:
        return "diffuser"
    return "bumper_R"


DESIGN = dict(
    columns=COLUMNS,
    panel=panel,
    front_caps=[(0.86, 0.004, _cap_front, 0.0), (0.66, 0.008, "bumper_F", 0.05), (0.44, 0.006, "grille", 0.09)],
    rear_caps=[(0.88, -0.004, _cap_rear), (0.6, -0.006, "bumper_R"), (0.38, -0.004, "plate_area")],
    ring_crease={4: 0.35, 6: 0.75, 8: 0.95, 11: 0.55},
    col_crease={0: 0.55, len(COLUMNS) - 1: 0.6, C_BONNET_FRONT: 0.3},
    arches=[(AXLES[0], -0.24, 0.378), (AXLES[1], -0.24, 0.378)],
    arch_inner=0.42,
)


# ---------------------------------------------------------------------------------------------
# Finishing: wheels, details, interior
# ---------------------------------------------------------------------------------------------
PAINT = 0x1D4FA3
CALIPER = 0x1B4FD8
WHEEL = dict(R=WHEEL_R, W=0.275, rim_r=0.242, rim_style="double5", rim_mat="rim", disc_r=0.195, tread="road")

FINISH = dict(
    materials={"roof": "carbon"},
    headlight_style="projector",
)

ENGINE_BAY = [dict(kind="front", centre=(0, 0.04, 1.6), size=(0.72, 0.42, 0.7), radiator_z=2.08, strut_x=0.6, strut_y=0.3, strut_z=1.4)]

INTERIOR = dict(floor_y=-0.34, mid_z=-0.35, length=2.2, half_w=0.72, dash_y=0.24, dash_z=0.72,
                drive_x=0.37, seat_y=-0.2, seat_z=0.05, rear_seat_z=-0.88)


def details(parts, mats):
    import math
    from lib import details as D
    from lib.util import parent_keep
    body_like = [parts[n] for n in parts if n.startswith(("body", "door_", "fender_", "bumper_", "trunk", "hood"))]
    made = {}

    # Wing mirrors on the front doors, just below the window line.
    for s, door in ((1, "door_FL"), (-1, "door_FR")):
        h = D.hit([parts[door]], (s * 1.4, 0.4, 0.78), (-s, 0, 0))
        anchor = tuple(h[0]) if h else (s * 0.9, 0.4, 0.78)
        m = D.mirror(f"mirror_{'L' if s > 0 else 'R'}", s, anchor, mats)
        parent_keep(m, parts[door])
        made[m.name] = m

    # Flush door handles.
    for door, z in (("door_FL", 0.3), ("door_FR", 0.3), ("door_RL", -0.62), ("door_RR", -0.62)):
        s = 1 if door.endswith("L") else -1
        h = D.hit([parts[door]], (s * 1.4, 0.3, z), (-s, 0, 0))
        if h:
            hd = D.handle(f"handle_{door[-2:]}", h[0], h[1], mats, mat="paint")
            parent_keep(hd, parts[door])

    # Wipers on the scuttle.
    D.wiper("wiper_L", (0.62, 0.44, 0.97), (-0.02, 0.47, 0.83), mats)
    D.wiper("wiper_R", (-0.05, 0.445, 0.98), (-0.62, 0.46, 0.86), mats)

    # Quad exhaust tips in the diffuser.
    for x in (0.38, 0.52, -0.38, -0.52):
        t = D.exhaust_tip(f"exhaust_{'L' if x > 0 else 'R'}{abs(x):.2f}", (x, -0.33, -2.39), 0.045, 0.09, mats)
        parent_keep(t, parts["bumper_R"])

    # Diffuser fins.
    for x in (-0.24, -0.08, 0.08, 0.24):
        f = D.box(f"fin_{x:+.2f}", (x, -0.37, -2.33), (0.008, 0.07, 0.28), mats["trim_matte"])
        parent_keep(f, parts["bumper_R"])

    # Boot-lid lip spoiler in carbon.
    h = D.hit([parts["trunk"]], (0, 1.2, -2.33), (0, -1, 0))
    ytop = h[0][1] if h else 0.475
    sp = D.lip_spoiler("spoiler", -2.36, ytop, 0.62, mats)
    parent_keep(sp, parts["trunk"])

    # Front splitter and side skirts.
    xs = np.linspace(-0.74, 0.74, 15)
    pts = []
    for x in xs:
        h = D.hit([parts["bumper_F"]], (x, -0.4, 3.0), (0, 0, -1))
        z = h[0][2] if h else 2.28
        pts.append((x, -0.43, z - 0.02))
    spl = D.strip("splitter", pts, 0.045, 0.018, mats, "carbon")
    parent_keep(spl, parts["bumper_F"])
    for s in (1, -1):
        pts = [(s * 0.87, -0.42, z) for z in np.linspace(-1.0, 1.0, 9)]
        sk = D.strip(f"skirt_{'L' if s > 0 else 'R'}", pts, 0.03, 0.05, mats, "carbon")
        parent_keep(sk, parts["body"])

    # Twin-kidney divider and frame on the grille.
    g = parts.get("grille")
    if g is not None:
        from lib.panels import bounds
        mn, mx = bounds(g)
        div = D.box("grille_divider", (0, (mn[1] + mx[1]) / 2, mx[2] + 0.005), (0.035, (mx[1] - mn[1]) * 0.95, 0.03), mats["trim_gloss"])
        parent_keep(div, g)

    # Plates and badges.
    h = D.hit([parts["bumper_F"]], (0, -0.31, 3.0), (0, 0, -1))
    if h:
        pl = D.plate("plate_F", (0, -0.31, h[0][2] + 0.004), 1, mats)
        parent_keep(pl, parts["bumper_F"])
    h = D.hit([parts["bumper_R"], parts.get("plate_area", parts["bumper_R"])], (0, 0.05, -3.0), (0, 0, 1))
    if h:
        pl = D.plate("plate_R", (0, 0.05, h[0][2] - 0.004), -1, mats)
        parent_keep(pl, parts["bumper_R"])
    h = D.hit([parts["hood"]], (0, 1.0, 2.12), (0, -1, 0))
    if h:
        b = D.badge("badge_F", (0, h[0][1] + 0.004, 2.12), 0.035, "y", mats)
        parent_keep(b, parts["hood"])

    # Shark-fin antenna.
    h = D.hit([parts.get("roof", parts["body"])], (0, 1.5, -0.65), (0, -1, 0))
    if h:
        fin = D.shark_fin("antenna", (0, h[0][1], -0.55), mats, "paint")
        parent_keep(fin, parts.get("roof", parts["body"]))
    return made
