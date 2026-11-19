import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { clamp, damp, G, lerp, RADS_TO_RPM, smoothstep } from '../core/math';
import { GROUP, groups, SURFACE_GRIP, type Physics, type Surface } from '../core/physics';
import { CrushSystem } from '../damage/CrushSystem';
import type { CrushRay } from '../damage/rays';
import { absScale, espControl, tcScale, type EspOut } from './assists';
import { autoShift, engineTorque, totalRatio, type GearState } from './drivetrain';
import { ackermann, SteeringController, type SteerContext } from './steering';
import { tireForces, type TireOut } from './tire';
import type { AxleSuspension, TireParams, VehicleConfig } from './types';

export interface DriveInput {
  /** 0..1 */
  throttle: number;
  /** 0..1 (also reverse when stopped) */
  brake: number;
  /** -1..1, +1 = left */
  steer: number;
  /** 0..1 */
  handbrake: number;
}

export interface Assists {
  tc: boolean;
  abs: boolean;
  esp: boolean;
}

const RHO = 1.2; // air density
const V_MIN_SLIP = 1.2; // m/s, slip normalisation floor
const SURFACE_ROLLING: Record<Surface, number> = { asphalt: 1, dirt: 2.4, grass: 3.2 };

/** Per-wheel simulation state. Index order: FL, FR, RL, RR. */
export class WheelState {
  readonly isFront: boolean;
  readonly isLeft: boolean;
  readonly mount = new THREE.Vector3();
  susp: AxleSuspension;
  /** Static camber (rad, negative = top leans in) and tyre width (m), for the view. */
  camber = 0;
  width = 0.25;
  /** Spin speed (rad/s), positive = rolling forward. */
  omega = 0;
  spin = 0;
  steer = 0;
  /** Suspension length (mount to hub centre, m). */
  length: number;
  prevLength: number;
  contact = false;
  fz = 0;
  fx = 0;
  fy = 0;
  slipRatio = 0;
  /** Slip ratio with a high speed floor, used by ABS/TC so they stay calm at walking speed. */
  slipAssist = 0;
  slipAngle = 0;
  /** Speed (m/s) at which the contact patch slides over the ground (smoke, skid marks, audio). */
  slideSpeed = 0;
  surface: Surface = 'asphalt';
  contactPoint = new THREE.Vector3();
  contactNormal = new THREE.Vector3(0, 1, 0);
  // Damage hooks (milestone 4/5): all neutral by default.
  gripScale = 1;
  steerBias = 0;
  springScale = 1;
  detached = false;
  flat = false;

  // Render interpolation history.
  prevSteer = 0;
  prevSpin = 0;

  // Scratch values for the step.
  mountWorldX = 0;
  mountWorldY = 0;
  mountWorldZ = 0;
  groundBody: RAPIER.RigidBody | null = null;
  groundHandle = -1;
  hit = false;
  springForce = 0;
  compression = 0;
  hubDrive = 0;
  brakeTorque = 0;

  constructor(
    readonly index: number,
    susp: AxleSuspension,
  ) {
    this.isFront = index < 2;
    this.isLeft = index % 2 === 0;
    this.susp = susp;
    this.length = susp.maxLen;
    this.prevLength = susp.maxLen;
  }
}

// Scratch objects (the step must not allocate).
const _q = new THREE.Quaternion();
const _qs = new THREE.Quaternion();
const _up = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _left = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _ang = new THREE.Vector3();
const _com = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _p = new THREE.Vector3();
const _r = new THREE.Vector3();
const _wf = new THREE.Vector3();
const _wl = new THREE.Vector3();
const _vp = new THREE.Vector3();
const _f = new THREE.Vector3();
const _tq = new THREE.Vector3();
const _jTot = new THREE.Vector3();
const _tTot = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _tire: TireOut = { fx: 0, fy: 0 };
const _esp: EspOut = { throttleScale: 1, brake: [0, 0, 0, 0], activity: 0 };
const _o = { x: 0, y: 0, z: 0 };
const AXLES: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [2, 3],
];

/** impulse = F * dt applied at point p; accumulates linear impulse and torque about the COM. */
function accumulate(dt: number, px: number, py: number, pz: number, fx: number, fy: number, fz: number): void {
  _f.set(fx * dt, fy * dt, fz * dt);
  _jTot.add(_f);
  _r.set(px - _com.x, py - _com.y, pz - _com.z);
  _tq.crossVectors(_r, _f);
  _tTot.add(_tq);
}
const _o2 = { x: 0, y: 0, z: 0 };
const _ack: [number, number] = [0, 0];
const _steerCtx: SteerContext = { dt: 0, input: 0, vLong: 0, vLat: 0, speed: 0, yawRate: 0, lf: 0, wheelbase: 0, frontPeak: 0, rearPeak: 0, first: false };

