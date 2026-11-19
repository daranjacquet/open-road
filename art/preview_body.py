"""Quick body preview: blender -b --factory-startup -P art/preview_body.py -- <car> <out.png> [levels]"""
import importlib
import os
import random
import sys
import time

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib.body import build_body  # noqa: E402
from lib.preview import render_sheet  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:]
car, out = argv[0], argv[1]
levels = int(argv[2]) if len(argv) > 2 else 2
bpy.ops.wm.read_factory_settings(use_empty=True)
mod = importlib.import_module(f"cars.{car}")
t = time.time()
parts = build_body(mod.DESIGN, levels=levels)
print("[preview] body built in", round(time.time() - t, 2), "s:", sorted(parts))
random.seed(3)
palette = {"glass": (0.08, 0.1, 0.13, 1), "well": (0.05, 0.05, 0.05, 1), "underbody": (0.1, 0.1, 0.1, 1),
           "pillar_trim": (0.03, 0.03, 0.03, 1), "grille": (0.02, 0.02, 0.02, 1), "diffuser": (0.04, 0.04, 0.04, 1),
           "light": (0.9, 0.9, 0.95, 1), "roof": (0.12, 0.12, 0.14, 1)}
for name, o in parts.items():
    m = o.data.materials[0]
    col = None
    for k, c in palette.items():
        if name.startswith(k):
            col = c
    if col is None:
        col = (0.55 + random.random() * 0.4, 0.15 + random.random() * 0.3, 0.1 + random.random() * 0.2, 1)
    m.diffuse_color = col
render_sheet(out, length=4.8)
print("[preview] wrote", out)
