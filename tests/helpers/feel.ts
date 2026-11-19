import * as THREE from 'three';
import { FIXED_DT, type Physics } from '../../src/core/physics';
import type { Vehicle } from '../../src/vehicle/Vehicle';

/** Keyboard-like steering ramp (same rates as src/core/input.ts). */
export class Keys {
  steer = 0;
  step(target: number, dt = FIXED_DT): number {
    const rate = target === 0 ? 6 : Math.sign(target) !== Math.sign(this.steer) && this.steer !== 0 ? 9 : 3.4;
    const d = target - this.steer;
    this.steer += Math.sign(d) * Math.min(Math.abs(d), rate * dt);
    return this.steer;
  }
}

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
/** Body slip angle (deg, + = velocity to the left of the heading) and lateral velocity. */
export function bodySlip(car: Vehicle): number {
  const r = car.body.rotation();
  const l = car.body.linvel();
  _q.set(r.x, r.y, r.z, r.w).invert();
  _v.set(l.x, l.y, l.z).applyQuaternion(_q);
  if (Math.hypot(_v.x, _v.z) < 2) return 0;
  return (Math.atan2(_v.x, Math.abs(_v.z)) * 180) / Math.PI;
}

export interface FeelStats {
  maxSlip: number;
  meanLatG: number;
  endKmh: number;
  frontSlip: number;
  rearSlip: number;
  spun: boolean;
}

/** Run with a per-step controller and collect handling stats. */
export function drive(
  physics: Physics,
  car: Vehicle,
  seconds: number,
  ctl: (t: number, car: Vehicle) => { throttle?: number; brake?: number; steer?: number; handbrake?: number },
  statsFrom = 0,
): FeelStats {
  const n = Math.round(seconds / FIXED_DT);
  let maxSlip = 0;
  let lat = 0;
  let fs = 0;
  let rs = 0;
  let cnt = 0;
  for (let i = 0; i < n; i++) {
    const t = i * FIXED_DT;
    const c = ctl(t, car);
    car.fixedUpdate(FIXED_DT, { throttle: c.throttle ?? 0, brake: c.brake ?? 0, steer: c.steer ?? 0, handbrake: c.handbrake ?? 0 });
    physics.step();
    car.afterPhysicsStep();
    if (t >= statsFrom) {
      maxSlip = Math.max(maxSlip, Math.abs(bodySlip(car)));
      lat += Math.abs(car.yawRate * car.speed) / 9.81;
      fs += Math.abs(car.wheels[0]!.slipAngle + car.wheels[1]!.slipAngle) * 0.5 * 57.3;
      rs += Math.abs(car.wheels[2]!.slipAngle + car.wheels[3]!.slipAngle) * 0.5 * 57.3;
      cnt++;
    }
  }
  return { maxSlip, meanLatG: lat / Math.max(cnt, 1), endKmh: car.speedKmh, frontSlip: fs / Math.max(cnt, 1), rearSlip: rs / Math.max(cnt, 1), spun: maxSlip > 35 };
}

export function fmt(s: FeelStats): string {
  return `slip ${s.maxSlip.toFixed(0).padStart(3)}° lat ${s.meanLatG.toFixed(2)}g end ${s.endKmh.toFixed(0).padStart(3)} F${s.frontSlip.toFixed(1)}° R${s.rearSlip.toFixed(1)}°${s.spun ? ' SPIN' : ''}`;
}
