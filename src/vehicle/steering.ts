import { clamp, damp, lerp, moveToward, smoothstep } from '../core/math';
import type { VehicleConfig } from './types';
/** Steering lock available at a given speed: halves at `speedRef`, falls off as 1/(1+(v/ref)^2). */
export function maxSteerAngle(lock: number, speedRef: number, speed: number): number {
  const r = speed / speedRef;
  return lock / (1 + r * r);
}

/**
 * Ackermann geometry. `delta` is the virtual centre wheel angle (+ = left turn).
 * Returns [left wheel angle, right wheel angle]; the inside wheel turns more.
 */
export function ackermann(delta: number, wheelbase: number, track: number, out: [number, number] = [0, 0]): [number, number] {
  const a = Math.abs(delta);
  if (a < 1e-5) {
    out[0] = out[1] = delta;
    return out;
  }
  const R = wheelbase / Math.tan(a);
  const inner = Math.atan(wheelbase / Math.max(R - track / 2, 1e-3));
  const outer = Math.atan(wheelbase / (R + track / 2));
  out[0] = delta > 0 ? inner : -outer;
  out[1] = delta > 0 ? outer : -inner;
  return out;
}

/** What the steering needs to know about the car this step (car frame, SI units). */
export interface SteerContext {
  dt: number;
  /** Driver input -1..1 (+ = left). */
  input: number;
  vLong: number;
  vLat: number;
  speed: number;
  yawRate: number;
  /** Centre of mass to front axle, and wheelbase (m). */
  lf: number;
  wheelbase: number;
  /** tan of the front / rear tyre's peak slip angle. */
  frontPeak: number;
  rearPeak: number;
  /** First step after a reset (no history yet). */
  first: boolean;
}

/**
 * Driver-side steering with the arcade aids: assisted steering (the input asks the front tyres
 * for slip angle relative to where the front axle goes, so full lock never ploughs and the wheels
 * countersteer in a slide), stability (unwind when the rear slides) and the slip-rate signal used
 * by slide control.
 */
export class SteeringController {
  /** Input after the rate limit (-1..1). */
  input = 0;
  /** Centre wheel angle (rad, + = left). */
  angle = 0;
  /** Filtered direction of travel of the front axle relative to the heading (rad). */
  frontTravel = 0;
  /** Body slip angle (rad) and its filtered rate (rad/s). */
  slip = 0;
  slipRate = 0;
  /** Assist weight this step (0 plain rack .. 1 fully assisted) and the plain rack's lock. */
  assistWeight = 0;
  plainMax = 0;

  reset(): void {
    this.input = this.angle = this.frontTravel = this.slip = this.slipRate = 0;
  }

  update(st: VehicleConfig['steering'], c: SteerContext): number {
    const dt = c.dt;
    const target = clamp(c.input, -1, 1);
    const rate = st.rate * (Math.abs(target) < Math.abs(this.input) ? 1.6 : 1);
    this.input = moveToward(this.input, target, rate * dt);
    const travel = c.vLong > 0.5 ? Math.atan2(c.vLat + c.yawRate * c.lf, c.vLong) : 0;
    this.frontTravel += (travel - this.frontTravel) * damp(30, dt);
    // Body slip and how fast it changes (0 in a steady corner or a steady drift).
    const slipNow = c.vLong > 1 ? Math.atan2(c.vLat, c.vLong) : 0;
    const slipRate = c.first ? 0 : (slipNow - this.slip) / dt;
    this.slip = slipNow;
    this.slipRate += (slipRate - this.slipRate) * damp(20, dt);
    // Assisted: aim the wheels along the front axle's path plus up to the tyre's peak slip angle.
    // Plain: the input is a fraction of a speed-sensitive lock.
    const w = clamp(st.assist, 0, 1) * smoothstep(2, 7, c.vLong);
    const peakAngle = Math.atan(c.frontPeak) * 1.15;
    this.assistWeight = w;
    this.plainMax = maxSteerAngle(st.lock, st.speedRef, c.speed);
    // Stability: when the rear axle slides past its peak, stop asking the front for more rotation
    // in the same direction (what a driver does by unwinding the wheel).
    let ask = this.input;
    const stab = clamp(st.stability ?? 0, 0, 1);
    if (stab > 0 && c.vLong > 3 && ask * c.yawRate > 0) {
      const rearTravel = Math.atan2(c.vLat + c.yawRate * (c.lf - c.wheelbase), c.vLong);
      const rearPeak = Math.atan(c.rearPeak);
      ask *= 1 - stab * clamp((Math.abs(rearTravel) - rearPeak) / rearPeak, 0, 1);
    }
    const goal = clamp(w * this.frontTravel + ask * lerp(this.plainMax, peakAngle, w), -st.lock, st.lock);
    this.angle = moveToward(this.angle, goal, 6 * dt);
    return this.angle;
  }
}
