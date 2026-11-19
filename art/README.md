# Art pipeline (Blender)

The cars are built in **Blender 5.x** by a parametric Python script and exported as GLB. The game loads the GLBs from `public/models/`.

```bash
npm run models                      # all three cars
blender -b --factory-startup -P art/build_cars.py -- --only sport   # one car
```

Files:

- `art/specs.py`: body keyframes (length profile, belt line, roof, widths, wheel arches), panel rules and extras for each car. Edit and re-run to reshape a car.
- `art/carlib.py`: loft along Z with a B-spline cross-section, smooth normals, helpers (runs in Blender's Python with numpy).
- `art/build_cars.py`: builds the shell (about 37k triangles), splits it into panels, adds lights, mirrors, exhausts, wheels and an interior block, saves `art/blend/<car>.blend` and exports `public/models/<car>.glb`.
- `art/blend/*.blend`: the generated scenes, for inspection or hand editing.

Wheel sizes come from `src/vehicle/cars/<car>.json`, so the model always matches the physics.

## What the game needs from a car model

Part names (meshes; each part's origin sits at its hinge or fixation point, in the chassis frame):

`body`, `hood`, `trunk`, `door_FL`, `door_FR`, `bumper_F`, `bumper_R`, `glass_front`, `glass_rear`, `glass_L`, `glass_R`, `light_FL/FR/RL/RR`, `mirror_L`, `mirror_R`, `interior`, plus per wheel `tire_XX`, `rim_XX`, `disc_XX` (XX = FL, FR, RL, RR) built around the hub at the origin with the axle along X. Extras (exhausts, wing, splitter, grille) are parented to the panel they ride on, so they follow it when it dents or detaches.

Rules:

- +Y up, +Z forward, +X left, 1 unit = 1 m, scale applied. (The script builds in this frame and converts to Blender's Z-up; the glTF exporter converts back.)
- Shell panels dense enough to dent: about 20 to 40k triangles in total.
- Panels share vertices along their borders when pristine. Border vertices get a darker vertex colour (`Col`) so panel gaps read as seams. The game ignores material colours from the GLB except the paint colour of `body`; it re-skins parts by name.
- The hard collision core and the crumple-ray grids live in the car's JSON (`colliders`, `outline`, `crush`), not in the model.

## Fallback

`src/render/car/generator.ts` is a TypeScript port of the same generator. It produces the same parts and is used when a GLB is missing or fails to load. `tests/glb.test.ts` checks that both give the same panels, triangle counts, pivots and bounds.
