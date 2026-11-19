"""Body pipeline: control cage -> subdivision surface -> wheel-arch booleans -> panels split by material."""
import bpy

from .cage import build_cage
from .section import section
from .util import C, apply_modifiers, cylinder, delete, material, separate_by_material, subdivide


def build_body(design, levels=3):
    """Returns {panel name: object}. Panel objects carry placeholder materials named 'panel:<name>'."""
    cols = [section(c) for c in design["columns"]]
    cage = build_cage(
        "body_cage",
        cols,
        design["panel"],
        design["front_caps"],
        design["rear_caps"],
        ring_crease=design.get("ring_crease"),
        col_crease=design.get("col_crease"),
    )
    subdivide(cage, levels=levels)

    # Wheel arches: one cylinder per wheel, cut from the outside in. The cutter surface left inside the
    # body becomes the wheel-well liner (its own material).
    well = bpy.data.materials.get("panel:well") or bpy.data.materials.new("panel:well")
    for (az, ay, ar) in design["arches"]:
        for side in (1, -1):
            inner = design.get("arch_inner", 0.42)
            outer = 1.6
            cx = side * (inner + outer) / 2
            cut = cylinder("arch_cut", (cx, ay, az), ar, outer - inner, "x", well, segments=72)
            # Flatten the bottom of the cutter below the floor (cut fully through the sill area).
            boolean_cut(cage, cut)
            delete(cut)

    parts = separate_by_material(cage)
    out = {}
    for name, obj in parts.items():
        out[name.replace("panel:", "")] = obj
        obj.name = name.replace("panel:", "")
    return out


def boolean_cut(obj, cutter):
    m = obj.modifiers.new("bool", "BOOLEAN")
    m.operation = "DIFFERENCE"
    m.object = cutter
    m.solver = "EXACT"
    try:
        m.material_mode = "TRANSFER"
    except Exception:
        pass
    apply_modifiers(obj)


def unused():
    return C, material
