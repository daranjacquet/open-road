import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { clamp } from '../core/math';
import { GROUP, groups, type Physics } from '../core/physics';
import type { CrushRay } from './rays';
import type { ImprintContact } from './Deformer';

export interface CrushEvent {
  ray: CrushRay;
  /** New plastic crush depth added this step (m). */
  deltaDepth: number;
  /** Energy absorbed by the crumple zone this step (J). */
  energy: number;
  /** World-space point of contact. */
  point: THREE.Vector3;
  /** Approach speed at the contact (m/s). */
  speed: number;
}

/** What the crush system needs from the vehicle (kept minimal so it stays testable). */
export interface CrushHost {
  body: RAPIER.RigidBody;
  mass: number;
  /** Add the impulse F*dt at a world point to the vehicle's accumulated impulse/torque. */
  applyForce(dt: number, px: number, py: number, pz: number, fx: number, fy: number, fz: number): void;
}

const _q = new THREE.Quaternion();
const _pos = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _ang = new THREE.Vector3();
const _com = new THREE.Vector3();
const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _n = new THREE.Vector3();
const _hp = new THREE.Vector3();
const _r = new THREE.Vector3();
const _vp = new THREE.Vector3();
const _vt = new THREE.Vector3();
const _p = { x: 0, y: 0, z: 0 };
const _imp = { x: 0, y: 0, z: 0 };

const FRICTION = 0.35;

/**
 * Crumple zones as one-sided plastic springs along rays. A ray that meets an obstacle inside the
 * car's visible shell pushes back with a force that ramps up over `yield` metres to `fmax`, then
 * holds (plastic crush): the shell gives way and the ray remembers how deep it has been pushed.
 * The crush depth per ray IS the damage field used to dent the mesh.
 */
export class CrushSystem {
  /** How much the crumple zone stiffens as it compacts (force x (1 + stiffening * depth^2)). */
  static stiffening = 4.5;
  /** Strength of the zone before it has crushed at all, as a fraction of its full strength. */
  static softStart = 0.85;
  /** Permanent crush depth per ray (m). */
  readonly crush: Float32Array;
  /** Energy absorbed per ray (J). */
  readonly work: Float32Array;
  /** Last contact force per ray (N), for debug. */
  readonly force: Float32Array;
  /** Total energy absorbed so far (J). */
  energy = 0;
  /** Sum of contact forces this step (N), for camera shake and debug. */
  stepForce = 0;
  /** Rays touched this step (for debug). */
  active = 0;
  onCrush: ((e: CrushEvent) => void) | null = null;
  /** Plastic contacts of the last step (obstacles the car actually yielded against). */
  readonly contacts: ImprintContact[] = [];
  private readonly contactPool: ImprintContact[] = [];

  private readonly ray: RAPIER.Ray;
  private readonly envelope: RAPIER.Cuboid;
  private readonly filter = groups(GROUP.RAY, GROUP.WORLD | GROUP.PROP | GROUP.OUTLINE);
  private readonly ev: CrushEvent;
  private readonly local: THREE.Vector3[];
  private readonly localDir: THREE.Vector3[];

  constructor(
    private readonly physics: Physics,
    private readonly host: CrushHost,
    readonly rays: CrushRay[],
    envelope: { center: [number, number, number]; half: [number, number, number] },
  ) {
    const n = rays.length;
    this.crush = new Float32Array(n);
    this.work = new Float32Array(n);
    this.force = new Float32Array(n);
    this.ray = new physics.RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    this.envelope = new physics.RAPIER.Cuboid(envelope.half[0], envelope.half[1], envelope.half[2]);
    this.envCenter = new THREE.Vector3(...envelope.center);
    this.local = rays.map((r) => new THREE.Vector3(...r.origin));
    this.localDir = rays.map((r) => new THREE.Vector3(...r.dir));
    this.ev = { ray: rays[0]!, deltaDepth: 0, energy: 0, point: new THREE.Vector3(), speed: 0 };
  }

