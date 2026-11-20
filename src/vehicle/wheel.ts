import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Surface } from '../core/physics';
import type { AxleSuspension } from './types';

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
