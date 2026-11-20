import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { CarModel } from '../render/carModel';
import type { VehicleConfig, Vec3 } from '../vehicle/types';
import type { CrushRay } from './rays';

/** A crumple ray of the passenger cell, before it gets its place in the car's ray list. */
export type CabinRay = Omit<CrushRay, 'index'>;

/**
 * The passenger cell fitted to the car's real shape: a convex hard core that stays inside the
 * greenhouse everywhere (roof, roof edges, pillars, windscreen, rear window, side glass), and
 * crumple rays from it out to the visible shell. A box core pokes out through sloped glass and
 * rounded roof edges, so a car rolling over would land on a rigid block and never crush.
 */
export interface Cabin {
  /** Index in `cfg.colliders` of the box this replaces (the upper one). */
  collider: number;
  /** Hard core, as the points of a convex hull (chassis frame, x y z per point). */
  core: Float32Array;
  /** The visible greenhouse, as the points of a convex hull (what other cars' rays hit). */
  shell: Float32Array;
  /** A point inside the cell (the first centre its rays fan out from). */
  centre: Vec3;
  rays: CabinRay[];
}

const G = 9.81;
/** Crush depth between the visible shell and the hard core (m): roof, sides, the ends (pillars, glass). */
const DEPTH = { top: 0.24, side: 0.13, ends: 0.18 };
/**
 * Strength of each face of the cell when all of it bears at once, in multiples of the car's weight.
 * A roof is built to carry 3 to 4 times the weight on one corner, about a quarter of its area: a
 * car resting on its roof holds, a car landing on it at speed folds it in by a hand's width or more.
 */
export const CABIN_STRENGTH = { top: 10, side: 10, ends: 8 };
const ELASTIC = 0.03;
const STEP = (15 * Math.PI) / 180;
/** Least clearance between the hard core and the outer skin anywhere (m). */
const MARGIN = 0.06;
/** Closest two cabin rays may end on the shell (m): the centres' fans overlap. */
const SPACING = 0.1;

const cache = new WeakMap<VehicleConfig, Cabin | null>();

/** Queries on a convex hull, built once (a bare Rapier shape rebuilds its hull on every query). */
export interface ConvexQuery {
  /** Distance from an inside point to the hull's surface along a unit direction (-1 if none). */
  exit(p: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }): number;
  contains(p: { x: number; y: number; z: number }): boolean;
  free(): void;
}

export function convexQuery(R: typeof RAPIER, points: Float32Array): ConvexQuery | null {
  const desc = R.ColliderDesc.convexHull(points);
  if (!desc) return null;
  const world = new R.World({ x: 0, y: 0, z: 0 });
  const collider = world.createCollider(desc);
  const ray = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
  return {
    exit(p, dir) {
      ray.origin = { x: p.x, y: p.y, z: p.z };
      ray.dir = { x: dir.x, y: dir.y, z: dir.z };
      const t = collider.castRay(ray, 3, false);
      return t >= 0 ? t : -1;
    },
    contains: (p) => collider.containsPoint(p),
    free: () => world.free(),
  };
}

/** Exit distance from a point inside a box along a unit direction. */
function exitBox(p: THREE.Vector3, d: THREE.Vector3, c: Vec3, h: Vec3): number {
  let t = Infinity;
  const pa = [p.x, p.y, p.z];
  const da = [d.x, d.y, d.z];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(da[a]!) < 1e-9) continue;
    const lim = da[a]! > 0 ? c[a]! + h[a]! : c[a]! - h[a]!;
    t = Math.min(t, (lim - pa[a]!) / da[a]!);
  }
  return t;
}

/** Share of a direction that faces the roof, the sides and the ends (sums to 1). */
function faceWeights(d: THREE.Vector3): { top: number; side: number; ends: number } {
  const top = Math.max(d.y, 0) ** 2;
  const side = d.x * d.x;
  const ends = d.z * d.z;
  const s = top + side + ends || 1;
  return { top: top / s, side: side / s, ends: ends / s };
}

/**
 * Fit the passenger cell of a car to its model (once per car: the result is cached).
 * Null when the config has no separate upper core box.
 */
export function fitCabin(cfg: VehicleConfig, model: Pick<CarModel, 'probe'>, R: typeof RAPIER): Cabin | null {
  const cached = cache.get(cfg);
  if (cached !== undefined) return cached;
  const cabin = fit(cfg, model, R);
  cache.set(cfg, cabin);
  return cabin;
}

