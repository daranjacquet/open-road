import { clamp, interpTable, smoothstep } from '../core/math';
import type { Drive, VehicleConfig } from './types';

/**
 * Garage setup, in the units a player thinks in. `stockTune(cfg)` reads a car's factory setup,
 * `applyTune(cfg, tune)` builds the VehicleConfig the physics runs on.
 */
export interface Tune {
  // Steering
  /** Max wheel angle (deg). */
  steerLock: number;
  /** Steering assist (%): 100 = the stick asks for front grip and the wheels countersteer by themselves. */
  steerAssist: number;
  /** Stability assist (%): unwinds the steering when the rear slides. 0 for drifting. */
  stability: number;
  /** Slide control (%): damps how fast a slide swings, so drifts settle instead of snapping. */
  slideControl: number;
  /** Steering speed (x). */
  steerSpeed: number;
  // Engine
  /** Peak power (hp). */
  power: number;
  /** Peak torque (N m). */
  torque: number;
  /** Rev limit (rpm). */
  redline: number;
  // Driveline
  drive: Drive;
  /** AWD share to the front axle (%). */
  frontBias: number;
  /** Limited-slip differential lock (%): 0 open, 100 welded. */
  diffLock: number;
  finalDrive: number;
  gearbox: 'auto' | 'manual';
  // Suspension
  /** Ride height change (cm). */
  rideHeight: number;
  /** Spring rates (N/mm). */
  springFront: number;
  springRear: number;
  /** Damper strength (x). */
  damping: number;
  /** Anti-roll bars (N/mm). */
  arbFront: number;
  arbRear: number;
  // Wheels and tyres
  /** Extra track width (cm, both sides together). */
  trackFront: number;
  trackRear: number;
  /** Static camber (deg, negative = top leans in). */
  camberFront: number;
  camberRear: number;
  /** Tyre width (mm). */
  tireFront: number;
  tireRear: number;
  /** Tyre compound grip (x). */
  grip: number;
  /** Rear grip balance (x): below 1 the rear lets go first. */
  rearGrip: number;
  /** How much grip is left once sliding (%): high = progressive and easy to hold a slide. */
  slideGrip: number;
  // Brakes
  /** Brake power (x). */
  brakes: number;
  /** Front brake share (%). */
  brakeBias: number;
  /** Handbrake power (x). */
  handbrake: number;
  // Chassis
  mass: number;
  /** Weight on the front axle (%). */
  weightFront: number;
  /** Downforce area Cl*A (m^2). */
  downforce: number;
  // Aids
  tc: boolean;
  abs: boolean;
  esp: boolean;
}

export type TuneKey = keyof Tune;

const HP = 745.7;
const RPM_TO_RADS = (2 * Math.PI) / 60;

/** Peak torque (N m) and peak power (W) of a torque curve up to the rev limit. */
export function curvePeaks(curve: [number, number][], redline: number): { torque: number; power: number; torqueRpm: number; powerRpm: number } {
  let torque = 0;
  let power = 0;
  let torqueRpm = 0;
  let powerRpm = 0;
  for (let rpm = 500; rpm <= redline; rpm += 25) {
    const t = interpTable(curve, rpm);
    const p = t * rpm * RPM_TO_RADS;
    if (t > torque) {
      torque = t;
      torqueRpm = rpm;
    }
    if (p > power) {
      power = p;
      powerRpm = rpm;
    }
  }
  return { torque, power, torqueRpm, powerRpm };
}

