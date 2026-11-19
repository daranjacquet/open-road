"""Body specs of the three cars. Same numbers and panel rules as the former TypeScript generator.

Chassis frame: +Y up, +Z forward, +X left. `classify` maps a shell face (centroid c, averaged normal n)
to a part name; anything unmatched is "body".
"""


def _sport_classify(cx, cy, cz, nx, ny, nz):
    ax = abs(cx)
    left = cx > 0
    if cz > 1.88 or (cz > 1.62 and cy < -0.22):
        return "bumper_F"
    if cz < -1.98 or (cz < -1.62 and cy < -0.22):
        return "bumper_R"
    if 0.18 < cz < 0.95 and ax < 0.52 and nz > 0.2 and ny > 0.3 and cy > 0.3:
        return "glass_front"
    if -1.55 < cz < -0.88 and ax < 0.52 and nz < -0.25 and cy > 0.33:
        return "glass_rear"
    if ax > 0.5 and -0.95 < cz < 0.62 and 0.345 < cy < 0.66:
        return "glass_L" if left else "glass_R"
    if ax > 0.5 and -0.62 < cz < 0.72 and -0.28 < cy < 0.345:
        return "door_FL" if left else "door_FR"
    if 0.9 < cz < 1.88 and cy > 0.1 and ax < 0.78 and ny > 0.5:
        return "hood"
    if -1.98 < cz < -1.45 and cy > 0.15 and ax < 0.78 and ny > 0.5:
        return "trunk"
    return "body"


def _hatch_classify(cx, cy, cz, nx, ny, nz):
    ax = abs(cx)
    left = cx > 0
    if cz > 1.78 or (cz > 1.5 and cy < -0.2):
        return "bumper_F"
    if cz < -1.8 or (cz < -1.5 and cy < -0.2):
        return "bumper_R"
    if 0.0 < cz < 0.72 and ax < 0.55 and nz > 0.2 and ny > 0.3 and cy > 0.28:
        return "glass_front"
    if -1.75 < cz < -1.3 and ax < 0.55 and nz < -0.15 and cy > 0.4:
        return "glass_rear"
    if ax > 0.52 and -1.35 < cz < 0.4 and 0.33 < cy < 0.86:
        return "glass_L" if left else "glass_R"
    if ax > 0.52 and -0.65 < cz < 0.52 and -0.28 < cy < 0.33:
        return "door_FL" if left else "door_FR"
    if 0.8 < cz < 1.78 and cy > 0.08 and ax < 0.76 and ny > 0.5:
        return "hood"
    if -1.78 < cz < -1.4 and cy > 0.3 and ax < 0.76:
        return "trunk"
    return "body"


def _pickup_classify(cx, cy, cz, nx, ny, nz):
    ax = abs(cx)
    left = cx > 0
    if cz > 2.38 or (cz > 2.05 and cy < -0.3):
        return "bumper_F"
    if cz < -2.5 or (cz < -2.1 and cy < -0.4):
        return "bumper_R"
    if 0.45 < cz < 1.0 and ax < 0.66 and nz > 0.2 and ny > 0.3 and cy > 0.42:
        return "glass_front"
    if -0.46 < cz < -0.18 and ax < 0.6 and nz < -0.2 and cy > 0.5:
        return "glass_rear"
    if ax > 0.58 and -0.2 < cz < 0.85 and 0.46 < cy < 0.95:
        return "glass_L" if left else "glass_R"
    if ax > 0.58 and -0.25 < cz < 0.9 and -0.35 < cy < 0.46:
        return "door_FL" if left else "door_FR"
    if 1.02 < cz < 2.38 and cy > 0.2 and ax < 0.92 and ny > 0.5:
        return "hood"
    if -2.45 < cz < -0.55 and cy > 0.28 and ax < 0.92 and ny > 0.5:
        return "trunk"
    return "body"