  private readonly envCenter: THREE.Vector3;

  /** Largest crush depth (m) of the rays whose surface point is within `r` of a chassis-frame point. */
  crushNear(x: number, y: number, z: number, r = 0.5): number {
    let m = 0;
    const r2 = r * r;
    for (let i = 0; i < this.rays.length; i++) {
      const s = this.rays[i]!.surface;
      const dx = s[0] - x;
      const dy = s[1] - y;
      const dz = s[2] - z;
      if (dx * dx + dy * dy + dz * dz < r2 && this.crush[i]! > m) m = this.crush[i]!;
    }
    return m;
  }

  /** Total crush fraction of a ray (0 = pristine, 1 = fully crushed). */
  depthFraction(i: number): number {
    return this.crush[i]! / this.rays[i]!.length;
  }

  reset(): void {
    this.crush.fill(0);
    this.work.fill(0);
    this.force.fill(0);
    this.energy = 0;
  }

  private addContact(collider: RAPIER.Collider, point: THREE.Vector3, dir: THREE.Vector3, shared: boolean): void {
    for (const c of this.contacts) {
      if (c.collider.handle === collider.handle && c.point.distanceToSquared(point) < 0.04) return;
    }
    if (this.contacts.length >= 48) return;
    let c = this.contactPool[this.contacts.length];
    if (!c) {
      c = { collider, point: new THREE.Vector3(), dir: new THREE.Vector3(), shared };
      this.contactPool.push(c);
    }
    c.collider = collider;
    c.point.copy(point);
    c.dir.copy(dir);
    c.shared = shared;
    this.contacts.push(c);
  }

