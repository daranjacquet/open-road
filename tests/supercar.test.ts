import { expect, it } from 'vitest';
import { perf } from './helpers/perf';

/** The supercar must drive like one: hard acceleration, high grip that grows with speed, no understeer
 *  push and no oversteer at speed with a keyboard. */
it('the supercar performs and handles like a supercar', async () => {
  const p = await perf();
  console.log('supercar', JSON.stringify(p));
  expect(p.t100).toBeLessThan(3.0);
  expect(p.t200).toBeLessThan(7.5);
  expect(p.top).toBeGreaterThan(320);
  expect(p.top).toBeLessThan(370);
  expect(p.brake100).toBeLessThan(32);
  // Mechanical grip, then downforce.
  expect(p.latG[80]!).toBeGreaterThan(1.25);
  expect(p.latG[150]!).toBeGreaterThan(1.45);
  expect(p.latG[220]!).toBeGreaterThan(1.6);
  expect(p.latG[220]!).toBeGreaterThan(p.latG[80]!);
  // The rear never slides more than the front: planted at speed.
  for (const v of [80, 150, 220]) expect(p.slip[v]![1]).toBeLessThan(p.slip[v]![0]);
  expect(p.turnIn).toBeLessThan(0.2);
  expect(p.laneChange).toBeLessThan(10);
}, 120_000);
