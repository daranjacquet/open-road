# Open Road

A browser driving sandbox built around **realistic car physics and crash damage**. A 4 km open world with mountains, country roads, a city, two circuits and places to visit, obstacles to wreck cars on, three detailed cars reworked in Blender, and an **F-16 Fighting Falcon** to fly from the airfield (afterburner, fly-by-wire, 9 g turns, Mach 1), with a flight model built surface by surface and wings, tail and gear that come off. Everything runs client-side: Three.js for rendering, Rapier (WASM) for rigid-body physics, and custom code for the tyres, drivetrain, aerodynamics, crumple zones and crash deformation.

**Play:** https://daranjacquet.github.io/open-road/

| Sport saloon (rear-biased AWD) | Off-roader (4x4) | Supercar (mid-engine, AWD) |
| --- | --- | --- |
| ![sedan](docs/sedan.jpg) | ![offroad](docs/offroad.jpg) | ![supercar](docs/supercar.jpg) |
| ![sedan rear](docs/sedan_rear.jpg) | ![offroad rear](docs/offroad_rear.jpg) | ![supercar rear](docs/supercar_rear.jpg) |

| 65 km/h into a wall: bonnet folded open, wing crumpled, engine bay exposed | 55 km/h into a pillar: the pillar's shape is pushed into the nose |
| --- | --- |
| ![wall](docs/crash-sedan-wall.jpg) | ![pillar](docs/crash-offroad-pillar.jpg) |
| **Torn-off bumper, bonnet sprung open** | **Side impact: doors pushed in and sprung, windows cracked** |
| ![bumper](docs/crash-sedan-bumper.jpg) | ![side](docs/crash-offroad-side.jpg) |
| **The SR22 (the first aircraft, now parked on the apron) climbing out** | **Pulled hard at 210 kt: both wings fold off** |
| ![aircraft](docs/aircraft.jpg) | ![wings](docs/aircraft-wings.jpg) |

## Controls

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Accelerate | `W` / `Up` | right trigger |
| Brake, then reverse | `S` / `Down` | left trigger |
| Steer | `A` `D` / `Left` `Right` | left stick |
| Handbrake (also presses the clutch) | `Space` | `A` or `X` |
| Shift up / down (manual gearbox) | `E` / `Q` | `RB` / `LB` |
| Garage (setups and settings) | `G` | |
| Turn the car in the air (pitch with W/S, roll with A/D) | `W` `S` `A` `D` while airborne | |
| Flip the car upright | `R` | `Y` |
| Repair where you are | `F` (or the on-screen button) | |
| Repair and respawn | `Shift+R` | |
| Camera (chase, hood, bumper) | `C` | `B` |
| Orbit the camera around the car / zoom | hold right mouse button and move / wheel | |
| Teleport to the next place | `T` (or the garage menu) | |
| Map (click a place to go there) | `N` | |
| Next vehicle: the cars, then the F-16 (keeps your position, attitude, speed and spin, upside down included) | `V` (or the menu) | |
| Reset the parked target cars | `B` | |
| Mute | `M` | |
| Debug overlay | `F3` | |

| Get into the aircraft (car stopped next to it) | `Enter` | `Start` |

The gearbox is automatic by default (manual in the garage). The steering is assisted: holding a direction asks the front tyres for their best grip, whatever the speed, and the wheels countersteer by themselves when the rear slides. You can turn every aid down in the garage.

### Flying the F-16

The fighter waits at the start of **runway 27** at the airfield (or teleport to *Fly the F-16*). Drive up to it and press `Enter`; press `Enter` again, stopped on the ground, to get out (your car waits beyond the left wing tip).

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Stick back (nose up) / forward (nose down) | `S` `Down` / `W` `Up` | left stick |
| Roll left / right (steers the nose wheel on the ground) | `A` `D` / `Left` `Right` | left stick |
| Rudder left / right (pivots on the spot at a standstill) | `Q` / `E` | `LB` / `RB` |
| Throttle up / down (the lever stays where you leave it; the afterburner lights past 85 %) | hold `Shift` / `Ctrl` | right / left trigger |
| Wheel brakes on the ground, air brake in the air | `Space` | `A` |
| View: chase or cockpit | `C` | `B` |
| Boosted engine (thrust x2) / stock engine (default) | `B` | |
| Arcade flight (default) / simulation | `H` | |
| Back to runway 27, repaired | `R` | `Y` |
| Repair in place | `F` | |

