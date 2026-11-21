import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { clamp } from '../../core/math';
import { GROUP, groups, type Physics } from '../../core/physics';
import type { AircraftConfig, ColliderDef, FlightInput, GearDef, SurfaceDef } from './types';

const G = 9.81;
const OSWALD = 0.8;
/** Downwash at the tail per radian of wing angle of attack, and the wing's zero-lift angle (rad). */
const DOWNWASH = 0.4;
const WING_ZERO_LIFT = 0.067;

const _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _pos = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _ang = new THREE.Vector3();
const _com = new THREE.Vector3();
const _p = new THREE.Vector3();
const _r = new THREE.Vector3();
const _v = new THREE.Vector3();
const _vb = new THREE.Vector3();
const _n = new THREE.Vector3();
const _s = new THREE.Vector3();
const _f = new THREE.Vector3();
const _t = new THREE.Vector3();
const _up = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _a = { x: 0, y: 0, z: 0 };
const _b = { x: 0, y: 0, z: 0 };
const _x = new THREE.Vector3();
const CHORD = new THREE.Vector3(0, 0, 1);

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Air density (kg/m3) at an altitude (m), standard atmosphere. */
export function airDensity(h: number): number {
  return 1.225 * Math.pow(Math.max(0.2, 1 - 2.2558e-5 * h), 4.2559);
}

/**
 * Lift coefficient of a surface at angle of attack `a` with `dcl` added by its control: linear up
 * to the stall, then blending over about 7 degrees into a flat plate's (which keeps some lift and a
 * lot of drag). `extraMax` raises the stall limit (flaps let the wing reach a higher lift).
 */
export function liftCoefficient(s: SurfaceDef, a: number, dcl: number, extraMax = 0): { cl: number; stall: number } {
  const linear = s.cl0 + s.clAlpha * a + dcl;
  const plate = 1.1 * Math.sin(2 * a) + 0.5 * dcl;
  const aPos = (s.clMax + extraMax - s.cl0 - dcl) / s.clAlpha;
  const aNeg = (s.clMin - s.cl0 - dcl) / s.clAlpha;
  const t = a > aPos ? smoothstep(0, 0.12, a - aPos) : a < aNeg ? smoothstep(0, 0.12, aNeg - a) : 0;
  return { cl: linear * (1 - t) + plate * t, stall: t };
}

interface Surface {
  def: SurfaceDef;
  pos: THREE.Vector3;
  normal: THREE.Vector3;
  span: THREE.Vector3;
  on: boolean;
  /** Last step: lift (N, signed along the normal), angle of attack (rad), how far into the stall (0..1). */
  lift: number;
  alpha: number;
  stall: number;
}

export interface Wheel {
  def: GearDef;
  on: boolean;
  /** Strut length (wheel centre below the strut top, m) and its rate (m/s, shortening positive). */
  length: number;
  rate: number;
  contact: boolean;
  /** Load (N), wheel spin (rad) for the view. */
  load: number;
  spin: number;
  steer: number;
}

export interface Part {
  name: string;
  defs: ColliderDef[];
  colliders: RAPIER.Collider[];
  on: boolean;
  /** Impact impulse taken so far (N s) and what breaks it. */
  damage: number;
  strength: number;
}

/** Impulse (N s) each part takes from impacts before it breaks off. */
const STRENGTH: Record<string, number> = { wingL: 9000, wingR: 9000, tailH: 4500, tailV: 4500, fuselage: Infinity, engine: Infinity };

export interface BreakEvent {
  part: string;
  reason: 'impact' | 'overload' | 'landing';
  /** The part's new body (null for gear legs and the propeller, which only the view shows). */
  body: RAPIER.RigidBody | null;
}

/**
 * A light aircraft as one Rapier rigid body. Each lifting surface works out its own airflow
 * (including the body's rotation), angle of attack, lift, drag and stall, so stability, damping,
 * stalls, spins and the effect of losing a wing all come out of where the surfaces sit. The engine
 * turns a propeller (static thrust limited, then constant power), the gear is three raycast struts
 * with tyres and brakes and a steerable nose wheel. Parts take impacts and loads and come off.
 */
