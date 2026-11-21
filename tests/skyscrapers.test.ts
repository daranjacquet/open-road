import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createPhysics, FIXED_DT, GROUP, groups, type Physics } from '../src/core/physics';
import { CARS } from '../src/game/catalog';
import { GameCar } from '../src/game/GameCar';
import { rect, Skyscrapers, twinTower } from '../src/world/skyscrapers';
import { loadModels } from './helpers/models';

beforeAll(loadModels);

const mats = () => ({ roof: new THREE.MeshStandardMaterial(), concrete: new THREE.MeshStandardMaterial(), mast: new THREE.MeshStandardMaterial() });

async function city(): Promise<{ physics: Physics; towers: Skyscrapers }> {
  const physics = await createPhysics();
  const { RAPIER, world } = physics;
  world.createCollider(RAPIER.ColliderDesc.cuboid(2000, 1, 2000).setTranslation(0, -1, 0).setCollisionGroups(groups(GROUP.WORLD, 0xffff)));
  const glass = new THREE.MeshStandardMaterial();
  const box = rect(20, 15);
  const towers = new Skyscrapers(
    physics,
    [
      twinTower('WTC', 0, 0, 0, glass, true),
      { name: 'High-rise', x: 300, z: 0, y: 0, facade: glass, bands: [{ y0: 0, y1: 70, bottom: box, top: box }] },
    ],
    mats(),
    false,
  );
  return { physics, towers };
}

describe('skyscrapers', () => {
  it('stand on a ring of ground-floor sections; a light knock does nothing, a hard one breaks a section', async () => {
    const { towers } = await city();
    const wtc = towers.tower('WTC')!;
    expect(wtc.sections).toBe(24);
    expect(towers.tower('High-rise')!.sections).toBeGreaterThan(10);
    towers.hit(wtc.handles[0]!, 100e3, 1, 0);
    towers.flush();
    expect(towers.tower('WTC')!.standing).toBe(24);
    // A 200 km/h saloon: the section goes and the rest carries to its neighbours.
    towers.hit(wtc.handles[3]!, 0.5 * 1720 * 55 * 55, 1, 0);
    towers.flush();
    const after = towers.tower('WTC')!;
    expect(after.standing).toBeLessThan(24);
    expect(after.standing).toBeGreaterThan(18);
    expect(after.collapsed).toBe(false);
  });

  it('comes down when a whole side is knocked out, the blocks fall, and it stands again after a rebuild', async () => {
    const { physics, towers } = await city();
    const colliders = physics.world.colliders.len();
    const t = towers.tower('High-rise')!;
    // Knock out the sections one by one until it goes.
    for (const h of t.handles) {
      towers.hit(h, 2e6, -1, 0);
      towers.flush();
      if (towers.tower('High-rise')!.collapsed) break;
    }
    expect(towers.tower('High-rise')!.collapsed).toBe(true);
    expect(towers.stats.debris).toBeGreaterThan(10);
    // The blocks fall: none is left high up after a few seconds.
    for (let i = 0; i < 120 * 6; i++) physics.step();
    let highest = -Infinity;
    physics.world.forEachRigidBody((b) => {
      if (b.isDynamic()) highest = Math.max(highest, b.translation().y);
    });
    expect(highest).toBeLessThan(40);
    expect(towers.tower('WTC')!.collapsed).toBe(false);
    towers.rebuild();
    expect(towers.stats.debris).toBe(0);
    expect(towers.tower('High-rise')!.standing).toBe(t.sections);
    expect(physics.world.colliders.len()).toBe(colliders);
  });

  it('a car crashing into the ground floor at 150 km/h knocks a section in', async () => {
    const { physics, towers } = await city();
    const car = new GameCar(physics, new THREE.Scene(), CARS.find((c) => c.id === 'sedan')!, 300, -60, 0);
    car.damage.addImpactListener((i) => {
      if (i.collider >= 0) towers.hit(i.collider, 0.5 * car.vehicle.mass * i.speed * i.speed, i.normal.x, i.normal.z);
    });
    const idle = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
    for (let i = 0; i < 30; i++) {
      car.fixedUpdate(FIXED_DT, idle);
      physics.step();
      car.vehicle.afterPhysicsStep();
      towers.flush();
    }
    car.vehicle.body.setLinvel({ x: 0, y: 0, z: 150 / 3.6 }, true);
    for (let i = 0; i < 120 * 2; i++) {
      car.fixedUpdate(FIXED_DT, idle);
      physics.step();
      car.vehicle.afterPhysicsStep();
      towers.flush();
    }
    const t = towers.tower('High-rise')!;
    expect(t.standing).toBeLessThan(t.sections);
    expect(car.crush.energy).toBeGreaterThan(50e3);
  });
});

