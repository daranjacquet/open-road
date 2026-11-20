/**
 * Builds the terrain from the world plan: relief, flat areas, circuits, lake, edge mountains, then
 * the roads carved in. Headless (no three.js rendering, no physics), deterministic.
 */
import { Heightmap } from './heightmap';
import { baseDetail, baseHeight, baseLow, CELL, CELLS, DRIFT, lakeShape, LAKE, PADS, padDistance, padInset, RACE, rimHeight, ROADS, type Pad } from './layout';
import { sampledField, smoothstep } from './noise';
import { carveRoads, RoadLine } from './roadline';
import { TrackLine, type TrackDef } from './track';

/** Height of a road surface across a flat area (just above the asphalt and ground there). */
export const ROAD_ON_PAD = 0.03;

export interface World {
  hm: Heightmap;
  roads: RoadLine[];
  /** Per terrain vertex: distance to the nearest road edge (m, capped at 255). */
  roadEdge: Float32Array;
}

/** Blend the vertices around a shape towards a height: weight 1 inside, smooth falloff outside. */
function flatten(hm: Heightmap, x0: number, z0: number, x1: number, z1: number, weight: (x: number, z: number) => number, y: number): void {
  const ix0 = Math.max(0, Math.floor((x0 + hm.half) / hm.cell));
  const ix1 = Math.min(hm.n, Math.ceil((x1 + hm.half) / hm.cell));
  const iz0 = Math.max(0, Math.floor((z0 + hm.half) / hm.cell));
  const iz1 = Math.min(hm.n, Math.ceil((z1 + hm.half) / hm.cell));
  for (let ix = ix0; ix <= ix1; ix++) {
    const x = hm.coord(ix);
    for (let iz = iz0; iz <= iz1; iz++) {
      const w = weight(x, hm.coord(iz));
      if (w <= 0) continue;
      const k = hm.index(ix, iz);
      hm.heights[k] = hm.heights[k]! + (y - hm.heights[k]!) * w;
    }
  }
}

function padBounds(p: Pad): [number, number, number, number] {
  const f = p.falloff;
  if (p.rect) return [p.rect[0] - f, p.rect[1] - f, p.rect[2] + f, p.rect[3] + f];
  const [cx, cz, r] = p.disc!;
  return [cx - r - f, cz - r - f, cx + r + f, cz + r + f];
}

/** Keep a circuit, its run-off and walls flat at 0: max weight over discs along its line. */
function flattenTrack(hm: Heightmap, def: TrackDef): void {
  const line = new TrackLine(def);
  const r = def.width / 2 + def.runoff + 14;
  const fall = 110;
  const w = new Float32Array(hm.verts * hm.verts);
  let bx0 = Infinity;
  let bz0 = Infinity;
  let bx1 = -Infinity;
  let bz1 = -Infinity;
  // A disc every 12 m: the flat radius keeps a 14 m margin beyond the walls, more than the gaps.
  for (let i = 0; i < line.n; i += 6) {
    const cx = line.x[i]!;
    const cz = line.z[i]!;
    const reach = r + fall;
    const ix0 = Math.max(0, Math.floor((cx - reach + hm.half) / hm.cell));
    const ix1 = Math.min(hm.n, Math.ceil((cx + reach + hm.half) / hm.cell));
    const iz0 = Math.max(0, Math.floor((cz - reach + hm.half) / hm.cell));
    const iz1 = Math.min(hm.n, Math.ceil((cz + reach + hm.half) / hm.cell));
    bx0 = Math.min(bx0, ix0);
    bx1 = Math.max(bx1, ix1);
    bz0 = Math.min(bz0, iz0);
    bz1 = Math.max(bz1, iz1);
    for (let ix = ix0; ix <= ix1; ix++) {
      const dx = hm.coord(ix) - cx;
      for (let iz = iz0; iz <= iz1; iz++) {
        const dz = hm.coord(iz) - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 > reach * reach) continue;
        const v = d2 <= r * r ? 1 : 1 - smoothstep(r, reach, Math.sqrt(d2));
        const k = hm.index(ix, iz);
        if (v > w[k]!) w[k] = v;
      }
    }
  }
  for (let ix = bx0; ix <= bx1; ix++) {
    for (let iz = bz0; iz <= bz1; iz++) {
      const k = hm.index(ix, iz);
      hm.heights[k] = hm.heights[k]! * (1 - w[k]!);
    }
  }
}

/**
 * Coarse field (32 m cells) of how far the nearest road is, mapped to 0.38 next to a road and 1 far
 * from it: the relief is calmed around roads.
 */
function valleyField(size: number): (x: number, z: number) => number {
  const c = 32;
  const n = Math.ceil(size / c) + 1;
  const half = size / 2;
  const v = new Float32Array(n * n);
  const segs: number[] = [];
  // Stages and trails keep the hills around them (that is the point of them).
  for (const r of ROADS) {
    if (r.stage) continue;
    for (let i = 0; i + 1 < r.points.length; i++) segs.push(...r.points[i]!, ...r.points[i + 1]!);
  }
  for (let i = 0; i < n; i++) {
    const x = i * c - half;
    for (let j = 0; j < n; j++) {
      const z = j * c - half;
      let best = Infinity;
      for (let k = 0; k < segs.length; k += 4) {
        const ax = segs[k]!;
        const az = segs[k + 1]!;
        const dx = segs[k + 2]! - ax;
        const dz = segs[k + 3]! - az;
        const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
        const d = (x - ax - t * dx) ** 2 + (z - az - t * dz) ** 2;
        if (d < best) best = d;
      }
      v[i * n + j] = 0.38 + 0.62 * smoothstep(70, 480, Math.sqrt(best));
    }
  }
  return (x, z) => {
    const gx = Math.min(n - 1.001, Math.max(0, (x + half) / c));
    const gz = Math.min(n - 1.001, Math.max(0, (z + half) / c));
    const i = Math.floor(gx);
    const j = Math.floor(gz);
    const fx = gx - i;
    const fz = gz - j;
    const a = v[i * n + j]!;
    const b = v[(i + 1) * n + j]!;
    const d = v[i * n + j + 1]!;
    const e = v[(i + 1) * n + j + 1]!;
    return (a * (1 - fx) + b * fx) * (1 - fz) + (d * (1 - fx) + e * fx) * fz;
  };
}

