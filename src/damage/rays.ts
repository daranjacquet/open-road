import type { CarModel } from '../render/carModel';
import type { CrushGrid, VehicleConfig, Vec3 } from '../vehicle/types';

/** One crumple-zone ray, in the chassis frame. */
export interface CrushRay {
  index: number;
  kind: CrushGrid['kind'];
  /** Start point on the hard core. */
  origin: Vec3;
  /** Unit outward direction. */
  dir: Vec3;
  /** Distance from the core to the visible shell: the crush depth available. */
  length: number;
  /** Panel the ray exits through (used to attribute damage). */
  part: string;
  /** Force (N) at which the crumple zone yields (plastic crush). */
  fmax: number;
  /** Penetration (m) at which that force is reached (stiffness = fmax / yield). */
  yield: number;
  /** Point on the visible surface (rest), where this ray's dent is centred. */
  surface: Vec3;
}

/** Expand the config's ray grids into individual rays, measuring each against the visible shell. */
/** Default elastic travel per zone kind (see CrushGrid.elastic). */
export const ELASTIC: Record<CrushGrid['kind'], number> = { front: 0.08, rear: 0.08, corner: 0.06, left: 0.03, right: 0.03, roof: 0.03 };

export function buildCrushRays(cfg: VehicleConfig, model: Pick<CarModel, 'probe'>): CrushRay[] {
  const rays: CrushRay[] = [];
  for (const g of cfg.crush) {
    const len = Math.hypot(g.dir[0], g.dir[1], g.dir[2]);
    const d: Vec3 = [g.dir[0] / len, g.dir[1] / len, g.dir[2] / len];
    const first = rays.length;
    for (let a = 0; a < g.nu; a++) {
      const s = g.nu === 1 ? 0 : (a / (g.nu - 1)) * 2 - 1;
      for (let b = 0; b < g.nv; b++) {
        const t = g.nv === 1 ? 0 : (b / (g.nv - 1)) * 2 - 1;
        const o: Vec3 = [g.origin[0] + g.u[0] * s + g.v[0] * t, g.origin[1] + g.u[1] * s + g.v[1] * t, g.origin[2] + g.u[2] * s + g.v[2] * t];
        const hit = model.probe(o, d, 1.5);
        if (!hit || hit.dist < 0.03) continue; // ray starts outside the shell, or is degenerate
        rays.push({
          index: rays.length,
          kind: g.kind,
          origin: o,
          dir: d,
          length: hit.dist,
          part: hit.part,
          fmax: 0,
          yield: g.elastic ?? ELASTIC[g.kind],
          surface: [o[0] + d[0] * hit.dist, o[1] + d[1] * hit.dist, o[2] + d[2] * hit.dist],
        });
      }
    }
    // Share the grid's total force between the rays that actually exist.
    const n = rays.length - first;
    for (let i = first; i < rays.length; i++) rays[i]!.fmax = g.force / Math.max(n, 1);
  }
  return rays;
}
