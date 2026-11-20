import type { Vec3 } from '../types';

/** What moves a lifting surface: none, an aileron (left or right), the elevator, the rudder, the flaps. */
export type ControlKind = 'none' | 'aileronL' | 'aileronR' | 'elevator' | 'rudder' | 'flap';

/**
 * One lifting surface (a wing panel, a tail plane, the fin), in the body frame (+z forward, +y up,
 * +x left), with its own airflow, lift curve and stall. The aircraft's handling comes out of where
 * these sit: no stability derivatives are scripted.
 */
export interface SurfaceDef {
  name: string;
  /** Part it belongs to (it goes when the part comes off). */
  part: string;
  /** Aerodynamic centre (quarter chord). */
  pos: Vec3;
  /** Lift reference direction at zero angle of attack (unit): up for wings, sideways for the fin. */
  normal: Vec3;
  /** Span direction (unit, along the surface, perpendicular to the chord). */
  span: Vec3;
  area: number;
  chord: number;
  aspect: number;
  /** Lift coefficient at zero angle of attack (incidence and camber), lift slope (per radian). */
  cl0: number;
  clAlpha: number;
  /** Lift coefficient where the surface stalls (positive and negative). */
  clMax: number;
  clMin: number;
  cd0: number;
  /** Pitching moment coefficient about the aerodynamic centre (nose down is negative). */
  cm0: number;
  control: ControlKind;
  /** Lift added per radian of control deflection (flap effectiveness times lift slope). */
  controlCl: number;
  /** Largest deflection (rad). */
  controlMax: number;
}

export interface GearDef {
  name: string;
  part: string;
  /** Strut top (body frame). */
  pos: Vec3;
  /** Strut travel (m) and wheel radius (m). */
  travel: number;
  radius: number;
  /** Spring rate (N/m) and damping (N s/m). */
  k: number;
  c: number;
  steer: boolean;
  brake: boolean;
}

export interface ColliderDef {
  part: string;
  center: Vec3;
  half: Vec3;
  /** Mass (kg): the body's mass, centre of mass and inertia come from these. */
  mass: number;
}

export interface AircraftConfig {
  name: string;
  surfaces: SurfaceDef[];
  gear: GearDef[];
  colliders: ColliderDef[];
  /** Drag area of everything that is not a lifting surface (fuselage, gear, cowling), m^2. */
  bodyDragArea: number;
  engine: {
    /** Shaft power (W), static thrust (N), propeller efficiency, rpm at idle and at full power. */
    power: number;
    staticThrust: number;
    efficiency: number;
    idleRpm: number;
    maxRpm: number;
    /** Propeller hub (body frame) and radius (m). */
    pos: Vec3;
    radius: number;
  };
  /** Wheel brakes: deceleration force per wheel at full pedal, as a share of its load. */
  brakeMu: number;
  /** Nose-wheel steering lock (rad) at walking pace. */
  steerLock: number;
  /** Load factor (g) the wings and tail take before they fail, and the sink rate (m/s) a gear leg takes. */
  limits: { wingG: number; gearSink: number };
}

export type { FlightInput } from '../../core/input';
