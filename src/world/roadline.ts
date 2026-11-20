import * as THREE from 'three';
import type { Heightmap } from './heightmap';
import { smoothstep } from './noise';

/** A country road: centre line through control points, its height comes from the terrain. */
export interface RoadDef {
  id: string;
  name: string;
  /** Control points (x, z), in driving order. */
  points: [number, number][];
  /** Asphalt width (m). */
  width: number;
  /** Height pinned at the first / last point, where the road joins a flat area or another road. */
  startY?: number;
  endY?: number;
  /** Steepest grade allowed (rise / run). */
  maxGrade?: number;
  /** A ramp: straight grade from the start height to the ground at the end (quarry access). */
  linear?: boolean;
  /** A loop: the last point joins the first, smoothly. */
  closed?: boolean;
  /** Within `r` m of (x, z) the road stays at least at height `y` (keeps the lake road dry). */
  dryAbove?: { x: number; z: number; r: number; y: number };
  /** Centre dashes and edge lines (default: yes; gravel tracks never have them). */
  lines?: boolean;
  /** Surface: asphalt (default) or a gravel track (no markings, dirt grip). */
  surface?: RoadSurface;
  /**
   * A mixed surface: [start, surface] pairs, start as a fraction of the length (the first at 0).
   * Overrides `surface`.
   */
  sections?: [number, RoadSurface][];
  /** How far (m, half window) the profile averages the ground: small = follows every crest. */
  smoothing?: number;
  /** A timed stage between two points (fractions of the length), with gantries and a clock. */
  stage?: { name: string; start: number; finish: number };
}

export interface RoadLineData {
  def: RoadDef;
  x: Float64Array;
  z: Float64Array;
  y: Float64Array;
  tx: Float64Array;
  tz: Float64Array;
  ground: Float64Array;
  bridge: Uint8Array;
  n: number;
  length: number;
  step: number;
  ds: number;
  closed: boolean;
}

export type RoadSurface = 'asphalt' | 'gravel';

/** Surface of a road at sample i (its sections, or its single surface). */
export function surfaceOf(road: { def: RoadDef; n: number }, i: number): RoadSurface {
  const secs = road.def.sections;
  if (!secs) return road.def.surface ?? 'asphalt';
  const f = i / Math.max(1, road.n - 1);
  let s: RoadSurface = secs[0]![1];
  for (const [from, surf] of secs) if (f >= from) s = surf;
  return s;
}

/** Below this the road is a bridge rather than an embankment (m of fill). */
export const BRIDGE_FILL = 6;

/**
 * The sampled road: position, height and direction every `step` m. Heights follow the terrain,
 * smoothed and limited to the road's grade, so driving it never meets a wall or a cliff. A closed
 * road (a loop) has no ends: its last sample is followed by the first.
 */
export class RoadLine {
  readonly x: Float64Array;
  readonly z: Float64Array;
  readonly y: Float64Array;
  readonly tx: Float64Array;
  readonly tz: Float64Array;
  /** Height of the untouched terrain under each sample. */
  readonly ground: Float64Array;
  /** True where the road crosses a gap on a bridge (too much fill for an embankment). */
  readonly bridge: Uint8Array;
  readonly n: number;
  readonly length: number;
  readonly step: number;
  /** Distance between samples (m). */
  readonly ds: number;
  readonly closed: boolean;

