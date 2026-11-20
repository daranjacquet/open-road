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

## The aircraft

The Cirrus SR22 (`sources/plane/`, credits in `../CREDITS.md`) has its own import, built the same way:

```bash
node scripts/build-models.mjs plane                                    # import, compress
blender -b --factory-startup -P art/explore_plane.py -- art/sources/plane/cirrus_sr22.glb +X 7.92 /tmp/views   # boxes and grid views of a new model
blender -b --factory-startup -P art/import_plane.py -- plane --views /tmp/views                              # + views of the parts
```

- `explore_plane.py` prints every object's box in the game frame and renders side, top and front views with a 0.5 m grid, to write the mapping.
- `import_plane.py` + `imports/plane.json`: orientation, length and origin (the centre of gravity), material renames, texture boxes to paint out (registration, logos), the parts that break off (split from the body by boxes: wings, tailplane, fin, gear legs with their wheel fairings, propeller), and the control surfaces, cut along their hinge lines with `bmesh.ops.bisect_plane` (hinge plane plus the spanwise ends) and given a `hinge_axis`. Parts carry `part_name`, `chassis_pivot`, `hinge_axis` and `parent_part` (controls under their wing or tailplane, wheels under their leg).
- The flight model (`src/vehicle/aircraft/sr22.json`) is not fitted by a script: its surfaces, gear and mass boxes were placed on measurements of the model, and `tests/aircraft-model.test.ts` checks that they still match it.

## Layout

- `lib/importer.py`: loading any source format, transforms, bounding boxes, triangle counts, quick renders.
- `imports/<id>.json`: one mapping per car (see above), and `plane.json` for the aircraft.
- `sources/<id>/`: the downloaded models and their licences.
- `blend/`: the `.blend` scenes written by the import.
- `build/`: raw exports (ignored by git); `scripts/optimize-models.mjs` writes `public/models/`.

The first cars were modelled entirely by Python scripts (control cage, subdivision, panel gaps). That pipeline was removed; it is kept in git under the tag `procedural-cars`.

## What the game expects

- Chassis frame: +Y up, +Z forward, +X left, metres. The import mappings use this frame, and the glTF exporter converts from Blender's Z-up.
- Every object carries two custom properties exported as glTF extras: `part_name` (its name, which survives glTF de-duplication and meshopt node splits) and `chassis_pivot` (its hinge or bolt point). Do not call it `pivot`: three.js r187 reads that key itself.
- Named parts: `body`, `hood`, `trunk`, `door_FL/FR/RL/RR`, `bumper_F/R`, `glass_*`, `light_FL/FR/RL/RR`, `mirror_L/R`; wheels as `tire_XX`, `rim_XX`, `nuts_XX`, `disc_XX`, `caliper_XX` built at the origin with the axle along X.
- Material names matter (`paint`, `carbon`, `glass`, `glass_dark`, `honeycomb`...): the game adds the scuff and crack shaders by name.
- The hard collision core, the outline boxes and the crumple-ray grids live in `src/vehicle/cars/<id>.json`, not in the model.

When the game loads a car, it bakes each mesh to the chassis frame, re-centres it on its pivot and merges everything that does not move on its own into the nearest part that does, per material.
