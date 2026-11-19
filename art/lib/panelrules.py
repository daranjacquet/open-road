"""Generic panel layout from named column ranges (half-open [a, b) column intervals).

keys (all optional except where noted):
  rear_bumper_end   columns < this (and j <= 8) are the rear bumper; column 0 is always rear bumper
  trunk             (a, b) boot / tailgate top surface (j 9..13)
  rear_window       (a, b) rear screen (j >= 12)
  roof              (a, b) roof (j >= 11)
  quarter_window    (a, b) small side glass (j 8..10)
  rear_door         (a, b) rear doors (lower j 3..7, glass j 8..10)
  b_pillar          (a, b) black pillar between door windows
  front_door        (a, b)
  windshield        (a, b) (j >= 12)
  cowl              (a, b) scuttle panel between windscreen and bonnet (j 9..13)
  hood              (a, b) bonnet (j 9..13)
  front_bumper_start  columns >= this (j <= 8) are the front bumper
  fender            (a, b) front wings (j 4..8)
  head_light        (cols set, j set)   tail_light (cols set, j set)
  side_intake       (cols set, j set)   vent (cols set, j set)  extra {(i, j): name}
  door_low_j        lowest ring band of the doors (default 3)
"""


def make_panel(L):
    def rng(key):
        r = L.get(key)
        return (lambda i: r[0] <= i < r[1]) if r else (lambda i: False)

    in_trunk, in_rw, in_roof = rng("trunk"), rng("rear_window"), rng("roof")
    in_qw, in_rd, in_bp, in_fd = rng("quarter_window"), rng("rear_door"), rng("b_pillar"), rng("front_door")
    in_ws, in_cowl, in_hood, in_fender = rng("windshield"), rng("cowl"), rng("hood"), rng("fender")
    rb_end = L.get("rear_bumper_end", 1)
    fb_start = L.get("front_bumper_start", 10 ** 6)
    hl, tl = L.get("head_light"), L.get("tail_light")
    si, vent = L.get("side_intake"), L.get("vent")
    extra = L.get("extra", {})
    door_low = L.get("door_low_j", 3)
    last = L["n_columns"] - 2  # last face band index

    def panel(i, j, side):
        s = side
        if (i, j) in extra:
            v = extra[(i, j)]
            return v.replace("{s}", s)
        if j <= 2:
            return "underbody"
        if hl and i in hl[0] and j in hl[1]:
            return "light_F" + s
        if tl and i in tl[0] and j in tl[1]:
            return "light_R" + s
        if si and i in si[0] and j in si[1]:
            return "intake_side"
        if vent and i in vent[0] and j in vent[1]:
            return "vent"
        if i == 0 or (i < rb_end and j <= 8):
            return "bumper_R"
        if i >= fb_start and j <= 8:
            return "bumper_F"
        if i >= last and j > 8:
            return "bumper_F" if L.get("nose_is_bumper", True) else "hood"
        if in_trunk(i) and 9 <= j <= 13:
            return "trunk"
        if in_hood(i) and 9 <= j <= 13:
            return "hood"
        if in_cowl(i) and 9 <= j <= 13:
            return "cowl"
        if in_rw(i) and j >= 12:
            return "glass_rear"
        if in_ws(i) and j >= 12:
            return "glass_front"
        if in_roof(i) and j >= 11:
            return "roof"
        if 8 <= j <= 10:
            if in_rd(i):
                return "glass_R" + s
            if in_fd(i):
                return "glass_F" + s
            if in_bp(i):
                return "pillar_trim"
            if in_qw(i):
                return "glass_Q" + s
        if door_low <= j <= 7:
            if in_rd(i):
                return "door_R" + s
            if in_fd(i):
                return "door_F" + s
            if in_fender(i) and j >= 4:
                return "fender_F" + s
        return "body"

    return panel
