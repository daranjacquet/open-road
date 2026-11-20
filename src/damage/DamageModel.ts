import * as THREE from 'three';
import { clamp } from '../core/math';
import type { Vehicle } from '../vehicle/Vehicle';
import type { CrushEvent, CrushSystem } from './CrushSystem';
import type { CrushRay } from './rays';

export interface ImpactInfo {
  /** Energy absorbed in this event (J). */
  energy: number;
  /** World-space contact point. */
  point: THREE.Vector3;
  /** Outward direction of the crushed ray, world space. */
  normal: THREE.Vector3;
  speed: number;
  part: string;
  /** Handle of the collider the car crushed against (-1 if unknown). */
  collider: number;
}

export type Zone = 'front' | 'rear' | 'left' | 'right' | 'roof';

/** Energy (J) that fully wrecks a zone. */
const ZONE_CAPACITY: Record<Zone, number> = { front: 260e3, rear: 200e3, left: 60e3, right: 60e3, roof: 14e3 };
/** Crush depth (m) that alone wrecks a zone: a roof folded in by a hand's width is badly damaged. */
const ZONE_DEPTH: Record<Zone, number> = { front: 0.6, rear: 0.5, left: 0.25, right: 0.25, roof: 0.25 };
/** Energy (J) absorbed near a wheel that fully wrecks it. */
const WHEEL_CAPACITY = 95e3;
const ENGINE_CAPACITY = 380e3;
/**
 * Hard landings: closing speed (m/s) at the bump stop a corner takes without harm (a drop of about
 * 2.5 m), and the speed that wrecks the wheel and its suspension in one go (a drop of about 9 m).
 * Heavier cars carry stronger suspensions: the damage only depends on the speed.
 */
const LAND_SAFE = 5.5;
const LAND_WRECK = 13;

const _n = new THREE.Vector3();

/**
 * Zone a ray's damage counts towards: the passenger cell by its own faces (roof, pillars and glass
 * are the roof; the greenhouse sides are the sides); on the lower body, the corners and the tops of
 * the bonnet and the boot belong to the front or the rear.
 */
export function zoneOf(r: CrushRay): Zone {
  if (r.cabin) return r.kind === 'left' || r.kind === 'right' ? r.kind : 'roof';
  if (r.kind === 'corner' || r.kind === 'roof') return r.origin[2] > 0 ? 'front' : 'rear';
  return r.kind;
}

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
  private readonly impactListeners: ((i: ImpactInfo) => void)[] = [];
  /** Subscribe to crumple events (effects, audio). */
  addImpactListener(fn: (i: ImpactInfo) => void): void {
    this.impactListeners.push(fn);
  }
  /** Fired when a zone/mechanical value changed (HUD, effects). */
  onChange: (() => void) | null = null;

  private dirty = false;
  /** Peak bump-stop speed of the landing in progress, and landing damage so far, per wheel. */
  private readonly landPeak = [0, 0, 0, 0];
  private readonly landDamage = [0, 0, 0, 0];
  private readonly impact: ImpactInfo = { energy: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), speed: 0, part: '', collider: -1 };
  private readonly rayWheelWeight: Float32Array[]; // [wheel][ray]

  constructor(
    private readonly vehicle: Vehicle,
    private readonly crush: CrushSystem,
  ) {
    this.rayWheelWeight = vehicle.wheels.map((wh) => {
      const a = new Float32Array(crush.rays.length);
      crush.rays.forEach((r, i) => {
        const dx = r.surface[0] - wh.mount.x;
        const dz = r.surface[2] - wh.mount.z;
        // A crushed roof above the wheel does not bend it: only the body around it counts.
        const dy = Math.max(0, r.surface[1] - wh.mount.y - 0.3);
        a[i] = r.cabin ? 0 : Math.exp(-(dx * dx + dz * dz) / (0.75 * 0.75) - (dy * dy) / (0.3 * 0.3));
      });
      return a;
    });
    crush.onCrush = (e) => this.handle(e);
  }

  private handle(e: CrushEvent): void {
    this.totalEnergy += e.energy;
    this.partEnergy.set(e.ray.part, (this.partEnergy.get(e.ray.part) ?? 0) + e.energy);
    this.dirty = true;
    if (this.impactListeners.length > 0) {
      const i = this.impact;
      i.energy = e.energy;
      i.point.copy(e.point);
      _n.set(e.ray.dir[0], e.ray.dir[1], e.ray.dir[2]).applyQuaternion(this.vehicle.currQuat);
      i.normal.copy(_n);
      i.speed = e.speed;
      i.part = e.ray.part;
      i.collider = e.collider ? e.collider.handle : -1;
      for (const fn of this.impactListeners) fn(i);
    }
  }

  /** Once per physics step: a corner landing hard on its bump stop bends the wheel and suspension. */
  afterStep(): void {
    const wheels = this.vehicle.wheels;
    for (let k = 0; k < 4; k++) {
      const s = wheels[k]!.bottomSpeed;
      if (s > 0) {
        this.landPeak[k] = Math.max(this.landPeak[k]!, s);
        continue;
      }
      const peak = this.landPeak[k]!;
      if (peak === 0) continue;
      this.landPeak[k] = 0;
      if (peak <= LAND_SAFE) continue;
      this.landDamage[k]! += (peak * peak - LAND_SAFE * LAND_SAFE) / (LAND_WRECK * LAND_WRECK - LAND_SAFE * LAND_SAFE);
      this.dirty = true;
    }
  }

  /** Recompute mechanical state if anything was crushed since the last call. */
  update(): void {
    if (!this.dirty) return;
    this.dirty = false;
    const crush = this.crush;
    const rays = crush.rays;
    const zoneWork: Record<Zone, number> = { front: 0, rear: 0, left: 0, right: 0, roof: 0 };
    const zoneDepth: Record<Zone, number> = { front: 0, rear: 0, left: 0, right: 0, roof: 0 };
    let engineWork = 0;
    const wheelWork = [0, 0, 0, 0];
    for (let i = 0; i < rays.length; i++) {
      const w = crush.work[i]!;
      if (w <= 0) continue;
      const r = rays[i]!;
      const z = zoneOf(r);
      zoneWork[z] += w;
      zoneDepth[z] = Math.max(zoneDepth[z], crush.crush[i]!);
      if (r.origin[2] > 0.5 && r.kind !== 'roof' && !r.cabin) engineWork += w;
      for (let k = 0; k < 4; k++) wheelWork[k]! += w * this.rayWheelWeight[k]![i]!;
    }
    // A zone is as damaged as the energy it took or the depth it folded, whichever tells more.
    (Object.keys(zoneWork) as Zone[]).forEach((k) => (this.zone[k] = clamp(Math.max(zoneWork[k] / ZONE_CAPACITY[k], zoneDepth[k] / ZONE_DEPTH[k]), 0, 1)));
    this.engine = clamp(engineWork / ENGINE_CAPACITY, 0, 1);
    const v = this.vehicle;
    v.powerScale = 1 - 0.7 * this.engine * this.engine;
    for (let k = 0; k < 4; k++) {
      const d = clamp(wheelWork[k]! / WHEEL_CAPACITY + this.landDamage[k]!, 0, 1);
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
    this.landPeak.fill(0);
    this.landDamage.fill(0);
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
