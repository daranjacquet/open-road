import * as THREE from 'three';
import { clamp, damp, lerp } from '../core/math';
import type { Vehicle } from '../vehicle/Vehicle';

export type CameraMode = 'chase' | 'hood' | 'bumper';
const MODES: CameraMode[] = ['chase', 'hood', 'bumper'];
/** Aircraft views: behind and above, or the pilot's seat. */
export type AirCameraMode = 'chase' | 'cockpit';

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
const _pivot = new THREE.Vector3();
const _up = new THREE.Vector3();
/** Pilot's eye in the aircraft body frame (left seat; +x is left). */
const EYE = new THREE.Vector3(0.3, 0.62, -0.12);
/** Height of the orbit pivot above the car's origin (m): the middle of the cabin. */
const PIVOT_HEIGHT = 0.8;

/** Chase camera that follows the heading, leans towards the velocity when sliding, and widens FOV with speed. */
export class CameraRig {
  mode: CameraMode = 'chase';
  private yaw = 0;
  private initialised = false;
  private readonly pos = new THREE.Vector3();
  /** Debug/photo pose relative to the car (chassis frame); overrides the mode when set. */
  photo: { offset: THREE.Vector3; target: THREE.Vector3 } | null = null;
  /** Ground height under a point (the camera never goes below it). Installed by the map. */
  groundAt: (x: number, z: number) => number = () => 0;
  /** Transient shake amplitude (metres), decays on its own. Set by crashes. */
  shake = 0;
  /** Mouse orbit around the car (right button held), on top of the chase direction. */
  orbitYaw = 0;
  orbitPitch = 0;
  /** Distance multiplier (mouse wheel). */
  zoom = 1;
  airMode: AirCameraMode = 'chase';
  /** Smoothed attitude the aircraft chase view follows (it lags the aircraft a little). */
  private readonly airQuat = new THREE.Quaternion();
  private dragging = false;
  /** Seconds since the mouse last moved the camera. */
  private idle = 99;

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  /** Right-drag orbits around the car, the wheel zooms (chase camera). */
  attachMouse(el: HTMLElement): void {
    // While the right button is held the cursor is locked (hidden, it does not move) and the mouse
    // only turns the camera; it reappears where it was on release.
    const stop = (): void => {
      this.dragging = false;
      if (document.pointerLockElement === el) document.exitPointerLock();
    };
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('mousedown', (e) => {
      if (e.button !== 2) return;
      this.dragging = true;
      e.preventDefault();
      try {
        const lock = (opts?: { unadjustedMovement: boolean }): Promise<void> | undefined =>
          el.requestPointerLock(opts) as unknown as Promise<void> | undefined;
        // Raw mouse input is not available everywhere: fall back to a plain lock, and if the browser
        // refuses the lock altogether the orbit still works with a visible cursor.
        lock({ unadjustedMovement: true })?.catch?.(() => lock()?.catch?.(() => undefined));
      } catch {
        /* no pointer lock (old browser): the cursor moves, the orbit still works */
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 2) stop();
    });
    window.addEventListener('blur', stop);
    // Esc or the browser ending the lock also ends the drag.
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== el) this.dragging = false;
    });
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

  /** Start the next view fresh (no smoothing from the last vehicle's pose). */
  reset(): void {
    this.initialised = false;
  }

  cycleAir(): void {
    this.airMode = this.airMode === 'chase' ? 'cockpit' : 'chase';
    this.initialised = false;
  }

  /** Follow an aircraft: `pos` / `quat` are its render-interpolated body transform. */
  updateAircraft(dt: number, pos: THREE.Vector3, quat: THREE.Quaternion, speed: number): void {
    if (!this.initialised) {
      this.airQuat.copy(quat);
      this.initialised = true;
    }
    if (this.airMode === 'cockpit') {
      this.camera.position.copy(EYE).applyQuaternion(quat).add(pos);
      _up.set(0, 1, 0).applyQuaternion(quat);
      this.camera.up.copy(_up);
      // Straight ahead, a touch down: the nose and the horizon both in view.
      _look.set(EYE.x, EYE.y - 0.9, EYE.z + 20).applyQuaternion(quat).add(pos);
      this.camera.lookAt(_look);
      this.pos.copy(this.camera.position);
    } else {
      // The view follows the aircraft's attitude with a short lag, so turns, climbs and rolls show.
      this.airQuat.slerp(quat, damp(3.5, dt));
      this.idle += dt;
      if (!this.dragging && this.idle > 1.5) {
        const k = damp(1.5, dt);
        this.orbitYaw -= angleDiff(0, this.orbitYaw) * k;
        this.orbitPitch -= this.orbitPitch * k;
      }
      // Keep the horizon mostly level: only part of the bank reaches the camera.
      _fwd.set(0, 0, 1).applyQuaternion(this.airQuat);
      const yaw = Math.atan2(_fwd.x, _fwd.z) + this.orbitYaw;
      const pitch = Math.asin(clamp(_fwd.y, -1, 1));
      const range = lerp(14, 17, clamp(speed / 80, 0, 1)) * this.zoom;
      const elev = clamp(0.2 - pitch * 0.85 + this.orbitPitch, -1.2, 1.4);
      _pivot.set(0, 0.6, 0).applyQuaternion(quat).add(pos);
      const flat = Math.cos(elev) * range;
      _p.set(_pivot.x - Math.sin(yaw) * flat, _pivot.y + Math.sin(elev) * range, _pivot.z - Math.cos(yaw) * flat);
      const floor = this.groundAt(_p.x, _p.z) + 0.5;
      if (_p.y < floor) _p.y = floor;
      this.camera.position.copy(_p);
      _up.set(0, 1, 0).applyQuaternion(this.airQuat);
      this.camera.up.set(0, 1, 0).lerp(_up, 0.35).normalize();
      this.camera.lookAt(_pivot);
      this.pos.copy(_p);
    }
    if (this.shake > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
      this.camera.position.z += (Math.random() - 0.5) * this.shake;
      this.shake *= Math.exp(-7 * dt);
    }
    const fov = this.airMode === 'cockpit' ? 72 : lerp(60, 70, clamp(speed / 90, 0, 1));
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov = clamp(this.camera.fov + (fov - this.camera.fov) * damp(4, Math.max(dt, 0)), 40, 90);
      this.camera.updateProjectionMatrix();
    }
  }

  /** `carPos` / `carQuat` are the render-interpolated chassis transform. */
  update(dt: number, car: Vehicle, carPos: THREE.Vector3, carQuat: THREE.Quaternion): void {
    const speed = car.speed;
    this.camera.up.set(0, 1, 0);
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
      // Orbit around one point on the car: the camera sits on a sphere centred on the pivot and
      // always looks straight at it, so turning the view (mouse or chase yaw) pivots around the car.
      // Only the angles are smoothed, never the position, so the car stays centred.
      _pivot.set(carPos.x, carPos.y + PIVOT_HEIGHT, carPos.z);
      const dist = lerp(6.8, 9.2, clamp(speed / 50, 0, 1));
      const height = lerp(2.5, 3.2, clamp(speed / 50, 0, 1)) - PIVOT_HEIGHT;
      const range = Math.hypot(dist, height) * this.zoom;
      const elev = clamp(Math.atan2(height, dist) + this.orbitPitch, -0.15, 1.4);
      const yaw = this.yaw + this.orbitYaw;
      const flat = Math.cos(elev) * range;
      _p.set(_pivot.x - Math.sin(yaw) * flat, _pivot.y + Math.sin(elev) * range, _pivot.z - Math.cos(yaw) * flat);
      // Keep the camera above the ground (slide in along the ray rather than clipping).
      const floor = this.groundAt(_p.x, _p.z) + 0.35;
      if (_p.y < floor) {
        const t = Math.max(0, (_pivot.y - floor) / Math.max(_pivot.y - _p.y, 1e-3));
        _p.lerpVectors(_pivot, _p, t);
        if (_p.y < floor) _p.y = floor;
      }
      this.pos.copy(_p);
      this.camera.position.copy(_p);
      this.camera.lookAt(_pivot);
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
