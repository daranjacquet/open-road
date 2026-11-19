import { clamp, interpTable, lerp } from '../core/math';
import type { EngineConfig, GearboxConfig } from './types';

/** Crankshaft torque (N m). Negative values are engine braking. */
export function engineTorque(e: EngineConfig, rpm: number, throttle: number): number {
  const full = interpTable(e.torqueCurve, rpm);
  const drive = full * clamp(throttle, 0, 1);
  const brake = e.engineBrake * clamp(rpm / e.redlineRpm, 0, 1.2) * (1 - clamp(throttle * 1.5, 0, 1));
  return drive - brake;
}

/** Total ratio (gearbox x final drive). Reverse is negative. Neutral is 0. */
export function totalRatio(g: GearboxConfig, gear: number): number {
  if (gear === 0) return 0;
  if (gear < 0) return -g.reverse * g.finalDrive;
  return (g.ratios[gear - 1] ?? 0) * g.finalDrive;
}

export interface GearState {
  /** -1 reverse, 0 neutral, 1..N forward. */
  gear: number;
  /** Seconds left in the current shift (torque cut). */
  shiftTimer: number;
}

/**
 * Automatic gear selection with hysteresis and anti-hunting: an upshift is refused if the
 * resulting rpm would immediately trigger a downshift, and the reverse. No upshift while the
 * driven wheels spin.
 */
export function autoShift(
  g: GearboxConfig,
  st: GearState,
  rpm: number,
  throttle: number,
  dt: number,
  wheelspin = false,
): void {
  if (st.shiftTimer > 0) st.shiftTimer = Math.max(0, st.shiftTimer - dt);
  if (st.gear <= 0 || st.shiftTimer > 0) return;
  const top = g.ratios.length;
  const upRpm = lerp(g.upshiftRpmLight, g.upshiftRpm, clamp(throttle, 0, 1));
  // Hold the gear while the driven wheels spin (burnouts, drifts): the revs are not road speed.
  if (st.gear < top && rpm > upRpm && !wheelspin) {
    const next = (g.ratios[st.gear] ?? 1) / (g.ratios[st.gear - 1] ?? 1);
    if (rpm * next > g.downshiftRpm + 600) {
      st.gear++;
      st.shiftTimer = g.shiftTime;
      return;
    }
  }
  if (st.gear > 1) {
    const prev = (g.ratios[st.gear - 2] ?? 1) / (g.ratios[st.gear - 1] ?? 1);
    // Downshift when too slow, or kick down under hard throttle if there is headroom.
    const lowRpm = g.downshiftRpm + (throttle > 0.85 ? 900 : 0);
    if (rpm < lowRpm && rpm * prev < g.upshiftRpm - 500) {
      st.gear--;
      st.shiftTimer = g.shiftTime * 0.6;
    }
  }
}
