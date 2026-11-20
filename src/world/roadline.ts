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
  /** Lowest height allowed (keeps the lake road out of the water). */
  minY?: number;
  /** A ramp: straight grade from the start height to the ground at the end (quarry access). */
  linear?: boolean;
  /** Centre dashes and edge lines. */
  lines?: boolean;
  /** Surface: asphalt (default) or a gravel track (no markings, dirt grip). */
  surface?: 'asphalt' | 'gravel';
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
}

/** Below this the road is a bridge rather than an embankment (m of fill). */
export const BRIDGE_FILL = 6;

/**
 * The sampled road: position, height and direction every `step` m. Heights follow the terrain,
 * smoothed and limited to the road's grade, so driving it never meets a wall or a cliff.
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

  constructor(
    readonly def: RoadDef,
    terrain: (x: number, z: number) => number,
    step = 2,
  ) {
    this.step = step;
    const curve = new THREE.CatmullRomCurve3(
      def.points.map(([x, z]) => new THREE.Vector3(x, 0, z)),
      false,
      'centripetal',
    );
    this.length = curve.getLength();
    const n = (this.n = Math.max(2, Math.round(this.length / step) + 1));
    const pts = curve.getSpacedPoints(n - 1);
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
      const a = Math.max(0, i - 1);
      const b = Math.min(n - 1, i + 1);
      const dx = this.x[b]! - this.x[a]!;
      const dz = this.z[b]! - this.z[a]!;
      const l = Math.hypot(dx, dz) || 1;
      this.tx[i] = dx / l;
      this.tz[i] = dz / l;
    }
    this.profile();
  }

  /** Height profile: terrain averaged over about 100 m, grade-limited, ends pinned. */
  private profile(): void {
    const { n, ground, y, def } = this;
    const ds = this.length / (n - 1);
    y.set(ground);
    const box = (half: number): void => {
      const src = Float64Array.from(y);
      const prefix = new Float64Array(n + 1);
      for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i]! + src[i]!;
      const k = Math.max(1, Math.round(half / ds));
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
      box(50);
      box(50);
    }
    const g = (def.maxGrade ?? 0.09) * ds;
    const floor = def.minY ?? -Infinity;
    const limit = (): void => {
      // Pinned ends, a floor (above the lake), then forward and backward passes: each sample stays
      // within the grade of its neighbour and the ends pull the profile towards them.
      for (let i = 0; i < n; i++) if (y[i]! < floor) y[i] = floor;
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
    const { def, x, z, y, tx, tz, ground, bridge, n, length, step } = this;
    return { def, x, z, y, tx, tz, ground, bridge, n, length, step };
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

  /** Pose at arc length s (clamped): position on the road and yaw along it. */
  at(s: number): { x: number; y: number; z: number; yaw: number } {
    const i = Math.min(this.n - 1, Math.max(0, Math.round(s / (this.length / (this.n - 1)))));
    return { x: this.x[i]!, y: this.y[i]!, z: this.z[i]!, yaw: Math.atan2(this.tx[i]!, this.tz[i]!) };
  }

  /** Steepest grade over 10 m windows (checks). */
  maxGradeOver(window = 10): number {
    const ds = this.length / (this.n - 1);
    const k = Math.max(1, Math.round(window / ds));
    let m = 0;
    for (let i = 0; i + k < this.n; i++) m = Math.max(m, Math.abs(this.y[i + k]! - this.y[i]!) / (k * ds));
    return m;
  }
}

/** Depth of the terrain under the asphalt (keeps the terrain out of the road at every LOD). */
export const ROAD_SINK = 0.08;

/**
 * Carve the roads into the terrain: flat under the asphalt and its verges, then cut or fill
 * blending back into the hillside over a width that grows with the height difference. Bridges
 * leave the ground below them alone. Returns, per vertex, the distance to the nearest road edge
 * (m, 0 on the road; capped at 255), for scattering trees and painting the ground.
 */
export function carveRoads(hm: Heightmap, roads: RoadLine[]): Float32Array {
  const verts = hm.verts;
  const total = verts * verts;
  const bestW = new Float32Array(total); // influence weight of the nearest road (0..1)
  const bestY = new Float32Array(total);
  const bestAlong = new Float32Array(total).fill(Infinity);
  const bestRoad = new Int16Array(total).fill(-1);
  const edge = new Float32Array(total).fill(255);
  for (let ri = 0; ri < roads.length; ri++) {
    const road = roads[ri]!;
    const hw = road.def.width / 2;
    const flat = hw + 6;
    const ds = road.length / (road.n - 1);
    const every = Math.max(1, Math.round(2 / ds));
    for (let i = 0; i < road.n; i += every) {
      const rx = road.x[i]!;
      const rz = road.z[i]!;
      const ip = Math.max(0, i - 1);
      const inx = Math.min(road.n - 1, i + 1);
      const slope = (road.y[inx]! - road.y[ip]!) / ((inx - ip) * ds);
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
          const lat = Math.abs(dx * road.leftX(i) + dz * road.leftZ(i));
          const alongSigned = dx * road.tx[i]! + dz * road.tz[i]!;
          const along = Math.abs(alongSigned);
          if (along > ds * every * 0.75 + 0.5) continue;
          // Road height right beside the vertex (the sample's height carried along the grade).
          const ry = road.y[i]! + slope * alongSigned - ROAD_SINK;
          const k = hm.index(ix, iz);
          const e = Math.max(0, lat - hw);
          if (e < edge[k]!) edge[k] = e;
          if (lat > reach) continue;
          const w = lat <= flat ? 1 : 1 - smoothstep(0, 1, (lat - flat) / bank);
          if (isBridge) {
            // Under a bridge only cut (never fill up to the deck).
            if (w > 0 && hm.heights[k]! > ry - 5 && w >= bestW[k]!) {
              bestW[k] = w;
              bestY[k] = Math.min(hm.heights[k]!, ry - 5);
            }
            continue;
          }
          // The strongest influence wins. Between equals, the earlier road (a road that ends on
          // another lies under it), and along one road the sample squarely beside the vertex.
          if (w > bestW[k]! || (w === bestW[k]! && bestRoad[k] === ri && along < bestAlong[k]!)) {
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
  }
  return edge;
}
