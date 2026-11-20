import * as THREE from 'three';

/** Size (px) and world tile (m) of the ground detail: about 5 mm per texel. */
const N = 512;
export const GROUND_TILE = 2.5;

export interface GroundDetail {
  /** R grass relief, G dirt relief, B fine grain, A dry grass blades (all 0..1, mean about 0.5). */
  shade: THREE.DataTexture;
  /** RG grass slope (x, z), BA dirt slope (x, z), encoded 0..255 around 128. */
  slope: THREE.DataTexture;
  /** Two smooth noises (R, G) for patches of half a metre to a few metres. */
  patch: THREE.DataTexture;
}

let cached: GroundDetail | null = null;

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tiling value noise with `cells` cells across, added into `out` (size n x n) with amplitude `amp`. */
function addNoise(out: Float32Array, cells: number, amp: number, rnd: () => number, n = N): void {
  const lat = new Float32Array(cells * cells);
  for (let i = 0; i < lat.length; i++) lat[i] = rnd();
  const k = n / cells;
  for (let y = 0; y < n; y++) {
    const gy = y / k;
    const y0 = Math.floor(gy);
    const fy = gy - y0;
    const uy = fy * fy * (3 - 2 * fy);
    const r0 = (y0 % cells) * cells;
    const r1 = ((y0 + 1) % cells) * cells;
    for (let x = 0; x < n; x++) {
      const gx = x / k;
      const x0 = Math.floor(gx);
      const fx = gx - x0;
      const ux = fx * fx * (3 - 2 * fx);
      const c0 = x0 % cells;
      const c1 = (x0 + 1) % cells;
      const v = (lat[r0 + c0]! * (1 - ux) + lat[r0 + c1]! * ux) * (1 - uy) + (lat[r1 + c0]! * (1 - ux) + lat[r1 + c1]! * ux) * uy;
      out[y * n + x]! += v * amp;
    }
  }
}

/** Rescale to mean 0.5 and the given spread (standard deviation), clamped to 0..1. */
function normalise(h: Float32Array, spread: number): void {
  let mean = 0;
  for (const v of h) mean += v;
  mean /= h.length;
  let varc = 0;
  for (const v of h) varc += (v - mean) ** 2;
  const k = spread / Math.sqrt(varc / h.length || 1);
  for (let i = 0; i < h.length; i++) h[i] = Math.min(1, Math.max(0, 0.5 + (h[i]! - mean) * k));
}

/** Grass from above: clumps, then thousands of short blades lying every way, a few of them dry. */
function grass(rnd: () => number): { h: Float32Array; dry: Float32Array } {
  const h = new Float32Array(N * N);
  const dry = new Float32Array(N * N);
  addNoise(h, 16, 0.35, rnd);
  addNoise(h, 64, 0.15, rnd);
  for (let i = 0; i < h.length; i++) h[i] = h[i]! * 0.55;
  for (let k = 0; k < 14000; k++) {
    const x0 = rnd() * N;
    const y0 = rnd() * N;
    const a = rnd() * Math.PI * 2;
    const len = 6 + rnd() * 14;
    const top = 0.45 + rnd() * 0.55;
    const isDry = rnd() < 0.09;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    for (let s = 0; s < len; s += 0.7) {
      const t = s / len;
      // A blade rises from its root and thins to its tip.
      const v = top * (0.55 + 0.45 * Math.sin(t * Math.PI * 0.9 + 0.3));
      const px = ((Math.round(x0 + dx * s) % N) + N) % N;
      const py = ((Math.round(y0 + dy * s) % N) + N) % N;
      const o = py * N + px;
      if (v > h[o]!) {
        h[o] = v;
        dry[o] = isDry ? 1 : 0;
      }
    }
  }
  normalise(h, 0.2);
  return { h, dry };
}

/** Dirt from above: gentle undulation, grain, and pebbles of all sizes. */
function dirt(rnd: () => number): Float32Array {
  const h = new Float32Array(N * N);
  addNoise(h, 8, 0.3, rnd);
  addNoise(h, 48, 0.2, rnd);
  addNoise(h, 128, 0.12, rnd);
  for (let k = 0; k < 3200; k++) {
    const big = rnd() < 0.08;
    const r = big ? 5 + rnd() * 6 : 1.4 + rnd() * 3.2;
    const e = 0.6 + rnd() * 0.4; // flattened
    const a = rnd() * Math.PI;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const cx = rnd() * N;
    const cy = rnd() * N;
    const top = 0.55 + rnd() * 0.5;
    const R = Math.ceil(r) + 1;
    for (let oy = -R; oy <= R; oy++) {
      for (let ox = -R; ox <= R; ox++) {
        const u = (ox * ca + oy * sa) / r;
        const v = (-ox * sa + oy * ca) / (r * e);
        const d2 = u * u + v * v;
        if (d2 >= 1) continue;
        const px = ((Math.floor(cx) + ox) % N + N) % N;
        const py = ((Math.floor(cy) + oy) % N + N) % N;
        const o = py * N + px;
        const dome = top * Math.sqrt(1 - d2);
        if (dome > h[o]! * 0.9) h[o] = Math.max(h[o]!, 0.25 + dome * 0.75);
      }
    }
  }
  normalise(h, 0.19);
  return h;
}

