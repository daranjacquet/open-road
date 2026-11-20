# Tuning guide

Every car lives in `src/vehicle/cars/<id>.json` and is typed by `src/vehicle/types.ts`. Units are SI (metres, kilograms, newtons, radians) except engine speed in rpm. The car frame is +Y up, +Z forward, +X left.

Run `npm test` after a change: the headless simulations print 0-100 time, top speed, braking distance, skid-pad lateral g, high-speed drift and steering response for each car, plus keyboard-style handling runs (full-lock corners, slalom, handbrake flick, drift hold) in `tests/handling.test.ts`.

The in-game garage (`G`) edits the same values live; `src/vehicle/tuning.ts` maps its sliders to the config and holds the Drift and Track setups.

## Handling

| Value | Effect | Typical range |
| --- | --- | --- |
| `mass`, `com` | Weight and centre of mass. A higher `com.y` means more roll and weight transfer; moving `com.z` forward adds front weight (understeer). | com.y -0.15 to 0 |
| `inertiaBox` | Box (w, h, l) used for the moments of inertia. A longer box means a car that resists yawing. | |
| `suspension*.k` | Spring rate. Ride height and body motion. Natural frequency about 1.2 to 1.6 Hz for a road car. | 16000 to 50000 N/m |
| `suspension*.cBump` / `cRebound` | Damping. Rebound higher than bump keeps the body controlled. Too low gives bounce, too high gives skipping. | 1100 to 5000 |
| `suspension*.arb` | Anti-roll bar. A stiffer front bar adds understeer, a stiffer rear bar adds oversteer. | 2500 to 24000 |
| `tire.mu` | Peak grip. About the lateral g at the limit on asphalt. | 0.95 to 1.15 |
| `tire.peakSlipAngle` | Slip angle at peak lateral force. Smaller means sharper, more responsive. | 0.15 to 0.17 (tan) |
| `tire.slideRatio` | Grip left when fully sliding. Low is snappy and punishing, high is progressive and easy to drift. | 0.78 to 0.84 |
| `tire.loadSensitivity` | How much grip per newton is lost as load rises. Higher means weight transfer costs more grip. | 0.1 to 0.14 |
| `rearStiffnessScale` | Rear cornering stiffness. Above 1 makes the car stable and understeering at speed (needed for hands-off stability), below 1 makes it lively. | 1.0 to 1.14 |
| `rearGripScale` | Rear peak grip. With the steering assist the front always runs at its peak, so the rear needs a few percent more grip for the car to stay stable at the limit. | 1.04 to 1.07 |
| `tireForceHeight` | Height above the contact patch where tyre forces act. Lower means more load transfer under braking and acceleration. | 0.1 to 0.14 |
| `steering.lock` | Maximum wheel angle. | 0.55 to 0.6 rad (drift: 1.0) |
| `arcade` | Arcade grip 0..1: extra cornering force at speed, steadier grip off-road (see the README). | 0.7 (default when absent) |
| `driftAssist` | Drift assist 0..1: in a slide held on the throttle, the aids let the wheels spin, AWD goes rearward and the engine's drive pushes the car along its heading. | 0.7 (default); race car 0.15 |
| `steering.assist` | 0 to 1. At 1 the input asks the front tyres for slip angle (up to their peak) relative to where the front axle is going: full lock gives the best cornering grip at any speed, and the wheels countersteer by themselves in a slide. At 0 it is a plain rack whose lock halves at `speedRef`. | 0.8 |
| `steering.stability` | 0 to 1. When the rear slides past its peak, stop asking the front for more rotation in that direction. | 0.5 (drift: 0) |
| `steering.slideControl` | 0 to 1. Yaw damper on the rate of change of the slip angle: slides settle instead of snapping back or spinning, without limiting the angle. 0.4 on road cars, 0.8 for drifting. | 0.3 to 0.8 |
| `steering.rate` | How fast the input travels, in full-lock fractions per second. | 5 |
| `camber`, `tireWidth` | Per axle. A little negative camber adds cornering grip (best near -3.5 degrees) and costs braking and traction grip. Wider tyres add grip and stiffness. | camber 0 to -3.5 |

