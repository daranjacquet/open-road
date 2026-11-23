import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { FIXED_DT } from '../src/core/physics';
import { CARS } from '../src/game/catalog';
import { makeSim } from './helpers/sim';

/** Pitch (nose up +) and bank (right side down +) of a car, in degrees. */
function attitude(q: THREE.Quaternion): { pitch: number; bank: number } {
  const f = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  const l = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  return { pitch: Math.asin(f.y) * 57.3, bank: Math.asin(l.y) * 57.3 };
}

describe('cars in the air (keys turn them, like in action games)', () => {
  for (const def of CARS) {
    it(`${def.id}: W tips the nose down, S lifts it, A/D roll it; no key, no turning`, async () => {
      const fly = async (input: { throttle: number; brake: number; steer: number }) => {
        const { physics, car } = await makeSim(def.cfg, 0, 0, 0);
        car.placeAt(0, 60, 0, 0);
        for (let i = 0; i < 60; i++) {
          car.fixedUpdate(FIXED_DT, { ...input, handbrake: 0 });
          physics.step();
          car.afterPhysicsStep();
        }
        return attitude(car.currQuat);
      };
      const still = await fly({ throttle: 0, brake: 0, steer: 0 });
      const down = await fly({ throttle: 1, brake: 0, steer: 0 });
      const up = await fly({ throttle: 0, brake: 1, steer: 0 });
      const left = await fly({ throttle: 0, brake: 0, steer: 1 });
      const right = await fly({ throttle: 0, brake: 0, steer: -1 });
      console.log(def.id, 'half a second:', JSON.stringify({ still, down, up, left, right }, (_k, v) => (typeof v === 'number' ? Math.round(v) : v)));
      expect(Math.abs(still.pitch)).toBeLessThan(2);
      expect(down.pitch).toBeLessThan(-35);
      expect(up.pitch).toBeGreaterThan(35);
      expect(left.bank).toBeLessThan(-35);
      expect(right.bank).toBeGreaterThan(35);
    });
  }
});

describe('garage air drag', () => {
  it('less drag, higher top speed (the gearing follows)', async () => {
    const { applyTune, stockTune, suggestFinalDrive } = await import('../src/vehicle/tuning');
    const def = CARS.find((c) => c.id === 'sedan')!;
    const top = async (drag: number): Promise<number> => {
      const t = { ...stockTune(def.cfg), drag };
      t.finalDrive = suggestFinalDrive(def.cfg, t);
      const { physics, car } = await makeSim(applyTune(def.cfg, t), 0, 0, 0);
      for (let i = 0; i < 120 * 40; i++) {
        car.fixedUpdate(FIXED_DT, { throttle: 1, brake: 0, steer: 0, handbrake: 0 });
        physics.step();
        car.afterPhysicsStep();
      }
      return car.speedKmh;
    };
    const stock = await top(def.cfg.aero.cdA);
    const slippery = await top(def.cfg.aero.cdA * 0.4);
    console.log(`sedan after 40 s flat out: stock drag ${stock.toFixed(0)} km/h, 40 % drag ${slippery.toFixed(0)} km/h`);
    expect(slippery).toBeGreaterThan(stock + 20);
  }, 60_000);
});
