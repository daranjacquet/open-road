import { describe, expect, it } from 'vitest';
import { CARS } from '../src/game/catalog';

/** The car JSON files are cast to VehicleConfig; this checks they really fit it. */
describe('car configs', () => {
  for (const { id, cfg } of CARS) {
    it(`${id} is complete and in range`, () => {
      expect(['FWD', 'RWD', 'AWD']).toContain(cfg.drive);
      expect(cfg.mass).toBeGreaterThan(600);
      expect(cfg.mass).toBeLessThan(4000);
      for (const k of ['FL', 'FR', 'RL', 'RR'] as const) expect(cfg.wheels[k]).toHaveLength(3);
      expect(cfg.wheels.FL[2]).toBeGreaterThan(cfg.wheels.RL[2]); // front is +Z
      expect(cfg.wheels.FL[0]).toBeGreaterThan(cfg.wheels.FR[0]); // left is +X
      for (const s of [cfg.suspensionFront, cfg.suspensionRear]) {
        expect(s.maxLen).toBeGreaterThan(s.minLen);
        expect(s.k).toBeGreaterThan(5000);
        expect(s.cRebound).toBeGreaterThan(0);
      }
      expect(cfg.tire.mu).toBeGreaterThan(0.5);
      expect(cfg.tire.slideRatio).toBeGreaterThan(0.5);
      expect(cfg.tire.slideRatio).toBeLessThan(1);
      expect(cfg.steering.lock).toBeGreaterThan(0.3);
      expect(cfg.steering.assist).toBeGreaterThanOrEqual(0);
      expect(cfg.steering.assist).toBeLessThanOrEqual(1);
      expect(cfg.steering.rate).toBeGreaterThan(0);
      expect(cfg.engine.torqueCurve.length).toBeGreaterThan(3);
      for (let i = 1; i < cfg.engine.torqueCurve.length; i++) expect(cfg.engine.torqueCurve[i]![0]).toBeGreaterThan(cfg.engine.torqueCurve[i - 1]![0]);
      expect(cfg.gearbox.ratios.length).toBeGreaterThan(3);
      for (let i = 1; i < cfg.gearbox.ratios.length; i++) expect(cfg.gearbox.ratios[i]!).toBeLessThan(cfg.gearbox.ratios[i - 1]!);
      expect(cfg.crush.length).toBeGreaterThan(4);
      expect(cfg.colliders.length).toBeGreaterThan(0);
      expect(cfg.outline.length).toBeGreaterThan(0);
    });
  }
});
