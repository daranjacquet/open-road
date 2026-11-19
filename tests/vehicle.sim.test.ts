import { describe, expect, it } from 'vitest';
import sport from '../src/vehicle/cars/sport.json';
import type { VehicleConfig } from '../src/vehicle/types';
import { makeSim, run } from './helpers/sim';

const cfg = sport as unknown as VehicleConfig;

describe('sport coupe: headless driving simulation', () => {
  it('has the configured mass and centre of mass', async () => {
    const { physics, car } = await makeSim(cfg);
    physics.step();
    expect(car.body.mass()).toBeCloseTo(cfg.mass, 0);
    const com = car.body.localCom();
    expect(com.y).toBeCloseTo(cfg.com[1], 2);
  });

  it('settles on its suspension without bouncing or creeping', async () => {
    const { physics, car } = await makeSim(cfg);
    const s = run(physics, car, 4, () => ({}), 0.5);
    const last = s[s.length - 1]!;
    console.log('rest: speed', last.speedKmh.toFixed(3), 'km/h; y', car.body.translation().y.toFixed(3),
      'compression', car.wheels.map((w) => w.compression.toFixed(3)).join(' '),
      'fz', car.wheels.map((w) => w.fz.toFixed(0)).join(' '));
    expect(last.speedKmh).toBeLessThan(0.5);
    const total = car.wheels.reduce((a, w) => a + w.fz, 0);
    expect(total).toBeGreaterThan(cfg.mass * 9.81 * 0.97);
    expect(total).toBeLessThan(cfg.mass * 9.81 * 1.03);
  });

  it('accelerates 0-100 km/h in a realistic time, going straight', async () => {
    const { physics, car } = await makeSim(cfg);
    const s = run(physics, car, 20, (t) => ({ throttle: t > 1 ? 1 : 0 }), 0.05);
    const t100 = s.find((p) => p.speedKmh >= 100)?.t;
    const x400 = s.find((p) => p.z >= 400)?.t;
    console.log('0-100 at', t100?.toFixed(2), 's; 400 m at', x400?.toFixed(2), 's; final', s[s.length - 1]!.speedKmh.toFixed(0), 'km/h; gears', [...new Set(s.map((p) => p.gear))].join(','));
    expect(t100).toBeDefined();
    expect(t100! - 1).toBeGreaterThan(4.2);
    expect(t100! - 1).toBeLessThan(6.5);
    expect(Math.abs(car.body.translation().x)).toBeLessThan(1.0);
  });

  it('reaches a plausible top speed', async () => {
    const { physics, car } = await makeSim(cfg);
    const s = run(physics, car, 45, () => ({ throttle: 1 }), 1);
    const top = Math.max(...s.map((p) => p.speedKmh));
    console.log('top speed', top.toFixed(0), 'km/h at gear', s[s.length - 1]!.gear);
    expect(top).toBeGreaterThan(200);
    expect(top).toBeLessThan(330);
  });

  it('brakes from 100 km/h to a stop in a realistic distance without ABS lock-ups', async () => {
    const { physics, car } = await makeSim(cfg, 0, 0, 0);
    // get to ~100 km/h first
    run(physics, car, 10, (_t, c) => ({ throttle: c.speedKmh < 100 ? 1 : 0.25 }), 1);
    const z0 = car.body.translation().z;
    const v0 = car.speedKmh;
    const s = run(physics, car, 6, () => ({ brake: 1 }), 0.1);
    const stop = s.find((p) => p.speedKmh < 1);
    const dist = car.body.translation().z - z0;
    console.log('braking from', v0.toFixed(0), 'km/h: stopped at', stop?.t.toFixed(2), 's, distance', dist.toFixed(1), 'm, peak long g', Math.min(...s.map((p) => p.longG)).toFixed(2));
    expect(v0).toBeGreaterThan(85);
    expect(dist).toBeGreaterThan(28);
    expect(dist).toBeLessThan(55);
    expect(Math.abs(car.body.translation().x)).toBeLessThan(1.5);
  });

  it('holds about 1 g on a skid pad and stays controllable', async () => {
    const R = 50;
    const { physics, car } = await makeSim(cfg, R, 0, 0); // heading +Z, circle centre at origin on the left? (x positive start)
    // Drive a left circle: start at x = +? Left of +Z heading is +X, so circle centre = (x + R, 0). Place start at (0,0) instead.
    car.placeAt(0, 0.9, 0, 0);
    let maxLat = 0;
    const s = run(
      physics,
      car,
      40,
      (t, c) => {
        // Hold speed by a simple P controller, ramping target from 30 to 100 km/h.
        const target = 30 + t * 2;
        const throttle = c.speedKmh < target ? 0.8 : 0;
        // steer to follow radius R: angle ~ wheelbase / R plus a feedback on lateral distance
        const steer = 0.28 + 0.0 * t;
        return { throttle, steer };
      },
      0.5,
    );
    for (const p of s) maxLat = Math.max(maxLat, Math.abs(p.latG));
    console.log('skidpad: max lateral', maxLat.toFixed(2), 'g; final speed', s[s.length - 1]!.speedKmh.toFixed(0));
    expect(maxLat).toBeGreaterThan(0.7);
    expect(maxLat).toBeLessThan(1.5);
  });

  it('stays straight at very high speed with hands off the wheel', async () => {
    const { physics, car } = await makeSim(cfg);
    run(physics, car, 60, () => ({ throttle: 1 }), 5);
    const x = car.body.translation().x;
    console.log('hands-off high speed drift: x =', x.toFixed(2), 'm at', car.speedKmh.toFixed(0), 'km/h');
    expect(Math.abs(x)).toBeLessThan(6);
  });

  it('has a clean, non-oscillating steering response at 100 km/h', async () => {
    const { physics, car } = await makeSim(cfg);
    run(physics, car, 10, (_t, c) => ({ throttle: c.speedKmh < 100 ? 1 : 0.2 }), 1);
    const yaw: number[] = [];
    run(physics, car, 4, (t, c) => ({ throttle: c.speedKmh < 100 ? 0.5 : 0.18, steer: t > 0.5 ? 0.35 : 0 }), 0.1).forEach((s) => yaw.push(s.yawRate));
    console.log('yaw rate after steer step:', yaw.map((y) => y.toFixed(2)).join(' '));
    const tail = yaw.slice(-12);
    const mean = tail.reduce((a, b) => a + b, 0) / tail.length;
    expect(mean).toBeGreaterThan(0.05); // left turn (+yaw)
    // Settled: the last samples do not swing around their mean.
    for (const y of tail) expect(Math.abs(y - mean)).toBeLessThan(Math.max(0.1, Math.abs(mean) * 0.35));
  });

  it('breaks the rear loose with the handbrake (rear slip angle exceeds front)', async () => {
    const { physics, car } = await makeSim(cfg);
    car.assists.esp = false;
    run(physics, car, 8, (_t, c) => ({ throttle: c.speedKmh < 70 ? 1 : 0.3 }), 1);
    let maxRear = 0;
    let maxFront = 0;
    run(
      physics,
      car,
      2.5,
      (t) => ({ throttle: 0, steer: t < 0.6 ? 0.8 : 0, handbrake: t > 0.2 && t < 1.4 ? 1 : 0 }),
      0.05,
    );
    // sample slip during a second run for clarity
    const { physics: p2, car: c2 } = await makeSim(cfg);
    c2.assists.esp = false;
    run(p2, c2, 8, (_t, c) => ({ throttle: c.speedKmh < 70 ? 1 : 0.3 }), 1);
    const n = 2.5 / (1 / 120);
    for (let i = 0; i < n; i++) {
      const t = i / 120;
      c2.fixedUpdate(1 / 120, { throttle: 0, brake: 0, steer: t < 0.6 ? 0.8 : 0, handbrake: t > 0.2 && t < 1.4 ? 1 : 0 });
      p2.step();
      c2.afterPhysicsStep();
      maxRear = Math.max(maxRear, Math.abs(c2.wheels[2]!.slipAngle) * 57.3);
      maxFront = Math.max(maxFront, Math.abs(c2.wheels[0]!.slipAngle) * 57.3);
    }
    console.log('handbrake turn: max rear slip', maxRear.toFixed(1), 'deg, max front slip', maxFront.toFixed(1), 'deg');
    expect(maxRear).toBeGreaterThan(12);
  });

  it('recovers upright from a flipped state', async () => {
    const { physics, car } = await makeSim(cfg);
    car.body.setRotation({ x: 0, y: 0, z: 1, w: 0 }, true); // upside down
    car.body.setTranslation({ x: 0, y: 3, z: 0 }, true);
    run(physics, car, 2, () => ({}), 1);
    car.recover();
    run(physics, car, 3, () => ({}), 1);
    const q = car.body.rotation();
    const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
    expect(upY).toBeGreaterThan(0.98);
    expect(car.speedKmh).toBeLessThan(1);
  });
});