## Drivetrain

| Value | Effect |
| --- | --- |
| `engine.torqueCurve` | [rpm, N m] at full throttle. Defines pull. |
| `engine.launchRpm` | Where the engine flares while the clutch slips from a standstill. |
| `gearbox.ratios`, `finalDrive` | Acceleration versus top speed. The automatic uses `upshiftRpm`, `upshiftRpmLight` (light throttle), `downshiftRpm`. |
| `drive` | `FWD`, `RWD`, `AWD` (with `frontTorqueBias`). |
| `diff.lsdK`, `lsdMax` | Limited-slip coupling (N m per rad/s, cap). 0 is an open differential. |
| `brakes.torque`, `frontBias` | Total brake torque and front share. More front bias is stable, more rear bias rotates the car. |
| `aero.cdA`, `clA` | Drag area and downforce area. Drag sets top speed. |
| `aero.frontShare` | Share of the downforce on the front axle. Below the static front weight share the car gains understeer (stability) with speed, above it the rear gets light at speed. Absent: downforce at the centre of mass. |

## Damage

| Value | Effect |
| --- | --- |
| `crush[].force` | Total force (N) at which a grid of crush rays yields when fully engaged. Higher means a stiffer car and a harsher pulse. |
| `crush[].elastic` | Elastic travel (m) before the zone crushes for good: bumper foam and crash boxes that swallow parking knocks and spring back. Defaults: front and rear 8 cm, corners 6 cm, sides and roof 3 cm. |
| `crush[].origin`, `u`, `v`, `nu`, `nv`, `dir` | Where the rays start (on the hard core) and where they point. The distance to the visible shell is the available crush depth. |
| `colliders` | The hard core, also pinned in the deformation field (the passenger cell never deforms). Keep it smaller than the body by the crush depth you want. |
| `outline` | Boxes other cars' rays (and dents) can hit: the visible shell. |
| `CrushSystem.stiffening` | How much the crumple zone stiffens as it compacts (default 4.5). |
| `CrushSystem.softStart` | Strength of an untouched zone as a fraction of its full strength (default 0.85). Lower values let small knocks crush the metal. |
| `H`, `DECAY`, `WAVE` in `Deformer.ts` | Lattice spacing (10 cm), how far a dent drags the metal around it (smaller decay = wider dents), crumple wavelength (13 cm). |
| `RULES` in `PartsManager.ts` | Dent depth (m) at which each part springs open, is fully open, tears off or breaks. Glass starts cracking at 15 mm and shatters at 7 cm. |
| Capacities in `DamageModel.ts` | Energy that wrecks a zone, the engine or a wheel. |

Supercar reference (`tests/supercar.test.ts`): 0-100 km/h 2.7 s, 0-200 km/h 6.6 s, 347 km/h, 100-0 km/h in 29 m, keyboard full-lock cornering 1.37 g at 80 km/h up to 1.76 g at 220 km/h, rear never sliding more than the front.

Crash calibration (saloon, rigid wall):

| Speed | Crush | Result |
| --- | --- | --- |
| 8 km/h | 0 | No mark: the bumper absorbs it. |
| 15 km/h | about 3 cm | Small dent, nothing broken. |
| 20 km/h | about 7 cm | Light dents, lights intact. |
| 30 km/h | about 16 cm | Headlights broken, bonnet springs open. |
| 50 km/h | about 33 cm | Nose crumpled, engine damaged. |
| 70 km/h and up | to the core | Bumper torn off, engine dead. |

The visible dent follows the permanent crush (`Deformer.imprint` caps it with `CrushSystem.crushNear`), so the elastic travel never shows as a dent.