A take-off: full throttle with the afterburner (`Shift` held to 100 %), keep straight with `Q`/`E`, stick back from about 270 km/h; it lifts off after about 330 m (500 m at military power, 85 %) and climbs away at 20 degrees. It goes about Mach 0.95 at sea level on dry power and just past Mach 1 with the afterburner (Rapier caps every body at 400 m/s, Mach 1.18). To land, come back to **runway 09** from the west (the hills east of the airfield rise to 180 m) at about 300 km/h, power back, air brake if fast; the brakes stop it in a few hundred metres.

**Arcade flight** is on by default (`H` switches to the simulation): the stick asks for a rotation rate and the fighter turns at it, without stalling: it rolls at 250 degrees a second and holds the bank you leave it in, pulls up to 9 g at speed, and loops in a few seconds above 60 m; at a standstill on the ground the rudder keys pivot it; and flying never breaks it, however fast (only crashes do).

In the **simulation** the surfaces fly it, through a fly-by-wire law like the real one: the stick asks for a load factor (centred 1 g, full back 9 g, full forward -3 g) and the flight computer moves the all-moving tailplane to hold it, with an angle-of-attack limiter at 25 degrees. Without it, a full pull at 1,000 km/h would reach 20 g and fold the wings.

The instruments (bottom right): attitude indicator, airspeed in km/h and Mach, altitude in feet, vertical speed, heading, load factor, engine spool (N, % rpm), throttle, the afterburner light. Bottom left, a top view of the fighter shows each part that has come off.

### Garage