  constructor(
    readonly def: RoadDef,
    terrain: (x: number, z: number) => number,
    /** Lowest height the road may take at (x, z) (keeps it on top of flat areas it crosses). */
    private readonly floorAt: (x: number, z: number) => number = () => -Infinity,
    step = 2,
  ) {
    this.step = step;
    this.closed = def.closed === true;
    const curve = new THREE.CatmullRomCurve3(
      def.points.map(([x, z]) => new THREE.Vector3(x, 0, z)),
      this.closed,
      'centripetal',
    );
    this.length = curve.getLength();
    const segments = Math.max(1, Math.round(this.length / step));
    // A loop's last spaced point repeats the first: drop it.
    const n = (this.n = this.closed ? segments : segments + 1);
    this.ds = this.length / segments;
    const pts = curve.getSpacedPoints(segments);
    this.x = new Float64Array(n);
    this.z = new Float64Array(n);
    this.y = new Float64Array(n);
    this.tx = new Float64Array(n);
    this.tz = new Float64Array(n);
    this.ground = new Float64Array(n);
    this.bridge = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      this.x[i] = pts[i]!.x;
      this.z[i] = pts[i]!.z;
      this.ground[i] = terrain(this.x[i]!, this.z[i]!);
    }
    for (let i = 0; i < n; i++) {
      const a = this.wrap(i - 1);
      const b = this.wrap(i + 1);
      const dx = this.x[b]! - this.x[a]!;
      const dz = this.z[b]! - this.z[a]!;
      const l = Math.hypot(dx, dz) || 1;
      this.tx[i] = dx / l;
      this.tz[i] = dz / l;
    }
    this.profile();
  }

  /** Sample index i, wrapped around a loop or clamped to the ends. */
  wrap(i: number): number {
    const n = this.n;
    if (this.closed) return ((i % n) + n) % n;
    return i < 0 ? 0 : i >= n ? n - 1 : i;
  }

  /** Grade at sample i (rise per metre, along the driving direction). */
  slope(i: number): number {
    const a = this.wrap(i - 1);
    const b = this.wrap(i + 1);
    const span = this.closed ? 2 : b - a;
    return span > 0 ? (this.y[b]! - this.y[a]!) / (span * this.ds) : 0;
  }

  /** Height profile: terrain averaged over about 100 m, grade-limited, ends pinned. */
  private profile(): void {
    const { n, ground, y, def, ds } = this;
    y.set(ground);
    const box = (half: number): void => {
      const src = Float64Array.from(y);
      const k = Math.max(1, Math.round(half / ds));
      if (this.closed) {
        let sum = 0;
        for (let d = -k; d <= k; d++) sum += src[this.wrap(d)]!;
        for (let i = 0; i < n; i++) {
          y[i] = sum / (2 * k + 1);
          sum += src[this.wrap(i + k + 1)]! - src[this.wrap(i - k)]!;
        }
        return;
      }
      const prefix = new Float64Array(n + 1);
      for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i]! + src[i]!;
      for (let i = 0; i < n; i++) {
        const a = Math.max(0, i - k);
        const b = Math.min(n - 1, i + k);
        y[i] = (prefix[b + 1]! - prefix[a]!) / (b - a + 1);
      }
    };
    if (def.linear) {
      const y0 = def.startY ?? ground[0]!;
      const y1 = def.endY ?? ground[n - 1]!;
      for (let i = 0; i < n; i++) y[i] = y0 + ((y1 - y0) * i) / (n - 1);
    } else {
      const k = def.smoothing ?? 50;
      box(k);
      box(k);
    }
    const g = (def.maxGrade ?? 0.09) * ds;
    const dry = def.dryAbove;
    const limit = (): void => {
      // A floor near the lake, pinned ends, then forward and backward passes: each sample stays
      // within the grade of its neighbour (twice round a loop, so the seam settles too).
      for (let i = 0; i < n; i++) {
        const f = this.floorAt(this.x[i]!, this.z[i]!);
        if (y[i]! < f) y[i] = f;
        if (dry && y[i]! < dry.y && Math.hypot(this.x[i]! - dry.x, this.z[i]! - dry.z) < dry.r) y[i] = dry.y;
      }
      if (this.closed) {
        for (let pass = 0; pass < 2; pass++) {
          for (let k = 1; k <= 2 * n; k++) {
            const i = this.wrap(k);
            const p = this.wrap(k - 1);
            y[i] = Math.min(Math.max(y[i]!, y[p]! - g), y[p]! + g);
          }
          for (let k = 2 * n; k >= 1; k--) {
            const i = this.wrap(k - 1);
            const p = this.wrap(k);
            y[i] = Math.min(Math.max(y[i]!, y[p]! - g), y[p]! + g);
          }
        }
        return;
      }
      if (def.startY !== undefined) y[0] = def.startY;
      if (def.endY !== undefined) y[n - 1] = def.endY;
      for (let i = 1; i < n; i++) y[i] = Math.min(Math.max(y[i]!, y[i - 1]! - g), y[i - 1]! + g);
      if (def.endY !== undefined) y[n - 1] = def.endY;
      for (let i = n - 2; i >= 0; i--) y[i] = Math.min(Math.max(y[i]!, y[i + 1]! - g), y[i + 1]! + g);
    };
    limit();
    // Round the vertical curves; the grade limit has the last word.
    box(14);
    limit();
    box(6);
    limit();
    for (let i = 0; i < n; i++) this.bridge[i] = y[i]! - ground[i]! > BRIDGE_FILL ? 1 : 0;
    // Where a road joins another one, an embankment rather than a bridge stub.
    const nearEnd = Math.round(40 / ds);
    if (def.startY !== undefined) for (let i = 0; i < Math.min(n, nearEnd); i++) this.bridge[i] = 0;
    if (def.endY !== undefined) for (let i = Math.max(0, n - nearEnd); i < n; i++) this.bridge[i] = 0;
    // No bridge stubs: a bridge spans at least 30 m.
    const minRun = Math.round(30 / ds);
    let i = 0;
    while (i < n) {
      if (!this.bridge[i]) {
        i++;
        continue;
      }
      let j = i;
      while (j < n && this.bridge[j]) j++;
      if (j - i < minRun) {
        const pad = Math.ceil((minRun - (j - i)) / 2);
        for (let k = Math.max(0, i - pad); k < Math.min(n, j + pad); k++) this.bridge[k] = 1;
      }
      i = j + 1;
    }
  }

  /** The sampled arrays, for sending the road to or from a worker. */
  toData(): RoadLineData {
    const { def, x, z, y, tx, tz, ground, bridge, n, length, step, ds, closed } = this;
    return { def, x, z, y, tx, tz, ground, bridge, n, length, step, ds, closed };
  }

  /** A road rebuilt from `toData()` output, without resampling. */
  static fromData(d: RoadLineData): RoadLine {
    return Object.assign(Object.create(RoadLine.prototype) as RoadLine, d);
  }

  leftX(i: number): number {
    return this.tz[i]!;
  }
  leftZ(i: number): number {
    return -this.tx[i]!;
  }

  /** Nearest sample (brute force over the line; for checks and spawn points). */
  nearest(x: number, z: number): { i: number; dist: number } {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < this.n; i++) {
      const d = (this.x[i]! - x) ** 2 + (this.z[i]! - z) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return { i: best, dist: Math.sqrt(bd) };
  }

  /** Pose at arc length s (wrapped on a loop, clamped otherwise): position and yaw along it. */
  at(s: number): { x: number; y: number; z: number; yaw: number } {
    const i = this.wrap(Math.round(s / this.ds));
    return { x: this.x[i]!, y: this.y[i]!, z: this.z[i]!, yaw: Math.atan2(this.tx[i]!, this.tz[i]!) };
  }

  /** Steepest grade over 10 m windows (checks). */
  maxGradeOver(window = 10): number {
    const k = Math.max(1, Math.round(window / this.ds));
    let m = 0;
    const last = this.closed ? this.n : this.n - k;
    for (let i = 0; i < last; i++) m = Math.max(m, Math.abs(this.y[this.wrap(i + k)]! - this.y[i]!) / (k * this.ds));
    return m;
  }
}

