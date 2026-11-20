/**
 * Vehicle configuration. All cars are plain JSON files that satisfy this interface.
 *
 * Local car frame (also the glTF / Three.js convention):
 *   +Y up, +Z forward, +X LEFT (so the right-hand side is -X).
 * Units: metres, kilograms, seconds, newtons, radians (rpm for engine speed).
 */
export type Drive = 'FWD' | 'RWD' | 'AWD';
export type Vec3 = [number, number, number];

export interface TireParams {
  /** Peak friction coefficient at `refLoad` on asphalt. */
  mu: number;
  /** Vertical load (N) at which `mu` applies. */
  refLoad: number;
  /** Fraction of mu lost per +100 % of load above refLoad (load sensitivity). */
  loadSensitivity: number;
  /** Slip ratio at peak longitudinal force (typical 0.10 to 0.16). */
  peakSlipRatio: number;
  /** tan(slip angle) at peak lateral force (typical 0.12 to 0.18). */
  peakSlipAngle: number;
  /** Grip at full slide relative to the peak, 0.7 (snappy loss) to 0.95 (progressive). */
  slideRatio: number;
  /** Longitudinal peak grip relative to lateral. */
  longGripRatio: number;
  /** Rolling resistance coefficient on asphalt. */
  rollingResistance: number;
  /** Grip multiplier on loose surfaces (dirt, grass): all-terrain tyres > 1. */
  looseGrip?: number;
}

export interface AxleSuspension {
  /** Spring rate (N/m) at the wheel. */
  k: number;
  /** Damping in compression / rebound (N s/m). */
  cBump: number;
  cRebound: number;
  /** Anti-roll bar stiffness (N per m of left/right compression difference). */
  arb: number;
  /** Spring length at full droop (m), from the mount to the wheel centre. */
  maxLen: number;
  /** Length at full bump (m). */
  minLen: number;
}

export interface EngineConfig {
  idleRpm: number;
  redlineRpm: number;
  /** [rpm, N m] at full throttle. */
  torqueCurve: [number, number][];
  /** Engine braking torque (N m) at redline with the throttle closed. */
  engineBrake: number;
  /** Crankshaft + flywheel inertia (kg m^2). */
  inertia: number;
  /** RPM the engine flares to while the clutch slips at launch. */
  launchRpm: number;
}

export interface GearboxConfig {
  /** Forward ratios, first gear first. */
  ratios: number[];
  reverse: number;
  finalDrive: number;
  efficiency: number;
  shiftTime: number;
  /** Upshift rpm at full throttle / light throttle. */
  upshiftRpm: number;
  upshiftRpmLight: number;
  downshiftRpm: number;
}

export interface CarPartConfig {
  /** Name of the part in the model (see art conventions). */
  name: string;
  /** Mass in kg once detached. */
  mass: number;
  /** Local anchor on the chassis (metres). */
  anchor: Vec3;
  /** Half extents of the collider used when detached. */
  half: Vec3;
  /** Accumulated damage (0..1) at which the part comes off. */
  detachAt: number;
}

/**
 * A rectangular grid of "crush rays" fired outwards from the hard core of the car.
 * Rays + plasticity are the crumple zones: they give soft, long crash pulses and the damage field.
 */
export interface CrushGrid {
  kind: 'front' | 'rear' | 'left' | 'right' | 'roof' | 'corner';
  /** Grid centre on the core surface (chassis frame). */
  origin: Vec3;
  /** Half extents of the grid along its two axes. */
  u: Vec3;
  v: Vec3;
  nu: number;
  nv: number;
  /** Outward direction (need not be normalised). */
  dir: Vec3;
  /** Force (N) when the whole grid is engaged; shared between its rays. */
  force: number;
  /**
   * Elastic travel (m) before the zone starts to crush for good: bumper foam and crash boxes that
   * swallow parking knocks. Defaults per kind (front/rear 8 cm, corner 6 cm, sides and roof 3 cm).
   */
  elastic?: number;
}