  step(dt: number, posIn: THREE.Vector3, quatIn: THREE.Quaternion): void {
    this.stepForce = 0;
    this.active = 0;
    this.contacts.length = 0;
    const world = this.physics.world;
    const body = this.host.body;
    _pos.copy(posIn);
    _q.copy(quatIn);

    // Cheap early-out: is anything inside the car's envelope at all?
    _o.copy(this.envCenter).applyQuaternion(_q).add(_pos);
    _p.x = _o.x;
    _p.y = _o.y;
    _p.z = _o.z;
    const hit = world.intersectionWithShape(_p, { x: _q.x, y: _q.y, z: _q.z, w: _q.w }, this.envelope, undefined, this.filter, undefined, body);
    if (!hit) return;

    const lv = body.linvel();
    const av = body.angvel();
    _vel.set(lv.x, lv.y, lv.z);
    _ang.set(av.x, av.y, av.z);
    // Centre of mass in world space.
    const lc = body.localCom();
    _com.set(lc.x, lc.y, lc.z).applyQuaternion(_q).add(_pos);

    const ray = this.ray;
    const rays = this.rays;
    for (let i = 0; i < rays.length; i++) {
      const rd = rays[i]!;
      const c = this.crush[i]!;
      const reach = rd.length - c;
      if (reach < 0.01) continue;
      _o.copy(this.local[i]!).applyQuaternion(_q).add(_pos);
      _d.copy(this.localDir[i]!).applyQuaternion(_q);
      ray.origin.x = _o.x;
      ray.origin.y = _o.y;
      ray.origin.z = _o.z;
      ray.dir.x = _d.x;
      ray.dir.y = _d.y;
      ray.dir.z = _d.z;
      const h = world.castRayAndGetNormal(ray, reach, true, undefined, this.filter, undefined, body);
      if (!h) continue;

      let p = reach - h.timeOfImpact; // penetration into the (crushed) shell
      if (p <= 0) continue;
      this.active++;
      // Another car crushes against us too: each side takes half of the overlap (springs in series),
      // so the pair absorbs the right energy and conserves momentum.
      const hitOther = h.collider.parent();
      if (hitOther !== null && this.physics.crushBodies.has(hitOther.handle)) p *= 0.5;

      _hp.set(_o.x + _d.x * h.timeOfImpact, _o.y + _d.y * h.timeOfImpact, _o.z + _d.z * h.timeOfImpact);
      // Contact normal: from the obstacle towards the car. Fall back to the ray direction.
      _n.set(h.normal.x, h.normal.y, h.normal.z);
      if (_n.dot(_d) > -0.15) _n.copy(_d).negate();

      // Relative velocity of the car's contact point to the obstacle.
      _r.subVectors(_hp, _com);
      _vp.crossVectors(_ang, _r).add(_vel);
      const other = h.collider.parent();
      const otherDynamic = other !== null && other.isDynamic();
      // Cars run their own crumple zones against us: do not double the reaction on them.
      const otherPassive = otherDynamic && !this.physics.crushBodies.has(other!.handle);
      if (otherDynamic) {
        const gv = other!.velocityAtPoint({ x: _hp.x, y: _hp.y, z: _hp.z });
        _vp.x -= gv.x;
        _vp.y -= gv.y;
        _vp.z -= gv.z;
      }
      const vn = -_vp.dot(_n); // > 0 when closing

      // Plastic spring: force rises over `yield`, saturates at the zone's strength, which is soft at
      // first (bumper skin, energy absorber) and stiffens as the structure compacts. The strength is
      // evaluated at the middle of this step's crush increment so deep single-step hits absorb
      // the right amount of energy (midpoint rule).
      const dcTry = Math.max(p - rd.yield, 0);
      const cm = c + 0.5 * dcTry;
      const depthFrac = cm / rd.length;
      const soft = CrushSystem.softStart + (1 - CrushSystem.softStart) * Math.min(cm / 0.12, 1);
      const fmax = rd.fmax * soft * (1 + CrushSystem.stiffening * depthFrac * depthFrac);
      const k = fmax / rd.yield;
      let F = k * p + 0.025 * fmax * Math.max(vn, 0);
      // Unloading follows a much softer path than loading (hysteresis): crushed metal does not spring back.
      if (vn < 0) F *= 0.15;
      let dc = 0;
      if (F >= fmax) {
        F = fmax;
        if (p > rd.yield) {
          dc = Math.min(p - rd.yield, reach - 0.005);
          this.crush[i] = c + dc;
          this.work[i] = this.work[i]! + fmax * dc;
          this.energy += fmax * dc;
          p = rd.yield;
        }
      }
      this.force[i] = F;
      this.stepForce += F;

      // Normal force on the car, plus Coulomb friction along the obstacle surface.
      const fx = _n.x * F;
      const fy = _n.y * F;
      const fz = _n.z * F;
      _vt.copy(_vp).addScaledVector(_n, vn); // tangential part: vp - n*(vp.n) with vn = -vp.n
      const vtLen = _vt.length();
      let tx = 0;
      let ty = 0;
      let tz = 0;
      if (vtLen > 0.05) {
        const cap = (vtLen * this.host.mass) / (10 * dt);
        const ft = Math.min(FRICTION * F, cap);
        tx = (-_vt.x / vtLen) * ft;
        ty = (-_vt.y / vtLen) * ft;
        tz = (-_vt.z / vtLen) * ft;
      }
      this.host.applyForce(dt, _hp.x, _hp.y, _hp.z, fx + tx, fy + ty, fz + tz);
      if (otherPassive) {
        _p.x = _hp.x;
        _p.y = _hp.y;
        _p.z = _hp.z;
        _imp.x = -(fx + tx) * dt;
        _imp.y = -(fy + ty) * dt;
        _imp.z = -(fz + tz) * dt;
        other!.applyImpulseAtPoint(_imp, _p, true);
      }

      if (dc > 0) this.addContact(h.collider, _hp, this.localDir[i]!, hitOther !== null && this.physics.crushBodies.has(hitOther.handle));
      if (dc > 0 && this.onCrush) {
        const e = this.ev;
        e.ray = rd;
        e.deltaDepth = dc;
        e.energy = fmax * dc;
        e.point.copy(_hp);
        e.speed = Math.max(vn, 0);
        this.onCrush(e);
      }
    }
    void clamp;
  }
}