The sliders keep their ranges, but any value typed in a box is taken as it is, past the range too (a positive quantity such as mass or power is held at a tenth of its slider's minimum, so it never reaches zero). The top-right panel (`G`) picks the vehicle (the three cars and the SR22, taking over where you are at your speed) and changes the car live, saving the setup per car:

- **Setups**: Stock, **Drift** (RWD, welded diff, 58 degrees of lock, front camber, wider front track, soft rear grip, big handbrake, no stability aid), **Rally** (four-wheel drive with a rear bias, a mostly locked diff, soft and tall suspension, gravel tyres that keep their grip when sliding, full drift assist: slides easily on dirt or asphalt and still corners at about 1.4 g) and **Track** (stiffer and lower, wider tyres, more grip and downforce).
- **Steering**: lock, steering assist, stability assist, slide control, steering speed, **arcade grip**, **drift assist**.
- **Engine**: power, torque, rev limit. **Driveline**: FWD, RWD or AWD, AWD split, diff lock, final drive, auto or manual gearbox.
- **Suspension**: ride height, springs, dampers, anti-roll bars. **Wheels and tyres**: track width, camber, tyre width, grip, rear grip balance, grip while sliding, dirt and grass grip.
- **Engine**: raising the power also lengthens the final drive (until you set it yourself), so a stronger engine reaches a higher top speed instead of hitting the rev limiter in top gear.
- **Brakes**: power, bias, handbrake. **Chassis**: mass, weight distribution, downforce, air drag (Cd A: lower it and the car goes faster, the gearing follows). **Driving aids**: TC, ABS, ESP.

### The map

A 4 km x 4 km world with hills, a mountain range and a ring of peaks at the edge. The minimap (bottom left) turns with the car; `N` opens the whole map, where clicking a place drives you there. Driving off the edge or into the lake puts the car back on the last spot where it stood on dry ground, repaired.

- **Test area** (start): crash wall, barriers, ramps, props, a long straight that leads to the mountain pass.
- **City**: a grid of avenues and streets with raised pavements, a couple of hundred buildings that get taller towards downtown, shops on the ground floors, street trees, a central square with a fountain, the **twin towers of the World Trade Center** (417 m, the North Tower with its antenna) just south of it, a 170 m landmark tower, a **multi-storey car park you can drive up**, parks and car parks, lane markings, zebra crossings and stop lines, traffic lights that cycle, stop and speed-limit signs, and street lamps. Lamps and signs fall over when you hit them.
- **Country roads** (13 km): a **mountain pass** with hairpins and a viaduct up to a summit viewpoint at about 80 m, a lake road, a southern road past the farm and the airfield, a forest road, gravel tracks; guard rails where the ground drops away, direction signs at the junctions.
- **Rally stage** (2.6 km): from the city's north edge to the loop under the mountains, through wooded hills (70 m of climbing), asphalt and gravel in turn, timed between a START and a FINISH gantry. **Forest trail** (1.5 km): a narrow gravel track up and down the steep hills along the west edge (grades up to 20 %), for the 4x4 and rally setups, timed too. Both are on the map and in the teleports; best times are kept per car.
- **Places**: a **lake village** with a church and a harbour jetty you can drive onto, a petrol station, an **airfield** (below), a **farm** among fields, a **quarry** with jumps and dirt mounds, the **summit viewpoint**.
- **Airfield**: runway 09/27, 1,320 m by 45 m, marked like a real one (threshold stripes, runway numbers, touchdown zone, aiming points, centre line, edges), blast pads with yellow chevrons, edge, threshold, runway-end and approach lights, a **PAPI** at each end whose four lights really turn white or red with your angle above the approach, windsocks, a parallel taxiway with its centre line, blue edge lights, holding points and red runway signs, an apron with parking stands and two parked SR22s, hangars and a control tower. The approaches are clear of trees. Cars can use the runway for top-speed runs.
- **Skyscrapers that come down**: the twin towers, the landmark tower and the high-rises of 60 m and more. Their ground floor is a ring of wall sections around a core: crash into one hard enough and it caves in (the car's kinetic energy against the section's strength, the rest carrying to its neighbours): from about 60 km/h a section goes, and around 100 km/h a 70 m high-rise comes down in one hit (the twin towers take a couple of 200 km/h hits). Lose a whole side, or almost a third of the ring, and the tower falls: it breaks into pieces about 8 to 20 m across (storey slices cut into wedges around the axis, each split again halfway out, up to about 320 per tower) that lean over towards the side that gave way and come down through the city in a cloud of dust, crushing whatever is under them. The pieces of a collapse are drawn together in one batched mesh per material (a few draw calls for hundreds of pieces), and rubble that has settled turns static, so a fallen tower costs almost nothing after about ten seconds. **Fly the F-16 into one** (from about 65 kt, anywhere from 5 m up) and it breaks where it was hit: the top falls over the way the aircraft was flying, and a couple of seconds later the stump and the ground floor come down too. The aircraft does not stop dead: it flies on through the tower with the energy breaking it did not take, and through the falling blocks (except on the twin towers, `passThrough: false`). Behind the ground-floor wall is the concrete core, so a car that knocks a section in stops there instead of driving on under the tower. Each tower has a rule saying which vehicles can break it (`breakers` in `src/world/skyscrapers.ts`): all of them by default, cars only for the twin towers (the game does not stage the September 11 attacks). Rubble that has settled turns static (cars bump into it), but the aircraft knocks it loose: whatever it hits and the settled pieces within 25 m come free again, so a piece left balanced on the pile can be brought down. Teleporting anywhere puts every tower back up. The other buildings are solid.
- **Forests** of about 50,000 trees (you can hit them), thicker on the hills and mountains.
- **Ground**: grass, forest floor, fields, dirt, sand, rock and snow blended over the terrain. Close up, grass shows tufts and blades and dirt shows grain and pebbles, with relief that catches the light; from the driving seat, coarser tufts and patches of drier or lusher grass and damp earth. Dirt tracks are brown earth with two packed wheel tracks, a looser crown and grass coming through at the edges. All of it comes from one procedural texture set made at load (`src/world/groundtex.ts`).
- **Grand Prix circuit**: 2.9 km, 14 m wide, long main straight, hairpin, esses, kerbs, armco and a start gantry.
- **Drift circuit**: 2 km, 16 m wide, tight and twisty, red and white block walls.
- **Lap timer** on both circuits: a lap counts only if you went through every sector; best laps are saved per car and circuit. Stages are timed start to finish through five checkpoints (cutting a corner is fine, a shortcut voids the run).

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # Vitest: tyre model, drivetrain, headless driving, crash and flight simulations
npm run build      # typecheck + production build into dist/
npm run models     # rebuild the cars and the aircraft in Blender and compress them into public/models (needs `blender`)
```

## How it works

```
src/
  main.ts    boot only: builds the systems below and hands them to Game
  core/      fixed-step loop, Rapier setup (with the surface lookup), input, math
  vehicle/   Vehicle.ts (suspension, tyres, drivetrain, assists), SteeringController, tuning, car JSON configs;
             aircraft/ (Aircraft.ts: surfaces, propeller or jet, gear, structure, fly-by-wire; f16.json, sr22.json)
  damage/    crumple zones, dents, mechanical damage, detachable parts
  render/    scene, camera (car and aircraft views), adaptive resolution, GLB car and aircraft loaders,
             paint/glass shaders, effects, smoke
  world/     world plan (layout.ts), terrain generation (worldgen.ts, in a worker), terrain chunks,
             roads, places, airfield, city, circuits, trees, lake, minimap picture, surface raster
  game/      Game (frame loop, cars, the aircraft, actions), GameCar (one complete car), GameAircraft
             (the aircraft's model, moving controls, debris, smoke), RaceSystem and lap timer, catalogue
  audio/     procedural Web Audio
  ui/        HUD, flight instruments and garage panel
tests/       unit tests plus headless simulations of driving, handling, crashes, collisions, map
docs/        AUDIT.md (models, performance, architecture), TUNING.md, screenshots
public/models/  the exported cars and aircraft (GLB)
art/         Blender: import pipeline for third-party car models (import_car.py, inspect_model.py,
             lib/importer.py, imports/<id>.json) and for the aircraft (import_plane.py, explore_plane.py),
             model sources and .blend files
scripts/     optimize-models.mjs (meshopt compression of the Blender exports)
```

Layering, enforced by ESLint (`npm run lint`, `eslint.config.js`): `core` <- `vehicle`, `damage` (simulation, no rendering) <- `render`, `world`, `audio` <- `game` <- `ui` <- `main`. Only type-only imports may point up (damage names render's mesh types, game names the HUD and garage types). `npm run check` runs lint, types and tests; CI runs lint, tests and the build before deploying.

**Performance**: the render resolution adapts to the frame rate (pixel ratio 0.6 to 1.5; *Garage > Graphics* pins it), the physics loop does not allocate, and a crash's dent normals are recomputed under a per-frame budget. See [docs/AUDIT.md](docs/AUDIT.md) for measurements.

### Driving
- Physics steps at a fixed **120 Hz** with render interpolation, independent of frame rate.
- One Rapier rigid body per car. **Suspension is raycast**, written from scratch: spring, asymmetric damper, bump stop, anti-roll bars. Weight transfer is not scripted; it comes out of the forces.
- **Tyre model**: slip ratio and slip angle, a Magic-Formula-style curve, a combined-slip friction ellipse, load sensitivity and surface grip. A one-step stability clamp keeps it well behaved at walking speed.
- **Drivetrain**: engine torque curve, clutch slip at launch, automatic gearbox (shifts on road speed, holds the gear in wheelspin) or manual, open or limited-slip differential, brake bias, handbrake with clutch, drag and downforce.
- **Arcade layer, each on a slider**: steering assist (the input asks for front slip angle relative to where the front axle is going, so full lock never ploughs and the wheels countersteer in a slide), stability assist (unwinds the steering when the rear slides) and slide control (a damper on how fast the slip angle changes, not on how far it can go, so slides settle instead of snapping).
- **Arcade grip** (garage slider, 70 % by default): a sideways force at the centre of mass worth a share of what the tyres give (15 % at low speed, up to 57 % above 140 km/h), so the car turns in at speed instead of ploughing without changing its balance (the saloon goes from 1.0 to 1.5 g at 150 km/h); a little more front grip below 100 km/h; dirt and grass keep their grip once sliding.
- **Drift assist** (garage slider; 70 % on the saloon and the 4x4, 15 % on the supercar, which stays planted like a race car): with the throttle held in a slide, the aids let the wheels spin, four-wheel drive sends its torque to the rear, and a share of the engine's drive pushes the car along its heading while its path bends towards where it points. More power means more push, so the throttle holds and steers the drift.
- Aids: traction control, ABS and a yaw-rate ESP. In a slide held on the throttle (5 to 35 degrees) they let the wheels spin and step in only gently; past that they act fully.
- Every car is a JSON file in `src/vehicle/cars/`. See [docs/TUNING.md](docs/TUNING.md) for what each value does.

### Cars and models
The three cars are hand-made models from Sketchfab (CC BY 4.0, see [CREDITS.md](CREDITS.md)), reworked for crashes by a Blender pipeline (`art/import_car.py`, one mapping per car in `art/imports/`):

- **Rally saloon** (Evo-style 90s four-door, wing and bonnet scoop): Thunderbolt '96 by Daniel Zhabotinsky, 19k triangles.
- **Off-roader**: Bokaroo '67 by Daniel Zhabotinsky, 28k triangles.
- **Supercar**: V12 Goblin by ollitei, 66k triangles.
- The pipeline orients and scales each model, removes badges, cuts it into the crash parts (doors, bonnet, boot or engine cover, bumpers, every glass pane, lights, mirrors) with their hinges, rebuilds the wheels around their hubs, keeps the original textures (resized, WebP) under the material names the game reacts to, and places the chassis origin where the suspension expects it.
- `scripts/fit-car-config.mjs` then fits the physics geometry to the model (wheel positions and size, the hard core, the outline and the crumple-ray grids), keeping every handling value.
- 30 to 43 meshes per car (the old procedural cars had about 100) and 1.4 to 1.5 MB per car with textures.

### Flight
The F-16 is one Rapier rigid body whose mass (12,160 kg, about the real one with half its fuel), centre of mass and inertia come from nine boxes laid over the model (nose and cockpit, centre fuselage, engine, two boxes per wing, tailplane, fin). Nothing about its handling is scripted: it comes out of where the lifting surfaces sit, and the controller only asks for rates or g.

- **Six lifting surfaces** (inner and outer panel of each wing, the stabilator, the fin) placed on the model's measured planform: 27.8 m2 of wing (F-16: 27.87), the stabilators 5.9 m2 and the fin 5.1 m2. Each works out its own airflow every 120 Hz step, the body's rotation included (so it damps itself), then its angle of attack, a lift curve that is linear up to the stall and blends into a flat plate's past it, profile and induced drag, and its pitching moment. Downwash from the wing reaches the tailplane. The centre of mass sits at about 30 % of the mean chord, statically stable by about 0.46 m.
- **Engine**: a turbofan of 76 kN dry and 127 kN with the afterburner (F100-PW-229: 79 and 129 kN), whose rpm spools up in a couple of seconds; the drag rises 4.4 times through Mach 0.85 to 1.05 (wave drag); the air brake adds 1.2 m2 of drag area.
- **Controls**: flaperons on the inner panels for the roll, the whole tailplane (a stabilator) for the pitch, the rudder; they move at the rate of real actuators. The arcade controller pushes with the aircraft's inertia about its own axes (Rapier gives it in its principal frame, whose axes can come in any order).
- **Ground effect**: within a span of the ground the wing gets a little more lift and much less induced drag.
- **Gear**: three raycast struts (spring, damper, bump stop) with tyres, rolling resistance, brakes on the mains and a nose wheel steered by the rudder and the roll keys, less at speed; 16 % of the weight on the nose wheel.
- **Numbers** (measured by `tests/f16.test.ts`): lift-off within 450 m with the afterburner and 650 m at military power, top speed Mach 0.85 to 1.0 dry and 1.0 to 1.15 with the afterburner at sea level, roll rate 200 to 300 degrees a second, full pull 7.5 to 10.5 g with nothing breaking, in the arcade and in the simulation. The SR22's flight model (`sr22.json`) is still there and still tested (`tests/aircraft.test.ts`); the two parked on the apron use its boxes.
- **Damage**: parts take impacts (contact forces from Rapier, summed as impulse) and a wing, the tailplane or the fin tears off past its strength; a gear leg that meets the ground faster than 4 m/s collapses; hits on the engine cut its power until it stops and smokes; a main gear leg, mounted in its wing, goes with the wing, and so does the wingtip light. In the simulation a wing pulled past 13.5 g folds (the fly-by-wire stops short of it). A part that comes off leaves with its mass (the balance shifts), its lift (a missing wing rolls the aircraft over), and flies on as its own body with the velocity it had.

### Crash damage
Full soft-body simulation (BeamNG style) is too heavy for a browser, so damage is split in two:

1. **Crumple zones (physics).** Each car has a small hard core (the rigid body Rapier solves) and 320 to 380 *crush rays* fired outwards through the visible shell. A ray that meets an obstacle pushes back like a plastic spring: the force ramps up, saturates, then the zone yields for good. Crash pulses last tens of milliseconds instead of one frame, and the absorbed energy drives the mechanical damage. The rays see everything solid, the terrain and the road decks included, so a car **rolling over, landing on its nose or sliding on its roof** crushes like one hitting a wall.
2. **Passenger cell fitted to the model.** The upper part of the hard core is not a box: at load, the greenhouse of each car is probed from several points inside it (a fast grid over the shell's triangles) and the core is a convex hull kept 13 to 24 cm inside the real roof, pillars, windscreen and side glass, shrink-wrapped until it clears the shell everywhere. About 170 to 260 rays fan out from it, with a strength per face (roof, sides, pillars) set in multiples of the car's weight: a car resting on its roof holds, a 70 km/h rollover folds the roof in by 5 to 15 cm, cracks the pillars and bursts the glass. Fans of rays over the bonnet and the boot cover the overhangs.
3. **Deformation field (visuals).** A 10 cm lattice covers the car. Whenever the crumple zones yield, lattice nodes that ended up inside the obstacle (or past the surface of the ground) are pushed back out to its surface along the crush direction, so the car takes the **imprint of what it hit**: a pillar leaves a V, a wall flattens the nose, the ground flattens a roof edge, another car leaves its shape (capped to what the crumple zone really took). A screened Laplace relaxation drags the surrounding metal along; only the hard core stays pinned.
4. **Crumpling.** Where the field squeezes a panel in its own plane, the sheet has to fold because its length is conserved. Each vertex gets a wrinkle whose amplitude follows from the local compression, which gives accordion bonnets and rippled wings instead of a shrunken car.
5. **Glass and sparks.** Windows crack in a spider web around the deepest point before they shatter. Metal sliding over the ground or a wall throws sparks on hard ground. The paint stays on, however bad the dents.
6. **Mechanical damage.** Energy absorbed near the engine bay, a wheel or a body zone becomes power loss, bent wheels (toe pulls the car sideways), softer suspension, less grip and flat tyres. Hard landings bend them too: a corner that hits its bump stop faster than 5.5 m/s (a drop of about 2.5 m) takes damage, a drop of 8 m wrecks it. The HUD shows each zone by the energy it took or the depth it folded, whichever is worse.
7. **Parts.** The bonnet, boot and doors spring open, then tear off as rigid bodies that keep their dents. Bumpers, lights, mirrors and glass break by how far they have been dented. Front wheels come off in the hardest hits.

Everything is deterministic: the same crash gives the same damage.

## Measured performance

Measured on a Mac with a 120 Hz display (production build, Chromium in the Claude desktop app, frames driven at 60 Hz with a GPU sync), with the player car, two parked cars and all props:

| Metric | Result |
| --- | --- |
| Frame time while driving | 6.5 to 8 ms (GPU), 2.7 to 3.5 ms of CPU, depending on the place |
| Physics + vehicles | 0.05 to 0.3 ms per 120 Hz step for 3 cars |
| Crash frame | 10 to 13 ms for the worst frame of a warm 70 km/h wall crash |
| Draw calls | 250 to 450 (city and test area are the busiest) |
| Triangles | 450k to 650k |
| Loading | about 0.9 s from scripts to the first frame (the world is built in a worker meanwhile) |
| Download | 325 kB app + 111 kB world worker + 680 kB three + 4.3 MB Rapier + the cars on screen (meshopt); the F-16 (1.9 MB) and the parked SR22 (1 MB) load after the first frame |

I have not measured on a modest PC; the render resolution adapts to the frame rate. See [docs/AUDIT.md](docs/AUDIT.md) for the details.

## Known limits

- **Not a soft-body.** The car does not bend as a structure: the deformation field shapes the panels, the rigid body keeps its mass and inertia, and the hard core inside the passenger cell never deforms (the roof and pillars around it do).
- **Very hard hits bottom out.** At 100 km/h into a wall the crumple depth runs out and the rigid core stops the car abruptly (peak deceleration well above real life).
- **Car vs car is approximate.** Each car sees the other's undeformed outline (a box for the lower body, a hull of the greenhouse); dents are capped by its own crush, so impacts look plausible but not exact.
- **Wheels are rays.** A tyre does not hit a kerb sideways: a car sliding into a kerb rides over it rather than tripping on it. Spoilers and roof racks bend with the panels around them, not on their own.
- **Cars are reworked third-party models** (see `CREDITS.md`): crash parts are cut out of a single body by boxes, so panel edges follow straight cuts, not the real shut lines.
- **Handling was tuned with headless simulations**, not by a human driver: full-lock corners from 60 to 180 km/h, slaloms, handbrake flicks and a keyboard-style drifter that only presses keys fully (`tests/handling.test.ts`).
- **Falling towers** break along fixed storey and quarter cuts into big blocks (30 m on the twin towers), not into rubble; the blocks stay where they land until you teleport.
- **World.** No traffic and no pedestrians. The whole world is built at load (terrain in a worker, about 1 s in all); no streaming. Trees and the terrain far away use simpler models.
- **Aircraft**: no wind or turbulence, no fuel, no weapons, no engine failures other than impact damage, no thrust lapse with speed or height, and no spin model beyond what the surfaces give. The real F-16 is statically unstable and flies only through its computer; this one is stable, with a simpler fly-by-wire law. The gear does not retract and the wheels do not turn visibly. Rapier caps speeds at 400 m/s (Mach 1.18), so it never reaches its real Mach 2. The fuselage itself never breaks: wings, tail and gear do. An aircraft brings the skyscrapers down, except the twin towers (only cars can). Runway 27 cannot be approached from the east: the hills are in the way.
- **Flight handling** was tuned with headless test flights (takeoff, climb, cruise, stall, a 3-degree approach and landing, overload, hard landing), not by a human pilot.
- Skid marks only on asphalt. Audio is synthesised and simple.

## License

Code: MIT. Car and aircraft models: CC BY 4.0 by their authors, see [CREDITS.md](CREDITS.md).
