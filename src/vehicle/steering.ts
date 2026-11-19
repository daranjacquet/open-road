/** Steering lock available at a given speed: halves at `speedRef`, falls off as 1/(1+(v/ref)^2). */
export function maxSteerAngle(lock: number, speedRef: number, speed: number): number {
  const r = speed / speedRef;
  return lock / (1 + r * r);
}

/**
 * Ackermann geometry. `delta` is the virtual centre wheel angle (+ = left turn).
 * Returns [left wheel angle, right wheel angle]; the inside wheel turns more.
 */
export function ackermann(delta: number, wheelbase: number, track: number): [number, number] {
  const a = Math.abs(delta);
  if (a < 1e-5) return [delta, delta];
  const R = wheelbase / Math.tan(a);
  const inner = Math.atan(wheelbase / Math.max(R - track / 2, 1e-3));
  const outer = Math.atan(wheelbase / (R + track / 2));
  return delta > 0 ? [inner, outer] : [-outer, -inner];
}