export function stockTune(cfg: VehicleConfig): Tune {
  const pk = curvePeaks(cfg.engine.torqueCurve, cfg.engine.redlineRpm);
  const L = cfg.wheels.FL[2] - cfg.wheels.RL[2];
  const width = cfg.tireWidth ?? { front: cfg.wheel.width, rear: cfg.wheel.width };
  return {
    steerLock: round((cfg.steering.lock * 180) / Math.PI, 1),
    steerAssist: Math.round(cfg.steering.assist * 100),
    stability: Math.round((cfg.steering.stability ?? 0) * 100),
    slideControl: Math.round((cfg.steering.slideControl ?? 0) * 100),
    steerSpeed: 1,
    power: Math.round(pk.power / HP),
    torque: Math.round(pk.torque),
    redline: cfg.engine.redlineRpm,
    drive: cfg.drive,
    frontBias: Math.round(cfg.frontTorqueBias * 100),
    diffLock: Math.round(clamp(cfg.diff.lsdMax / 5000, 0, 1) * 100),
    finalDrive: cfg.gearbox.finalDrive,
    gearbox: 'auto',
    rideHeight: 0,
    springFront: round(cfg.suspensionFront.k / 1000, 1),
    springRear: round(cfg.suspensionRear.k / 1000, 1),
    damping: 1,
    arbFront: round(cfg.suspensionFront.arb / 1000, 1),
    arbRear: round(cfg.suspensionRear.arb / 1000, 1),
    trackFront: 0,
    trackRear: 0,
    camberFront: cfg.camber?.front ?? 0,
    camberRear: cfg.camber?.rear ?? 0,
    tireFront: Math.round(width.front * 1000),
    tireRear: Math.round(width.rear * 1000),
    grip: 1,
    rearGrip: 1,
    slideGrip: Math.round(cfg.tire.slideRatio * 100),
    brakes: 1,
    brakeBias: Math.round(cfg.brakes.frontBias * 100),
    handbrake: 1,
    mass: cfg.mass,
    weightFront: round(((cfg.com[2] - cfg.wheels.RL[2]) / L) * 100, 1),
    downforce: cfg.aero.clA,
    tc: true,
    abs: true,
    esp: true,
  };
}

function round(v: number, digits: number): number {
  const k = 10 ** digits;
  return Math.round(v * k) / k;
}

/** Engine curve reshaped to a target peak torque (low and mid range) and peak power (top end). */
export function reshapeCurve(base: VehicleConfig['engine'], torque: number, powerHp: number, redline: number): [number, number][] {
  const stretch = redline / base.redlineRpm;
  const stretched = base.torqueCurve.map(([r, t]) => [r * stretch, t] as [number, number]);
  const pk = curvePeaks(stretched, redline);
  const sLow = torque / Math.max(pk.torque, 1);
  const r0 = pk.torqueRpm;
  const r1 = Math.max(pk.powerRpm, r0 + 500);
  const shaped = (sHigh: number): [number, number][] =>
    stretched.map(([r, t]) => [r, t * (sLow + (sHigh - sLow) * smoothstep(r0, r1, r))] as [number, number]);
  // The top-end scale that gives the asked-for peak power (power is monotonic in it).
  let sHigh = sLow;
  for (let i = 0; i < 6; i++) {
    const p = curvePeaks(shaped(sHigh), redline).power;
    sHigh = clamp(sHigh * ((powerHp * HP) / Math.max(p, 1)), 0.2, 6);
  }
  return shaped(sHigh);
}