/** Slope of a tiling height field (relief `amp` metres for a 0..1 height), encoded for a texture. */
function encodeSlope(h: Float32Array, amp: number, out: Uint8Array, ch: number): void {
  const k = amp / (2 * (GROUND_TILE / N));
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const sx = (h[y * N + ((x + 1) % N)]! - h[y * N + ((x + N - 1) % N)]!) * k;
      const sz = (h[((y + 1) % N) * N + x]! - h[((y + N - 1) % N) * N + x]!) * k;
      const o = (y * N + x) * 4 + ch;
      out[o] = Math.round(Math.min(1, Math.max(-1, sx)) * 127 + 128);
      out[o + 1] = Math.round(Math.min(1, Math.max(-1, sz)) * 127 + 128);
    }
  }
}

function texture(data: Uint8Array, n = N, format: THREE.PixelFormat = THREE.RGBAFormat): THREE.DataTexture {
  const t = new THREE.DataTexture(data, n, n, format, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/**
 * Close-up detail shared by the terrain and the dirt roads: grass and dirt relief (for shading and
 * for bumps that catch the light), generated once. Texture rows run along world z, columns along x.
 */
export function groundDetail(): GroundDetail {
  if (cached) return cached;
  const rnd = rng(9137);
  const g = grass(rnd);
  const d = dirt(rnd);
  const grain = new Float32Array(N * N);
  addNoise(grain, 256, 1, rnd);
  normalise(grain, 0.2);
  const shade = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    shade[i * 4] = Math.round(g.h[i]! * 255);
    shade[i * 4 + 1] = Math.round(d[i]! * 255);
    shade[i * 4 + 2] = Math.round(grain[i]! * 255);
    shade[i * 4 + 3] = Math.round(g.dry[i]! * 255);
  }
  const slope = new Uint8Array(N * N * 4);
  encodeSlope(g.h, 0.006, slope, 0);
  encodeSlope(d, 0.009, slope, 2);
  // Patches: 256 px over 24 m, features from about 40 cm to 3 m.
  const P = 256;
  const patch = new Uint8Array(P * P * 2);
  for (let c = 0; c < 2; c++) {
    const f = new Float32Array(P * P);
    addNoise(f, 8, 0.5, rnd, P);
    addNoise(f, 16, 0.3, rnd, P);
    addNoise(f, 64, 0.2, rnd, P);
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of f) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    for (let i = 0; i < P * P; i++) patch[i * 2 + c] = Math.round(((f[i]! - lo) / (hi - lo)) * 255);
  }
  cached = { shade: texture(shade), slope: texture(slope), patch: texture(patch, P, THREE.RGFormat) };
  return cached;
}

/** World size (m) of the patch texture. */
export const PATCH_TILE = 24;

/**
 * GLSL: detail of the ground at world point `w` (xz), `gDist` metres from the camera. Close up the
 * fine detail, its tile shifted around by the patches so it never repeats in a grid; from a few
 * metres away a coarser copy takes over (tufts and stones you still see from the driving seat).
 * Declares `vec4 gShade`, `vec4 gSlope` and `vec2 gPatch` (patches, 0..1). Needs the samplers
 * `uGround`, `uGroundSlope`, `uGroundPatch`.
 */
export const GROUND_SAMPLE_GLSL = /* glsl */ `
  vec2 gPatch = texture2D(uGroundPatch, w / ${PATCH_TILE.toFixed(1)}).rg;
  vec2 gUv = w / ${GROUND_TILE.toFixed(2)} + (gPatch - 0.5) * 0.7;
  // Gradients taken outside the branch (lookups inside it may not compute their own).
  vec2 gDx = dFdx(gUv);
  vec2 gDy = dFdy(gUv);
  vec4 gShade = vec4(0.5, 0.5, 0.5, 0.0);
  vec4 gSlope = vec4(0.0);
  // Millimetre detail only reads within a few metres: skip it further away.
  float gNearK = 1.0 - smoothstep(10.0, 18.0, gDist);
  if (gNearK > 0.0) {
    gShade = mix(gShade, textureGrad(uGround, gUv, gDx, gDy), gNearK);
    gSlope = (textureGrad(uGroundSlope, gUv, gDx, gDy) * 2.0 - 1.0) * gNearK;
  }
  float gFarK = smoothstep(3.0, 12.0, gDist);
  vec4 gCoarse = texture2D(uGround, mat2(0.6, -0.8, 0.8, 0.6) * w / ${(GROUND_TILE * 3.5).toFixed(2)} + vec2(0.13, 0.58));
  gShade.rgb = mix(gShade.rgb, mix(gShade.rgb, gCoarse.rgb, 0.8), gFarK);
`;
