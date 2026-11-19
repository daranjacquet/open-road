# Tuning guide

Every car lives in `src/vehicle/cars/<id>.json` and is typed by `src/vehicle/types.ts`. Units are SI (metres, kilograms, newtons, radians) except engine speed in rpm. The car frame is +Y up, +Z forward, +X left.

Run `npm test` after a change: the headless simulations print 0-100 time, top speed, braking distance, skid-pad lateral g, high-speed drift and steering response for each car.

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
| `rearGripScale` | Rear peak grip. Use with care: it also moves the limit. | 1.0 |
| `tireForceHeight` | Height above the contact patch where tyre forces act. Lower means more load transfer under braking and acceleration. | 0.1 to 0.14 |
| `steering.lock`, `speedRef` | Wheel angle at standstill, and the speed at which available lock halves. | |

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