/** Generate the whole terrain and the road network. */
export function generateWorld(times?: Record<string, number>): World {
  let t0 = performance.now();
  const lap = (k: string): void => {
    if (!times) return;
    const now = performance.now();
    times[k] = Math.round(now - t0);
    t0 = now;
  };
  const hm = new Heightmap(CELLS, CELL);
  const valley = valleyField(hm.size);
  // Large shapes on an 8 m grid, small bumps at every vertex.
  const low = sampledField(hm.size, 8, (x, z) => baseLow(x, z, valley(x, z)));
  lap('low');
  hm.fill((x, z) => low(x, z) + baseDetail(x, z));
  lap('fill');

  for (const p of PADS) {
    const c = p.rect ? [(p.rect[0] + p.rect[2]) / 2, (p.rect[1] + p.rect[3]) / 2] : [p.disc![0], p.disc![1]];
    const y = p.natural ? baseHeight(c[0]!, c[1]!, valley(c[0]!, c[1]!)) + p.y : p.y;
    const [x0, z0, x1, z1] = padBounds(p);
    flatten(hm, x0, z0, x1, z1, (x, z) => 1 - smoothstep(0, p.falloff, padDistance(p, x, z)), y);
  }
  lap('pads');
  flattenTrack(hm, RACE);
  flattenTrack(hm, DRIFT);
  lap('tracks');

  // Lake and shore.
  const lr = LAKE.r * 1.3 + 160;
  const lakeW = { y: 0, w: 0 };
  {
    const ix0 = Math.max(0, Math.floor((LAKE.x - lr + hm.half) / hm.cell));
    const ix1 = Math.min(hm.n, Math.ceil((LAKE.x + lr + hm.half) / hm.cell));
    const iz0 = Math.max(0, Math.floor((LAKE.z - lr + hm.half) / hm.cell));
    const iz1 = Math.min(hm.n, Math.ceil((LAKE.z + lr + hm.half) / hm.cell));
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        [lakeW.y, lakeW.w] = lakeShape(hm.coord(ix), hm.coord(iz));
        if (lakeW.w <= 0) continue;
        const k = hm.index(ix, iz);
        hm.heights[k] = hm.heights[k]! + (lakeW.y - hm.heights[k]!) * lakeW.w;
      }
    }
  }

  lap('lake');
  // Mountains along the world edge.
  const band = Math.ceil((hm.half - 1790) / hm.cell) + 1;
  for (let ix = 0; ix <= hm.n; ix++) {
    const edgeX = ix < band || ix > hm.n - band;
    for (let iz = 0; iz <= hm.n; iz++) {
      if (!edgeX && iz >= band && iz <= hm.n - band) {
        iz = hm.n - band;
        continue;
      }
      const add = rimHeight(hm.coord(ix), hm.coord(iz));
      if (add > 0) hm.heights[hm.index(ix, iz)] += add;
    }
  }

  lap('rim');
  // Roads, in order: a road that starts or ends on an earlier one takes its height there.
  const natural = (x: number, z: number): number => hm.heightAt(x, z);
  // The flat areas the spurs start from (asphalt already there): never carved, and a road crossing
  // them stays just on top of them.
  const startPads = PADS.filter((p) => p.name === 'test area' || p.name === 'city' || p.name === 'airfield');
  // 12 m in from their edges, so a road passing just outside still carves its verge.
  const inStartPad = (x: number, z: number): boolean => startPads.some((p) => padInset(p, x, z) >= 12);
  const floorAt = (x: number, z: number): number => (inStartPad(x, z) ? ROAD_ON_PAD : -Infinity);
  const roads: RoadLine[] = [];
  for (const def of ROADS) {
    // An end that lands on an earlier road is moved exactly onto its centre line and takes its
    // height there, so the two meet without a gap or a step.
    const points = def.points.map((p) => [...p] as [number, number]);
    const join = (p: [number, number]): number | undefined => {
      for (const r of roads) {
        const near = r.nearest(p[0], p[1]);
        if (near.dist < 15) {
          p[0] = r.x[near.i]!;
          p[1] = r.z[near.i]!;
          return r.y[near.i]!;
        }
      }
      return undefined;
    };
    const pinned = { ...def, points };
    if (!def.closed) {
      const startY = join(points[0]!);
      const endY = join(points[points.length - 1]!);
      if (pinned.startY === undefined) pinned.startY = startY;
      if (pinned.endY === undefined) pinned.endY = endY;
    }
    roads.push(new RoadLine(pinned, natural, floorAt));
  }
  lap('roads');
  const roadEdge = carveRoads(hm, roads, inStartPad);
  lap('carve');
  return { hm, roads, roadEdge };
}
