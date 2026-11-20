import type { Heightmap } from './heightmap';
import { AVENUES, STREETS } from './city';
import { LAKE, lakeRadius, PLACES, WATER_LEVEL } from './layout';
import type { RoadLine } from './roadline';
import type { BuiltTrack } from './track';

/**
 * A top-down picture of the whole world, as seen from above: x to the right, -z up (the map's north).
 */
export interface Overview {
  canvas: HTMLCanvasElement;
  /** World metres per pixel. */
  scale: number;
  /** World half size (m): pixel (0, 0) is at (-half, -half). */
  half: number;
}

/** Shaded relief, water, forests and fields, one pixel per terrain cell (pure: runs in the worker). */
export function overviewPixels(hm: Heightmap, splat: Uint8Array): Uint8ClampedArray {
  const px = hm.n;
  const d = new Uint8ClampedArray(px * px * 4);
  for (let py = 0; py < px; py++) {
    const iz = py;
    for (let ix = 0; ix < px; ix++) {
      const k = hm.index(ix, iz);
      const h = hm.heights[k]!;
      const sx = hm.get(ix + 1, iz) - hm.get(ix - 1, iz);
      const sz = hm.get(ix, iz + 1) - hm.get(ix, iz - 1);
      // Light from the north-west.
      const shade = Math.min(1.25, Math.max(0.55, 1 + (-sx * 0.6 + sz * 0.6) / (2 * hm.cell) * 1.6));
      const o = (py * px + ix) * 4;
      const x = hm.coord(ix);
      const z = hm.coord(iz);
      let r: number;
      let gg: number;
      let b: number;
      if (h < WATER_LEVEL - 0.05 && Math.hypot(x - LAKE.x, z - LAKE.z) < lakeRadius(x, z) + 40) {
        r = 52;
        gg = 104;
        b = 128;
        d[o] = r;
        d[o + 1] = gg;
        d[o + 2] = b;
        d[o + 3] = 255;
        continue;
      }
      const t = Math.min(1, Math.max(0, h / 200));
      r = 92 + 70 * t;
      gg = 124 + 20 * t;
      b = 70 + 60 * t;
      const sp = k * 4;
      const forest = splat[sp + 3]! / 255;
      r += (40 - r) * forest * 0.75;
      gg += (78 - gg) * forest * 0.75;
      b += (40 - b) * forest * 0.75;
      if (splat[sp + 2]! > 10) {
        r = 170;
        gg = 156;
        b = 92;
      }
      const dirt = splat[sp]! / 255;
      r += (140 - r) * dirt;
      gg += (110 - gg) * dirt;
      b += (80 - b) * dirt;
      if (h > 215) {
        const snow = Math.min(1, (h - 215) / 40);
        r += (235 - r) * snow;
        gg += (238 - gg) * snow;
        b += (242 - b) * snow;
      }
      d[o] = r * shade;
      d[o + 1] = gg * shade;
      d[o + 2] = b * shade;
      d[o + 3] = 255;
    }
  }
  return d;
}

/** The overview picture: relief pixels, then the city, circuits and roads drawn on top. */
export function drawOverview(hm: Heightmap, roads: RoadLine[], pixels: Uint8ClampedArray, tracks: BuiltTrack[]): Overview {
  const px = hm.n;
  const scale = hm.cell;
  const half = hm.half;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = px;
  const g = canvas.getContext('2d')!;
  g.putImageData(new ImageData(pixels as Uint8ClampedArray<ArrayBuffer>, px, px), 0, 0);

  const P = (x: number, z: number): [number, number] => [(x + half) / scale, (z + half) / scale];
  // City blocks and streets.
  const [cx0, cz0] = P(AVENUES[0]! - 7, STREETS[0]! - 7);
  const [cx1, cz1] = P(AVENUES[AVENUES.length - 1]! + 7, STREETS[STREETS.length - 1]! + 7);
  g.fillStyle = '#8b8d92';
  g.fillRect(cx0, cz0, cx1 - cx0, cz1 - cz0);
  g.fillStyle = '#b9b6ae';
  for (let i = 0; i + 1 < AVENUES.length; i++) {
    for (let j = 0; j + 1 < STREETS.length; j++) {
      const [a, bb] = P(AVENUES[i]! + 7, STREETS[j]! + 7);
      const [c, e] = P(AVENUES[i + 1]! - 7, STREETS[j + 1]! - 7);
      g.fillRect(a, bb, c - a, e - bb);
    }
  }
  const stroke = (pts: [number, number][], width: number, color: string, closed = false): void => {
    g.beginPath();
    pts.forEach(([x, z], i) => (i ? g.lineTo(...P(x, z)) : g.moveTo(...P(x, z))));
    if (closed) g.closePath();
    g.lineWidth = width;
    g.strokeStyle = color;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.stroke();
  };
  for (const t of tracks) {
    const pts: [number, number][] = [];
    for (let i = 0; i < t.line.n; i += 2) pts.push([t.line.x[i]!, t.line.z[i]!]);
    stroke(pts, t.line.def.width / scale + 1.5, '#2b2d31', true);
  }
  // Test area pads.
  g.fillStyle = '#5d6066';
  const [tx0, tz0] = P(-160, -160);
  g.fillRect(tx0, tz0, 320 / scale, 320 / scale);
  const [sx0, sz0] = P(-14, 180);
  g.fillRect(sx0, sz0, 28 / scale, 680 / scale);
  // Airfield: runway, taxiway, apron.
  g.fillStyle = '#4a4c52';
  const rect = (x0: number, z0: number, x1: number, z1: number): void => {
    const [a, b] = P(x0, z0);
    const [c, e] = P(x1, z1);
    g.fillRect(a, b, c - a, e - b);
  };
  const af = PLACES.airfield;
  rect(af.x0, af.z - 22, af.x1, af.z + 22);
  rect(af.x0 + 60, af.z + 58, af.x1 - 60, af.z + 74);
  rect(560, af.z + 74, 820, af.z + 138);
  g.fillStyle = '#e8e8e2';
  rect(af.x0 + 20, af.z - 1, af.x1 - 20, af.z + 1);
  for (const r of roads) {
    const pts: [number, number][] = [];
    for (let i = 0; i < r.n; i += 2) pts.push([r.x[i]!, r.z[i]!]);
    const gravel = r.def.surface === 'gravel';
    stroke(pts, r.def.width / scale + 2.5, gravel ? '#6f5a3e' : '#3b3c40', r.closed);
    stroke(pts, r.def.width / scale, gravel ? '#b49a70' : '#e9e2cc', r.closed);
  }
  return { canvas, scale, half };
}