# Extras are described as data: (name, kind, center, size_or_radius_len, rotation_y_rad, material, parent)
# kind: "box" (size = x,y,z) or "cyl_z" (size = radius, length; axis along Z).
SPECS = {
    "sport": dict(
        z_min=-2.2, z_max=2.2, paint=0xB3170D,
        yb=[(-2.2, -0.3), (-2.0, -0.37), (-1.5, -0.4), (1.5, -0.4), (2.0, -0.35), (2.2, -0.28)],
        belt=[(-2.2, 0.18), (-1.9, 0.26), (-1.45, 0.3), (-0.9, 0.31), (0.5, 0.31), (0.8, 0.27), (1.0, 0.24), (1.7, 0.14), (2.2, 0.06)],
        top=[(-2.2, 0.18), (-1.9, 0.26), (-1.62, 0.31), (-1.3, 0.46), (-1.0, 0.63), (-0.8, 0.7), (0.1, 0.7), (0.35, 0.62), (0.6, 0.42), (0.85, 0.28), (1.0, 0.25), (1.7, 0.15), (2.2, 0.07)],
        half_width=[(-2.2, 0.74), (-2.0, 0.84), (-1.5, 0.9), (-0.5, 0.92), (0.8, 0.92), (1.6, 0.9), (2.0, 0.84), (2.2, 0.74)],
        roof_half_width=[(-2.2, 0.6), (-1.6, 0.72), (-1.3, 0.62), (-1.0, 0.6), (0.1, 0.6), (0.35, 0.62), (0.7, 0.7), (0.95, 0.76), (2.2, 0.62)],
        crown=[(-2.2, 0), (-1.6, 0.015), (-0.8, 0.005), (0.6, 0), (1.0, 0.02), (1.8, 0.012), (2.2, 0)],
        arches=[(1.36, -0.23, 0.4), (-1.24, -0.23, 0.4)],
        classify=_sport_classify,
        pivots={"body": (0, 0, 0), "hood": (0, 0.26, 0.9), "trunk": (0, 0.3, -1.45), "door_FL": (0.92, 0.1, 0.72),
                "door_FR": (-0.92, 0.1, 0.72), "bumper_F": (0, -0.15, 2.0), "bumper_R": (0, -0.15, -2.0)},
        interior=((0, 0.16, -0.2), (0.5, 0.3, 0.72)),
        mirrors=[(0.99, 0.4, 0.5), (-0.99, 0.4, 0.5)],
        extras=[
            ("exhaust_0", "cyl_z", (0.5, -0.3, -2.17), (0.045, 0.16), 0, "rim", "bumper_R"),
            ("exhaust_1", "cyl_z", (-0.5, -0.3, -2.17), (0.045, 0.16), 0, "rim", "bumper_R"),
            ("exhaust_2", "cyl_z", (0.36, -0.3, -2.17), (0.045, 0.16), 0, "rim", "bumper_R"),
            ("exhaust_3", "cyl_z", (-0.36, -0.3, -2.17), (0.045, 0.16), 0, "rim", "bumper_R"),
            ("wing", "box", (0, 0.4, -2.0), (1.5, 0.025, 0.28), 0, "trim", "trunk"),
            ("wing_post_0", "box", (0.55, 0.35, -1.98), (0.04, 0.1, 0.08), 0, "trim", "trunk"),
            ("wing_post_1", "box", (-0.55, 0.35, -1.98), (0.04, 0.1, 0.08), 0, "trim", "trunk"),
            ("light_FL", "box", (0.6, 0.065, 2.1), (0.32, 0.06, 0.1), 0.3, "headlight", "bumper_F"),
            ("light_FR", "box", (-0.6, 0.065, 2.1), (0.32, 0.06, 0.1), -0.3, "headlight", "bumper_F"),
            ("light_RL", "box", (0.58, 0.19, -2.12), (0.4, 0.07, 0.06), -0.15, "taillight", "bumper_R"),
            ("light_RR", "box", (-0.58, 0.19, -2.12), (0.4, 0.07, 0.06), 0.15, "taillight", "bumper_R"),
            ("splitter", "box", (0, -0.375, 2.12), (1.2, 0.015, 0.12), 0, "trim", "bumper_F"),
        ],
        mirror_parent=("door_FL", "door_FR"),
    ),
    "hatch": dict(
        z_min=-1.98, z_max=1.98, paint=0x2F8F5B,
        yb=[(-1.98, -0.28), (-1.8, -0.33), (-1.4, -0.35), (1.3, -0.35), (1.8, -0.32), (1.98, -0.26)],
        belt=[(-1.98, 0.18), (-1.8, 0.28), (-1.0, 0.3), (0.4, 0.3), (0.8, 0.26), (1.2, 0.2), (1.98, 0.06)],
        top=[(-1.98, 0.2), (-1.85, 0.3), (-1.78, 0.5), (-1.6, 0.8), (-1.35, 0.9), (-0.2, 0.93), (0.1, 0.9), (0.4, 0.6), (0.65, 0.3), (0.9, 0.24), (1.4, 0.17), (1.98, 0.08)],
        half_width=[(-1.98, 0.72), (-1.8, 0.82), (-1.2, 0.86), (0.9, 0.86), (1.6, 0.84), (1.98, 0.72)],
        roof_half_width=[(-1.98, 0.6), (-1.7, 0.7), (-1.5, 0.66), (-1.2, 0.66), (0.2, 0.66), (0.5, 0.7), (0.9, 0.74), (1.98, 0.6)],
        crown=[(-1.98, 0), (-1.6, 0.01), (0.4, 0.005), (1.0, 0.015), (1.98, 0)],
        arches=[(1.2, -0.2, 0.38), (-1.3, -0.2, 0.38)],
        classify=_hatch_classify,
        pivots={"body": (0, 0, 0), "hood": (0, 0.24, 0.82), "trunk": (0, 0.9, -1.4), "door_FL": (0.88, 0.1, 0.52),
                "door_FR": (-0.88, 0.1, 0.52), "bumper_F": (0, -0.12, 1.85), "bumper_R": (0, -0.12, -1.85)},
        interior=((0, 0.2, -0.45), (0.5, 0.34, 0.85)),
        mirrors=[(0.93, 0.42, 0.36), (-0.93, 0.42, 0.36)],
        extras=[
            ("exhaust_0", "cyl_z", (0.42, -0.3, -1.95), (0.04, 0.14), 0, "rim", "bumper_R"),
            ("light_FL", "box", (0.58, 0.09, 1.9), (0.3, 0.12, 0.08), 0.35, "headlight", "bumper_F"),
            ("light_FR", "box", (-0.58, 0.09, 1.9), (0.3, 0.12, 0.08), -0.35, "headlight", "bumper_F"),
            ("light_RL", "box", (0.7, 0.4, -1.86), (0.1, 0.3, 0.06), -0.1, "taillight", "bumper_R"),
            ("light_RR", "box", (-0.7, 0.4, -1.86), (0.1, 0.3, 0.06), 0.1, "taillight", "bumper_R"),
        ],
    ),
    "pickup": dict(
        z_min=-2.65, z_max=2.65, paint=0xD8D4C8,
        yb=[(-2.65, -0.42), (-2.4, -0.5), (2.2, -0.5), (2.65, -0.4)],
        belt=[(-2.65, 0.3), (-2.5, 0.38), (-0.5, 0.4), (-0.3, 0.4), (0.9, 0.4), (1.0, 0.36), (1.9, 0.33), (2.65, 0.16)],
        top=[(-2.65, 0.3), (-2.5, 0.38), (-0.5, 0.4), (-0.42, 0.62), (-0.3, 0.95), (-0.15, 1.0), (0.3, 1.0), (0.5, 0.88), (0.8, 0.55), (0.98, 0.4), (1.2, 0.35), (1.9, 0.33), (2.4, 0.28), (2.65, 0.18)],
        half_width=[(-2.65, 0.9), (-2.4, 1.0), (1.9, 1.0), (2.4, 0.96), (2.65, 0.84)],
        roof_half_width=[(-2.65, 0.8), (-0.5, 0.82), (-0.4, 0.8), (-0.2, 0.78), (0.4, 0.8), (0.9, 0.9), (2.65, 0.78)],
        crown=[(-2.65, 0), (-0.5, 0.01), (1.0, 0.015), (2.65, 0)],
        arches=[(1.75, -0.33, 0.5), (-1.45, -0.33, 0.5)],
        classify=_pickup_classify,
        pivots={"body": (0, 0, 0), "hood": (0, 0.38, 1.02), "trunk": (0, 0.4, -0.55), "door_FL": (1.0, 0.1, 0.9),
                "door_FR": (-1.0, 0.1, 0.9), "bumper_F": (0, -0.1, 2.5), "bumper_R": (0, -0.1, -2.5)},
        interior=((0, 0.35, 0.2), (0.62, 0.45, 0.62)),
        mirrors=[(1.06, 0.62, 0.7), (-1.06, 0.62, 0.7)],
        extras=[
            ("light_FL", "box", (0.78, 0.2, 2.5), (0.36, 0.16, 0.1), 0.2, "headlight", "bumper_F"),
            ("light_FR", "box", (-0.78, 0.2, 2.5), (0.36, 0.16, 0.1), -0.2, "headlight", "bumper_F"),
            ("light_RL", "box", (0.86, 0.22, -2.62), (0.14, 0.34, 0.08), -0.05, "taillight", "bumper_R"),
            ("light_RR", "box", (-0.86, 0.22, -2.62), (0.14, 0.34, 0.08), 0.05, "taillight", "bumper_R"),
            ("grille", "box", (0, 0.12, 2.6), (0.9, 0.3, 0.06), 0, "trim", "bumper_F"),
            ("exhaust_0", "cyl_z", (-0.7, -0.38, -2.6), (0.05, 0.2), 0, "rim", "bumper_R"),
        ],
    ),
}
