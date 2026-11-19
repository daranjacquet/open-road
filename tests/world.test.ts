import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { FIXED_DT, GROUP, groups } from '../src/core/physics';
import { GameCar } from '../src/game/GameCar';
import { applyTune, stockTune } from '../src/vehicle/tuning';
import { loadModels } from './helpers/models';
import { CARS } from '../src/game/catalog';
import { LapTimer } from '../src/game/laps';
import { DRIFT, RACE } from '../src/world/map';
import { ASPHALT, GRASS, SurfaceMap } from '../src/world/surface';
import { TrackLine } from '../src/world/track';
import { drive } from './helpers/feel';
import { makeSim } from './helpers/sim';

describe('parked cars stay put', () => {
  for (const def of CARS) {
    it(`${def.id} does not creep with no input`, async () => {
      const { physics, car } = await makeSim(def.cfg);
      drive(physics, car, 3, () => ({}));
      const a = { ...car.body.translation() };
      drive(physics, car, 20, () => ({}));
      const b = car.body.translation();
      expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeLessThan(0.02);
    });
  }
});

describe('city kerbs', () => {
  beforeAll(loadModels);
  it('a lowered supercar drives up an 8 cm bevelled kerb at walking pace without stopping or denting', async () => {
    const def = CARS.find((c) => c.id === 'supercar')!;
    const { physics, car: tmp } = await makeSim(def.cfg);
    physics.world.removeRigidBody(tmp.body);
    const { RAPIER, world } = physics;
    // Same prism as src/world/city.ts: 8 cm high, sides sloping over 30 cm.
    const [h, b, x0, x1, z0, z1] = [0.08, 0.3, -30, 30, 20, 70];
    const pts = new Float32Array([x0 - b, -0.02, z0 - b, x1 + b, -0.02, z0 - b, x1 + b, -0.02, z1 + b, x0 - b, -0.02, z1 + b, x0, h, z0, x1, h, z0, x1, h, z1, x0, h, z1]);
    world.createCollider(RAPIER.ColliderDesc.convexHull(pts)!.setCollisionGroups(groups(GROUP.WORLD, 0xffff)), world.createRigidBody(RAPIER.RigidBodyDesc.fixed()));
    const lowered = { ...def, cfg: applyTune(def.cfg, { ...stockTune(def.cfg), rideHeight: -6 }) };
    const car = new GameCar(physics, new THREE.Scene(), lowered, 0, 8, 0);
    let minKmh = 99;
    for (let i = 0; i < 120 * 6; i++) {
      const v = car.vehicle.speedKmh;
      car.fixedUpdate(FIXED_DT, { throttle: Math.min(Math.max((12 - v) * 0.3, 0), 1), brake: 0, steer: 0, handbrake: 0 });
      physics.step();
      car.vehicle.afterPhysicsStep();
      const z = car.vehicle.body.translation().z;
      if (i > 240 && z > 15 && z < 26) minKmh = Math.min(minKmh, v);
    }
    expect(car.vehicle.body.translation().z).toBeGreaterThan(26);
    expect(minKmh).toBeGreaterThan(8);
    expect(Math.max(...car.crush.crush)).toBe(0);
  }, 30_000);
});

describe('circuits', () => {
  for (const def of [RACE, DRIFT]) {
    it(`${def.id}: a closed loop with room for walls between sections and drivable corners`, () => {
      const line = new TrackLine(def);
      expect(line.length).toBeGreaterThan(1800);
      const clearance = 2 * (def.width / 2 + def.runoff) + 10;
      let minGap = Infinity;
      for (let i = 0; i < line.n; i += 2) {
        for (let j = 0; j < line.n; j += 2) {
          const ds = Math.min(Math.abs(i - j), line.n - Math.abs(i - j)) * line.step;
          if (ds < 150) continue;
          minGap = Math.min(minGap, Math.hypot(line.x[i]! - line.x[j]!, line.z[i]! - line.z[j]!));
        }
      }
      expect(minGap).toBeGreaterThan(clearance);
      const maxCurv = Math.max(...Array.from(line.curv, Math.abs));
      expect(1 / maxCurv).toBeGreaterThan(18);
      // Everything inside the 2 km world, walls included.
      for (let i = 0; i < line.n; i++) {
        expect(Math.abs(line.x[i]!) + def.width / 2 + def.runoff).toBeLessThan(995);
        expect(Math.abs(line.z[i]!) + def.width / 2 + def.runoff).toBeLessThan(995);
      }
    });
  }

  it('times a full lap and ignores a shortcut', () => {
    const line = new TrackLine(RACE);
    const timer = new LapTimer(line, 'test');
    const v = 50; // m/s
    let t = 0;
    const along = (from: number, to: number): void => {
      for (let s = from; s <= to; s += v / 60) {
        const p = line.at(s);
        t += 1 / 60;
        timer.update(p.x, p.z, t);
      }
    };
    along(line.length - 100, line.length + 10); // cross the line: lap starts
    expect(timer.state.running).toBe(true);
    along(10, line.length + 10);
    expect(timer.state.lap).toBe(1);
    expect(timer.state.last!).toBeCloseTo(line.length / v, 0);
    // Cut from 20 % straight to 95 %: no lap counted.
    along(10, line.length * 0.2);
    along(line.length * 0.95, line.length + 10);
    expect(timer.state.lap).toBe(1);
  });
});

describe('surface raster', () => {
  it('paints and reads asphalt', () => {
    const m = new SurfaceMap(2000);
    expect(m.get(10, 10)).toBe(GRASS);
    m.fillDisc(10, 10, 5, ASPHALT);
    expect(m.get(12, 11)).toBe(ASPHALT);
    expect(m.get(20, 10)).toBe(GRASS);
    m.fillRect(-100, -5, -50, 5, ASPHALT);
    expect(m.get(-75, 0)).toBe(ASPHALT);
    expect(m.get(5000, 0)).toBe(GRASS);
  });
});
