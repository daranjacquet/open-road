"""Mechanical bits under the bonnet (or the engine cover): visible when panels open or tear off,
and they crumple with the rest of the car."""
import math

from .details import rounded_box, tube
from .util import box, cylinder, parent_keep


def build(spec, mats, parent):
    """spec: dict(kind='front'|'rear'|'frunk', centre=(x,y,z), size=(w,h,l), radiator_z=float or None,
    strut_x=float, strut_y=float, strut_z=float)"""
    objs = []
    cx, cy, cz = spec["centre"]
    w, h, l = spec["size"]
    kind = spec.get("kind", "front")
    if kind == "frunk":
        tub = box("frunk_tub", (cx, cy, cz), (w, h, l), mats["trim_matte"])
        objs.append(tub)
    else:
        block = rounded_box("engine_block", (cx, cy - h * 0.1, cz), (w * 0.8, h * 0.75, l * 0.8), mats["housing"])
        cover = rounded_box("engine_cover_trim", (cx, cy + h * 0.32, cz), (w * 0.62, h * 0.12, l * 0.7), mats["trim_gloss"])
        logo = cylinder("engine_logo", (cx, cy + h * 0.39, cz), 0.05, 0.01, "y", mats["chrome"], segments=20)
        objs += [block, cover, logo]
        # Intake runners / pipes across the top.
        for s in (1, -1):
            pts = [(cx + s * w * 0.3, cy + h * 0.2, cz - l * 0.3), (cx + s * w * 0.42, cy + h * 0.32, cz),
                   (cx + s * w * 0.3, cy + h * 0.25, cz + l * 0.35)]
            objs.append(tube(f"intake_pipe_{'L' if s > 0 else 'R'}", pts, 0.035, mats["trim_matte"]))
        battery = box("battery", (cx + w * 0.55, cy, cz - l * 0.4), (0.2, 0.18, 0.28), mats["trim_matte"])
        reservoir = cylinder("coolant", (cx - w * 0.55, cy + 0.05, cz - l * 0.35), 0.06, 0.16, "y", mats["lens_clear"], segments=16)
        objs += [battery, reservoir]
        if kind == "rear":
            for s in (1, -1):
                for k in range(5):
                    pipe = cylinder(f"runner_{'L' if s > 0 else 'R'}{k}", (cx + s * w * 0.28, cy + h * 0.38, cz - l * 0.35 + k * l * 0.17),
                                    0.028, 0.18, "y", mats["chrome"], segments=12, rot=(0, 0, s * math.radians(25)))
                    objs.append(pipe)
    if spec.get("radiator_z") is not None:
        rz = spec["radiator_z"]
        rad = box("radiator", (cx, cy - 0.02, rz), (w * 1.35, h * 0.85, 0.05), mats["trim_matte"])
        core = box("radiator_core", (cx, cy - 0.02, rz + 0.026), (w * 1.25, h * 0.75, 0.004), mats["honeycomb"])
        objs += [rad, core]
        from .panels import planar_uv
        planar_uv(core, (1, 0, 0), (0, 0, 1), scale=6.0)
    if spec.get("strut_x"):
        for s in (1, -1):
            objs.append(cylinder(f"strut_{'L' if s > 0 else 'R'}", (s * spec["strut_x"], spec["strut_y"], spec["strut_z"]), 0.07, 0.05, "y", mats["satin_alu"], segments=20))
    for o in objs:
        parent_keep(o, parent)
    return objs
