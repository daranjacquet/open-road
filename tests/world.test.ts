import { describe, expect, it } from 'vitest';
import { CARS } from '../src/game/catalog';
import { LapTimer } from '../src/game/laps';
import { DRIFT, RACE } from '../src/world/map';
import { ASPHALT, GRASS, SurfaceMap } from '../src/world/surface';
import { TrackLine } from '../src/world/track';
import { drive } from './helpers/feel';
import { makeSim } from './helpers/sim';

describe('parked cars stay put', () => {
  for (const def of CARS) {
    it(`${def.id} does not creep with no input`, async () => {
      const { physics, car } = await makeSim(def.cfg);
      drive(physics, car, 3, () => ({}));
      const a = { ...car.body.translation() };
      drive(physics, car, 20, () => ({}));
      const b = car.body.translation();
      expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeLessThan(0.02);
    });
  }
});

describe('circuits', () => {
  for (const def of [RACE, DRIFT]) {
    it(`${def.id}: a closed loop with room for walls between sections and drivable corners`, () => {
      const line = new TrackLine(def);
      expect(line.length).toBeGreaterThan(1800);
      const clearance = 2 * (def.width / 2 + def.runoff) + 10;
      let minGap = Infinity;
      for (let i = 0; i < line.n; i += 2) {
        for (let j = 0; j < line.n; j += 2) {
          const ds = Math.min(Math.abs(i - j), line.n - Math.abs(i - j)) * line.step;
          if (ds < 150) continue;
          minGap = Math.min(minGap, Math.hypot(line.x[i]! - line.x[j]!, line.z[i]! - line.z[j]!));
        }
      }
      expect(minGap).toBeGreaterThan(clearance);
      const maxCurv = Math.max(...Array.from(line.curv, Math.abs));
      expect(1 / maxCurv).toBeGreaterThan(18);
      // Everything inside the 2 km world, walls included.
      for (let i = 0; i < line.n; i++) {
        expect(Math.abs(line.x[i]!) + def.width / 2 + def.runoff).toBeLessThan(995);
        expect(Math.abs(line.z[i]!) + def.width / 2 + def.runoff).toBeLessThan(995);
      }
    });
  }

  it('times a full lap and ignores a shortcut', () => {
    const line = new TrackLine(RACE);
    const timer = new LapTimer(line, 'test');
    const v = 50; // m/s
    let t = 0;
    const along = (from: number, to: number): void => {
      for (let s = from; s <= to; s += v / 60) {
        const p = line.at(s);
        t += 1 / 60;
        timer.update(p.x, p.z, t);
      }
    };
    along(line.length - 100, line.length + 10); // cross the line: lap starts
    expect(timer.state.running).toBe(true);
    along(10, line.length + 10);
    expect(timer.state.lap).toBe(1);
    expect(timer.state.last!).toBeCloseTo(line.length / v, 0);
    // Cut from 20 % straight to 95 %: no lap counted.
    along(10, line.length * 0.2);
    along(line.length * 0.95, line.length + 10);
    expect(timer.state.lap).toBe(1);
  });
});

describe('surface raster', () => {
  it('paints and reads asphalt', () => {
    const m = new SurfaceMap(2000);
    expect(m.get(10, 10)).toBe(GRASS);
    m.fillDisc(10, 10, 5, ASPHALT);
    expect(m.get(12, 11)).toBe(ASPHALT);
    expect(m.get(20, 10)).toBe(GRASS);
    m.fillRect(-100, -5, -50, 5, ASPHALT);
    expect(m.get(-75, 0)).toBe(ASPHALT);
    expect(m.get(5000, 0)).toBe(GRASS);
  });
});
