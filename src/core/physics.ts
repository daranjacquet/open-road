import RAPIER from '@dimforge/rapier3d-compat';

export const FIXED_DT = 1 / 120;

export interface Physics {
  RAPIER: typeof RAPIER;
  world: RAPIER.World;
  events: RAPIER.EventQueue;
  /** Handles of the colliders that make up the open ground (surface grip comes from `surfaceAt`). */
  groundColliders: Set<number>;
  step(): void;
}

/** Collision groups (membership << 16 | filter). */
export const GROUP = {
  WORLD: 0x0001,
  CHASSIS: 0x0002,
  PART: 0x0004,
  PROP: 0x0008,
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
    step() {
      world.step(events);
    },
  };
}
