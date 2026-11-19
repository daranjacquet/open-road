import { CARS } from '../../src/game/catalog';
import type { VehicleConfig } from '../../src/vehicle/types';
import { bodySlip, drive, Keys } from './feel';
import { makeSim } from './sim';

export interface PerfReport {
  t100: number;
  t200: number;
  top: number;
  brake100: number;
  /** Mean lateral g in a steady keyboard full-lock corner, per speed. */
  latG: Record<number, number>;
  /** Mean front / rear slip angle (deg) in those corners: front well above rear = understeer. */
  slip: Record<number, [number, number]>;
  /** Seconds from steering input to 90 % of the steady yaw rate at 120 km/h. */
  turnIn: number;
  /** Largest body slip (deg) in a full-lock lane change at 160 km/h. */
  laneChange: number;
}

const hold = (kmh: number) => (s: number) => Math.min(Math.max((kmh - s) * 0.15 + 0.25, 0), 1);

export async function perf(cfg: VehicleConfig = CARS.find((c) => c.id === 'supercar')!.cfg): Promise<PerfReport> {
  // Start at one end of the 10 km test plane so a 350 km/h run stays on it.
  let { physics, car } = await makeSim(cfg, 0, -4800);
  let t100 = 0;
  let t200 = 0;
  let top = 0;
  let t = 0;
  drive(physics, car, 60, (_t, c) => {
    t += 1 / 120;
    if (!t100 && c.vLong * 3.6 >= 100) t100 = t - 1;
    if (!t200 && c.vLong * 3.6 >= 200) t200 = t - 1;
    top = Math.max(top, c.vLong * 3.6);
    return { throttle: t > 1 ? 1 : 0 };
  });
  ({ physics, car } = await makeSim(cfg));
  let z0 = 0;
  let braking = false;
  let stop = 0;
  drive(physics, car, 30, (_t, c) => {
    if (!braking && c.speedKmh >= 100) {
      braking = true;
      z0 = c.body.translation().z;
    }
    if (braking && !stop && c.speedKmh < 0.5) stop = c.body.translation().z - z0;
    return braking ? { brake: stop ? 0 : 1 } : { throttle: 1 };
  });
  const latG: Record<number, number> = {};
  const slip: Record<number, [number, number]> = {};
  for (const v of [80, 150, 220]) {
    ({ physics, car } = await makeSim(cfg));
    drive(physics, car, 40, (_t, c) => ({ throttle: Math.min(Math.max((v - c.speedKmh) * 0.15, 0), 1) }));
    const k = new Keys();
    const s = drive(physics, car, 3, (_t, c) => ({ throttle: hold(v)(c.speedKmh), steer: k.step(1) }), 1.5);
    latG[v] = +s.meanLatG.toFixed(2);
    slip[v] = [+s.frontSlip.toFixed(1), +s.rearSlip.toFixed(1)];
  }
  ({ physics, car } = await makeSim(cfg));
  drive(physics, car, 30, (_t, c) => ({ throttle: Math.min(Math.max((120 - c.speedKmh) * 0.15, 0), 1) }));
  const k2 = new Keys();
  const yaw: number[] = [];
  drive(physics, car, 2, (_t, c) => {
    yaw.push(Math.abs(c.yawRate));
    return { throttle: hold(120)(c.speedKmh), steer: k2.step(1) };
  });
  const steady = yaw.slice(-30).reduce((a, b) => a + b, 0) / 30;
  const turnIn = yaw.findIndex((y) => y >= steady * 0.9) / 120;
  ({ physics, car } = await makeSim(cfg));
  drive(physics, car, 40, (_t, c) => ({ throttle: Math.min(Math.max((160 - c.speedKmh) * 0.15, 0), 1) }));
  const k3 = new Keys();
  let maxSlip = 0;
  drive(physics, car, 4, (tt, c) => {
    maxSlip = Math.max(maxSlip, Math.abs(bodySlip(c)));
    return { throttle: hold(160)(c.speedKmh), steer: k3.step(tt < 0.6 ? 1 : tt < 1.4 ? -1 : 0) };
  });
  return { t100: +t100.toFixed(2), t200: +t200.toFixed(2), top: Math.round(top), brake100: +stop.toFixed(1), latG, slip, turnIn: +turnIn.toFixed(2), laneChange: +maxSlip.toFixed(1) };
}