/** Build the physics configuration for a setup. `base` is never modified. */
export function applyTune(base: VehicleConfig, t: Tune): VehicleConfig {
  const cfg: VehicleConfig = structuredClone(base);
  const stock = stockTune(base);

  cfg.steering.lock = (t.steerLock * Math.PI) / 180;
  cfg.steering.assist = clamp(t.steerAssist / 100, 0, 1);
  cfg.steering.stability = clamp(t.stability / 100, 0, 1);
  cfg.steering.slideControl = clamp(t.slideControl / 100, 0, 1);
  cfg.steering.rate = base.steering.rate * t.steerSpeed;

  if (t.power !== stock.power || t.torque !== stock.torque || t.redline !== stock.redline) {
    const e = cfg.engine;
    const k = t.redline / base.engine.redlineRpm;
    e.torqueCurve = reshapeCurve(base.engine, t.torque, t.power, t.redline);
    e.redlineRpm = t.redline;
    e.launchRpm = base.engine.launchRpm * k;
    cfg.gearbox.upshiftRpm = base.gearbox.upshiftRpm * k;
    cfg.gearbox.upshiftRpmLight = base.gearbox.upshiftRpmLight * k;
    cfg.gearbox.downshiftRpm = base.gearbox.downshiftRpm * k;
  }

  cfg.drive = t.drive;
  cfg.frontTorqueBias = clamp(t.frontBias / 100, 0.05, 0.95);
  if (t.diffLock !== stock.diffLock) {
    const lock = clamp(t.diffLock / 100, 0, 1);
    cfg.diff.lsdK = 40 + 460 * lock;
    cfg.diff.lsdMax = 5000 * lock;
  }
  cfg.gearbox.finalDrive = t.finalDrive;

  const dh = t.rideHeight / 100;
  for (const [s, k, arb] of [
    [cfg.suspensionFront, t.springFront, t.arbFront],
    [cfg.suspensionRear, t.springRear, t.arbRear],
  ] as const) {
    const baseS = s === cfg.suspensionFront ? base.suspensionFront : base.suspensionRear;
    const kScale = (k * 1000) / baseS.k;
    s.k = k * 1000;
    s.arb = arb * 1000;
    // Dampers follow the spring (same damping ratio), times the damping knob.
    const c = Math.sqrt(kScale) * t.damping;
    s.cBump = baseS.cBump * c;
    s.cRebound = baseS.cRebound * c;
    s.maxLen = Math.max(baseS.maxLen + dh, 0.1);
    s.minLen = clamp(baseS.minLen + dh, 0.02, s.maxLen - 0.06);
  }

  const wf = t.trackFront / 200;
  const wr = t.trackRear / 200;
  cfg.wheels.FL = [base.wheels.FL[0] + wf, base.wheels.FL[1], base.wheels.FL[2]];
  cfg.wheels.FR = [base.wheels.FR[0] - wf, base.wheels.FR[1], base.wheels.FR[2]];
  cfg.wheels.RL = [base.wheels.RL[0] + wr, base.wheels.RL[1], base.wheels.RL[2]];
  cfg.wheels.RR = [base.wheels.RR[0] - wr, base.wheels.RR[1], base.wheels.RR[2]];
  cfg.camber = { front: t.camberFront, rear: t.camberRear };
  cfg.tireWidth = { front: t.tireFront / 1000, rear: t.tireRear / 1000 };
  cfg.tire.mu = base.tire.mu * t.grip;
  cfg.rearGripScale = base.rearGripScale * t.rearGrip;
  cfg.tire.slideRatio = clamp(t.slideGrip / 100, 0.6, 0.97);

  cfg.brakes.torque = base.brakes.torque * t.brakes;
  cfg.brakes.frontBias = clamp(t.brakeBias / 100, 0.3, 0.85);
  cfg.brakes.handbrakeTorque = base.brakes.handbrakeTorque * t.handbrake;

  cfg.mass = t.mass;
  const L = cfg.wheels.FL[2] - cfg.wheels.RL[2];
  if (t.weightFront !== stock.weightFront) cfg.com = [base.com[0], base.com[1], cfg.wheels.RL[2] + (clamp(t.weightFront, 30, 70) / 100) * L];
  cfg.aero.clA = t.downforce;
  return cfg;
}

/** Ready-made setups, built from the car's factory setup. */
export const PRESETS: Record<string, (stock: Tune) => Tune> = {
  Stock: (s) => ({ ...s }),
  Drift: (s) => ({
    ...s,
    steerLock: 58,
    steerAssist: 90,
    stability: 0,
    slideControl: 80,
    steerSpeed: 1.4,
    power: Math.round(s.power * 1.3),
    torque: Math.round(s.torque * 1.25),
    drive: 'RWD',
    diffLock: 100,
    rideHeight: -3,
    springFront: Math.round(s.springFront * 1.3),
    springRear: Math.round(s.springRear * 1.2),
    damping: 1.15,
    arbFront: Math.round(s.arbFront * 1.4),
    arbRear: Math.round(s.arbRear * 0.6),
    trackFront: 6,
    trackRear: 3,
    camberFront: -5,
    camberRear: -1,
    tireFront: s.tireFront + 10,
    tireRear: s.tireRear,
    grip: 1,
    rearGrip: 0.9,
    slideGrip: 92,
    brakeBias: 62,
    handbrake: 2.5,
    weightFront: 51,
    downforce: 0,
    tc: false,
    abs: true,
    esp: false,
  }),
  Track: (s) => ({
    ...s,
    steerAssist: 75,
    stability: 40,
    slideControl: 30,
    power: Math.round(s.power * 1.15),
    torque: Math.round(s.torque * 1.1),
    diffLock: 55,
    rideHeight: -3,
    springFront: Math.round(s.springFront * 1.4),
    springRear: Math.round(s.springRear * 1.4),
    damping: 1.2,
    arbFront: Math.round(s.arbFront * 1.3),
    arbRear: Math.round(s.arbRear * 1.25),
    trackFront: 2,
    trackRear: 2,
    camberFront: -2.5,
    camberRear: -1.5,
    tireFront: s.tireFront + 20,
    tireRear: s.tireRear + 20,
    grip: 1.1,
    brakes: 1.2,
    downforce: s.downforce + 1.0,
    esp: false,
  }),
};
