import * as THREE from 'three';
import { clamp, damp, lerp } from '../core/math';
import type { Vehicle } from '../vehicle/Vehicle';

export type CameraMode = 'chase' | 'hood' | 'bumper';
const MODES: CameraMode[] = ['chase', 'hood', 'bumper'];

function angleDiff(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

const _p = new THREE.Vector3();
const _look = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _vel = new THREE.Vector3();

/** Chase camera that follows the heading, leans towards the velocity when sliding, and widens FOV with speed. */
export class CameraRig {
  mode: CameraMode = 'chase';
  private yaw = 0;
  private initialised = false;
  private readonly pos = new THREE.Vector3();
  /** Debug/photo pose relative to the car (chassis frame); overrides the mode when set. */
  photo: { offset: THREE.Vector3; target: THREE.Vector3 } | null = null;
  /** Transient shake amplitude (metres), decays on its own. Set by crashes. */
  shake = 0;

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  cycle(): void {
    this.mode = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length]!;
    this.initialised = false;
  }

  /** `carPos` / `carQuat` are the render-interpolated chassis transform. */
  update(dt: number, car: Vehicle, carPos: THREE.Vector3, carQuat: THREE.Quaternion): void {
    const speed = car.speed;
    _fwd.set(0, 0, 1).applyQuaternion(carQuat);
    const headingYaw = Math.atan2(_fwd.x, _fwd.z);
    const lv = car.body.linvel();
    _vel.set(lv.x, 0, lv.z);

    if (this.photo) {
      _p.copy(this.photo.offset).applyQuaternion(carQuat).add(carPos);
      this.camera.position.copy(_p);
      _look.copy(this.photo.target).applyQuaternion(carQuat).add(carPos);
      this.camera.lookAt(_look);
      return;
    }

    if (this.mode === 'chase') {
      let target = headingYaw;
      if (_vel.length() > 6 && car.vLong > -1) {
        const velYaw = Math.atan2(_vel.x, _vel.z);
        target = headingYaw + angleDiff(headingYaw, velYaw) * 0.45;
      } else if (car.vLong < -2) {
        target = headingYaw;
      }
      if (!this.initialised) {
        this.yaw = target;
        this.initialised = true;
      }
      this.yaw += angleDiff(this.yaw, target) * damp(3.2, dt);
      const dist = lerp(6.8, 9.2, clamp(speed / 50, 0, 1));
      const height = lerp(2.5, 3.2, clamp(speed / 50, 0, 1));
      _p.set(carPos.x - Math.sin(this.yaw) * dist, carPos.y + height, carPos.z - Math.cos(this.yaw) * dist);
      if (this.pos.lengthSq() === 0) this.pos.copy(_p);
      // Positional smoothing, stiffer at speed so the car does not outrun the camera.
      const k = damp(lerp(9, 18, clamp(speed / 40, 0, 1)), dt);
      this.pos.lerp(_p, k);
      this.camera.position.copy(this.pos);
      _look.set(carPos.x + Math.sin(this.yaw) * 4, carPos.y + 1.1, carPos.z + Math.cos(this.yaw) * 4);
      this.camera.lookAt(_look);
    } else {
      const off = this.mode === 'hood' ? _p.set(0.0, 1.05, 0.55) : _p.set(0, 0.55, 2.35);
      off.applyQuaternion(carQuat).add(carPos);
      this.camera.position.copy(off);
      _look.set(0, this.mode === 'hood' ? 1.0 : 0.6, 30).applyQuaternion(carQuat).add(carPos);
      this.camera.lookAt(_look);
      this.pos.copy(this.camera.position);
    }

    if (this.shake > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
      this.camera.position.z += (Math.random() - 0.5) * this.shake;
      this.shake *= Math.exp(-7 * dt);
    }

    const fov = lerp(62, 82, clamp(speed / 60, 0, 1));
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * damp(4, dt);
      this.camera.updateProjectionMatrix();
    }
  }
}
