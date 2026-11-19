# Art pipeline (Blender)

## Game cars: third-party models

The cars in the game come from hand-made models (CC BY 4.0, see `../CREDITS.md`) in `sources/<id>/`, reworked by **Blender 5.x** scripts:

```bash
npm run models                                         # every car with a mapping: import, compress, fit physics
node scripts/build-models.mjs sedan                    # one car
blender -b --factory-startup -P art/inspect_model.py -- art/sources/sedan/thunderbolt_96.glb --render /tmp/m.png
blender -b --factory-startup -P art/import_car.py -- sedan --views /tmp/views   # + side/top/front grid renders
```

- `inspect_model.py`: meshes, materials, triangles and sizes of any .glb/.gltf/.fbx/.obj/.blend.
- `import_car.py` + `imports/<id>.json`: the mapping says which source objects make which part, which boxes (game frame: x left, y up, z forward, metres) to cut doors, mirrors or lids out of the body, how to rename materials (`paint`, `glass`, `trim_matte`, `underbody`... the names the game reacts to; textures are kept), which faces to `restyle` so the outer shell counts for the crumple rays, and where the wheels are. `--views DIR` renders orthographic views with a 0.25 m grid (red lines every metre) to place the boxes.
- It writes `blend/<id>.blend`, `build/<id>.glb` and `build/<id>.measure.json`; `scripts/optimize-models.mjs` compresses into `public/models/`, `scripts/fit-car-config.mjs` fits the physics geometry of `src/vehicle/cars/<id>.json` to the measurements.

## Earlier procedural cars

The first cars were modelled entirely by Python scripts (below). They are kept for reference; `npm run models:procedural` rebuilds them and overwrites the game cars.

```bash
npm run models:procedural
blender -b --factory-startup -P art/build_cars.py -- --only sedan --preview /tmp/pv   # one car + preview renders
blender -b --factory-startup -P art/preview_body.py -- sedan /tmp/body.png 2         # quick body-only check
```

## Layout

- `cars/<id>.py`: one design per car. `COLUMNS` (the control cage, see below), the panel layout, wheel arches, wheel spec, paint, interior, engine bay and a `details()` function that places lamps, mirrors, handles, exhausts and so on.
- `lib/section.py`: one cross-section (15 control points from the bottom centre to the roof centre) from a few named heights and widths.
- `lib/cage.py`: columns to a closed control cage with creases, end caps closed with quad grids, a material slot per panel.
- `lib/body.py`: subdivision surface, wheel-arch booleans (the cutter leaves the wheel-well liners), split by material into panels.
- `lib/assemble.py`, `lib/panels.py`: real panel gaps with flanges, sunk glass with rubber edges, honeycomb grilles, pivots on hinges, hierarchy.
- `lib/lights.py`, `lib/wheels.py`, `lib/details.py`, `lib/interior.py`, `lib/engine_bay.py`: the parts.
- `lib/materials.py`, `lib/textures.py`: paint (clear coat), carbon weave, honeycomb, tyre tread normal maps, number plates, gauges; all generated, nothing downloaded.
- `blend/`: the generated `.blend` scenes.
- `build/`: raw exports (ignored by git); `scripts/optimize-models.mjs` writes `public/models/`.

## What the game expects

- Chassis frame: +Y up, +Z forward, +X left, metres. The scripts design in this frame (`lib.util.C` converts to Blender's Z-up), and the glTF exporter converts back.
- Every object carries two custom properties exported as glTF extras: `part_name` (its name, which survives glTF de-duplication and meshopt node splits) and `chassis_pivot` (its hinge or bolt point). Do not call it `pivot`: three.js r187 reads that key itself.
- Named parts: `body`, `hood`, `trunk`, `door_FL/FR/RL/RR`, `bumper_F/R`, `glass_*`, `light_FL/FR/RL/RR`, `mirror_L/R`; wheels as `tire_XX`, `rim_XX`, `nuts_XX`, `disc_XX`, `caliper_XX` built at the origin with the axle along X.
- Material names matter (`paint`, `carbon`, `glass`, `glass_dark`, `honeycomb`...): the game adds the scuff and crack shaders by name.
- The hard collision core, the outline boxes and the crumple-ray grids live in `src/vehicle/cars/<id>.json`, not in the model.

When the game loads a car, it bakes each mesh to the chassis frame, re-centres it on its pivot and merges everything that does not move on its own into the nearest part that does, per material.