export class Aircraft {
  readonly body: RAPIER.RigidBody;
  readonly surfaces: Surface[];
  readonly wheels: Wheel[];
  readonly parts = new Map<string, Part>();
  /** Control positions after their actuators (rad), flap travel 0..1, throttle 0..1. */
  readonly controls = { aileron: 0, elevator: 0, rudder: 0, flaps: 0, throttle: 0, trim: 0 };
  /** Flight data of the last step. */
  readonly state = { airspeed: 0, alpha: 0, beta: 0, altitude: 0, agl: 0, vs: 0, g: 1, stall: 0, rpm: 700, onGround: true, heading: 0, stallMargin: 1 };
  /**
   * Pilot aids: auto-trim (holds the pitch attitude when the stick is let go), coordinated rudder,
   * and stall protection (the elevator stops just short of the stall, for keyboard flying: the
   * wing can still be pulled past its load limit at high speed).
   */
  assists = { trim: true, rudder: true, protect: false };
  propBroken = false;
  /** Engine output factor (impacts on the nose reduce it). */
  engineHealth = 1;
  /** Engine power multiplier (1 = stock; the game's boosted engine doubles it). */
  boost = 1;
  onBreak: ((e: BreakEvent) => void) | null = null;
  readonly prevPos = new THREE.Vector3();
  readonly currPos = new THREE.Vector3();
  readonly prevQuat = new THREE.Quaternion();
  readonly currQuat = new THREE.Quaternion();
  private readonly ray: RAPIER.Ray;
  private readonly colliderPart = new Map<number, Part>();
  private overload = 0;
  private propAngle = 0;
  /**
   * Steps left after a placement in which the struts take their length without judging a landing
   * (in a new world the ground only shows up to rays after the first physics step).
   */
  private settle = 3;

