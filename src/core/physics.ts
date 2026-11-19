import RAPIER from '@dimforge/rapier3d-compat';

export const FIXED_DT = 1 / 120;

/** Ground surface types: the tyre model scales grip by them. */
export type Surface = 'asphalt' | 'dirt' | 'grass';
/** Friction multiplier per surface. */
export const SURFACE_GRIP: Record<Surface, number> = {
  asphalt: 1.0,
  dirt: 0.72,
  grass: 0.55,
};

export interface Physics {
  RAPIER: typeof RAPIER;
  world: RAPIER.World;
  events: RAPIER.EventQueue;
  /** Handles of the colliders that make up the open ground (their grip comes from `surfaceAt`). */
  groundColliders: Set<number>;
  /** Handles of rigid bodies that run their own crumple zones (no double reaction on them). */
  crushBodies: Set<number>;
  /** Surface under a point of the open ground. The map installs its painted raster here. */
  surfaceAt(x: number, z: number): Surface;
  step(): void;
}

/** Collision groups (membership << 16 | filter). */
export const GROUP = {
  WORLD: 0x0001,
  CHASSIS: 0x0002,
  PART: 0x0004,
  PROP: 0x0008,
  /** Visible-shell colliders of cars: only crumple-zone rays can see them (never the solver). */
  OUTLINE: 0x0010,
  /** Membership of crumple-zone rays. */
  RAY: 0x8000,
  /** Ray queries for suspension only hit these. */
  GROUND_RAY: 0x0001 | 0x0008,
} as const;

export function groups(member: number, filter: number): number {
  return ((member & 0xffff) << 16) | (filter & 0xffff);
}

export async function createPhysics(): Promise<Physics> {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = FIXED_DT;
  // A bit more solver work than the default: stacked crates and 4-wheel contact feel better.
  world.integrationParameters.numSolverIterations = 6;
  const events = new RAPIER.EventQueue(true);
  return {
    RAPIER,
    world,
    events,
    groundColliders: new Set<number>(),
    crushBodies: new Set<number>(),
    surfaceAt: () => 'asphalt',
    step() {
      world.step(events);
    },
  };
}