function fit(cfg: VehicleConfig, model: Pick<CarModel, 'probe'>, R: typeof RAPIER): Cabin | null {
  if (cfg.colliders.length < 2) return null;
  const top = (i: number): number => cfg.colliders[i]!.center[1] + cfg.colliders[i]!.half[1];
  let ci = 0;
  for (let i = 1; i < cfg.colliders.length; i++) if (top(i) > top(ci)) ci = i;
  const box = cfg.colliders[ci]!;
  const outline = cfg.outline[ci] ?? box;
  let belt = -Infinity;
  for (let i = 0; i < cfg.colliders.length; i++) if (i !== ci) belt = Math.max(belt, top(i));
  const bottom = box.center[1] - box.half[1];
  const yc = (belt + top(ci)) / 2;
  const d = new THREE.Vector3();
  const p = new THREE.Vector3();
  const back = new THREE.Vector3();

  interface Sample {
    centre: THREE.Vector3;
    dir: THREE.Vector3;
    /** First surface from inside, and the outermost one along the same line (m). */
    dist: number;
    outer: number;
    part: string;
    /** Solid angle the sample stands for (sr). */
    omega: number;
  }
  // Fans from several centres along the cell: one centre alone can sit right behind an inner wall
  // (a mid-engined car's bulkhead) and see nothing of the glass beyond it.
  const centres: { c: THREE.Vector3; samples: Sample[]; checks: { dir: THREE.Vector3; outer: number }[] }[] = [];
  for (const f of [0, 0.55, -0.55]) {
    const c = new THREE.Vector3(box.center[0], yc, box.center[2] + f * box.half[2]);
    const samples: Sample[] = [];
    let open = 0;
    let total = 0;
    // Roll angle a around the car's length (0 = left, 90 = up, 180 = right, a little below the
    // horizon on each side for the doors), pitch b towards the front and the back.
    for (let bi = -6; bi <= 6; bi++) {
      const b = bi * STEP;
      const pole = Math.abs(bi) === 6;
      const na = pole ? 1 : 15;
      for (let ai = 0; ai < na; ai++) {
        const a = pole ? Math.PI / 2 : -STEP + ai * STEP;
        d.set(Math.cos(a) * Math.cos(b), Math.sin(a) * Math.cos(b), Math.sin(b));
        total++;
        const hit = model.probe([c.x, c.y, c.z], [d.x, d.y, d.z], 3);
        if (!hit) continue;
        if (hit.dist > 0.25) open++;
        back.copy(c).addScaledVector(d, 3);
        const out = model.probe([back.x, back.y, back.z], [-d.x, -d.y, -d.z], 3);
        const omega = pole ? Math.PI * (1 - Math.cos(STEP / 2)) * 2 : STEP * STEP * Math.cos(b);
        samples.push({ centre: c, dir: d.clone(), dist: hit.dist, outer: out ? 3 - out.dist : hit.dist, part: hit.part, omega });
      }
    }
    // A centre inside clutter (seats, an engine) sees walls all around: no use.
    if (open < total * 0.5) continue;
    // Directions between the samples, only to check the fitted core against the outer skin
    // (hollows such as side air intakes fall between samples).
    const checks: { dir: THREE.Vector3; outer: number }[] = [];
    for (let bi = -5.5; bi <= 5.5; bi++) {
      for (let ai = -0.5; ai <= 14.5; ai++) {
        const a = -STEP + ai * STEP;
        const b = bi * STEP;
        const dir = new THREE.Vector3(Math.cos(a) * Math.cos(b), Math.sin(a) * Math.cos(b), Math.sin(b));
        back.copy(c).addScaledVector(dir, 3);
        const out = model.probe([back.x, back.y, back.z], [-dir.x, -dir.y, -dir.z], 3);
        if (out) checks.push({ dir, outer: 3 - out.dist });
      }
    }
    for (const sm of samples) checks.push({ dir: sm.dir, outer: sm.outer });
    centres.push({ c, samples, checks });
  }
  if (centres.length === 0) return null;

  // Core points: each sample's shell point pulled in by the crush depth (and kept in the box).
  interface CorePoint {
    centre: THREE.Vector3;
    dir: THREE.Vector3;
    t: number;
  }
  const points: CorePoint[] = [];
  const shell: number[] = [];
  for (const { c, samples } of centres) {
    for (const s of samples) {
      const w = faceWeights(s.dir);
      const depth = DEPTH.top * w.top + DEPTH.side * w.side + DEPTH.ends * w.ends;
      points.push({ centre: c, dir: s.dir, t: Math.max(Math.min(s.dist - depth, exitBox(c, s.dir, box.center, box.half)), 0.05) });
      p.copy(c).addScaledVector(s.dir, Math.min(s.outer, exitBox(c, s.dir, outline.center, outline.half)));
      shell.push(p.x, Math.max(p.y, bottom), p.z);
    }
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) shell.push(outline.center[0] + sx * outline.half[0], bottom, outline.center[2] + sz * outline.half[2]);
  }
  const build = (): { pts: Float32Array; shape: ConvexQuery } | null => {
    const pts: number[] = [];
    for (const q of points) {
      p.copy(q.centre).addScaledVector(q.dir, q.t);
      pts.push(p.x, Math.max(p.y, bottom), p.z);
    }
    // Down to the floor: the cell stands on the lower core.
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) pts.push(box.center[0] + sx * box.half[0], bottom, box.center[2] + sz * box.half[2]);
    const f = Float32Array.from(pts);
    const shape = convexQuery(R, f);
    return shape ? { pts: f, shape } : null;
  };
  // Shrink-wrap: a hull of points that are each inside the shell can still bridge a hollow of the
  // shell (where a roof drops to an engine deck). Pull in the points near any place where the hull
  // comes closer than MARGIN to the outer skin, and rebuild, until it fits.
  let built = build();
  for (let it = 0; it < 8 && built; it++) {
    const shape = built.shape;
    const exitFrom = (_: unknown, c: THREE.Vector3, dir: THREE.Vector3): number => shape.exit(c, dir);
    const bad: { x: number; y: number; z: number; by: number }[] = [];
    for (const { c, checks } of centres) {
      for (const s of checks) {
        const h = exitFrom(shape, c, s.dir);
        const over = h - (s.outer - MARGIN);
        if (h >= 0 && over > 0.005) bad.push({ x: c.x + s.dir.x * h, y: c.y + s.dir.y * h, z: c.z + s.dir.z * h, by: over });
      }
    }
    if (bad.length === 0) break;
    shape.free();
    for (const q of points) {
      p.copy(q.centre).addScaledVector(q.dir, q.t);
      let by = 0;
      for (const b of bad) if ((b.x - p.x) ** 2 + (b.y - p.y) ** 2 + (b.z - p.z) ** 2 < 0.35 * 0.35) by = Math.max(by, b.by);
      if (by > 0) q.t = Math.max(0.05, q.t - by - 0.01);
    }
    built = build();
  }
  if (!built) return null;
  const coreF = built.pts;
  const hull = built.shape;
  const exitFrom = (_: unknown, c: THREE.Vector3, dir: THREE.Vector3): number => hull.exit(c, dir);

  // Rays from the hull out to the shell, above the belt line (the lower core has its own grids),
  // only where the first surface seen is the outer skin (not an inner wall, nothing further out),
  // one per patch of shell: the centres' fans overlap.
  const rays: (CabinRay & { area: number; w: { top: number; side: number; ends: number } })[] = [];
  for (const { samples } of centres) {
    for (const s of samples) {
      if (s.outer - s.dist > 0.2) continue;
      const sx = s.centre.x + s.dir.x * s.dist;
      const sy = s.centre.y + s.dir.y * s.dist;
      const sz = s.centre.z + s.dir.z * s.dist;
      if (sy < belt + 0.03) continue;
      if (rays.some((r) => (r.surface[0] - sx) ** 2 + (r.surface[1] - sy) ** 2 + (r.surface[2] - sz) ** 2 < SPACING * SPACING)) continue;
      const exit = exitFrom(hull, s.centre, s.dir);
      if (!(exit >= 0)) continue;
      const length = s.dist - exit;
      if (length < 0.03) continue;
      const w = faceWeights(s.dir);
      const kind: CrushRay['kind'] = w.side >= Math.max(w.top, w.ends) ? (s.dir.x > 0 ? 'left' : 'right') : 'roof';
      rays.push({
        kind,
        origin: [s.centre.x + s.dir.x * exit, s.centre.y + s.dir.y * exit, s.centre.z + s.dir.z * exit],
        dir: [s.dir.x, s.dir.y, s.dir.z],
        length,
        part: s.part,
        fmax: 0,
        yield: ELASTIC,
        surface: [sx, sy, sz],
        cabin: true,
        area: s.dist * s.dist * s.omega,
        w,
      });
    }
  }
  // Each face's strength spread over its rays by the shell area they cover.
  const weight = cfg.mass * G;
  const strength = { ...CABIN_STRENGTH, ...cfg.cabin };
  const area = { top: 0, side: 0, ends: 0 };
  for (const r of rays) {
    area.top += r.area * r.w.top;
    area.side += r.area * r.w.side;
    area.ends += r.area * r.w.ends;
  }
  const sigma = {
    top: (strength.top * weight) / Math.max(area.top, 1e-6),
    side: (strength.side * weight) / Math.max(area.side, 1e-6),
    ends: (strength.ends * weight) / Math.max(area.ends, 1e-6),
  };
  for (const r of rays) r.fmax = r.area * (r.w.top * sigma.top + r.w.side * sigma.side + r.w.ends * sigma.ends);

  hull.free();
  const c0 = centres[0]!.c;
  return {
    collider: ci,
    core: coreF,
    shell: Float32Array.from(shell),
    centre: [c0.x, c0.y, c0.z],
    rays: rays.map(({ area: _a, w: _w, ...r }) => r),
  };
}