/** Lateral grip factor from static camber (deg): a little negative camber helps in corners. */
export function camberLateral(deg: number): number {
  const c = -deg;
  if (c >= 0) return 1 + 0.03 * Math.min(c, 3.5) - 0.012 * Math.max(c - 3.5, 0);
  return 1 + 0.05 * c; // positive camber hurts quickly
}
/** Longitudinal grip factor from static camber (deg): a leaning tyre has less patch to brake and drive on. */
export function camberLongitudinal(deg: number): number {
  return clamp(1 - 0.022 * Math.abs(deg), 0.75, 1);
}

/** Tyre parameters for one axle after width, camber and stiffness. */
export function axleTire(base: TireParams, widthRatio: number, camberDeg: number, stiffness: number): TireParams {
  const lat = camberLateral(camberDeg);
  const lon = camberLongitudinal(camberDeg);
  return {
    ...base,
    mu: base.mu * Math.pow(widthRatio, 0.22) * lat,
    longGripRatio: (base.longGripRatio * lon) / lat,
    peakSlipAngle: base.peakSlipAngle / (stiffness * Math.pow(widthRatio, 0.45)),
    rollingResistance: base.rollingResistance * Math.pow(widthRatio, 0.5),
  };
}

export class Vehicle {
  readonly body: RAPIER.RigidBody;
  readonly wheels: WheelState[];
  wheelbase = 0;
  trackFront = 0;
  readonly assists: Assists = { tc: true, abs: true, esp: true };
  /** Manual gearbox: the driver shifts with shiftUp / shiftDown. */
  manual = false;

  // Drivetrain state.
  readonly gearState: GearState = { gear: 1, shiftTimer: 0 };
  rpm: number;
  /** Steering and its arcade aids (assist, stability, slide signal). */
  readonly steering = new SteeringController();
  /** Inertia about the up axis (kg m^2). */
  private yawInertia = 1;
  limiter = false;

  // Telemetry (read by HUD / debug).
  speed = 0; // m/s
  vLong = 0;
  yawRate = 0;
  throttleCmd = 0;
  brakeCmd = 0;
  espActivity = 0;
  tcActive = false;
  absActive = false;
  /** Damage multipliers (milestone 4). */
  powerScale = 1;
  /** Crumple zones (null until `attachCrush`). */
  crush: CrushSystem | null = null;
  mass: number;

  // Interpolation snapshots for the chassis.
  readonly prevPos = new THREE.Vector3();
  readonly currPos = new THREE.Vector3();
  readonly prevQuat = new THREE.Quaternion();
  readonly currQuat = new THREE.Quaternion();

  private readonly ray: RAPIER.Ray;
  private frontTire!: TireParams;
  private rearTire!: TireParams;
  private drivenShare: [number, number, number, number] = [0, 0, 0, 0];
  private readonly comLocal = new THREE.Vector3();
  private readonly mountLocal: THREE.Vector3[];
  private wheelIdleInertia = 1;
  /** Distance from the centre of mass to the front axle (m). */
  private lf = 1.3;
  private first = true;
  private readonly invG = 1 / G;

