import * as THREE from 'three';

/** Monotone-ish cubic Hermite through [x, value] keyframes (x ascending). Flat extrapolation. */
export function keyCurve(keys: ReadonlyArray<readonly [number, number]>): (x: number) => number {
  const n = keys.length;
  const xs = keys.map((k) => k[0]);
  const ys = keys.map((k) => k[1]);
  const m: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const i0 = Math.max(i - 1, 0);
    const i1 = Math.min(i + 1, n - 1);
    m[i] = i1 === i0 ? 0 : (ys[i1]! - ys[i0]!) / (xs[i1]! - xs[i0]!);
  }
  return (x: number): number => {
    if (x <= xs[0]!) return ys[0]!;
    if (x >= xs[n - 1]!) return ys[n - 1]!;
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]!) i++;
    const h = xs[i + 1]! - xs[i]!;
    const t = (x - xs[i]!) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * ys[i]! +
      (t3 - 2 * t2 + t) * h * m[i]! +
      (-2 * t3 + 3 * t2) * ys[i + 1]! +
      (t3 - t2) * h * m[i + 1]!
    );
  };
}

/** Closed uniform quadratic B-spline through control points, `m` samples per span. */
export function closedBSpline(ctrl: ReadonlyArray<readonly [number, number]>, m: number, out: Float32Array, offset: number): void {
  const n = ctrl.length;
  let o = offset;
  for (let i = 0; i < n; i++) {
    const p0 = ctrl[i]!;
    const p1 = ctrl[(i + 1) % n]!;
    const p2 = ctrl[(i + 2) % n]!;
    for (let s = 0; s < m; s++) {
      const t = s / m;
      const a = 0.5 * (1 - t) * (1 - t);
      const b = 0.5 * (-2 * t * t + 2 * t + 1);
      const c = 0.5 * t * t;
      out[o++] = a * p0[0] + b * p1[0] + c * p2[0];
      out[o++] = a * p0[1] + b * p1[1] + c * p2[1];
    }
  }
}

export interface LoftOptions {
  zMin: number;
  zMax: number;
  stations: number;
  /** Samples per B-spline span. */
  perSpan: number;
  /** Returns the RIGHT half control polygon (bottom centre to top centre) at z. x >= 0. */
  section: (z: number) => [number, number][];
  /** Rounded end caps: radius (m) over which the section closes to a point. */
  endRound: number;
}

export interface LoftResult {
  positions: Float32Array;
  indices: Uint32Array;
  stations: number;
  ring: number;
}

/**
 * Builds a closed tube along Z whose cross-section is a B-spline through the mirrored control polygon.
 * Vertex (i, j): station i (rear to front), ring sample j (bottom centre, going to the LEFT side first).
 * Winding is chosen so the faces point outwards.
 */
export function loft(opt: LoftOptions): LoftResult {
  const { zMin, zMax, stations, perSpan, section, endRound } = opt;
  const first = section(zMin);
  const nHalf = first.length;
  const nCtrl = nHalf * 2 - 2;
  const ring = nCtrl * perSpan;
  const positions = new Float32Array(stations * ring * 3);
  const tmp = new Float32Array(ring * 2);
  const ctrl: [number, number][] = new Array(nCtrl);

  for (let i = 0; i < stations; i++) {
    const u = i / (stations - 1);
    // Denser towards both ends where the shape changes fastest.
    const w = 0.5 - 0.5 * Math.cos(Math.PI * u);
    const z = zMin + (zMax - zMin) * (0.5 * u + 0.5 * w);
    const half = section(z);
    // left half (+x) from bottom centre upwards, then the mirrored right half coming back down
    for (let k = 0; k < nHalf; k++) ctrl[k] = [half[k]![0], half[k]![1]];
    for (let k = 1; k < nHalf - 1; k++) ctrl[nHalf - 1 + k] = [-half[nHalf - 1 - k]![0], half[nHalf - 1 - k]![1]];
    closedBSpline(ctrl, perSpan, tmp, 0);

    // End rounding: scale the whole section towards its centre near the extremes.
    const dEnd = Math.min(z - zMin, zMax - z);
    let f = 1;
    if (dEnd < endRound) {
      const r = 1 - dEnd / endRound;
      f = Math.sqrt(Math.max(0, 1 - r * r));
    }
    let cy = 0;
    for (let k = 0; k < ring; k++) cy += tmp[k * 2 + 1]!;
    cy /= ring;
    for (let j = 0; j < ring; j++) {
      const x = tmp[j * 2]! * f;
      const y = cy + (tmp[j * 2 + 1]! - cy) * f;
      const o = (i * ring + j) * 3;
      positions[o] = x;
      positions[o + 1] = y;
      positions[o + 2] = z;
    }
  }

  const indices = new Uint32Array((stations - 1) * ring * 6);
  let o = 0;
  for (let i = 0; i < stations - 1; i++) {
    for (let j = 0; j < ring; j++) {
      const j1 = (j + 1) % ring;
      const a = i * ring + j;
      const b = i * ring + j1;
      const c = (i + 1) * ring + j;
      const d = (i + 1) * ring + j1;
      indices[o++] = a;
      indices[o++] = c;
      indices[o++] = b;
      indices[o++] = b;
      indices[o++] = c;
      indices[o++] = d;
    }
  }

  // Make sure faces point outwards: test the top-centre quad of the middle station.
  const mid = Math.floor(stations / 2);
  const j = Math.floor(ring * 0.5 * (1 - 0.0)); // opposite of bottom centre = top centre
  const base = (mid * ring + j) * 3;
  const a = new THREE.Vector3(positions[base]!, positions[base + 1]!, positions[base + 2]!);
  const bj = ((j + 1) % ring) + mid * ring;
  const cj = j + (mid + 1) * ring;
  const bb = new THREE.Vector3(positions[bj * 3]!, positions[bj * 3 + 1]!, positions[bj * 3 + 2]!);
  const cc = new THREE.Vector3(positions[cj * 3]!, positions[cj * 3 + 1]!, positions[cj * 3 + 2]!);
  const n = new THREE.Vector3().crossVectors(cc.clone().sub(a), bb.clone().sub(a));
  if (n.y < 0) {
    for (let t = 0; t < indices.length; t += 3) {
      const tmpI = indices[t + 1]!;
      indices[t + 1] = indices[t + 2]!;
      indices[t + 2] = tmpI;
    }
  }
  return { positions, indices, stations, ring };
}
