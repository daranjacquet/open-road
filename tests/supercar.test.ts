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
  // 90 % of the steady yaw rate before the keyboard ramp even reaches full lock (0.29 s).
  expect(p.turnIn).toBeLessThan(0.22);
  expect(p.laneChange).toBeLessThan(10);
}, 120_000);

it('stays planted when the throttle goes down mid-corner (race car, not a drift car)', async () => {
  const { makeSim } = await import('./helpers/sim');
  const { drive, Keys } = await import('./helpers/feel');
  const { CARS } = await import('../src/game/catalog');
  const cfg = CARS.find((c) => c.id === 'supercar')!.cfg;
  for (const v of [60, 100, 140]) {
    const { physics, car } = await makeSim(cfg);
    drive(physics, car, 30, (_t, c) => ({ throttle: Math.min(Math.max((v - c.speedKmh) * 0.15 + 0.25, 0), 1) }));
    const k = new Keys();
    const s = drive(physics, car, 4, (t, c) => ({ throttle: t > 1.5 ? 1 : Math.min(Math.max((v - c.speedKmh) * 0.15 + 0.25, 0), 1), steer: k.step(t < 3 ? 1 : 0) }), 1.5);
    console.log('supercar corner exit floored at', v, 'km/h: max body slip', s.maxSlip.toFixed(1), 'deg');
    expect(s.maxSlip).toBeLessThan(10);
  }
}, 60_000);

it('more power is felt: with the gearing it suggests, top speed and 0-300 km/h improve a lot', async () => {
  const { CARS } = await import('../src/game/catalog');
  const { applyTune, stockTune, suggestFinalDrive } = await import('../src/vehicle/tuning');
  const def = CARS.find((c) => c.id === 'supercar')!;
  const st = stockTune(def.cfg);
  const strong = { ...st, power: st.power * 2, torque: st.torque * 2 };
  strong.finalDrive = suggestFinalDrive(def.cfg, strong);
  expect(strong.finalDrive).toBeLessThan(st.finalDrive);
  // Less power keeps the stock gearing.
  expect(suggestFinalDrive(def.cfg, { ...st, power: st.power * 0.7 })).toBe(st.finalDrive);
  const base = await perf(applyTune(def.cfg, st));
  const more = await perf(applyTune(def.cfg, strong));
  console.log('stock', base.t200, base.top, '| x2 power', more.t200, more.top);
  expect(more.top).toBeGreaterThan(base.top * 1.2);
  expect(more.t200).toBeLessThan(base.t200 * 0.8);
}, 180_000);
