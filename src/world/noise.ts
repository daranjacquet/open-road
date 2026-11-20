/**
 * Deterministic 2D value noise (the map is the same on every load). Pure functions, no allocation.
 */

function hash(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Value noise in [0, 1], smooth (quintic fade). */
export function noise2(x: number, z: number, seed = 0): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const a = hash(ix, iz, seed);
  const b = hash(ix + 1, iz, seed);
  const c = hash(ix, iz + 1, seed);
  const d = hash(ix + 1, iz + 1, seed);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

/** Fractal sum of `octaves` layers, in about [-1, 1]. */
export function fbm(x: number, z: number, octaves: number, seed = 0): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += (noise2(x, z, seed + o * 17) * 2 - 1) * amp;
    norm += amp;
    amp *= 0.5;
    // Rotate a little between octaves so the lattice does not line up.
    const nx = x * 1.6 + z * 1.2;
    z = z * 1.6 - x * 1.2;
    x = nx;
  }
  return sum / norm;
}

/** Ridged fractal in [0, 1]: sharp crests, for mountain ranges. */
export function ridged(x: number, z: number, octaves: number, seed = 0): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let weight = 1;
  for (let o = 0; o < octaves; o++) {
    let n = 1 - Math.abs(noise2(x, z, seed + o * 31) * 2 - 1);
    n *= n * weight;
    weight = Math.min(1, n * 2);
    sum += n * amp;
    norm += amp;
    amp *= 0.5;
    const nx = x * 1.7 + z * 1.1;
    z = z * 1.7 - x * 1.1;
    x = nx;
  }
  return sum / norm;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}

/**
 * A smooth function sampled once on a coarse grid (`step` m over a `size` m square centred on the
 * origin) and read back with bilinear interpolation: for noise whose finest detail is several
 * steps wide, much cheaper than evaluating it at every terrain vertex.
 */
export function sampledField(size: number, step: number, f: (x: number, z: number) => number): (x: number, z: number) => number {
  const n = Math.ceil(size / step) + 1;
  const half = size / 2;
  const v = new Float32Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) v[i * n + j] = f(i * step - half, j * step - half);
  const max = n - 1.0001;
  return (x, z) => {
    let gx = (x + half) / step;
    let gz = (z + half) / step;
    gx = gx < 0 ? 0 : gx > max ? max : gx;
    gz = gz < 0 ? 0 : gz > max ? max : gz;
    const i = Math.floor(gx);
    const j = Math.floor(gz);
    const fx = gx - i;
    const fz = gz - j;
    const o = i * n + j;
    const a = v[o]!;
    const b = v[o + n]!;
    const c = v[o + 1]!;
    const d = v[o + n + 1]!;
    return (a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz;
  };
}
