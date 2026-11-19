import { describe, expect, it } from 'vitest';
import { CARS } from '../src/game/catalog';
import { buildCarModel } from '../src/render/car';
import { buildCrushRays } from '../src/damage/rays';
import { makeSim, run } from './helpers/sim';

interface Metrics {
  id: string;
  t100: number | undefined;
  top: number;
  brake100: number;
  skidpadG: number;
  restRide: number;
  handsOffDrift: number;
  understeer: number;
}

async function measure(def: (typeof CARS)[number]): Promise<Metrics> {
  const cfg = def.cfg;
  // 0-100 and top speed
  let { physics, car } = await makeSim(cfg);
  const s = run(physics, car, 40, (t) => ({ throttle: t > 1 ? 1 : 0 }), 0.05);
  const t100 = s.find((p) => p.speedKmh >= 100)?.t;
  const top = Math.max(...s.map((p) => p.speedKmh));
  const driftX = Math.abs(car.body.translation().x);
  // braking
  ({ physics, car } = await makeSim(cfg));
  let z0 = 0;
  let zStop = Number.NaN;
  let braking = false;
  run(
    physics,
    car,
    30,
    (_t, c) => {
      if (!braking && c.speedKmh >= 100) {
        braking = true;
        z0 = c.body.translation().z;
      }
      if (braking && Number.isNaN(zStop) && c.speedKmh < 1) zStop = c.body.translation().z;
      return braking ? { brake: Number.isNaN(zStop) ? 1 : 0 } : { throttle: 1 };
    },
    1,
  );
  const brake = zStop - z0;
  // skid pad
  ({ physics, car } = await makeSim(cfg));
  car.placeAt(0, 0.9, 0, 0);
  let maxLat = 0;
  const sp = run(physics, car, 40, (t, c) => ({ throttle: c.speedKmh < 30 + t * 2 ? 0.8 : 0, steer: 0.3 }), 0.5);
  for (const p of sp) maxLat = Math.max(maxLat, Math.abs(p.latG));
  // static ride
  ({ physics, car } = await makeSim(cfg));
  run(physics, car, 3, () => ({}), 1);
  const ride = car.body.translation().y;
  // steady-state understeer: yaw gain at 80 km/h with a small steer
  ({ physics, car } = await makeSim(cfg));
  run(physics, car, 12, (_t, c) => ({ throttle: c.speedKmh < 80 ? 1 : 0.25 }), 1);
  const sy = run(physics, car, 3, (_t, c) => ({ throttle: c.speedKmh < 80 ? 0.6 : 0.2, steer: 0.12 }), 0.2);
  const yaw = sy.slice(-5).reduce((a, b) => a + b.yawRate, 0) / 5;
  return { id: def.id, t100, top, brake100: brake, skidpadG: maxLat, restRide: ride, handsOffDrift: driftX, understeer: yaw };
}

describe('the three cars', () => {
  const results: Metrics[] = [];

  for (const def of CARS) {
    it(`${def.id}: builds a model with named parts and a valid crush set`, () => {
      const model = buildCarModel(def.cfg, def.body);
      for (const n of ['body', 'hood', 'trunk', 'door_FL', 'door_FR', 'bumper_F', 'bumper_R', 'glass_front', 'glass_rear', 'light_FL', 'light_RR', 'mirror_L']) {
        expect(model.parts.has(n), `${def.id} missing ${n}`).toBe(true);
      }
      const rays = buildCrushRays(def.cfg, model);
      const kinds = new Set(rays.map((r) => r.kind));
      for (const k of ['front', 'rear', 'left', 'right', 'roof'] as const) expect(kinds.has(k), `${def.id} no ${k} rays`).toBe(true);
      expect(rays.length).toBeGreaterThan(70);
      const tris = [...model.parts.values()].reduce((a, m) => a + (m.userData['rest'] ? (m.geometry.getIndex()?.count ?? 0) / 3 : 0), 0);
      console.log(def.id, 'rays', rays.length, 'shell tris', tris);
      expect(tris).toBeGreaterThan(18000);
    });

    it(`${def.id}: drives plausibly`, async () => {
      const m = await measure(def);
      results.push(m);
      console.log(def.id, JSON.stringify({ ...m, t100: m.t100 === undefined ? null : +(m.t100 - 1).toFixed(2), top: Math.round(m.top), brake100: +m.brake100.toFixed(1), skidpadG: +m.skidpadG.toFixed(2), restRide: +m.restRide.toFixed(3), drift: +m.handsOffDrift.toFixed(2), yaw: +m.understeer.toFixed(3) }));
      expect(m.t100).toBeDefined();
      expect(m.restRide).toBeGreaterThan(0.3);
      expect(m.handsOffDrift).toBeLessThan(8);
      expect(m.skidpadG).toBeGreaterThan(0.55);
    });
  }

  it('the cars are clearly different from each other', () => {
    const by = Object.fromEntries(results.map((r) => [r.id, r]));
    expect(by['sport']!.t100! + 2).toBeLessThan(by['hatch']!.t100!);
    expect(by['sport']!.top).toBeGreaterThan(by['hatch']!.top + 30);
    expect(by['pickup']!.brake100).toBeGreaterThan(by['sport']!.brake100);
    expect(by['sport']!.skidpadG).toBeGreaterThan(by['pickup']!.skidpadG);
  });
});
