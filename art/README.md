# Art pipeline

The prompt asked for Blender-generated models. **Blender was not installed on the machine that built this project**, so the cars are generated in TypeScript instead (`src/render/car/`). They follow the conventions below so a Blender pipeline can replace them without touching the game code.

## What the game needs from a car model

Part names (meshes, origin at the part's pivot or fixation point, expressed in the chassis frame):

`body`, `hood`, `trunk`, `door_FL`, `door_FR` (and `door_RL`, `door_RR` for four-door cars), `bumper_F`, `bumper_R`, `glass_front`, `glass_rear`, `glass_L`, `glass_R`, `light_FL/FR/RL/RR`, `mirror_L`, `mirror_R`, `interior`, plus four wheels (a pivot group that steers, containing a spin group).

Rules:

- +Y up, +Z forward, +X left, 1 unit = 1 m, scale applied.
- Body panels dense enough to dent: about 20 to 40k triangles in total for the shell (the generated cars have about 37k).
- Panels share vertices along their borders when pristine; the game darkens border vertices to draw panel gaps.
- The hard collision core and the crush ray grids live in the car's JSON, not in the model (`colliders`, `outline`, `crush`).
- Materials: simple PBR (clear-coated paint, glass, chrome).

## Using Blender later

1. Install Blender and check `blender --version`.
2. Write a parametric `bpy` script in `art/` that builds the panels above and exports GLB (`blender -b -P art/car.py`).
3. Load the GLB in place of `generateCar()` and map it to the `CarModel` interface in `src/render/carModel.ts` (wheel pivots, `parts` map, a `probe` function that raycasts the shell from the inside).

No untested `bpy` script is shipped here on purpose.
