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
  /** Mouse orbit around the car (right button held), on top of the chase direction. */
  orbitYaw = 0;
  orbitPitch = 0;
  /** Distance multiplier (mouse wheel). */
  zoom = 1;
  private dragging = false;
  /** Seconds since the mouse last moved the camera. */
  private idle = 99;

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  /** Right-drag orbits around the car, the wheel zooms (chase camera). */
  attachMouse(el: HTMLElement): void {
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('mousedown', (e) => {
      if (e.button !== 2) return;
      this.dragging = true;
      e.preventDefault();
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 2) this.dragging = false;
    });
    window.addEventListener('blur', () => (this.dragging = false));
    window.addEventListener('mousemove', (e) => {
      if (!this.dragging) return;
      this.orbitYaw -= e.movementX * 0.006;
      this.orbitPitch = clamp(this.orbitPitch + e.movementY * 0.005, -0.25, 1.1);
      this.idle = 0;
    });
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoom = clamp(this.zoom * Math.exp(e.deltaY * 0.0012), 0.55, 2.6);
      },
      { passive: false },
    );
  }

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
      // The mouse orbit stays where it was left while parked; when driving it eases back behind
      // the car after a moment without mouse movement.
      this.idle += dt;
      if (!this.dragging && this.idle > 1.2 && speed > 3) {
        const k = damp(lerp(0.8, 2.5, clamp(speed / 25, 0, 1)), dt);
        this.orbitYaw -= angleDiff(0, this.orbitYaw) * k;
        this.orbitPitch -= this.orbitPitch * k;
      }
      const dist = lerp(6.8, 9.2, clamp(speed / 50, 0, 1)) * this.zoom;
      const height = lerp(2.5, 3.2, clamp(speed / 50, 0, 1)) * this.zoom;
      // Spherical offset: base elevation of the chase view plus the mouse pitch.
      const range = Math.hypot(dist, height - 1.1);
      const elev = clamp(Math.atan2(height - 1.1, dist) + this.orbitPitch, -0.12, 1.35);
      const yaw = this.yaw + this.orbitYaw;
      const flat = Math.cos(elev) * range;
      _p.set(carPos.x - Math.sin(yaw) * flat, carPos.y + 1.1 + Math.sin(elev) * range, carPos.z - Math.cos(yaw) * flat);
      _p.y = Math.max(_p.y, 0.4);
      if (this.pos.lengthSq() === 0) this.pos.copy(_p);
      // Positional smoothing, stiffer at speed so the car does not outrun the camera.
      const k = damp(lerp(9, 18, clamp(speed / 40, 0, 1)), dt);
      this.pos.lerp(_p, this.dragging ? 1 : k);
      this.camera.position.copy(this.pos);
      // Look a little ahead of the car when chasing, straight at it when orbiting around.
      const ahead = 4 * Math.max(Math.cos(this.orbitYaw), 0) * (1 - clamp(this.orbitPitch, 0, 1));
      _look.set(carPos.x + Math.sin(this.yaw) * ahead, carPos.y + 1.1, carPos.z + Math.cos(this.yaw) * ahead);
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
      this.camera.fov = clamp(this.camera.fov + (fov - this.camera.fov) * damp(4, Math.max(dt, 0)), 40, 90);
      this.camera.updateProjectionMatrix();
    }
  }
}
