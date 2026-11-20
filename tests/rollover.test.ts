import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createPhysics, FIXED_DT, GROUP, groups, type Physics } from '../src/core/physics';
import { CARS } from '../src/game/catalog';
import { GameCar } from '../src/game/GameCar';
import { fitCabin } from '../src/damage/cabin';
import { buildCarModel } from '../src/render/car';
import { loadModels } from './helpers/models';

beforeAll(async () => {
  await RAPIER.init();
  await loadModels();
});

type Ground = 'terrain' | 'road';

/** Flat open ground: the terrain heightfield, or a road deck (a triangle mesh). */
async function flatWorld(ground: Ground): Promise<Physics> {
  const physics = await createPhysics();
  const { world } = physics;
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  let desc: RAPIER.ColliderDesc;
  if (ground === 'terrain') {
    const n = 100;
    desc = RAPIER.ColliderDesc.heightfield(n, n, new Float32Array((n + 1) * (n + 1)), { x: 800, y: 1, z: 800 }, RAPIER.HeightFieldFlags.FIX_INTERNAL_EDGES);
    physics.groundHeight = () => 0;
  } else {
    const v = new Float32Array([-400, 0, -400, 400, 0, -400, 400, 0, 400, -400, 0, 400]);
    desc = RAPIER.ColliderDesc.trimesh(v, new Uint32Array([0, 2, 1, 0, 3, 2]), RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES);
  }
  const c = world.createCollider(desc.setFriction(1).setCollisionGroups(groups(GROUP.WORLD, 0xffff)), body);
  physics.groundColliders.add(c.handle);
  return physics;
}

interface Launch {
  v: [number, number, number];
  w: [number, number, number];
  /** Start tipped over by this roll angle (rad), just above the ground. */
  roll?: number;
}

/** Throw a car into a roll and let it come to rest. */
async function tumble(id: string, ground: Ground, launch: Launch): Promise<GameCar> {
  const physics = await flatWorld(ground);
  const car = new GameCar(physics, new THREE.Scene(), CARS.find((c) => c.id === id)!, 0, -200, 0);
  const v = car.vehicle;
  const idle = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
  const step = (i: number): void => {
    car.fixedUpdate(FIXED_DT, idle);
    physics.step();
    v.afterPhysicsStep();
    if (i % 2 === 0) car.updateVisuals(i * 1000 * FIXED_DT, 1, FIXED_DT * 2, 600);
  };
  for (let i = 0; i < 60; i++) step(i);
  if (launch.roll !== undefined) {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), launch.roll);
    v.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    v.body.setTranslation({ x: 0, y: 1.1, z: -200 }, true);
  }
  v.body.setLinvel({ x: launch.v[0], y: launch.v[1], z: launch.v[2] }, true);
  v.body.setAngvel({ x: launch.w[0], y: launch.w[1], z: launch.w[2] }, true);
  for (let i = 60; i < 60 + 120 * 5; i++) step(i);
  car.updateVisuals(1e9, 1, 0.016, 600);
  return car;
}

/** Deepest crush of the passenger cell's roof, pillars and glass (m). */
function roofCrush(car: GameCar): number {
  let m = 0;
  car.crush.rays.forEach((r, i) => {
    if (r.cabin && r.kind === 'roof') m = Math.max(m, car.crush.crush[i]!);
  });
  return m;
}

const ROLL_70: Launch = { v: [0, 3, 19.4], w: [0, 0, 7] };

describe('rollovers', () => {
  for (const id of ['sedan', 'offroad', 'supercar']) {
    it(`${id}: a 70 km/h rollover caves the roof in, breaks glass, and spares the engine and wheels`, async () => {
      const car = await tumble(id, 'terrain', ROLL_70);
      const roof = roofCrush(car);
      console.log(id, 'roof crush', roof.toFixed(3), 'roof zone', car.damage.zone.roof.toFixed(2), 'broken', car.parts.brokenParts().join(','));
      expect(roof).toBeGreaterThan(0.05);
      expect(car.damage.zone.roof).toBeGreaterThan(0.15);
      expect(car.parts.brokenParts().some((p) => p.startsWith('glass_'))).toBe(true);
      expect(car.deformer.maxDisplacement('body')).toBeGreaterThan(0.06);
      expect(car.vehicle.powerScale).toBeGreaterThan(0.9);
      for (const w of car.damage.wheel) expect(w).toBeLessThan(0.3);
    });
  }

  it('dents the car on a road deck as well as on the terrain', async () => {
    for (const ground of ['terrain', 'road'] as const) {
      const car = await tumble('sedan', ground, ROLL_70);
      expect(car.crush.energy, ground).toBeGreaterThan(5e3);
      expect(car.deformer.imprints, ground).toBeGreaterThan(100);
      expect(roofCrush(car), ground).toBeGreaterThan(0.05);
    }
  });

  it('a slow tip-over onto the roof only leaves light damage', async () => {
    const car = await tumble('sedan', 'terrain', { v: [0, 0, 0], w: [0, 0, 0.5], roll: 1.75 });
    const roof = roofCrush(car);
    expect(roof).toBeLessThan(0.08);
    for (const z of Object.values(car.damage.zone)) expect(z).toBeLessThan(0.25);
    expect(car.vehicle.powerScale).toBeGreaterThan(0.99);
  });
});

describe('passenger cell fitted to the model', () => {
  for (const def of CARS) {
    it(`${def.id}: the hard core stays inside the greenhouse, with crumple rays all over it`, () => {
      const model = buildCarModel(def.id);
      const cabin = fitCabin(def.cfg, model, RAPIER)!;
      expect(cabin).not.toBeNull();
      const hull = RAPIER.ColliderDesc.convexHull(cabin.core)!.shape;
      const [cx, cy, cz] = cabin.centre;
      const at = { x: 0, y: 0, z: 0 };
      const rot = { x: 0, y: 0, z: 0, w: 1 };
      const ray = new RAPIER.Ray({ x: cx, y: cy, z: cz }, { x: 0, y: 1, z: 0 });
      // Directions over the upper half, off the sampling grid the fit used.
      let worst = Infinity;
      for (let a = 7; a < 180; a += 17) {
        for (let b = -77; b <= 77; b += 22) {
          const ar = (a * Math.PI) / 180;
          const br = (b * Math.PI) / 180;
          const d: [number, number, number] = [Math.cos(ar) * Math.cos(br), Math.sin(ar) * Math.cos(br), Math.sin(br)];
          // The outer skin along this line: probe back in from outside the car.
          const hit = model.probe([cx + d[0] * 3, cy + d[1] * 3, cz + d[2] * 3], [-d[0], -d[1], -d[2]], 3);
          if (!hit) continue;
          ray.dir.x = d[0];
          ray.dir.y = d[1];
          ray.dir.z = d[2];
          worst = Math.min(worst, 3 - hit.dist - hull.castRay(ray, at, rot, 3, false));
        }
      }
      // Never out through the glass or the roof (a few cm of slack between sampled directions).
      expect(worst).toBeGreaterThan(-0.03);
      const kinds = new Set(cabin.rays.map((r) => r.kind));
      expect([...kinds].sort()).toEqual(['left', 'right', 'roof']);
      expect(cabin.rays.length).toBeGreaterThan(60);
      expect(cabin.rays.some((r) => r.part.startsWith('glass_'))).toBe(true);
      for (const r of cabin.rays) {
        expect(r.length).toBeGreaterThan(0.03);
        expect(r.fmax).toBeGreaterThan(0);
      }
    });
  }
});
