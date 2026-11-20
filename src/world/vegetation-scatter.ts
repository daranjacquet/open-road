/** Tree positions: pure, deterministic (runs in the world worker). */
import type { Heightmap } from './heightmap';
import type { GroundCover } from './paint';

/** Floats per tree in the packed array: x, y, z, scale, yaw, kind (0 conifer, 1 broadleaf). */
export const TREE_STRIDE = 6;

function hash(a: number, b: number, s: number): number {
  let h = Math.imul(a, 0x27d4eb2d) ^ Math.imul(b, 0x165667b1) ^ Math.imul(s, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Scatter trees over the terrain: one candidate per 10 m cell, kept with the forest density painted
 * on the ground, plus the odd lone tree in open country. Pure and deterministic.
 */
export function scatterTrees(hm: Heightmap, cover: GroundCover, roadEdge: Float32Array): Float32Array {
  const c = 10;
  const n = Math.floor(hm.size / c);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = (i + 0.15 + 0.7 * hash(i, j, 1)) * c - hm.half;
      const z = (j + 0.15 + 0.7 * hash(i, j, 2)) * c - hm.half;
      const ix = Math.round((x + hm.half) / hm.cell);
      const iz = Math.round((z + hm.half) / hm.cell);
      const k = hm.index(ix, iz);
      if (cover.bare[k] || roadEdge[k]! < 5) continue;
      const forest = cover.splat[k * 4 + 3]! / 255;
      const p = forest > 0.05 ? forest * 0.75 : 0.008;
      if (hash(i, j, 3) >= p) continue;
      const y = hm.heightAt(x, z);
      const high = y > 45 || x < -900 || z > 1050;
      const kind = high ? (hash(i, j, 4) < 0.85 ? 0 : 1) : hash(i, j, 4) < 0.3 ? 0 : 1;
      out.push(x, y, z, 0.75 + 0.6 * hash(i, j, 5), hash(i, j, 6) * Math.PI * 2, kind);
    }
  }
  return Float32Array.from(out);
}