/** Height of a road's surface at sample i, `off` m to its left (negative: right). */
export type SurfaceY = (i: number, off: number) => number;

/**
 * Where a road starts or ends on an earlier one, its last metres take the other road's surface
 * (its grade and camber included), just under it: no step, no flicker, no ground showing through.
 */
export function junctionSurface(road: RoadLine, earlier: RoadLine[]): SurfaceY {
  const ds = road.ds;
  const ends = (road.closed ? [] : [0, road.n - 1])
    .map((i) => ({ i, other: earlier.find((o) => o.nearest(road.x[i]!, road.z[i]!).dist < 8) }))
    .filter((e): e is { i: number; other: RoadLine } => e.other !== undefined);
  return (i, off) => {
    let y = road.y[i]!;
    for (const e of ends) {
      if (Math.abs(i - e.i) * ds > 32) continue;
      const o = e.other;
      const px = road.x[i]! + road.leftX(i) * off;
      const pz = road.z[i]! + road.leftZ(i) * off;
      const k = o.nearest(px, pz).i;
      const slope = o.slope(k);
      const along = (px - o.x[k]!) * o.tx[k]! + (pz - o.z[k]!) * o.tz[k]!;
      const lat = Math.abs((px - o.x[k]!) * o.leftX(k) + (pz - o.z[k]!) * o.leftZ(k));
      const w = 1 - smoothstep(o.def.width / 2 + 1, o.def.width / 2 + 18, lat);
      y += (o.y[k]! + slope * along - 0.015 - y) * w;
    }
    return y;
  };
}

/** The surface of every road: road r blends into the earlier roads it starts or ends on. */
export function roadSurfaces(roads: RoadLine[]): SurfaceY[] {
  return roads.map((road, r) => junctionSurface(road, roads.slice(0, r)));
}

/** Depth of the terrain under the asphalt (keeps the terrain out of the road at every LOD). */
export const ROAD_SINK = 0.08;

/**
 * Carve the roads into the terrain: flat under the asphalt and its verges, then cut or fill
 * blending back into the hillside over a width that grows with the height difference. Bridges
 * leave the ground below them alone, and so does `keep` (the flat areas roads start from). Returns,
 * per vertex, the distance to the nearest road edge (m, 0 on the road; capped at 255), for
 * scattering trees and painting the ground.
 */