  constructor(
    private readonly physics: Physics,
    readonly cfg: AircraftConfig,
    x: number,
    y: number,
    z: number,
    yaw: number,
  ) {
    const { RAPIER, world } = physics;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, y, z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setCcdEnabled(true)
        .setCanSleep(false)
        .setAngularDamping(0.02),
    );
    for (const d of cfg.colliders) {
      let p = this.parts.get(d.part);
      if (!p) {
        p = { name: d.part, defs: [], colliders: [], on: true, damage: 0, strength: STRENGTH[d.part] ?? 6000 };
        this.parts.set(d.part, p);
      }
      p.defs.push(d);
    }
    for (const g of cfg.gear) if (!this.parts.has(g.part)) this.parts.set(g.part, { name: g.part, defs: [], colliders: [], on: true, damage: 0, strength: Infinity });
    this.parts.set('prop', { name: 'prop', defs: [], colliders: [], on: true, damage: 0, strength: Infinity });
    this.buildColliders();
    this.surfaces = cfg.surfaces.map((def) => ({
      def,
      pos: new THREE.Vector3(...def.pos),
      normal: new THREE.Vector3(...def.normal).normalize(),
      span: new THREE.Vector3(...def.span).normalize(),
      on: true,
      lift: 0,
      alpha: 0,
      stall: 0,
    }));
    this.wheels = cfg.gear.map((def) => ({ def, on: true, length: def.travel, rate: 0, contact: false, load: 0, spin: 0, steer: 0 }));
    this.ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    this.sync();
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
  }

  get mass(): number {
    return this.body.mass();
  }

  private buildColliders(): void {
    const { RAPIER, world } = this.physics;
    for (const p of this.parts.values()) {
      if (!p.on || p.colliders.length) continue;
      for (const d of p.defs) {
        const c = world.createCollider(
          RAPIER.ColliderDesc.cuboid(...d.half)
            .setTranslation(...d.center)
            .setMass(d.mass)
            .setFriction(0.5)
            .setRestitution(0.05)
            .setCollisionGroups(groups(GROUP.PROP, 0xffff))
            .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
            .setContactForceEventThreshold(2000),
          this.body,
        );
        p.colliders.push(c);
        this.colliderPart.set(c.handle, p);
      }
    }
  }

  /** Put the aircraft at a spot, at rest and repaired. */
  placeAt(x: number, y: number, z: number, yaw: number): void {
    this.repair();
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    this.body.setTranslation({ x, y, z }, true);
    this.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.controls.throttle = 0;
    this.controls.flaps = 0;
    this.controls.trim = 0;
    for (const w of this.wheels) {
      w.length = w.def.travel;
      w.rate = 0;
    }
    this.settle = 3;
    this.sync();
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
  }

  /** Every part back on (call `placeAt` or keep the pose). */
  repair(): void {
    for (const p of this.parts.values()) {
      p.on = true;
      p.damage = 0;
    }
    this.buildColliders();
    for (const s of this.surfaces) s.on = true;
    for (const w of this.wheels) w.on = true;
    this.propBroken = false;
    this.engineHealth = 1;
    this.overload = 0;
  }

  private sync(): void {
    const t = this.body.translation();
    const r = this.body.rotation();
    this.currPos.set(t.x, t.y, t.z);
    this.currQuat.set(r.x, r.y, r.z, r.w);
  }

  /** Call right after the physics step (interpolation snapshots). */
  afterPhysicsStep(): void {
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
    this.sync();
  }

  /** A part comes off: its colliders leave the aircraft (the mass and balance change with them). */
  detach(name: string, reason: BreakEvent['reason']): void {
    const p = this.parts.get(name);
    if (!p || !p.on) return;
    p.on = false;
    const { RAPIER, world } = this.physics;
    let body: RAPIER.RigidBody | null = null;
    if (p.defs.length) {
      // The piece flies on with the velocity it had on the aircraft.
      const t = this.body.translation();
      const r = this.body.rotation();
      _q.set(r.x, r.y, r.z, r.w);
      const c0 = p.defs[0]!;
      _p.set(...c0.center).applyQuaternion(_q).add(_v.set(t.x, t.y, t.z));
      const pv = this.body.velocityAtPoint({ x: _p.x, y: _p.y, z: _p.z });
      const av = this.body.angvel();
      body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(t.x, t.y, t.z).setRotation(r).setLinvel(pv.x, pv.y, pv.z).setAngvel(av).setCanSleep(true).setCcdEnabled(true),
      );
      for (const d of p.defs) {
        world.createCollider(
          RAPIER.ColliderDesc.cuboid(...d.half).setTranslation(...d.center).setMass(d.mass).setFriction(0.6).setCollisionGroups(groups(GROUP.PROP, 0xffff)),
          body,
        );
      }
    }
    for (const c of p.colliders) {
      this.colliderPart.delete(c.handle);
      world.removeCollider(c, true);
    }
    p.colliders.length = 0;
    for (const s of this.surfaces) if (s.def.part === name) s.on = false;
    for (const w of this.wheels) if (w.def.part === name) w.on = false;
    if (name === 'prop') this.propBroken = true;
    this.onBreak?.({ part: name, reason, body });
  }

  /** A contact force from the physics step on one of our colliders (N), for `dt` seconds. */
  contactForce(handle: number, force: number, dt: number): void {
    const p = this.colliderPart.get(handle);
    if (!p || !p.on) return;
    p.damage += force * dt;
    if (p.name === 'engine') this.engineHealth = Math.max(0, 1 - p.damage / 25000);
    if (p.damage > p.strength) this.detach(p.name, 'impact');
  }

  /** One fixed step: controls, aerodynamics, engine, gear (before `physics.step()`). */
  fixedUpdate(dt: number, input: FlightInput): void {
    const body = this.body;
    const cfg = this.cfg;
    const t = body.translation();
    const r = body.rotation();
    _pos.set(t.x, t.y, t.z);
    _q.set(r.x, r.y, r.z, r.w);
    _qi.copy(_q).invert();
    const lv = body.linvel();
    const av = body.angvel();
    _vel.set(lv.x, lv.y, lv.z);
    _ang.set(av.x, av.y, av.z);
    const lc = body.localCom();
    _com.set(lc.x, lc.y, lc.z).applyQuaternion(_q).add(_pos);
    _up.set(0, 1, 0).applyQuaternion(_q);
    _fwd.set(0, 0, 1).applyQuaternion(_q);
    const mass = body.mass();
    const st = this.state;

    // Height above whatever is below (terrain, runway, roofs). The aircraft's rays only see the
    // fixed world: never its own broken-off parts, which start right beside it.
    const world = this.physics.world;
    this.ray.origin = { x: _com.x, y: _com.y, z: _com.z };
    this.ray.dir = { x: 0, y: -1, z: 0 };
    const below = world.castRay(this.ray, 400, true, undefined, groups(0xffff, GROUP.WORLD), undefined, body);
    st.agl = below ? below.timeOfImpact : 400;
    st.altitude = _com.y;
    st.vs = _vel.y;
    st.heading = Math.atan2(_fwd.x, _fwd.z);
    const airspeed = _vel.length();
    st.airspeed = airspeed;
    _vb.copy(_vel).applyQuaternion(_qi);
    st.alpha = Math.atan2(-_vb.y, Math.max(_vb.z, 0.1));
    st.beta = Math.atan2(_vb.x, Math.max(_vb.z, 0.1));

    this.actuate(dt, input);

    // ---- aerodynamics: every surface on its own ----
    const rho = airDensity(_com.y);
    const span = 11.7;
    let liftUp = 0;
    let wingL = 0;
    let wingR = 0;
    let stall = 0;
    let margin = 1;
    const c = this.controls;
    const wingAlpha = this.surfaces[0]?.on ? this.surfaces[0].alpha : st.alpha;
    for (const s of this.surfaces) {
      if (!s.on) {
        s.lift = 0;
        continue;
      }
      const d = s.def;
      _p.copy(s.pos).applyQuaternion(_q).add(_pos);
      _r.subVectors(_p, _com);
      _v.crossVectors(_ang, _r).add(_vel).applyQuaternion(_qi); // surface velocity, body frame
      _v.addScaledVector(s.span, -_v.dot(s.span));
      const V = _v.length();
      if (V < 0.5) {
        s.lift = 0;
        continue;
      }
      let a = Math.atan2(-_v.dot(s.normal), _v.dot(CHORD));
      // Downwash: the wing turns the air down before it reaches the tailplane (about 0.4 of the
      // wing's angle), which is what lets the elevator take the wing up to the stall.
      if (d.control === 'elevator') a -= DOWNWASH * Math.max(0, wingAlpha + WING_ZERO_LIFT);
      let dcl = 0;
      let flapMax = 0;
      switch (d.control) {
        case 'flap':
          dcl = d.controlCl * d.controlMax * c.flaps;
          flapMax = 0.8 * dcl;
          break;
        case 'aileronL':
          dcl = d.controlCl * c.aileron;
          break;
        case 'aileronR':
          dcl = -d.controlCl * c.aileron;
          break;
        case 'elevator':
          // Stick back (pitch +) pushes the tail down.
          dcl = -d.controlCl * (c.elevator + c.trim);
          break;
        case 'rudder':
          // Left pedal (yaw +) pushes the tail right, the nose left.
          dcl = -d.controlCl * c.rudder;
          break;
      }
      const { cl: cl0, stall: sv } = liftCoefficient(d, a, dcl, flapMax);
      // Ground effect on the wing: more lift, much less induced drag within a span of the ground.
      const h = Math.max(0.3, st.agl + (s.pos.y - lc.y));
      const ge = d.part.startsWith('wing') ? clamp(1 - h / span, 0, 1) : 0;
      const cl = cl0 * (1 + 0.12 * ge);
      const k = (16 * h) / span;
      const induced = d.part.startsWith('wing') ? (k * k) / (1 + k * k) : 1;
      const cd = d.cd0 + ((cl * cl) / (Math.PI * OSWALD * d.aspect)) * induced + sv * 1.1 * Math.sin(a) ** 2 + Math.abs(dcl) * 0.03;
      const q = 0.5 * rho * V * V;
      _s.copy(_v).multiplyScalar(1 / V); // direction of travel
      _n.copy(s.normal).addScaledVector(_s, -s.normal.dot(_s)).normalize(); // lift: across the airflow
      _f.copy(_n).multiplyScalar(cl * q * d.area).addScaledVector(_s, -cd * q * d.area);
      // Pitching moment about the aerodynamic centre (nose down for negative cm0).
      _t.copy(s.span).multiplyScalar(-d.cm0 * q * d.area * d.chord * Math.sign(s.span.x || 1));
      s.lift = cl * q * d.area;
      s.alpha = a;
      s.stall = sv;
      if (d.part === 'wingL') wingL += s.lift;
      if (d.part === 'wingR') wingR += s.lift;
      if (d.part.startsWith('wing')) {
        stall = Math.max(stall, sv);
        // Angle of attack left before this panel stalls (the stall warning reads it).
        margin = Math.min(margin, (d.clMax + flapMax - d.cl0 - dcl) / d.clAlpha - a);
      }
      _f.applyQuaternion(_q);
      liftUp += _f.dot(_up);
      _t.applyQuaternion(_q);
      _a.x = _f.x * dt;
      _a.y = _f.y * dt;
      _a.z = _f.z * dt;
      _b.x = _p.x;
      _b.y = _p.y;
      _b.z = _p.z;
      body.applyImpulseAtPoint(_a, _b, true);
      _a.x = _t.x * dt;
      _a.y = _t.y * dt;
      _a.z = _t.z * dt;
      body.applyTorqueImpulse(_a, true);
    }
    st.stall = stall;
    st.stallMargin = airspeed > 8 ? margin : 1;

    // ---- engine and propeller ----
    const e = cfg.engine;
    const running = !this.propBroken && this.engineHealth > 0;
    const thr = running ? c.throttle * this.engineHealth : 0;
    const vAxial = Math.max(_vel.dot(_fwd), 0);
    // Boosted, the static thrust grows less than the power (the propeller does not change).
    const t0 = e.staticThrust * (1 + (this.boost - 1) * 0.6);
    const thrust = running ? Math.min(t0 * thr, (e.efficiency * e.power * this.boost * thr) / Math.max(vAxial, 1)) : 0;
    const rpmTarget = this.propBroken ? 0 : running ? e.idleRpm + (e.maxRpm - e.idleRpm) * Math.pow(c.throttle, 0.8) + vAxial * 4 : vAxial * 18;
    st.rpm += (Math.min(rpmTarget, e.maxRpm * 1.05) - st.rpm) * Math.min(1, dt * 2.5);
    this.propAngle += (st.rpm / 60) * Math.PI * 2 * dt;
    _p.set(...e.pos).applyQuaternion(_q).add(_pos);
    _a.x = _fwd.x * thrust * dt;
    _a.y = _fwd.y * thrust * dt;
    _a.z = _fwd.z * thrust * dt;
    _b.x = _p.x;
    _b.y = _p.y;
    _b.z = _p.z;
    body.applyImpulseAtPoint(_a, _b, true);
    // Propeller strike: the disc reaching the ground.
    if (!this.propBroken && st.rpm > 200) {
      this.ray.origin = { x: _p.x, y: _p.y, z: _p.z };
      this.ray.dir = { x: -_up.x, y: -_up.y, z: -_up.z };
      const hit = world.castRay(this.ray, e.radius, true, undefined, groups(0xffff, GROUP.WORLD), undefined, body);
      if (hit && hit.timeOfImpact < e.radius * 0.97) this.detach('prop', 'impact');
    }

    // ---- everything else drags: fuselage, cowling, gear ----
    if (airspeed > 0.5) {
      const dq = 0.5 * rho * airspeed * cfg.bodyDragArea;
      _a.x = -_vel.x * dq * dt;
      _a.y = -_vel.y * dq * dt;
      _a.z = -_vel.z * dq * dt;
      body.applyImpulse(_a, true);
    }

    this.gear(dt, input, mass);
    st.onGround = this.wheels.some((w) => w.contact) || st.agl < 1.2;
    // Load factor the pilot feels: wing lift plus what the wheels carry, over the weight.
    let wheelLoad = 0;
    for (const w of this.wheels) wheelLoad += w.load;
    st.g = (liftUp + wheelLoad) / (mass * G);

    // ---- structure: a wing pulled past its limit load folds ----
    const half = (cfg.limits.wingG * mass * G) / 2;
    const worst = Math.max(Math.abs(wingL), Math.abs(wingR));
    this.overload = worst > half ? this.overload + dt : 0;
    if (this.overload > 0.08) this.detach(Math.abs(wingL) > Math.abs(wingR) ? 'wingL' : 'wingR', 'overload');
  }

  /** Control surfaces and levers follow the pilot through their actuators (and the aids). */
  private actuate(dt: number, input: FlightInput): void {
    const c = this.controls;
    const st = this.state;
    const s = this.cfg.surfaces;
    const max = (k: string): number => s.find((x) => x.control === k)?.controlMax ?? 0.3;
    const move = (from: number, to: number, rate: number): number => from + clamp(to - from, -rate * dt, rate * dt);
    c.aileron = move(c.aileron, input.roll * max('aileronL'), 2.5);
    let pitch = input.pitch;
    if (this.assists.protect && pitch > 0 && st.airspeed > 15) pitch = Math.min(pitch, clamp((st.stallMargin - 0.012) / 0.035, 0, 1));
    c.elevator = move(c.elevator, pitch * max('elevator'), 2.0);
    let rudder = input.yaw;
    // Coordinated rudder: cancel the sideslip in the air when the pilot is not using the pedals.
    if (this.assists.rudder && !st.onGround && Math.abs(input.yaw) < 0.05 && st.airspeed > 15) rudder = clamp(st.beta * 3, -1, 1);
    c.rudder = move(c.rudder, rudder * max('rudder'), 2.0);
    c.flaps = move(c.flaps, clamp(input.flaps, 0, 1), 0.14);
    c.throttle = move(c.throttle, clamp(input.throttle, 0, 1), 0.8);
    // Auto-trim: with the stick let go in flight, the trim slowly holds the pitch rate at zero.
    if (this.assists.trim && !st.onGround && Math.abs(input.pitch) < 0.05 && st.airspeed > 20) {
      const pitchRate = _x.set(1, 0, 0).applyQuaternion(_q).dot(_ang); // + = nose down
      c.trim = clamp(c.trim + pitchRate * 0.6 * dt, -0.25, 0.25);
    }
  }

  private gear(dt: number, input: FlightInput, mass: number): void {
    const body = this.body;
    const world = this.physics.world;
    const cfg = this.cfg;
    const speed = this.state.airspeed;
    const settled = this.settle === 0;
    if (this.settle > 0) this.settle--;
    for (const w of this.wheels) {
      w.contact = false;
      w.load = 0;
      if (!w.on) continue;
      const d = w.def;
      _p.set(...d.pos).applyQuaternion(_q).add(_pos);
      this.ray.origin = { x: _p.x, y: _p.y, z: _p.z };
      this.ray.dir = { x: -_up.x, y: -_up.y, z: -_up.z };
      const hit = world.castRayAndGetNormal(this.ray, d.travel + d.radius, true, undefined, groups(0xffff, GROUP.WORLD), undefined, body);
      const prev = settled ? w.length : null;
      if (!hit) {
        w.length = Math.min(d.travel, w.length + dt * 2);
        w.rate = 0;
        continue;
      }
      const len = clamp(hit.timeOfImpact - d.radius, 0, d.travel);
      w.length = len;
      // Just placed: the struts take their length, nothing has landed.
      w.rate = prev === null ? 0 : (prev - len) / dt;
      w.contact = true;
      // A leg landed on too hard folds.
      if (w.rate > cfg.limits.gearSink) {
        this.detach(d.part, 'landing');
        continue;
      }
      const comp = d.travel - len;
      let fz = d.k * comp + d.c * w.rate;
      if (len <= 0.001) fz += d.k * 4 * Math.max(0, d.radius - hit.timeOfImpact); // bump stop
      fz = Math.max(0, fz);
      w.load = fz;
      // Contact point and its velocity.
      _b.x = _p.x - _up.x * hit.timeOfImpact;
      _b.y = _p.y - _up.y * hit.timeOfImpact;
      _b.z = _p.z - _up.z * hit.timeOfImpact;
      _r.set(_b.x - _com.x, _b.y - _com.y, _b.z - _com.z);
      _v.crossVectors(_ang, _r).add(_vel);
      _n.set(hit.normal.x, hit.normal.y, hit.normal.z);
      // Wheel heading on the ground (the nose wheel steers with the pedals, less at speed).
      w.steer = d.steer ? clamp(input.yaw - 0.5 * input.roll, -1, 1) * cfg.steerLock * clamp(1 - speed / 30, 0.15, 1) : 0;
      _s.set(Math.sin(w.steer), 0, Math.cos(w.steer)).applyQuaternion(_q);
      _s.addScaledVector(_n, -_s.dot(_n)).normalize();
      _t.crossVectors(_n, _s); // lateral
      const vLong = _v.dot(_s);
      const vLat = _v.dot(_t);
      const mu = 0.8;
      const fLat = clamp(-vLat * 12000, -mu * fz, mu * fz);
      const roll = -Math.tanh(vLong / 0.5) * 0.02 * fz;
      const brake = d.brake ? -Math.tanh(vLong / 0.3) * clamp(input.brake, 0, 1) * cfg.brakeMu * fz : 0;
      const fLong = roll + brake;
      _f.copy(_up).multiplyScalar(fz).addScaledVector(_s, fLong).addScaledVector(_t, fLat);
      _a.x = _f.x * dt;
      _a.y = _f.y * dt;
      _a.z = _f.z * dt;
      body.applyImpulseAtPoint(_a, _b, true);
      w.spin += (vLong / d.radius) * dt;
    }
    void mass;
  }

  /** Propeller angle (rad) for the view. */
  get prop(): number {
    return this.propAngle;
  }
}
