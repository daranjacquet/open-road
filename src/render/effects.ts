import * as THREE from 'three';
import { clamp } from '../core/math';
import type { DamageModel, ImpactInfo } from '../damage/DamageModel';
import type { Vehicle } from '../vehicle/Vehicle';
import { ParticlePool } from './particles';

const MAX_SKID = 3000;
const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _e = new THREE.Euler();

/** Skid marks: a ring buffer of flat quads laid between successive contact points of a sliding tyre. */
class SkidMarks {
  readonly mesh: THREE.InstancedMesh;
  private cursor = 0;
  private readonly last: THREE.Vector3[] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  private readonly has = [false, false, false, false];

  constructor() {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0x050505, transparent: true, opacity: 0.55, depthWrite: false });
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -6;
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_SKID);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }

  add(wheel: number, x: number, y: number, z: number, width: number): void {
    if (this.has[wheel]) {
      const a = this.last[wheel]!;
      const dx = x - a.x;
      const dz = z - a.z;
      const len = Math.hypot(dx, dz);
      if (len > 0.12) {
        _p.set((x + a.x) / 2, y + 0.015, (z + a.z) / 2);
        _e.set(0, Math.atan2(dx, dz), 0);
        _q.setFromEuler(_e);
        _s.set(width, 1, len * 1.15);
        _m.compose(_p, _q, _s);
        this.mesh.setMatrixAt(this.cursor, _m);
        this.cursor = (this.cursor + 1) % MAX_SKID;
        this.mesh.count = Math.min(this.mesh.count + 1, MAX_SKID);
        this.mesh.instanceMatrix.needsUpdate = true;
        a.set(x, y, z);
      }
    } else {
      this.last[wheel]!.set(x, y, z);
      this.has[wheel] = true;
    }
  }

  lift(wheel: number): void {
    this.has[wheel] = false;
  }
}

/** Visual effects: crash sparks and debris dust, engine smoke, tyre smoke and dust, skid marks. */
export class Effects {
  readonly group = new THREE.Group();
  private readonly sparks = new ParticlePool({ capacity: 900, additive: true, gravity: -9.8, drag: 0.6, sizeScale: 600 });
  private readonly smoke = new ParticlePool({ capacity: 1400, gravity: 0.6, drag: 0.8, sizeScale: 600 });
  private readonly skids = new SkidMarks();
  private smokeCarry = 0;
  private wheelSmoke = [0, 0, 0, 0];
  /** Set by impacts, read by the camera rig (metres of shake). */
  shake = 0;

  constructor(
    private readonly vehicle: Vehicle,
    private readonly damage: DamageModel,
  ) {
    this.group.add(this.skids.mesh, this.smoke.points, this.sparks.points);
    this.group.renderOrder = 5;
    damage.onImpact = (i) => this.impact(i);
  }

  private impact(i: ImpactInfo): void {
    const e = i.energy;
    const n = Math.min(Math.floor(e / 2500) + 1, 8);
    const k = clamp(i.speed / 12, 0.3, 1.5);
    for (let s = 0; s < n; s++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.8;
      this.sparks.spawn(
        i.point.x, i.point.y, i.point.z,
        i.normal.x * 3 * k * Math.random() + Math.cos(a) * r * 4 * k,
        1 + Math.random() * 4 * k,
        i.normal.z * 3 * k * Math.random() + Math.sin(a) * r * 4 * k,
        0.35 + Math.random() * 0.5, 0.07, 0.03, 1, 0.65 + Math.random() * 0.25, 0.2, 1,
      );
    }
    const puffs = Math.min(Math.floor(e / 14000), 2);
    for (let s = 0; s < puffs; s++) {
      this.smoke.spawn(
        i.point.x, i.point.y, i.point.z,
        (Math.random() - 0.5) * 2 + i.normal.x * 1.5, 0.5 + Math.random() * 1.5, (Math.random() - 0.5) * 2 + i.normal.z * 1.5,
        0.9 + Math.random() * 0.8, 0.5, 2.2, 0.55, 0.52, 0.5, 0.35,
      );
    }
    this.shake = Math.min(0.5, this.shake + Math.sqrt(e) / 3000);
  }

