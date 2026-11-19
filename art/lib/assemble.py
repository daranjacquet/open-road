"""Turn the raw panel split into a finished car: materials, panel gaps, glass, lights, grilles,
hierarchy (what is bolted to what) and pivots for hinges."""
import numpy as np

from .lights import headlight, taillight
from .panels import bounds, gap_and_flange, glass_pane, planar_uv, push_along_normals
from .util import parent_keep, set_origin


PAINT_PANELS = ("body", "hood", "trunk", "door_", "fender_", "bumper_", "plate_area", "tailgate", "sidepod", "engine_cover", "front_panel")


def _set_mats(obj, *mats):
    obj.data.materials.clear()
    for m in mats:
        obj.data.materials.append(m)
    for p in obj.data.polygons:
        p.material_index = 0


def _shrink(obj, f):
    me = obj.data
    import numpy as _np
    co = _np.array([v.co[:] for v in me.vertices])
    if len(co) == 0:
        return
    c = (co.min(axis=0) + co.max(axis=0)) / 2
    for v in me.vertices:
        v.co = tuple(c + (_np.array(v.co[:]) - c) * f)


def finish(parts, mats, spec):
    """parts: {name: object} straight from build_body. spec: per-car options:
       paint_override: {panel: material key}, lights: {'front': style}, parents: {child: parent},
       pivots: {part: callable(min, max) -> chassis point}.
    """
    out = {}
    over = spec.get("materials", {})
    for name, obj in list(parts.items()):
        if name in over:
            _set_mats(obj, mats[over[name]], mats["gap"])
            if over[name] in ("paint", "carbon"):
                gap_and_flange(obj, gap=0.0025, depth=0.016)
        elif name.startswith(PAINT_PANELS):
            _set_mats(obj, mats["paint"], mats["gap"])
            gap_and_flange(obj, gap=0.0025, depth=0.016)
        elif name.startswith("glass"):
            dark = name.startswith("glass_Q") or name.startswith("glass_R") and name != "glass_rear"
            _set_mats(obj, mats["glass_dark" if dark else "glass"], mats["glass_rubber"])
            glass_pane(obj)
        elif name.startswith("light_F"):
            headlight(obj, mats, 1 if name.endswith("L") else -1, spec.get("headlight_style", "projector"))
        elif name.startswith("light_R"):
            taillight(obj, mats, 1 if name.endswith("L") else -1)
        elif name in ("grille", "intake_F", "intake_side", "vent", "rear_mesh"):
            _set_mats(obj, mats["honeycomb"], mats["trim_gloss"])
            push_along_normals(obj, -0.03)
            gap_and_flange(obj, gap=0.002, depth=0.05)
            planar_uv(obj, (1, 0, 0), (0, 0, 1), scale=3.0)
            # Dark backing a few centimetres behind the mesh, shrunk so it never pokes out.
            back = obj.copy()
            back.data = obj.data.copy()
            back.name = name + "_back"
            obj.users_collection[0].objects.link(back)
            _set_mats(back, mats["gap"])
            push_along_normals(back, -0.05)
            _shrink(back, 0.9)
            parent_keep(back, obj)
        elif name in ("pillar_trim",):
            _set_mats(obj, mats["trim_gloss"], mats["gap"])
            gap_and_flange(obj, gap=0.002, depth=0.01)
        elif name in ("cowl", "diffuser", "underbody", "skid"):
            _set_mats(obj, mats["trim_matte"] if name != "underbody" else mats["underbody"], mats["gap"])
            if name != "underbody":
                gap_and_flange(obj, gap=0.002, depth=0.012)
        elif name == "well":
            _set_mats(obj, mats["well"])
        elif name == "roof" and "roof" not in over:
            _set_mats(obj, mats["paint"], mats["gap"])
            gap_and_flange(obj)
        out[name] = obj

    # Pivots (origin = hinge / bolt point) for the parts the game opens or tears off.
    for name, obj in out.items():
        mn, mx = bounds(obj)
        piv = spec.get("pivots", {}).get(name)
        if piv is not None:
            set_origin(obj, piv(mn, mx))
        elif name == "hood":
            set_origin(obj, ((mn[0] + mx[0]) / 2, mx[1], mn[2]))  # rear edge, top
        elif name in ("trunk", "tailgate"):
            set_origin(obj, ((mn[0] + mx[0]) / 2, mx[1], mx[2]))  # front edge, top
        elif name.startswith("door_"):
            set_origin(obj, (mx[0] if name[-1] == "L" else mn[0], (mn[1] + mx[1]) / 2, mx[2]))  # front edge
        else:
            c = (mn + mx) / 2
            set_origin(obj, tuple(c))

    # Hierarchy.
    parents = dict(spec.get("parents", {}))
    for name, obj in out.items():
        par = parents.get(name)
        if par is None:
            if name.startswith("glass_F") and name[-1] in "LR" and len(name) == 8:
                par = "door_F" + name[-1]
            elif name.startswith("glass_R") and name[-1] in "LR" and len(name) == 8:
                par = "door_R" + name[-1]
            elif name.startswith("light_F") or name in ("grille", "intake_F"):
                par = "bumper_F"
            elif name in ("diffuser", "plate_area", "rear_mesh"):
                par = "bumper_R"
            elif name not in ("body",) and not name.startswith(("door_", "hood", "trunk", "bumper_", "tailgate")):
                par = "body"
        if par and par in out and par != name:
            parent_keep(obj, out[par])
    return out


def unused():
    return np
