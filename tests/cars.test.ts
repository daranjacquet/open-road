import { describe, expect, it } from 'vitest';
import { CARS } from '../src/game/catalog';
import { makeSim, run } from './helpers/sim';

interface Metrics {
  id: string;
  t100: number;
  top: number;
  brake100: number;
  skidpadG: number;
  restRide: number;
  drift: number;
}

async function measure(def: (typeof CARS)[number]): Promise<Metrics> {
  const cfg = def.cfg;
  let { physics, car } = await makeSim(cfg);
  const s = run(physics, car, 40, (t) => ({ throttle: t > 1 ? 1 : 0 }), 0.05);
  const t100 = (s.find((p) => p.speedKmh >= 100)?.t ?? 99) - 1;
  const top = Math.max(...s.map((p) => p.speedKmh));
  const drift = Math.abs(car.body.translation().x);
  ({ physics, car } = await makeSim(cfg));
  let z0 = 0;
  let zStop = Number.NaN;
  let braking = false;
  run(physics, car, 30, (_t, c) => {
    if (!braking && c.speedKmh >= 100) {
      braking = true;
      z0 = c.body.translation().z;
    }
    if (braking && Number.isNaN(zStop) && c.speedKmh < 1) zStop = c.body.translation().z;
    return braking ? { brake: Number.isNaN(zStop) ? 1 : 0 } : { throttle: 1 };
  }, 1);
  ({ physics, car } = await makeSim(cfg));
  car.placeAt(0, 1.0, 0, 0);
  let maxLat = 0;
  for (const p of run(physics, car, 40, (t, c) => ({ throttle: c.speedKmh < 30 + t * 2 ? 0.8 : 0, steer: 0.3 }), 0.5)) maxLat = Math.max(maxLat, Math.abs(p.latG));
  ({ physics, car } = await makeSim(cfg));
  run(physics, car, 3, () => ({}), 1);
  return { id: def.id, t100, top, brake100: zStop - z0, skidpadG: maxLat, restRide: car.body.translation().y, drift };
}

describe('the three cars drive plausibly and differently', () => {
  const r: Record<string, Metrics> = {};
  for (const def of CARS) {
    it(`${def.id}`, async () => {
      const m = await measure(def);
      r[def.id] = m;
      console.log(def.id, JSON.stringify({ t100: +m.t100.toFixed(2), top: Math.round(m.top), brake100: +m.brake100.toFixed(1), skidpadG: +m.skidpadG.toFixed(2), ride: +m.restRide.toFixed(3), drift: +m.drift.toFixed(2) }));
      expect(m.t100).toBeLessThan(9);
      expect(m.brake100).toBeGreaterThan(25);
      expect(m.brake100).toBeLessThan(60);
      expect(m.drift).toBeLessThan(8);
      expect(m.skidpadG).toBeGreaterThan(0.6);
    }, 30_000);
  }
  it('supercar is the quickest and grippiest, the off-roader the tallest and least grippy', () => {
    expect(r['supercar']!.t100).toBeLessThan(r['sedan']!.t100);
    expect(r['supercar']!.skidpadG).toBeGreaterThan(r['offroad']!.skidpadG);
    expect(r['offroad']!.restRide).toBeGreaterThan(r['sedan']!.restRide + 0.1);
    expect(r['supercar']!.restRide).toBeLessThan(r['sedan']!.restRide);
  });
});