describe('skyscrapers and aircraft', () => {
  

  it('a strike high up breaks a tower there: the top falls the way the aircraft flew, the stump stands', async () => {
    const { physics, towers } = await city();
    const t = towers.tower('High-rise')!;
    // A slow knock adds up but does not bring it down.
    towers.strike(t.upper[1]!, 0.2e6, 0, 1, 50);
    towers.flush();
    expect(towers.tower('High-rise')!.collapsed).toBe(false);
    expect(towers.tower('High-rise')!.struck).toBeGreaterThan(0);
    // An SR22 at 160 kt (5 MJ) at 50 m.
    for (let i = 0; i < 60; i++) towers.flush();
    towers.strike(t.upper[1]!, 0.5 * 1541 * 82 * 82, 0, 1, 50);
    towers.flush();
    const broken = towers.tower('High-rise')!;
    expect(broken.collapsed).toBe(true);
    // The ground floor still stands.
    expect(broken.standing).toBe(t.sections);
    let fixed = 0;
    physics.world.forEachRigidBody((b) => {
      if (b.isFixed() && b.translation().y > 5) fixed++;
    });
    expect(fixed).toBeGreaterThan(0);
    for (let i = 0; i < 120 * 6; i++) {
      physics.step();
      towers.flush();
    }
    // The top went over to +z and came down (a block may stay lodged on the stump).
    let high = 0;
    let towardZ = 0;
    let sumY = 0;
    let n = 0;
    physics.world.forEachRigidBody((b) => {
      if (!b.isDynamic()) return;
      if (b.translation().y > 62) high++;
      towardZ += b.translation().z;
      sumY += b.translation().y;
      n++;
    });
    expect(high / n).toBeLessThan(0.15);
    expect(sumY / n).toBeLessThan(35);
    expect(towardZ).toBeGreaterThan(0);
    towers.rebuild();
    expect(towers.tower('High-rise')!.collapsed).toBe(false);
    expect(towers.tower('High-rise')!.struck).toBe(0);
  });

  it('a real SR22 flying into a high-rise at 150 kt brings it down', async () => {
    const { physics, towers } = await city();
    const { Aircraft } = await import('../src/vehicle/aircraft/Aircraft');
    const cfg = (await import('../src/vehicle/aircraft/sr22.json')).default as unknown as import('../src/vehicle/aircraft/types').AircraftConfig;
    const ac = new Aircraft(physics, cfg, 300, 45, -150, 0);
    ac.body.setLinvel({ x: 0, y: 0, z: 78 }, true);
    const input = { pitch: 0, roll: 0, yaw: 0, throttle: 0.8, brake: 0, flaps: 0 };
    for (let i = 0; i < 120 * 4 && !towers.tower('High-rise')!.collapsed; i++) {
      ac.fixedUpdate(FIXED_DT, input);
      const lv = ac.body.linvel();
      physics.step();
      ac.afterPhysicsStep();
      physics.events.drainContactForceEvents((e) => {
        const f = e.totalForceMagnitude();
        ac.contactForce(e.collider1(), f, FIXED_DT);
        ac.contactForce(e.collider2(), f, FIXED_DT);
        const v2 = lv.x * lv.x + lv.y * lv.y + lv.z * lv.z;
        const h = Math.hypot(lv.x, lv.z) || 1;
        for (const c of [e.collider1(), e.collider2()]) towers.strike(c, 0.5 * ac.mass * v2, lv.x / h, lv.z / h, ac.currPos.y);
      });
      towers.flush();
    }
    expect(towers.tower('High-rise')!.collapsed).toBe(true);
    expect(towers.tower('WTC')!.collapsed).toBe(false);
  });
});