export function carveRoads(hm: Heightmap, roads: RoadLine[], keep: (x: number, z: number) => boolean = () => false): Float32Array {
  const surfaces = roadSurfaces(roads);
  const verts = hm.verts;
  const total = verts * verts;
  const bestW = new Float32Array(total); // influence weight of the nearest road (0..1)
  const bestY = new Float32Array(total);
  const bestAlong = new Float32Array(total).fill(Infinity);
  const bestRoad = new Int16Array(total).fill(-1);
  // Under any road's asphalt the ground never rises above that road's surface (less the sink).
  const cap = new Float32Array(total).fill(Infinity);
  const edge = new Float32Array(total).fill(255);
  for (let ri = 0; ri < roads.length; ri++) {
    const road = roads[ri]!;
    const surface = surfaces[ri]!;
    const hw = road.def.width / 2;
    const flat = hw + 6;
    const ds = road.ds;
    const every = Math.max(1, Math.round(2 / ds));
    for (let i = 0; i < road.n; i += every) {
      const rx = road.x[i]!;
      const rz = road.z[i]!;
      const isBridge = road.bridge[i] === 1;
      const diff = Math.abs(road.ground[i]! - road.y[i]!);
      const bank = Math.min(45, 6 + diff * 1.8);
      const reach = flat + bank;
      const ix0 = Math.max(0, Math.floor((rx - reach + hm.half) / hm.cell));
      const ix1 = Math.min(verts - 1, Math.ceil((rx + reach + hm.half) / hm.cell));
      const iz0 = Math.max(0, Math.floor((rz - reach + hm.half) / hm.cell));
      const iz1 = Math.min(verts - 1, Math.ceil((rz + reach + hm.half) / hm.cell));
      for (let ix = ix0; ix <= ix1; ix++) {
        const dx = hm.coord(ix) - rx;
        for (let iz = iz0; iz <= iz1; iz++) {
          const dz = hm.coord(iz) - rz;
          // Distance across the road (the along-road part is covered by the neighbouring samples).
          const latSigned = dx * road.leftX(i) + dz * road.leftZ(i);
          const lat = Math.abs(latSigned);
          const alongSigned = dx * road.tx[i]! + dz * road.tz[i]!;
          const along = Math.abs(alongSigned);
          if (along > ds * every * 0.75 + 0.5) continue;
          // The road surface right beside the vertex: the drawn surface (junctions blended in),
          // interpolated between this sample and the next one towards the vertex.
          const off = Math.max(-hw, Math.min(hw, latSigned));
          const j = road.wrap(i + (alongSigned >= 0 ? 1 : -1));
          const t = j === i ? 0 : Math.min(1, along / ds);
          const sy = surface(i, off) * (1 - t) + surface(j, off) * t;
          // Where a junction bends the surface, the ground's 4 m triangles follow it less closely:
          // a little more room there.
          const bent = Math.abs(surface(i, off) - road.y[i]!) > 0.01 ? 0.07 : 0;
          const ry = sy - ROAD_SINK - bent;
          const k = hm.index(ix, iz);
          const e = Math.max(0, lat - hw);
          if (e < edge[k]!) edge[k] = e;
          if (lat > reach || keep(hm.coord(ix), hm.coord(iz))) continue;
          const w = lat <= flat ? 1 : 1 - smoothstep(0, 1, (lat - flat) / bank);
          if (!isBridge && lat <= hw + 4.5 && ry < cap[k]!) cap[k] = ry;
          if (isBridge) {
            // Under a bridge only cut (never fill up to the deck).
            if (w > 0 && hm.heights[k]! > ry - 5 && w >= bestW[k]!) {
              bestW[k] = w;
              bestY[k] = Math.min(hm.heights[k]!, ry - 5);
            }
            continue;
          }
          // The strongest influence wins. Along one road, the sample squarely beside the vertex;
          // where two roads both hold the vertex flat (a junction), the lower one, so the ground
          // stays under both surfaces.
          const sameRoad = bestRoad[k] === ri;
          if (
            w > bestW[k]! ||
            (w === bestW[k]! && sameRoad && along < bestAlong[k]!) ||
            (w === 1 && bestW[k] === 1 && !sameRoad && ry < bestY[k]!)
          ) {
            bestW[k] = w;
            bestY[k] = ry;
            bestAlong[k] = along;
            bestRoad[k] = ri;
          }
        }
      }
    }
  }
  const h = hm.heights;
  for (let k = 0; k < total; k++) {
    const w = bestW[k]!;
    if (w > 0) h[k] = h[k]! + (bestY[k]! - h[k]!) * w;
    if (h[k]! > cap[k]!) h[k] = cap[k]!;
  }
  return edge;
}
