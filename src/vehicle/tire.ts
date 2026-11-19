import { clamp } from '../core/math';
import type { TireParams } from './types';

export interface TireOut {
  /** Longitudinal force on the car (N), positive = forward along the wheel heading. */
  fx: number;
  /** Lateral force on the car (N), positive = towards the car's LEFT (+X). */
  fy: number;
}

/**
 * Normalised friction curve g(s): 0 at s = 0, exactly 1 at s = 1 (the peak) and
 * falling to `slideRatio` for large s. It is a Magic-Formula-style
 * sin(C * atan(B * s)) with C and B derived from `slideRatio`, so a tuner only
 * thinks in "how much grip is left when fully sliding".
 */
export function frictionCurve(s: number, slideRatio: number): number {
  const r = clamp(slideRatio, 0.5, 0.99);
  const C = 2 - (2 * Math.asin(r)) / Math.PI; // sin(C*pi/2) = r
  const B = Math.tan(Math.PI / (2 * C)); // peak exactly at s = 1
  return Math.sin(C * Math.atan(B * s));
}

/** Friction coefficient after load sensitivity (heavier load = slightly less grip per newton). */
export function effectiveMu(p: TireParams, fz: number): number {
  const loadRatio = fz / p.refLoad;
  return p.mu * clamp(1 - p.loadSensitivity * (loadRatio - 1), 0.55, 1.35);
}

/**
 * Combined-slip tyre force on a friction ellipse.
 *
 * @param kappa    slip ratio ((wheel surface speed - ground speed) / ground speed)
 * @param tanAlpha tangent of slip angle: lateral patch velocity / |longitudinal speed|, +left
 * @param fz       vertical load (N)
 * @param grip     surface grip multiplier (asphalt 1.0)
 *
 * Slip is normalised by the peak slip of each axis, so the force direction follows the
 * combined slip vector (friction circle): braking or accelerating hard takes lateral grip
 * away and vice versa.
 */
export function tireForces(
  p: TireParams,
  kappa: number,
  tanAlpha: number,
  fz: number,
  grip: number,
  out: TireOut,
): TireOut {
  if (fz <= 0 || grip <= 0) {
    out.fx = 0;
    out.fy = 0;
    return out;
  }
  const kn = kappa / p.peakSlipRatio;
  const an = tanAlpha / p.peakSlipAngle;
  const s = Math.hypot(kn, an);
  if (s < 1e-9) {
    out.fx = 0;
    out.fy = 0;
    return out;
  }
  const mag = frictionCurve(s, p.slideRatio) * effectiveMu(p, fz) * grip * fz;
  out.fx = (mag * kn * p.longGripRatio) / s;
  // Lateral slip to the left (positive tanAlpha) must push the car to the right.
  out.fy = (-mag * an) / s;
  return out;
}
