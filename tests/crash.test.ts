import { describe, expect, it } from 'vitest';
import sport from '../src/vehicle/cars/sport.json';
import type { VehicleConfig } from '../src/vehicle/types';
import { FIXED_DT, GROUP, groups } from '../src/core/physics';
import { buildCarModel } from '../src/render/car';
import { buildCrushRays } from '../src/damage/rays';
import { makeSim } from './helpers/sim';

const cfg = sport as unknown as VehicleConfig;
const model = buildCarModel(cfg);
const rays = buildCrushRays(cfg, model);

interface CrashResult {
  v0: number;
  stopTime: number;
  peakG: number;
  meanG: number;
  frontCrush: number;
  energyKJ: number;
  finalZ: number;
  maxPenetration: number;
}

async function frontCrash(kmh: number, angle = 0): Promise<CrashResult> {
  const { physics, car } = await makeSim(cfg, 0, 0, angle);
  const { RAPIER, world } = physics;
  const wallZ = 150;
  const wb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 3, wallZ + 1.5));
  world.createCollider(RAPIER.ColliderDesc.cuboid(40, 3, 1.5).setCollisionGroups(groups(GROUP.WORLD, 0xffff)), wb);
  car.assists.esp = false;
  const crush = car.attachCrush(rays);
  const input = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
  let hit = false;
  let tHit = 0;
  let v0 = 0;
  let vPrev = 0;
  let peakG = 0;
  let stopT = -1;
  let maxPen = 0;
  for (let i = 0; i < 120 * 60; i++) {
    const t = i * FIXED_DT;
    input.throttle = !hit && car.speedKmh < kmh ? 1 : 0;
    car.fixedUpdate(FIXED_DT, input);
    physics.step();
    car.afterPhysicsStep();
    const z = car.body.translation().z;
    const v = car.vLong;
    if (!hit && crush.active > 0 && v > 3) {
      hit = true;
      tHit = t;
      v0 = v;
      vPrev = v;
    }
    if (hit) {
      peakG = Math.max(peakG, Math.abs(v - vPrev) / FIXED_DT / 9.81);
      vPrev = v;
      maxPen = Math.max(maxPen, z + 2.2 - wallZ);
      if (stopT < 0 && Math.abs(v) < 0.5) stopT = t - tHit;
      if (t - tHit > 1.5) break;
    }
  }
  let frontCrushMax = 0;
  rays.forEach((r, i) => {
    if (r.kind === 'front') frontCrushMax = Math.max(frontCrushMax, crush.crush[i]!);
  });
  const meanG = stopT > 0 ? v0 / stopT / 9.81 : 0;
  return { v0: v0 * 3.6, stopTime: stopT, peakG, meanG, frontCrush: frontCrushMax, energyKJ: crush.energy / 1000, finalZ: car.body.translation().z, maxPenetration: maxPen };
}

describe('crumple zones', () => {
  it('builds a sensible ray set', () => {
    const byKind: Record<string, number> = {};
    for (const r of rays) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
    console.log('rays', rays.length, byKind, 'parts', [...new Set(rays.map((r) => r.part))].join(','));
    expect(rays.length).toBeGreaterThan(80);
    for (const r of rays) {
      expect(r.length).toBeGreaterThan(0.03);
      expect(r.length).toBeLessThan(1.0);
    }
  });

  it('a 50 km/h wall hit crushes the nose over tens of ms and the car survives', async () => {
    const r = await frontCrash(50);
    console.log('50 km/h:', JSON.stringify(r, (_k, v) => (typeof v === 'number' ? Number(v.toFixed(3)) : v)));
    expect(r.peakG).toBeLessThan(100);
    expect(r.frontCrush).toBeGreaterThan(0.2);
    expect(r.frontCrush).toBeLessThan(0.5);
    expect(r.energyKJ).toBeGreaterThan(90); // most of the 130 kJ is absorbed plastically
  });

  it('a 100 km/h wall hit is violent but not instantaneous, and crushes the front deeply', async () => {
    const r = await frontCrash(100);
    console.log('100 km/h:', JSON.stringify(r, (_k, v) => (typeof v === 'number' ? Number(v.toFixed(3)) : v)));
    expect(r.frontCrush).toBeGreaterThan(0.5);
    expect(r.energyKJ).toBeGreaterThan(300);
  });

  it('a 20 km/h tap leaves only light damage', async () => {
    const r = await frontCrash(20);
    console.log('20 km/h:', JSON.stringify(r, (_k, v) => (typeof v === 'number' ? Number(v.toFixed(3)) : v)));
    expect(r.frontCrush).toBeLessThan(0.16);
    expect(r.frontCrush).toBeGreaterThan(0.02);
  });
});