/** Arcade handling when a car does not set it. */
export const DEFAULT_ARCADE = 0.7;

export interface VehicleConfig {
  name: string;
  drive: Drive;
  /** Share of drive torque sent to the front axle when AWD. */
  frontTorqueBias: number;
  mass: number;
  /** Centre of mass relative to the body origin. */
  com: Vec3;
  /** Box (w, h, l) used to derive the principal inertia. */
  inertiaBox: Vec3;
  /** Visible-shell boxes (what other cars' crumple rays can hit). */
  outline: { center: Vec3; half: Vec3 }[];
  /** Crumple-zone ray grids (damage milestone). */
  crush: CrushGrid[];
  /** Compound chassis colliders: the HARD CORE, smaller than the visible body by the crush depths. */
  colliders: { center: Vec3; half: Vec3 }[];
  /** Suspension mount points (top of spring), local space. */
  wheels: { FL: Vec3; FR: Vec3; RL: Vec3; RR: Vec3 };
  wheel: { radius: number; width: number; inertia: number };
  suspensionFront: AxleSuspension;
  suspensionRear: AxleSuspension;
  tire: TireParams;
  /** Rear tyre peak grip multiplier (balance tuning). */
  rearGripScale: number;
  /**
   * Arcade handling, 0..1 (default `DEFAULT_ARCADE`): extra cornering grip (more at the front and
   * at speed, so the car turns in instead of ploughing), steadier grip on dirt and grass once
   * sliding, and a push along the car's heading when the throttle is held in a slide, so a drift
   * can be driven out on the throttle.
   */
  arcade?: number;
  /** Rear cornering stiffness multiplier: >1 = more stable/understeering, <1 = lively rear. */
  rearStiffnessScale: number;
  /** Height above the contact patch where tyre forces are applied (m). Controls load transfer feel. */
  tireForceHeight: number;
  steering: {
    /** Max wheel angle (rad). */
    lock: number;
    /** Without assist: speed (m/s) at which the available lock is divided by 2. */
    speedRef: number;
    /** How fast the driver's input travels, in full-lock fractions per second. */
    rate: number;
    /**
     * Steering assist, 0..1. At 1 the stick asks for front-tyre slip angle (up to the tyre's peak)
     * relative to where the front axle is actually going, so the car never ploughs on full lock
     * and the wheels countersteer by themselves in a slide. At 0 it is a plain speed-sensitive rack.
     */
    assist: number;
    /**
     * Stability assist, 0..1: when the rear slides past its grip peak, the steering stops asking
     * the front tyres for more rotation in the same direction. 0 for drifting.
     */
    stability?: number;
    /**
     * Slide control, 0..1: damps how fast the slip angle swings (not how far it can go), so a
     * slide or a drift settles instead of snapping back or spinning. An arcade aid.
     */
    slideControl?: number;
  };
  brakes: {
    /** Total brake torque at the wheels (N m). */
    torque: number;
    frontBias: number;
    handbrakeTorque: number;
  };
  engine: EngineConfig;
  gearbox: GearboxConfig;
  diff: {
    /** Limited-slip coupling stiffness (N m per rad/s) and cap (N m). 0 = open diff. */
    lsdK: number;
    lsdMax: number;
  };
  aero: {
    /** Drag area Cd*A (m^2) and lift area Cl*A (positive = downforce). */
    cdA: number;
    clA: number;
    /** Share of the downforce on the front axle (aero balance). Absent: applied at the centre of mass. */
    frontShare?: number;
  };
  /** Static camber per axle (degrees, negative = top of the wheel leans in). */
  camber?: { front: number; rear: number };
  /** Tyre section width per axle (m). Defaults to wheel.width. */
  tireWidth?: { front: number; rear: number };
  /** Detachable parts (damage milestone). */
  parts?: CarPartConfig[];
}
