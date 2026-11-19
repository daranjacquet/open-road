import * as THREE from 'three';
import { lerp } from '../core/math';
import type { Vehicle } from '../vehicle/Vehicle';
import type { CarModel } from './carModel';

/** Drives a CarModel from interpolated vehicle state. Rendering only: never writes to physics. */
export class VehicleView {
  readonly pos = new THREE.Vector3();
  readonly quat = new THREE.Quaternion();
  private readonly mounts: THREE.Vector3[];

  constructor(
    readonly vehicle: Vehicle,
    readonly model: CarModel,
  ) {
    this.mounts = vehicle.wheels.map((w) => w.mount.clone());
  }

  update(alpha: number): void {
    const v = this.vehicle;
    this.pos.lerpVectors(v.prevPos, v.currPos, alpha);
    this.quat.slerpQuaternions(v.prevQuat, v.currQuat, alpha);
    const root = this.model.root;
    root.position.copy(this.pos);
    root.quaternion.copy(this.quat);
    for (let i = 0; i < 4; i++) {
      const w = v.wheels[i]!;
      const nodes = this.model.wheels[i]!;
      const len = lerp(w.prevLength, w.length, alpha);
      const m = this.mounts[i]!;
      nodes.pivot.position.set(m.x, m.y - len, m.z);
      nodes.pivot.rotation.y = lerp(w.prevSteer, w.steer, alpha);
      nodes.spin.rotation.x = lerp(w.prevSpin, w.spin, alpha);
      nodes.pivot.visible = !w.detached;
    }
  }
}