  /** Shards when a window goes. */
  glassBurst(p: THREE.Vector3): void {
    for (let i = 0; i < 40; i++) {
      this.sparks.spawn(
        p.x + (Math.random() - 0.5) * 0.6, p.y + (Math.random() - 0.5) * 0.2, p.z + (Math.random() - 0.5) * 0.6,
        (Math.random() - 0.5) * 5, 1 + Math.random() * 3, (Math.random() - 0.5) * 5,
        0.6 + Math.random() * 0.8, 0.05, 0.03, 0.75, 0.9, 1, 0.8,
      );
    }
    this.shake = Math.min(0.5, this.shake + 0.06);
  }

  update(dt: number, viewportHeight: number): void {
    const v = this.vehicle;

    // Engine smoke from the front of the car once the engine is hurt.
    const eng = this.damage.engine;
    if (eng > 0.3) {
      const rate = 6 + eng * 30;
      this.smokeCarry += rate * dt;
      while (this.smokeCarry >= 1) {
        this.smokeCarry -= 1;
        _v.set((Math.random() - 0.5) * 0.4, 0.2, 1.1).applyQuaternion(v.currQuat).add(v.currPos);
        const dark = clamp((eng - 0.5) * 2, 0, 1);
        const c = 0.85 - dark * 0.7;
        this.smoke.spawn(_v.x, _v.y + 0.35, _v.z, (Math.random() - 0.5) * 0.6, 1.2 + Math.random(), (Math.random() - 0.5) * 0.6, 1.6 + Math.random() * 0.8, 0.35, 1.8, c, c, c, 0.5);
      }
    }

    // Tyre smoke, dust and skid marks.
    for (let i = 0; i < 4; i++) {
      const w = v.wheels[i]!;
      if (!w.hit) {
        this.skids.lift(i);
        continue;
      }
      const slip = Math.hypot(w.slipRatio * 1.0, Math.tan(w.slipAngle) * 1.2);
      const sliding = slip > 0.42 && v.speed > 2;
      if (sliding && w.surface === 'asphalt') {
        this.skids.add(i, w.contactPoint.x, w.contactPoint.y, w.contactPoint.z, v.cfg.wheel.width * 0.8);
        this.wheelSmoke[i]! += dt * clamp(slip, 0, 2) * 40;
        while (this.wheelSmoke[i]! >= 1) {
          this.wheelSmoke[i]! -= 1;
          this.smoke.spawn(w.contactPoint.x, w.contactPoint.y + 0.1, w.contactPoint.z, (Math.random() - 0.5) * 1.2, 0.4 + Math.random() * 0.6, (Math.random() - 0.5) * 1.2, 0.9 + Math.random() * 0.5, 0.35, 1.5, 0.85, 0.85, 0.85, 0.28);
        }
      } else {
        this.skids.lift(i);
        if (w.surface !== 'asphalt' && v.speed > 6) {
          this.wheelSmoke[i]! += dt * clamp(v.speed / 8, 0, 6);
          while (this.wheelSmoke[i]! >= 1) {
            this.wheelSmoke[i]! -= 1;
            const dust = w.surface === 'dirt' ? [0.62, 0.5, 0.36] : [0.45, 0.55, 0.32];
            this.smoke.spawn(w.contactPoint.x, w.contactPoint.y + 0.05, w.contactPoint.z, (Math.random() - 0.5) * 1.5, 0.5 + Math.random() * 0.8, (Math.random() - 0.5) * 1.5, 0.8 + Math.random() * 0.6, 0.3, 1.3, dust[0]!, dust[1]!, dust[2]!, 0.22);
          }
        }
      }
    }

    this.sparks.update(dt, viewportHeight);
    this.smoke.update(dt, viewportHeight);
  }
}