  constructor(
    private readonly physics: Physics,
    public cfg: VehicleConfig,
    x = 0,
    z = 0,
    yaw = 0,
  ) {
    const { RAPIER, world } = physics;
    const m = cfg.mass;
    this.mass = m;
    const principal = Vehicle.principal(cfg);
    this.comLocal.set(...cfg.com);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const rideHeight = cfg.wheel.radius + cfg.suspensionFront.maxLen * 0.65 + 0.02;
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, rideHeight, z)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setAdditionalMassProperties(m, { x: cfg.com[0], y: cfg.com[1], z: cfg.com[2] }, principal, { x: 0, y: 0, z: 0, w: 1 })
      .setAngularDamping(0.05)
      .setLinearDamping(0)
      .setCcdEnabled(true)
      .setCanSleep(false);
    this.body = world.createRigidBody(desc);
    for (const c of cfg.colliders) {
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(...c.half)
          .setTranslation(...c.center)
          .setDensity(0)
          .setFriction(0.35)
          .setRestitution(0.05)
          .setCollisionGroups(groups(GROUP.CHASSIS, 0xffff)),
        this.body,
      );
    }

    for (const o of cfg.outline) {
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(...o.half)
          .setTranslation(...o.center)
          .setDensity(0)
          .setCollisionGroups(groups(GROUP.OUTLINE, GROUP.RAY)),
        this.body,
      );
    }

    this.mountLocal = [0, 1, 2, 3].map(() => new THREE.Vector3());
    this.wheels = [0, 1, 2, 3].map((i) => new WheelState(i, i < 2 ? cfg.suspensionFront : cfg.suspensionRear));
    this.deriveFromConfig();
    this.rpm = cfg.engine.idleRpm;
    this.ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    this.syncFromBody();
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
  }

  private static principal(cfg: VehicleConfig): { x: number; y: number; z: number } {
    const m = cfg.mass;
    const [w, h, l] = cfg.inertiaBox;
    return { x: (m / 12) * (h * h + l * l), y: (m / 12) * (w * w + l * l), z: (m / 12) * (w * w + h * h) };
  }

  /** Everything cached from the config (geometry, tyres per axle, driveline split). */
  private deriveFromConfig(): void {
    const cfg = this.cfg;
    const mounts = [cfg.wheels.FL, cfg.wheels.FR, cfg.wheels.RL, cfg.wheels.RR];
    const camber = cfg.camber ?? { front: 0, rear: 0 };
    const width = cfg.tireWidth ?? { front: cfg.wheel.width, rear: cfg.wheel.width };
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i]!;
      this.mountLocal[i]!.set(...mounts[i]!);
      w.mount.set(...mounts[i]!);
      w.susp = i < 2 ? cfg.suspensionFront : cfg.suspensionRear;
      w.camber = ((i < 2 ? camber.front : camber.rear) * Math.PI) / 180;
      w.width = i < 2 ? width.front : width.rear;
    }
    this.wheelbase = cfg.wheels.FL[2] - cfg.wheels.RL[2];
    this.trackFront = cfg.wheels.FL[0] - cfg.wheels.FR[0];
    this.lf = cfg.wheels.FL[2] - cfg.com[2];
    this.wheelIdleInertia = cfg.wheel.inertia;
    this.yawInertia = Vehicle.principal(cfg).y;
    this.drivenShare =
      cfg.drive === 'FWD'
        ? [0.5, 0.5, 0, 0]
        : cfg.drive === 'RWD'
          ? [0, 0, 0.5, 0.5]
          : [cfg.frontTorqueBias / 2, cfg.frontTorqueBias / 2, (1 - cfg.frontTorqueBias) / 2, (1 - cfg.frontTorqueBias) / 2];
    // Wider tyres: more grip and cornering stiffness; camber trades braking grip for cornering grip.
    // rearStiffnessScale: stiffer rear tyres (lower peak slip angle) without more peak grip.
    this.frontTire = axleTire(cfg.tire, width.front / cfg.wheel.width, camber.front, 1);
    this.rearTire = axleTire(cfg.tire, width.rear / cfg.wheel.width, camber.rear, cfg.rearStiffnessScale);
  }

  /** Swap in a new configuration on the fly (garage tuning). Keeps position, speed and damage. */
  applyConfig(cfg: VehicleConfig): void {
    this.cfg = cfg;
    this.deriveFromConfig();
    this.comLocal.set(...cfg.com);
    if (cfg.mass !== this.mass || this.body.localCom().y !== cfg.com[1] || this.body.localCom().z !== cfg.com[2]) {
      this.mass = cfg.mass;
      this.body.setAdditionalMassProperties(cfg.mass, { x: cfg.com[0], y: cfg.com[1], z: cfg.com[2] }, Vehicle.principal(cfg), { x: 0, y: 0, z: 0, w: 1 }, true);
    }
    const g = this.gearState;
    if (g.gear > cfg.gearbox.ratios.length) g.gear = cfg.gearbox.ratios.length;
    for (const w of this.wheels) w.length = clamp(w.length, w.susp.minLen, w.susp.maxLen);
  }

  /** Manual gearbox: next gear up (from reverse goes to neutral then first). */
  shiftUp(): void {
    const g = this.gearState;
    if (g.gear >= this.cfg.gearbox.ratios.length) return;
    g.gear = g.gear === -1 ? 0 : g.gear + 1;
    g.shiftTimer = this.cfg.gearbox.shiftTime;
  }

  /** Manual gearbox: next gear down; reverse only when (almost) stopped. */
  shiftDown(): void {
    const g = this.gearState;
    if (g.gear <= -1) return;
    if (g.gear === 0 && Math.abs(this.vLong) > 1.5) return;
    g.gear -= 1;
    g.shiftTimer = this.cfg.gearbox.shiftTime * 0.7;
  }

  /** Enable crumple zones from rays measured on the visible shell. */
  attachCrush(rays: CrushRay[]): CrushSystem {
    let min = [Infinity, Infinity, Infinity];
    let max = [-Infinity, -Infinity, -Infinity];
    for (const r of rays) {
      for (const p of [r.origin, r.surface]) {
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k]!, p[k]!);
          max[k] = Math.max(max[k]!, p[k]!);
        }
      }
    }
    const m = 0.12;
    const center: [number, number, number] = [(min[0]! + max[0]!) / 2, (min[1]! + max[1]!) / 2, (min[2]! + max[2]!) / 2];
    const half: [number, number, number] = [(max[0]! - min[0]!) / 2 + m, (max[1]! - min[1]!) / 2 + m, (max[2]! - min[2]!) / 2 + m];
    this.crush = new CrushSystem(this.physics, this, rays, { center, half });
    this.physics.crushBodies.add(this.body.handle);
    return this.crush;
  }

  /** Add the impulse F*dt applied at a world point (used by the crumple zones). */
  applyForce(dt: number, px: number, py: number, pz: number, fx: number, fy: number, fz: number): void {
    accumulate(dt, px, py, pz, fx, fy, fz);
  }

  get speedKmh(): number {
    return this.speed * 3.6;
  }

  /** Centre wheel angle (rad, + = left). */
  get steerAngle(): number {
    return this.steering.angle;
  }

  get gear(): number {
    return this.gearState.gear;
  }

  /** Put the car back on its wheels at its current position, facing the same way. */
  recover(): void {
    const t = this.body.translation();
    const r = this.body.rotation();
    _fwd.set(0, 0, 1).applyQuaternion(_q.set(r.x, r.y, r.z, r.w));
    const yaw = Math.atan2(_fwd.x, _fwd.z);
    this.placeAt(t.x, t.y + 1.0, t.z, yaw);
  }

  placeAt(x: number, y: number, z: number, yaw: number): void {
    _q.setFromAxisAngle(_up.set(0, 1, 0), yaw);
    this.body.setTranslation({ x, y, z }, true);
    this.body.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    for (const w of this.wheels) {
      w.omega = 0;
      w.length = w.susp.maxLen;
      w.prevLength = w.susp.maxLen;
    }
    this.gearState.gear = 1;
    this.gearState.shiftTimer = 0;
    this.rpm = this.cfg.engine.idleRpm;
    this.steering.reset();
    this.first = true;
    this.syncFromBody();
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
  }

  private syncFromBody(): void {
    const t = this.body.translation();
    const r = this.body.rotation();
    this.currPos.set(t.x, t.y, t.z);
    this.currQuat.set(r.x, r.y, r.z, r.w);
  }

  /** Copy current state to "previous" (call once at the start of each fixed step). */
  private snapshot(): void {
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
    for (const w of this.wheels) {
      w.prevSteer = w.steer;
      w.prevSpin = w.spin;
      w.prevLength = w.length;
    }
  }

  /** Advance the vehicle by one fixed step. Forces are applied as impulses; the world step follows. */
  fixedUpdate(dt: number, input: DriveInput): void {
    const cfg = this.cfg;
    const body = this.body;
    const wheels = this.wheels;
    const R = cfg.wheel.radius;

    // ---- chassis state ---------------------------------------------------------
    this.syncFromBodyPrevAware();
    _q.copy(this.currQuat);
    _pos.copy(this.currPos);
    _up.set(0, 1, 0).applyQuaternion(_q);
    _fwd.set(0, 0, 1).applyQuaternion(_q);
    _left.set(1, 0, 0).applyQuaternion(_q);
    const lv = body.linvel();
    const av = body.angvel();
    _vel.set(lv.x, lv.y, lv.z);
    _ang.set(av.x, av.y, av.z);
    _com.copy(this.comLocal).applyQuaternion(_q).add(_pos);
    const vLong = _vel.dot(_fwd);
    const speed = _vel.length();
    const yawRate = _ang.dot(_up);
    this.vLong = vLong;
    this.speed = speed;
    this.yawRate = yawRate;

    // ---- driver intent -----------------------------------------------------------
    const gs = this.gearState;
    let throttleCmd = clamp(input.throttle, 0, 1);
    let brakeCmd = clamp(input.brake, 0, 1);
    const stopped = Math.abs(vLong) < 0.8;
    if (this.manual) {
      // Manual: W is always the throttle, S always the brake; the driver picks the gear.
      if (gs.gear === 0 && stopped && throttleCmd > 0.05) {
        gs.gear = 1;
      }
    } else if (gs.gear === -1) {
      // Reverse: S drives, W brakes until stopped then selects first gear.
      const t = input.brake;
      const b = input.throttle;
      throttleCmd = clamp(t, 0, 1);
      brakeCmd = clamp(b, 0, 1);
      if (input.throttle > 0.05 && input.brake < 0.05 && stopped) {
        gs.gear = 1;
        gs.shiftTimer = 0.2;
        throttleCmd = clamp(input.throttle, 0, 1);
        brakeCmd = 0;
      }
    } else if (input.brake > 0.05 && input.throttle < 0.05) {
      if (vLong > 0.8) {
        throttleCmd = 0;
        brakeCmd = clamp(input.brake, 0, 1);
      } else if (stopped) {
        gs.gear = -1;
        gs.shiftTimer = 0.2;
        throttleCmd = clamp(input.brake, 0, 1);
        brakeCmd = 0;
      }
    }

    // ---- steering ----------------------------------------------------------------
    const vLat = _vel.dot(_left);
    const sc = this.steering;
    _steerCtx.dt = dt;
    _steerCtx.input = input.steer;
    _steerCtx.vLong = vLong;
    _steerCtx.vLat = vLat;
    _steerCtx.speed = speed;
    _steerCtx.yawRate = yawRate;
    _steerCtx.lf = this.lf;
    _steerCtx.wheelbase = this.wheelbase;
    _steerCtx.frontPeak = this.frontTire.peakSlipAngle;
    _steerCtx.rearPeak = this.rearTire.peakSlipAngle;
    _steerCtx.first = this.first;
    sc.update(cfg.steering, _steerCtx);
    const w = sc.assistWeight;
    const plainMax = sc.plainMax;
    const ack = ackermann(sc.angle, this.wheelbase, this.trackFront, _ack);
    wheels[0]!.steer = ack[0] + wheels[0]!.steerBias;
    wheels[1]!.steer = ack[1] + wheels[1]!.steerBias;
    wheels[2]!.steer = wheels[2]!.steerBias;
    wheels[3]!.steer = wheels[3]!.steerBias;

    // ---- assists (use last step's slip, one-step latency is fine at 120 Hz) --------
    let throttleScale = 1;
    this.tcActive = false;
    this.absActive = false;
    this.espActivity = 0;
    if (this.assists.tc && throttleCmd > 0.05) {
      let maxK = 0;
      for (let i = 0; i < 4; i++) if (this.drivenShare[i]! > 0) maxK = Math.max(maxK, wheels[i]!.slipAssist * Math.sign(totalRatio(cfg.gearbox, gs.gear) || 1));
      const s = tcScale(maxK);
      if (s < 1) this.tcActive = true;
      throttleScale *= s;
    }
    _esp.throttleScale = 1;
    _esp.brake[0] = _esp.brake[1] = _esp.brake[2] = _esp.brake[3] = 0;
    _esp.activity = 0;
    if (this.assists.esp) {
      const v = Math.max(Math.abs(vLong), 1);
      const cap = (0.95 * G) / v;
      const plain = (Math.sign(vLong) * v * Math.tan(sc.input * plainMax)) / this.wheelbase;
      const desired = clamp(lerp(plain, sc.input * cap, w), -cap, cap);
      espControl(vLong, yawRate, desired, _esp);
      throttleScale *= _esp.throttleScale;
      this.espActivity = _esp.activity;
    }

    // ---- drivetrain ----------------------------------------------------------------
    const gb = cfg.gearbox;
    const eng = cfg.engine;
    const ratio = totalRatio(gb, gs.gear);
    const absRatio = Math.abs(ratio);
    let sumW = 0;
    let nDriven = 0;
    for (let i = 0; i < 4; i++) {
      if (this.drivenShare[i]! > 0) {
        sumW += wheels[i]!.omega;
        nDriven++;
      }
    }
    const avgOmega = nDriven > 0 ? sumW / nDriven : 0;
    const coupledRpm = Math.abs(avgOmega * ratio) * RADS_TO_RPM;
    const throttleEff = throttleCmd * throttleScale;
    // Pulling the handbrake also presses the clutch: the engine revs freely and the gear is kept,
    // and letting go "kicks" the clutch (a drift entry, not a stall).
    const declutch = ratio !== 0 && input.handbrake > 0.1;
    // Clutch slips at launch: the engine flares towards launchRpm instead of lugging at wheel speed.
    const cs = ratio === 0 ? 0 : 1 - smoothstep(2, 7, Math.abs(vLong));
    let targetRpm: number;
    if (ratio === 0 || declutch) {
      targetRpm = eng.idleRpm + throttleCmd * (eng.redlineRpm - eng.idleRpm) * 0.6;
    } else {
      const launch = lerp(eng.idleRpm, eng.launchRpm, throttleEff);
      targetRpm = lerp(coupledRpm, Math.max(coupledRpm, launch), cs);
    }
    targetRpm = Math.max(targetRpm, eng.idleRpm);
    this.rpm += (targetRpm - this.rpm) * damp(1 / 0.05, dt);
    this.rpm = Math.min(this.rpm, eng.redlineRpm * 1.04);

    if (this.rpm >= eng.redlineRpm) this.limiter = true;
    else if (this.rpm < eng.redlineRpm - 250) this.limiter = false;

    let spin = 0;
    for (let i = 0; i < 4; i++) if (this.drivenShare[i]! > 0) spin = Math.max(spin, wheels[i]!.slipAssist);
    if (this.manual) {
      if (gs.shiftTimer > 0) gs.shiftTimer = Math.max(0, gs.shiftTimer - dt);
    } else {
      // Shift on road speed: locked or spinning wheels say nothing about which gear fits.
      const roadRpm = Math.max(((vLong > 0 ? speed : Math.abs(vLong)) / R) * absRatio * RADS_TO_RPM, eng.idleRpm);
      // Hold the gear in a drift (wheelspin while sliding sideways); a straight-line burnout upshifts.
      const drifting = spin > 0.25 && Math.abs(this.steering.slip) > 0.15;
      // On the rev limiter the engine is past the shift point whatever the road speed says.
      const shiftRpm = cs > 0.5 ? this.rpm : this.limiter ? Math.max(roadRpm, this.rpm) : roadRpm;
      autoShift(gb, gs, shiftRpm, throttleEff, dt, drifting);
    }

    let crank = engineTorque(eng, this.rpm, throttleEff) * this.powerScale;
    if (this.limiter && crank > 0) crank = 0;
    if (crank < 0) crank *= 1 - cs;
    const shifting = gs.shiftTimer > 0;
    const wheelTorqueTotal = shifting || ratio === 0 || declutch ? 0 : crank * ratio * gb.efficiency;
    const reflected = ratio === 0 || declutch ? 0 : (eng.inertia * absRatio * absRatio * (1 - cs)) / Math.max(nDriven, 1);

    for (let i = 0; i < 4; i++) wheels[i]!.hubDrive = wheelTorqueTotal * this.drivenShare[i]!;

    // Limited-slip coupling per driven axle.
    if (cfg.diff.lsdK > 0) {
      for (const [a, b] of AXLES) {
        if (this.drivenShare[a]! > 0 && this.drivenShare[b]! > 0) {
          const slip = wheels[a]!.omega - wheels[b]!.omega;
          // Coupling stiffness capped by what an explicit step can take without ringing.
          const kMax = (0.45 * (this.wheelIdleInertia + reflected)) / dt;
          const tr = clamp(Math.min(cfg.diff.lsdK, kMax) * slip, -cfg.diff.lsdMax, cfg.diff.lsdMax);
          wheels[a]!.hubDrive -= tr;
          wheels[b]!.hubDrive += tr;
        }
      }
    }

    // ---- brakes ----------------------------------------------------------------------
    const bk = cfg.brakes;
    const baseBrake = brakeCmd * bk.torque;
    const autoHold = speed < 0.4 && throttleCmd < 0.02 && brakeCmd < 0.02 ? 450 : 0;
    for (let i = 0; i < 4; i++) {
      const w = wheels[i]!;
      let t = (baseBrake * (w.isFront ? bk.frontBias : 1 - bk.frontBias)) / 2;
      if (this.assists.abs && t > 0) {
        const s = absScale(w.slipAssist);
        if (s < 1) this.absActive = true;
        t *= s;
      }
      if (!w.isFront) t += bk.handbrakeTorque * clamp(input.handbrake, 0, 1) * 0.5;
      t += _esp.brake[i]! * bk.torque * 0.5;
      w.brakeTorque = t + autoHold;
    }

    // ---- suspension pass 1: rays + springs -----------------------------------------
    const ray = this.ray;
    const world = this.physics.world;
    for (let i = 0; i < 4; i++) {
      const w = wheels[i]!;
      _p.copy(this.mountLocal[i]!).applyQuaternion(_q).add(_pos); // mount in world
      w.mountWorldX = _p.x;
      w.mountWorldY = _p.y;
      w.mountWorldZ = _p.z;
      ray.origin.x = _p.x;
      ray.origin.y = _p.y;
      ray.origin.z = _p.z;
      ray.dir.x = -_up.x;
      ray.dir.y = -_up.y;
      ray.dir.z = -_up.z;
      const maxToi = w.susp.maxLen + R;
      const hit = w.detached
        ? null
        : world.castRayAndGetNormal(ray, maxToi, true, undefined, groups(0xffff, GROUP.GROUND_RAY), undefined, body);
      if (hit) {
        const len = clamp(hit.timeOfImpact - R, w.susp.minLen, w.susp.maxLen);
        w.hit = true;
        w.contact = true;
        w.length = len;
        w.contactPoint.set(ray.origin.x + ray.dir.x * hit.timeOfImpact, ray.origin.y + ray.dir.y * hit.timeOfImpact, ray.origin.z + ray.dir.z * hit.timeOfImpact);
        w.contactNormal.set(hit.normal.x, hit.normal.y, hit.normal.z);
        w.groundBody = hit.collider.parent();
        w.groundHandle = hit.collider.handle;
        const comp = w.susp.maxLen - len;
        w.compression = comp;
        const vComp = this.first ? 0 : (w.prevLength - len) / dt;
        let f = w.susp.k * w.springScale * comp + (vComp > 0 ? w.susp.cBump : w.susp.cRebound) * vComp;
        // Progressive bump stop in the last 2.5 cm of travel.
        const stop = w.susp.minLen + 0.025 - len;
        if (stop > 0 || hit.timeOfImpact - R < w.susp.minLen) f += 120000 * Math.max(stop, 0.001);
        w.springForce = Math.max(0, f);
      } else {
        w.hit = false;
        w.contact = false;
        w.length = w.susp.maxLen;
        w.compression = 0;
        w.springForce = 0;
        w.groundBody = null;
      }
    }
    this.first = false;

    // ---- anti-roll bars (couple left/right on each axle) ------------------------------
    for (const [a, b] of AXLES) {
      const wa = wheels[a]!;
      const wb = wheels[b]!;
      const arb = wa.susp.arb;
      if (arb > 0) {
        const d = (wa.compression - wb.compression) * arb;
        if (wa.hit) wa.springForce = Math.max(0, wa.springForce + d);
        if (wb.hit) wb.springForce = Math.max(0, wb.springForce - d);
      }
    }

    // ---- pass 2: apply suspension + tyre forces ---------------------------------------
    _jTot.set(0, 0, 0);
    _tTot.set(0, 0, 0);

    for (let i = 0; i < 4; i++) {
      const w = wheels[i]!;
      const Ieff = this.wheelIdleInertia + (this.drivenShare[i]! > 0 ? reflected : 0);
      if (!w.hit) {
        // Airborne: free-spin with drive and brake torque, tiny drag.
        let om = w.omega + ((w.hubDrive - w.omega * 0.05) / Ieff) * dt;
        const bt = (w.brakeTorque / Ieff) * dt;
        om = Math.abs(om) <= bt ? 0 : om - Math.sign(om) * bt;
        w.omega = om;
        w.fz = 0;
        w.fx = 0;
        w.fy = 0;
        w.slipRatio = 0;
        w.slipAssist = 0;
        w.slipAngle = 0;
        w.slideSpeed = 0;
        w.spin += w.omega * dt;
        continue;
      }

      // Suspension force at the mount along the chassis up axis.
      const F = w.springForce;
      accumulate(dt, w.mountWorldX, w.mountWorldY, w.mountWorldZ, _up.x * F, _up.y * F, _up.z * F);
      if (w.groundBody && w.groundBody.isDynamic()) {
        _o.x = -_up.x * F * dt;
        _o.y = -_up.y * F * dt;
        _o.z = -_up.z * F * dt;
        _o2.x = w.contactPoint.x;
        _o2.y = w.contactPoint.y;
        _o2.z = w.contactPoint.z;
        w.groundBody.applyImpulseAtPoint(_o, _o2, true);
      }

      // Tyre frame on the contact plane.
      const n = w.contactNormal;
      _qs.setFromAxisAngle(_tmp.set(0, 1, 0), w.steer);
      _wf.set(0, 0, 1).applyQuaternion(_qs).applyQuaternion(_q); // heading in world space
      _wf.addScaledVector(n, -_wf.dot(n)).normalize();
      _wl.crossVectors(n, _wf); // points left

      // Contact point velocity: v + omega x r.
      _r.set(w.contactPoint.x - _com.x, w.contactPoint.y - _com.y, w.contactPoint.z - _com.z);
      _vp.crossVectors(_ang, _r).add(_vel);
      // Account for a moving ground body (props): subtract its velocity at the contact.
      if (w.groundBody && w.groundBody.isDynamic()) {
        const gv = w.groundBody.velocityAtPoint({ x: w.contactPoint.x, y: w.contactPoint.y, z: w.contactPoint.z });
        _vp.x -= gv.x;
        _vp.y -= gv.y;
        _vp.z -= gv.z;
      }
      const vx = _vp.dot(_wf);
      const vy = _vp.dot(_wl);

      const surface: Surface = this.physics.groundColliders.has(w.groundHandle) ? this.physics.surfaceAt(w.contactPoint.x, w.contactPoint.z) : 'asphalt';
      w.surface = surface;
      const grip = SURFACE_GRIP[surface] * (surface === 'asphalt' ? 1 : (cfg.tire.looseGrip ?? 1)) * w.gripScale * (w.isFront ? 1 : cfg.rearGripScale) * (w.flat ? 0.45 : 1);

      const wheelSpeed = w.omega * R;
      const denom = Math.max(Math.abs(vx), V_MIN_SLIP);
      const slipSpeed = wheelSpeed - vx;
      const kappa = clamp(slipSpeed / denom, -5, 5);
      const tanA = clamp(vy / denom, -5, 5);
      w.slipRatio = kappa;
      w.slipAssist = clamp(slipSpeed / Math.max(Math.abs(vx), 5), -5, 5);
      w.slipAngle = Math.atan(tanA);
      w.slideSpeed = Math.hypot(slipSpeed, vy);

      tireForces(w.isFront ? this.frontTire : this.rearTire, kappa, tanA, F, grip, _tire);
      let fx = _tire.fx;
      let fy = _tire.fy;

      // Rolling resistance (smooth through zero speed).
      fx -= (w.isFront ? this.frontTire : this.rearTire).rollingResistance * SURFACE_ROLLING[surface] * F * clamp(vx / 0.6, -1, 1);

      // Stability clamps: a tyre cannot remove more slip velocity in one step than exists.
      const mc = Math.max(F * this.invG, 40);
      // A wheel the brake holds cannot spin up, so only the car's own mass limits the force that
      // stops the contact sliding (static friction: no creeping when parked).
      const held = w.brakeTorque > Math.abs(w.hubDrive) + 1 && Math.abs(w.omega) < 0.5;
      const fxMax = held ? (Math.abs(slipSpeed) * mc * 0.8) / dt : Math.abs(slipSpeed) / (dt * (R * R / Ieff + 1 / mc));
      fx = clamp(fx, -fxMax, fxMax);
      const fyMax = (Math.abs(vy) * mc * 0.7) / dt;
      fy = clamp(fy, -fyMax, fyMax);

      w.fx = fx;
      w.fy = fy;
      w.fz = F;

      // Apply at the contact point lifted by tireForceHeight along the chassis up axis.
      const lift = cfg.tireForceHeight;
      const px = w.contactPoint.x + _up.x * lift;
      const py = w.contactPoint.y + _up.y * lift;
      const pz = w.contactPoint.z + _up.z * lift;
      const gx = _wf.x * fx + _wl.x * fy;
      const gy = _wf.y * fx + _wl.y * fy;
      const gz = _wf.z * fx + _wl.z * fy;
      accumulate(dt, px, py, pz, gx, gy, gz);
      if (w.groundBody && w.groundBody.isDynamic()) {
        _o.x = -gx * dt;
        _o.y = -gy * dt;
        _o.z = -gz * dt;
        _o2.x = w.contactPoint.x;
        _o2.y = w.contactPoint.y;
        _o2.z = w.contactPoint.z;
        w.groundBody.applyImpulseAtPoint(_o, _o2, true);
      }

      // Wheel spin: drive torque, tyre reaction, brake.
      let om = w.omega + ((w.hubDrive - fx * R) / Ieff) * dt;
      const bt = (w.brakeTorque / Ieff) * dt;
      om = Math.abs(om) <= bt ? 0 : om - Math.sign(om) * bt;
      w.omega = om;
      w.spin += om * dt;
    }

    // ---- slide control (arcade) -----------------------------------------------------------
    // A yaw damper on the rate of change of the slip angle: it does not change how much the car
    // can slide, only how violently the angle swings, so slides and drifts can be held on a keyboard.
    const slideK = clamp(cfg.steering.slideControl ?? 0, 0, 1);
    if (slideK > 0 && vLong > 3 && speed > 5) {
      const tz = clamp(slideK * 3 * this.yawInertia * this.steering.slipRate, -this.yawInertia * 4, this.yawInertia * 4) * dt;
      _tTot.addScaledVector(_up, tz);
    }

    // ---- aerodynamics ------------------------------------------------------------------
    if (speed > 0.5) {
      const q = 0.5 * RHO * speed;
      accumulate(dt, _com.x, _com.y, _com.z, -q * cfg.aero.cdA * _vel.x, -q * cfg.aero.cdA * _vel.y, -q * cfg.aero.cdA * _vel.z);
      const down = 0.5 * RHO * speed * speed * cfg.aero.clA;
      if (cfg.aero.frontShare === undefined) {
        accumulate(dt, _com.x, _com.y, _com.z, -_up.x * down, -_up.y * down, -_up.z * down);
      } else {
        // Downforce on each axle: the aero balance moves grip between front and rear at speed.
        const fs = clamp(cfg.aero.frontShare, 0, 1);
        for (const [z, share] of [
          [cfg.wheels.FL[2], fs],
          [cfg.wheels.RL[2], 1 - fs],
        ] as const) {
          _p.set(0, this.comLocal.y, z).applyQuaternion(_q).add(_pos);
          const d = down * share;
          accumulate(dt, _p.x, _p.y, _p.z, -_up.x * d, -_up.y * d, -_up.z * d);
        }
      }
    }

    // ---- crumple zones ---------------------------------------------------------------
    if (this.crush) this.crush.step(dt, this.currPos, this.currQuat);

    // ---- hand the accumulated impulse to the rigid body --------------------------------
    _o.x = _jTot.x;
    _o.y = _jTot.y;
    _o.z = _jTot.z;
    body.applyImpulse(_o, true);
    _o.x = _tTot.x;
    _o.y = _tTot.y;
    _o.z = _tTot.z;
    body.applyTorqueImpulse(_o, true);

    this.throttleCmd = throttleCmd;
    this.brakeCmd = brakeCmd;
  }

  /** After the world step: read the new rigid-body transform for rendering/interpolation. */
  afterPhysicsStep(): void {
    this.syncFromBody();
  }

  /** Called before the first force of each fixed step so prev/curr hold consecutive states. */
  private syncFromBodyPrevAware(): void {
    this.snapshot();
    this.syncFromBody();
  }
}
