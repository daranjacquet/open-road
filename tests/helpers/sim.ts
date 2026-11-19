import { createPhysics, FIXED_DT, GROUP, groups, type Physics } from '../../src/core/physics';
import { Vehicle, type DriveInput } from '../../src/vehicle/Vehicle';
import type { VehicleConfig } from '../../src/vehicle/types';

/** Headless simulation world: flat ground (asphalt zone covers the whole test area). */
export async function makeSim(cfg: VehicleConfig, x = 0, z = 0, yaw = 0): Promise<{ physics: Physics; car: Vehicle }> {
  const physics = await createPhysics();
  const { RAPIER, world } = physics;
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -1, 0));
  const col = world.createCollider(
    RAPIER.ColliderDesc.cuboid(5000, 1, 5000).setFriction(1).setCollisionGroups(groups(GROUP.WORLD, 0xffff)),
    body,
  );
  physics.groundColliders.add(col.handle);
  const car = new Vehicle(physics, cfg, x, z, yaw);
  return { physics, car };
}

export type Controller = (t: number, car: Vehicle) => Partial<DriveInput>;

export interface Sample {
  t: number;
  speedKmh: number;
  x: number;
  z: number;
  yawRate: number;
  latG: number;
  longG: number;
  rpm: number;
  gear: number;
}

/** Run the car with a controller for `seconds`; returns samples every `every` seconds. */
export function run(
  physics: Physics,
  car: Vehicle,
  seconds: number,
  controller: Controller,
  every = 0.25,
): Sample[] {
  const out: Sample[] = [];
  const n = Math.round(seconds / FIXED_DT);
  const input: DriveInput = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
  let nextSample = 0;
  const prevV = { x: 0, y: 0, z: 0 };
  let havePrev = false;
  for (let i = 0; i < n; i++) {
    const t = i * FIXED_DT;
    const c = controller(t, car);
    input.throttle = c.throttle ?? 0;
    input.brake = c.brake ?? 0;
    input.steer = c.steer ?? 0;
    input.handbrake = c.handbrake ?? 0;
    car.fixedUpdate(FIXED_DT, input);
    physics.step();
    car.afterPhysicsStep();
    if (t >= nextSample) {
      nextSample += every;
      const v = car.body.linvel();
      let latG = 0;
      let longG = 0;
      if (havePrev) {
        // acceleration in the body frame from velocity change over the sample interval
        const ax = (v.x - prevV.x) / every;
        const az = (v.z - prevV.z) / every;
        const q = car.body.rotation();
        // rotate world accel into body frame (yaw only is enough on a flat test)
        const yaw = 2 * Math.atan2(q.y, q.w);
        const fwdX = Math.sin(yaw);
        const fwdZ = Math.cos(yaw);
        longG = (ax * fwdX + az * fwdZ) / 9.81;
        latG = (ax * fwdZ - az * fwdX) / 9.81;
      }
      prevV.x = v.x;
      prevV.y = v.y;
      prevV.z = v.z;
      havePrev = true;
      const p = car.body.translation();
      out.push({ t, speedKmh: car.speedKmh, x: p.x, z: p.z, yawRate: car.yawRate, latG, longG, rpm: car.rpm, gear: car.gear });
    }
  }
  return out;
}
