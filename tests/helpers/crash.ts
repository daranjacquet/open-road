import * as THREE from 'three';
import { FIXED_DT, GROUP, groups } from '../../src/core/physics';
import { CARS } from '../../src/game/catalog';
import { GameCar } from '../../src/game/GameCar';
import { makeSim } from './sim';

export interface CrashResult {
  car: GameCar;
  peakG: number;
  frontCrush: number;
  energyKJ: number;
}

/** Drive a car into a wall (or a pole) at a given speed and let it settle. */
export async function crash(id: string, kmh: number, obstacle: 'wall' | 'pole' = 'wall', xOffset = 0): Promise<CrashResult> {
  const def = CARS.find((c) => c.id === id)!;
  const { physics, car: tmp } = await makeSim(def.cfg, 300, 300, 0);
  physics.world.removeRigidBody(tmp.body);
  const { RAPIER, world } = physics;
  const wb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(obstacle === 'wall' ? 0 : xOffset, 3, obstacle === 'wall' ? 151.5 : 151));
  world.createCollider(
    (obstacle === 'wall' ? RAPIER.ColliderDesc.cuboid(40, 3, 1.5) : RAPIER.ColliderDesc.cylinder(3, 0.2)).setCollisionGroups(groups(GROUP.WORLD, 0xffff)),
    wb,
  );
  const scene = new THREE.Scene();
  const car = new GameCar(physics, scene, def, 0, 0, 0);
  car.vehicle.assists.esp = false;
  const input = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
  let hit = false;
  let tHit = 0;
  let vPrev = 0;
  let peakG = 0;
  for (let i = 0; i < 120 * 60; i++) {
    const t = i * FIXED_DT;
    input.throttle = !hit && car.vehicle.speedKmh < kmh ? 1 : 0;
    car.fixedUpdate(FIXED_DT, input);
    physics.step();
    car.vehicle.afterPhysicsStep();
    if (i % 2 === 0) car.updateVisuals(t * 1000, 1, FIXED_DT * 2, 600);
    const v = car.vehicle.vLong;
    if (!hit && car.crush.active > 0) {
      hit = true;
      tHit = t;
      vPrev = v;
    }
    if (hit) {
      peakG = Math.max(peakG, Math.abs(v - vPrev) / FIXED_DT / 9.81);
      vPrev = v;
      if (t - tHit > 2.0) break;
    }
  }
  car.updateVisuals(1e9, 1, 0.016, 600);
  let frontCrush = 0;
  car.crush.rays.forEach((r, i) => {
    if (r.kind === 'front') frontCrush = Math.max(frontCrush, car.crush.crush[i]!);
  });
  return { car, peakG, frontCrush, energyKJ: car.crush.energy / 1000 };
}
