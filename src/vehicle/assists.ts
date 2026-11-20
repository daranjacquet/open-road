import { clamp } from '../core/math';

/** ABS: scale the brake torque of one wheel from its slip ratio (negative = locking). */
export function absScale(kappa: number): number {
  const over = -kappa - 0.16;
  return over <= 0 ? 1 : clamp(1 - over * 9, 0.08, 1);
}

/**
 * Traction control: scale engine torque from the worst driven-wheel slip ratio (positive = spinning).
 * `allowed` is the slip let through (higher in a slide, so the throttle can hold a drift).
 */
export function tcScale(maxKappa: number, allowed = 0.15): number {
  const over = maxKappa - allowed;
  return over <= 0 ? 1 : clamp(1 - over * 6, 0.25, 1);
}

export interface EspOut {
  throttleScale: number;
  /** Extra brake torque as a fraction of the total brake torque, per wheel (FL, FR, RL, RR). */
  brake: [number, number, number, number];
  /** 0..1, how hard ESP is intervening (for the HUD). */
  activity: number;
}

/**
 * Stability control. Compares the measured yaw rate with the yaw rate the driver asks for
 * (`desired`: from the steering input and speed, capped by what the tyres can give):
 * - oversteer (car rotates more than asked): brake the outer front wheel and cut throttle,
 * - understeer (car rotates less than asked): brake the inner rear wheel.
 */
export function espControl(vLong: number, yawRate: number, desired: number, out: EspOut): EspOut {
  out.throttleScale = 1;
  out.brake[0] = out.brake[1] = out.brake[2] = out.brake[3] = 0;
  out.activity = 0;
  const v = Math.abs(vLong);
  if (v < 8) return out;
  const err = yawRate - desired;
  const dead = 0.12;
  if (Math.abs(err) <= dead) return out;
  const over = Math.abs(err) - dead;
  if (Math.abs(yawRate) > Math.abs(desired) && Math.sign(err) === Math.sign(yawRate || err)) {
    // Oversteer: brake the wheel on the outside of the rotation.
    const idx = err > 0 ? 1 : 0;
    out.brake[idx] = clamp(over * 0.6, 0, 0.7);
    out.throttleScale = clamp(1 - over * 1.5, 0.3, 1);
    out.activity = clamp(over * 2, 0, 1);
  } else if (Math.abs(desired) > 0.15 && Math.abs(yawRate) < 0.75 * Math.abs(desired)) {
    // Understeer: help the car rotate with the inner rear wheel.
    const idx = desired > 0 ? 2 : 3;
    out.brake[idx] = clamp(over * 0.4, 0, 0.5);
    out.throttleScale = clamp(1 - over, 0.5, 1);
    out.activity = clamp(over * 1.5, 0, 1);
  }
  return out;
}
