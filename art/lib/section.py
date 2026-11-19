"""Cross-section template: column parameters -> 15 left-half control points (chassis frame).

Column keys (metres, chassis frame):
  z      longitudinal position of the lower body points
  gz     longitudinal position of the greenhouse points (j >= 11); 9 and 10 blend between z and gz
  floor  underbody height, Wf sill half-width, sill sill-top height
  W      half-width at the character line `char`, low lower-side height (optional), Wl its width (optional)
  sh     shoulder height, Wsh shoulder half-width
  belt   window-line height, Wb its half-width
  roof   roof (or bonnet/boot) centre height, Wr roof-rail half-width, crown extra centre height
"""


def lerp(a, b, t):
    return a + (b - a) * t


def section(c):
    z = c["z"]
    gz = c.get("gz", z)
    floor = c["floor"]
    Wf = c["Wf"]
    sill = c["sill"]
    W = c["W"]
    char = c["char"]
    low = c.get("low", lerp(sill, char, 0.45))
    Wl = c.get("Wl", lerp(Wf, W, 0.8))
    sh = c["sh"]
    Wsh = c["Wsh"]
    belt = c["belt"]
    Wb = c["Wb"]
    # A roof (or bonnet) below the belt makes a valley between raised wings, as on mid-engined cars.
    roof = c["roof"] if c.get("valley") else max(c["roof"], belt + 0.004)
    Wr = min(c["Wr"], Wb - 0.01)
    crown = c.get("crown", 0.0)
    h = roof - belt
    pts = [
        (0.0, floor, z),
        (0.5 * Wf, floor, z),
        (0.86 * Wf, floor + 0.004, z),
        (Wf, floor + c.get("rocker", 0.05), z),
        (Wf + 0.008, sill, z),
        (Wl, low, z),
        (W, char, z),
        (Wsh, sh, z),
        (Wb, belt, z),
        (lerp(Wb, Wr, 0.3), belt + 0.3 * h, lerp(z, gz, 0.3)),
        (lerp(Wb, Wr, 0.72), belt + 0.72 * h, lerp(z, gz, 0.72)),
        (Wr, roof - min(0.035, 0.6 * h), gz),
        (0.87 * Wr, roof - min(0.01, 0.2 * h) + crown * 0.25, gz),
        (0.46 * Wr, roof + crown * 0.78, gz),
        (0.0, roof + crown, gz),
    ]
    for k, v in c.get("override", {}).items():
        pts[k] = v
    return pts


def interp_columns(a, b, t, z=None):
    """Blend two column dicts (numeric keys)."""
    out = {}
    for k in a:
        if k == "override":
            continue
        if isinstance(a[k], (int, float)) and k in b:
            out[k] = lerp(a[k], b[k], t)
        else:
            out[k] = a[k]
    if z is not None:
        out["z"] = z
    return out
