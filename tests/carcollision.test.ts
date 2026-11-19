import { beforeAll, describe, expect, it } from 'vitest';
import { loadModels } from './helpers/models';
import * as THREE from 'three';
import { FIXED_DT, GROUP, groups, createPhysics } from '../src/core/physics';
import { CARS } from '../src/game/catalog';
import { GameCar, IDLE } from '../src/game/GameCar';
import type { DriveInput } from '../src/vehicle/Vehicle';

async function world() {
  const physics = await createPhysics();
  const { RAPIER, world: w } = physics;
  const body = w.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -1, 0));
  const col = w.createCollider(RAPIER.ColliderDesc.cuboid(5000, 1, 5000).setFriction(1).setCollisionGroups(groups(GROUP.WORLD, 0xffff)), body);
  physics.groundColliders.add(col.handle);
  return physics;
}

function finite(n: number): boolean {
  return Number.isFinite(n) && Math.abs(n) < 1e6;
}

beforeAll(loadModels);

describe('car vs car collisions', () => {
  it('head-on at 50 km/h into a parked car: both crumple, nothing explodes, both come to rest', async () => {
    const physics = await world();
    const scene = new THREE.Scene();
    const a = new GameCar(physics, scene, CARS[0]!, 0, 0, 0);
    const b = new GameCar(physics, scene, CARS[1]!, 0, 70, Math.PI, 0x3355aa);
    a.vehicle.assists.esp = false;
    const input: DriveInput = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
    let maxV = 0;
    let hit = false;
    let tHit = 0;
    for (let i = 0; i < 120 * 30; i++) {
      const t = i * FIXED_DT;
      input.throttle = !hit && a.vehicle.speedKmh < 50 ? 1 : 0;
      a.fixedUpdate(FIXED_DT, input);
      b.fixedUpdate(FIXED_DT, IDLE);
      physics.step();
      a.vehicle.afterPhysicsStep();
      b.vehicle.afterPhysicsStep();
      if (i % 2 === 0) {
        a.damage.update();
        b.damage.update();
      }
      const va = a.vehicle.body.linvel();
      const vb = b.vehicle.body.linvel();
      maxV = Math.max(maxV, Math.hypot(va.x, va.y, va.z), Math.hypot(vb.x, vb.y, vb.z));
      if (!hit && (a.crush.active > 0 || b.crush.active > 0)) {
        hit = true;
        tHit = t;
      }
      if (hit && t - tHit > 4) break;
    }
    const pa = a.vehicle.body.translation();
    const pb = b.vehicle.body.translation();
    console.log('A energy', (a.crush.energy / 1000).toFixed(0), 'kJ; B energy', (b.crush.energy / 1000).toFixed(0), 'kJ; max speed', (maxV * 3.6).toFixed(0), 'km/h; A z', pa.z.toFixed(1), 'B z', pb.z.toFixed(1), 'A speed', a.vehicle.speedKmh.toFixed(1), 'B speed', b.vehicle.speedKmh.toFixed(1));
    expect(hit).toBe(true);
    expect([pa.x, pa.y, pa.z, pb.x, pb.y, pb.z].every(finite)).toBe(true);
    expect(a.crush.energy).toBeGreaterThan(20e3);
    expect(b.crush.energy).toBeGreaterThan(20e3);
    expect(maxV * 3.6).toBeLessThan(80);
    expect(a.vehicle.speedKmh).toBeLessThan(15);
    // The cars did not pass through each other.
    expect(pa.z).toBeLessThan(pb.z);
    a.dispose();
    b.dispose();
  });
});
