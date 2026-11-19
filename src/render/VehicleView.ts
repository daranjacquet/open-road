import * as THREE from 'three';
import { lerp } from '../core/math';
import type { Vehicle } from '../vehicle/Vehicle';
import type { CarModel } from './carModel';

/** Drives a CarModel from interpolated vehicle state. Rendering only: never writes to physics. */
export class VehicleView {
  readonly pos = new THREE.Vector3();
  readonly quat = new THREE.Quaternion();
  constructor(
    readonly vehicle: Vehicle,
    readonly model: CarModel,
  ) {
    // Steer about the (cambered) wheel's own vertical: yaw first, then the camber lean.
    for (const w of model.wheels) w.pivot.rotation.order = 'YXZ';
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
      const m = w.mount;
      nodes.pivot.position.set(m.x, m.y - len, m.z);
      nodes.pivot.rotation.y = lerp(w.prevSteer, w.steer, alpha);
      // Negative camber leans the top of the wheel towards the car (+X is left).
      nodes.pivot.rotation.z = w.isLeft ? -w.camber : w.camber;
      nodes.spin.scale.x = w.width / v.cfg.wheel.width;
      nodes.spin.rotation.x = lerp(w.prevSpin, w.spin, alpha);
      nodes.pivot.visible = !w.detached;
    }
  }
}
