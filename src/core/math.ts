export const TAU = Math.PI * 2;
export const RPM_TO_RADS = TAU / 60;
export const RADS_TO_RPM = 60 / TAU;
export const G = 9.81;

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function moveToward(cur: number, target: number, maxDelta: number): number {
  const d = target - cur;
  if (Math.abs(d) <= maxDelta) return target;
  return cur + Math.sign(d) * maxDelta;
}

/** Frame-rate independent exponential smoothing factor. */
export function damp(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

/** Piecewise-linear interpolation over sorted [x, y] pairs; clamps outside the range. */
export function interpTable(table: ReadonlyArray<readonly [number, number]>, x: number): number {
  const n = table.length;
  if (n === 0) return 0;
  const first = table[0]!;
  if (x <= first[0]) return first[1];
  const last = table[n - 1]!;
  if (x >= last[0]) return last[1];
  for (let i = 1; i < n; i++) {
    const b = table[i]!;
    if (x <= b[0]) {
      const a = table[i - 1]!;
      const t = (x - a[0]) / (b[0] - a[0]);
      return a[1] + (b[1] - a[1]) * t;
    }
  }
  return last[1];
}
