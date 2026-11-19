import type { Physics } from '../../src/core/physics';
import type { Vehicle } from '../../src/vehicle/Vehicle';
import { bodySlip, drive, Keys } from './feel';

export interface DriftResult {
  /** Seconds spent with the drift angle between 15 and 55 degrees. */
  held: number;
  meanAngle: number;
  maxAngle: number;
  meanKmh: number;
  spun: boolean;
}

/**
 * A keyboard-style drifter on a left-hander: build speed, flick in with the handbrake, then keep the
 * angle around 30 degrees with on/off steering and throttle (only full presses, like a keyboard).
 */
export function driftRun(physics: Physics, car: Vehicle, entryKmh = 60, seconds = 8): DriftResult {
  drive(physics, car, 20, (_t, c) => ({ throttle: Math.min(Math.max((entryKmh - c.speedKmh) * 0.2, 0), 1) }));
  const k = new Keys();
  let held = 0;
  let sum = 0;
  let n = 0;
  let max = 0;
  let kmh = 0;
  let spun = false;
  const dt = 1 / 120;
  drive(physics, car, seconds, (t, c) => {
    const a = -bodySlip(c); // + = rear out to the right in a left-hander
    if (t > 1.5) {
      if (a > 15 && a < 55) held += dt;
      sum += a;
      n++;
      kmh += c.speedKmh;
      max = Math.max(max, Math.abs(a));
      if (Math.abs(a) > 80) spun = true;
    }
    if (t < 0.5) return { steer: k.step(1), handbrake: t > 0.15 ? 1 : 0, throttle: 0.4 };
    // Too little angle: steer in and floor it. Too much: let the wheel go and lift.
    const steer = a < 25 ? 1 : a > 38 ? -1 : 0;
    const throttle = a > 45 ? 0 : 1;
    return { steer: k.step(steer), throttle };
  });
  return { held, meanAngle: n ? sum / n : 0, maxAngle: max, meanKmh: n ? kmh / n : 0, spun };
}
