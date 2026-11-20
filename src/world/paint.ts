/**
 * Ground cover, computed once per terrain vertex: where forests grow, where the ground is dirt,
 * sand or fields. Pure (no three.js): the terrain shader reads it as a texture, the tree scatter
 * and the tyre grip read the same numbers.
 */
import type { Heightmap } from './heightmap';
import { DRIFT, LAKE, lakeRadius, PADS, padDistance, PLACES, RACE, WATER_LEVEL } from './layout';
import { fbm, sampledField, smoothstep } from './noise';
import { TrackLine } from './track';

/** How much forest (0..1) the land at (x, z) carries, before roads and buildings are cut out. */
export function forestDensity(x: number, z: number, h: number, ny: number, n = fbm(x / 380, z / 380, 3, 101) * 0.5 + 0.5): number {
  const west = smoothstep(-880, -1250, x);
  const north = smoothstep(980, 1250, z) * (1 - smoothstep(150, 200, h));
  const east = smoothstep(980, 1300, x) * 0.55;
  const south = smoothstep(-1050, -1350, z) * 0.22;
  const base = Math.max(west * 0.95, north * 0.8, east, south, 0.16);
  const d = base * smoothstep(0.42, 0.6, n + base * 0.28);
  return d * smoothstep(0.6, 0.78, ny);
}

export interface GroundCover {
  /** RGBA per terrain vertex: R dirt, G sand, B field crop hue (0 = none), A forest. */
  splat: Uint8Array;
  /** Per terrain vertex: 1 where nothing grows (buildings, circuits, water, roads). */
  bare: Uint8Array;
}

function hash2(a: number, b: number): number {
  let h = Math.imul(a, 0x27d4eb2d) ^ Math.imul(b, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

/** Paint the ground cover over the finished terrain. */
export function paintGround(hm: Heightmap, roadEdge: Float32Array): GroundCover {
  const v = hm.verts;
  const splat = new Uint8Array(v * v * 4);
  const bare = new Uint8Array(v * v);

  // Built areas and circuits: nothing grows there.
  const mark = (x0: number, z0: number, x1: number, z1: number, inside: (x: number, z: number) => boolean): void => {
    const ix0 = Math.max(0, Math.floor((x0 + hm.half) / hm.cell));
    const ix1 = Math.min(hm.n, Math.ceil((x1 + hm.half) / hm.cell));
    const iz0 = Math.max(0, Math.floor((z0 + hm.half) / hm.cell));
    const iz1 = Math.min(hm.n, Math.ceil((z1 + hm.half) / hm.cell));
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) if (inside(hm.coord(ix), hm.coord(iz))) bare[hm.index(ix, iz)] = 1;
    }
  };
  for (const p of PADS) {
    const m = 18;
    const b = p.rect ? [p.rect[0] - m, p.rect[1] - m, p.rect[2] + m, p.rect[3] + m] : [p.disc![0] - p.disc![2] - m, p.disc![1] - p.disc![2] - m, p.disc![0] + p.disc![2] + m, p.disc![1] + p.disc![2] + m];
    mark(b[0]!, b[1]!, b[2]!, b[3]!, (x, z) => padDistance(p, x, z) < m);
  }
  for (const def of [RACE, DRIFT]) {
    const line = new TrackLine(def);
    const r = def.width / 2 + def.runoff + 10;
    for (let i = 0; i < line.n; i += 3) {
      const cx = line.x[i]!;
      const cz = line.z[i]!;
      mark(cx - r, cz - r, cx + r, cz + r, (x, z) => (x - cx) ** 2 + (z - cz) ** 2 < r * r);
    }
  }

  const farm = PLACES.farm;
  const forestNoise = sampledField(hm.size, 16, (x, z) => fbm(x / 380, z / 380, 3, 101) * 0.5 + 0.5);
  for (let ix = 0; ix < v; ix++) {
    const x = hm.coord(ix);
    for (let iz = 0; iz < v; iz++) {
      const z = hm.coord(iz);
      const k = hm.index(ix, iz);
      const h = hm.heights[k]!;
      const o = k * 4;
      const edge = roadEdge[k]!;
      if (edge < 3) bare[k] = 1;
      // Lake: wet sand along the shore, nothing grows under water.
      const dl = Math.hypot(x - LAKE.x, z - LAKE.z);
      if (dl < LAKE.r * 1.35 + 60) {
        const lr = lakeRadius(x, z);
        if (dl < lr + 25) bare[k] = 1;
        if (dl < lr + 70 && h < WATER_LEVEL + 1.0) splat[o + 1] = Math.round(255 * (1 - smoothstep(WATER_LEVEL + 0.35, WATER_LEVEL + 1.0, h)));
      }
      // Quarry floor and walls: dirt and rubble.
      const dq = Math.hypot(x - PLACES.quarry.x, z - PLACES.quarry.z);
      if (dq < 175) {
        splat[o] = Math.round(255 * (1 - smoothstep(125, 170, dq)));
        if (dq < 160) bare[k] = 1;
      }
      // Farm: a yard of dirt and a patchwork of fields around it.
      const df = Math.hypot(x - farm.x, z - farm.z);
      if (df < 60) splat[o] = Math.max(splat[o]!, Math.round(255 * (1 - smoothstep(35, 60, df))));
      // Fields: a patchwork of plots, more of them near the farm, the edge decided plot by plot.
      if (df < 620 && df > 48 && edge > 4) {
        const fx = Math.floor((x + 37) / 92);
        const fz = Math.floor((z + 11) / 68);
        const pcx = fx * 92 - 37 + 46;
        const pcz = fz * 68 - 11 + 34;
        const reach = 330 + 230 * hash2(fx + 3, fz + 5);
        if (hash2(fx, fz) > 0.2 && Math.hypot(pcx - farm.x, pcz - farm.z) < reach) {
          splat[o + 2] = Math.round(255 * (0.15 + 0.85 * hash2(fz + 7, fx - 3)));
          bare[k] = 1;
        }
      }
      // Forest floor where the trees will be.
      if (!bare[k]) {
        const gx = hm.get(ix - 1, iz) - hm.get(ix + 1, iz);
        const gz = hm.get(ix, iz - 1) - hm.get(ix, iz + 1);
        const ny = (2 * hm.cell) / Math.sqrt(gx * gx + gz * gz + 4 * hm.cell * hm.cell);
        const d = forestDensity(x, z, h, ny, forestNoise(x, z)) * smoothstep(3, 9, edge);
        splat[o + 3] = Math.round(255 * Math.min(1, d * 1.3));
      }
    }
  }
  return { splat, bare };
}
