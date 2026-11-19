import * as THREE from 'three';
import { clamp } from '../core/math';
import type { Vehicle } from '../vehicle/Vehicle';
import type { CrushEvent, CrushSystem } from './CrushSystem';

export interface ImpactInfo {
  /** Energy absorbed in this event (J). */
  energy: number;
  /** World-space contact point. */
  point: THREE.Vector3;
  /** Outward direction of the crushed ray, world space. */
  normal: THREE.Vector3;
  speed: number;
  part: string;
}

export type Zone = 'front' | 'rear' | 'left' | 'right' | 'roof';

/** Energy (J) that fully wrecks a zone. */
const ZONE_CAPACITY: Record<Zone, number> = { front: 260e3, rear: 200e3, left: 90e3, right: 90e3, roof: 70e3 };
/** Energy (J) absorbed near a wheel that fully wrecks it. */
const WHEEL_CAPACITY = 95e3;
const ENGINE_CAPACITY = 380e3;

const _n = new THREE.Vector3();

/**
 * Turns crumple-zone energy into lasting mechanical damage: engine power, bent wheels,
 * damaged suspension, flat tyres. Everything is derived from the per-ray work so a given impact
 * always produces the same consequences.
 */
export class DamageModel {
  /** 0 = pristine, 1 = destroyed. */
  engine = 0;
  readonly wheel: [number, number, number, number] = [0, 0, 0, 0];
  readonly zone: Record<Zone, number> = { front: 0, rear: 0, left: 0, right: 0, roof: 0 };
  /** Energy absorbed per visible panel (J). */
  readonly partEnergy = new Map<string, number>();
  totalEnergy = 0;
  onImpact: ((i: ImpactInfo) => void) | null = null;
  /** Fired when a zone/mechanical value changed (HUD, effects). */
  onChange: (() => void) | null = null;

  private dirty = false;
  private readonly impact: ImpactInfo = { energy: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), speed: 0, part: '' };
  private readonly wheelXZ: [number, number][];
  private readonly rayWheelWeight: Float32Array[]; // [wheel][ray]

  constructor(
    private readonly vehicle: Vehicle,
    private readonly crush: CrushSystem,
  ) {
    this.wheelXZ = vehicle.wheels.map((w) => [w.mount.x, w.mount.z]);
    this.rayWheelWeight = this.wheelXZ.map(([wx, wz]) => {
      const a = new Float32Array(crush.rays.length);
      crush.rays.forEach((r, i) => {
        const dx = r.surface[0] - wx;
        const dz = r.surface[2] - wz;
        a[i] = Math.exp(-(dx * dx + dz * dz) / (0.75 * 0.75));
      });
      return a;
    });
    crush.onCrush = (e) => this.handle(e);
  }

  private handle(e: CrushEvent): void {
    this.totalEnergy += e.energy;
    this.partEnergy.set(e.ray.part, (this.partEnergy.get(e.ray.part) ?? 0) + e.energy);
    this.dirty = true;
    if (this.onImpact) {
      const i = this.impact;
      i.energy = e.energy;
      i.point.copy(e.point);
      _n.set(e.ray.dir[0], e.ray.dir[1], e.ray.dir[2]).applyQuaternion(this.vehicle.currQuat);
      i.normal.copy(_n);
      i.speed = e.speed;
      i.part = e.ray.part;
      this.onImpact(i);
    }
  }

  /** Recompute mechanical state if anything was crushed since the last call. */
  update(): void {
    if (!this.dirty) return;
    this.dirty = false;
    const crush = this.crush;
    const rays = crush.rays;
    const zoneWork: Record<Zone, number> = { front: 0, rear: 0, left: 0, right: 0, roof: 0 };
    let engineWork = 0;
    const wheelWork = [0, 0, 0, 0];
    for (let i = 0; i < rays.length; i++) {
      const w = crush.work[i]!;
      if (w <= 0) continue;
      const r = rays[i]!;
      const z: Zone = r.kind === 'corner' ? (r.origin[2] > 0 ? 'front' : 'rear') : (r.kind as Zone);
      zoneWork[z] += w;
      if (r.origin[2] > 0.5 && r.kind !== 'roof') engineWork += w;
      for (let k = 0; k < 4; k++) wheelWork[k]! += w * this.rayWheelWeight[k]![i]!;
    }
    (Object.keys(zoneWork) as Zone[]).forEach((k) => (this.zone[k] = clamp(zoneWork[k] / ZONE_CAPACITY[k], 0, 1)));
    this.engine = clamp(engineWork / ENGINE_CAPACITY, 0, 1);
    const v = this.vehicle;
    v.powerScale = 1 - 0.7 * this.engine * this.engine;
    for (let k = 0; k < 4; k++) {
      const d = clamp(wheelWork[k]! / WHEEL_CAPACITY, 0, 1);
      this.wheel[k] = d;
      const w = v.wheels[k]!;
      // A bent wheel toes out/in and drags the car to one side; the tyre loses grip.
      w.steerBias = (w.isLeft ? 1 : -1) * (w.isFront ? 0.13 : 0.07) * d * d;
      w.springScale = 1 - 0.35 * d;
      w.gripScale = 1 - 0.3 * d;
      w.flat = d > 0.85;
    }
    this.onChange?.();
  }

  reset(): void {
    this.engine = 0;
    this.totalEnergy = 0;
    this.partEnergy.clear();
    this.wheel.fill(0);
    for (const k of Object.keys(this.zone) as Zone[]) this.zone[k] = 0;
    this.dirty = false;
    const v = this.vehicle;
    v.powerScale = 1;
    for (const w of v.wheels) {
      w.steerBias = 0;
      w.springScale = 1;
      w.gripScale = 1;
      w.flat = false;
    }
    this.onChange?.();
  }
}
