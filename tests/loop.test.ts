import { describe, expect, it } from 'vitest';
import { FixedStepper } from '../src/core/loop';

describe('FixedStepper', () => {
  it('runs the right number of steps for a 60 Hz display at 120 Hz physics', () => {
    const s = new FixedStepper(1 / 120);
    let total = 0;
    for (let i = 0; i < 60; i++) total += s.advance(1 / 60).steps;
    expect(total).toBe(120);
  });

  it('is independent of frame rate over the same wall time', () => {
    const a = new FixedStepper(1 / 120);
    const b = new FixedStepper(1 / 120);
    let sa = 0;
    let sb = 0;
    for (let i = 0; i < 144; i++) sa += a.advance(1 / 144).steps;
    for (let i = 0; i < 30; i++) sb += b.advance(1 / 30).steps;
    expect(Math.abs(sa - 120)).toBeLessThanOrEqual(1);
    expect(Math.abs(sb - 120)).toBeLessThanOrEqual(1);
  });

  it('returns an interpolation alpha in [0,1)', () => {
    const s = new FixedStepper(1 / 120);
    const r = s.advance(1 / 120 + 0.004);
    expect(r.steps).toBe(1);
    expect(r.alpha).toBeGreaterThanOrEqual(0);
    expect(r.alpha).toBeLessThan(1);
  });

  it('drops time after a long stall instead of spiralling', () => {
    const s = new FixedStepper(1 / 120, 4, 10);
    const r = s.advance(5);
    expect(r.steps).toBe(4);
    expect(s.dropped).toBe(true);
    expect(r.alpha).toBeLessThan(1);
  });
});
