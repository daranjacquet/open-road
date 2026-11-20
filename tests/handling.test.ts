import { describe, expect, it } from 'vitest';
import { CARS } from '../src/game/catalog';
import { applyTune, curvePeaks, PRESETS, stockTune } from '../src/vehicle/tuning';
import type { Vehicle } from '../src/vehicle/Vehicle';
import type { VehicleConfig } from '../src/vehicle/types';
import { makeSim } from './helpers/sim';
import { bodySlip, drive, Keys } from './helpers/feel';
import { driftRun } from './helpers/drifter';

const hold = (kmh: number) => (c: Vehicle) => Math.min(Math.max((kmh - c.speedKmh) * 0.15 + 0.2, 0), 1);

async function cruising(cfg: VehicleConfig, kmh: number) {
  const sim = await makeSim(cfg);
  drive(sim.physics, sim.car, 30, (_t, c) => ({ throttle: Math.min(Math.max((kmh - c.speedKmh) * 0.15, 0), 1) }));
  return sim;
}

describe('keyboard handling (full presses only)', () => {
  for (const def of CARS) {
    it(`${def.id}: full lock corners at the limit without ploughing or spinning, 60 to 180 km/h`, async () => {
      // Arcade handling: well above what the tyres alone give (about 1 g for the saloon).
      const minG = def.id === 'offroad' ? 0.85 : 1.05;
      for (const v of [60, 100, 140, 180]) {
        const { physics, car } = await cruising(def.cfg, v);
        const k = new Keys();
        const s = drive(physics, car, 3, (_t, c) => ({ throttle: hold(v)(c), steer: k.step(1) }), 1.5);
        console.log(def.id, v, 'km/h: lat', s.meanLatG.toFixed(2), 'g, body slip', s.maxSlip.toFixed(1), 'deg, front slip', s.frontSlip.toFixed(1));
        expect(s.maxSlip).toBeLessThan(12);
        expect(s.meanLatG).toBeGreaterThan(minG);
        // Front tyres near their peak, not scrubbing at 20 degrees.
        expect(s.frontSlip).toBeLessThan(14);
      }
    }, 60_000);

    it(`${def.id}: a full-lock slalom at 80 km/h stays tidy`, async () => {
      const { physics, car } = await cruising(def.cfg, 80);
      const k = new Keys();
      const s = drive(physics, car, 6, (t, c) => ({ throttle: hold(80)(c), steer: k.step(Math.floor(t / 0.9) % 2 ? -1 : 1) }));
      expect(s.maxSlip).toBeLessThan(15);
    }, 30_000);

    it(`${def.id}: a handbrake flick slides, then straightens by itself when the keys are released`, async () => {
      const { physics, car } = await cruising(def.cfg, 80);
      const k = new Keys();
      let recovered = -1;
      const s = drive(physics, car, 4, (t, c) => {
        if (t > 1.2 && recovered < 0 && Math.abs(bodySlip(c)) < 4) recovered = t;
        return { throttle: t > 1 ? 0.3 : 0, steer: k.step(t < 0.7 ? 1 : 0), handbrake: t > 0.2 && t < 0.7 ? 1 : 0 };
      });
      console.log(def.id, 'flick: max slip', s.maxSlip.toFixed(0), 'deg, straight again at', recovered.toFixed(2), 's');
      expect(s.maxSlip).toBeGreaterThan(12);
      expect(s.maxSlip).toBeLessThan(45);
      expect(recovered).toBeGreaterThan(0);
      expect(recovered).toBeLessThan(2.8);
    }, 30_000);
  }
});

describe('garage setups', () => {
  it('the factory setup round-trips to the same physics', () => {
    for (const def of CARS) {
      const cfg = applyTune(def.cfg, stockTune(def.cfg));
      expect(cfg.engine.torqueCurve).toEqual(def.cfg.engine.torqueCurve);
      expect(cfg.diff).toEqual(def.cfg.diff);
      expect(cfg.com[2]).toBeCloseTo(def.cfg.com[2], 3);
      expect(cfg.suspensionFront.k).toBeCloseTo(def.cfg.suspensionFront.k, 0);
      expect(cfg.suspensionRear.cRebound).toBeCloseTo(def.cfg.suspensionRear.cRebound, 3);
      expect(cfg.steering.lock).toBeCloseTo(def.cfg.steering.lock, 3);
      expect(cfg.wheels).toEqual(def.cfg.wheels);
    }
  });

  it('power and torque sliders hit their targets', () => {
    const cfg = CARS[0]!.cfg;
    const t = { ...stockTune(cfg), power: 700, torque: 800 };
    const pk = curvePeaks(applyTune(cfg, t).engine.torqueCurve, t.redline);
    expect(pk.power / 745.7).toBeCloseTo(700, -1);
    expect(pk.torque).toBeGreaterThan(780);
    expect(pk.torque).toBeLessThan(900);
  });

  it('ride height, track width and camber change the car', async () => {
    const cfg = CARS[0]!.cfg;
    const low = await makeSim(applyTune(cfg, { ...stockTune(cfg), rideHeight: -5, trackFront: 10, camberFront: -4 }));
    const std = await makeSim(cfg);
    drive(low.physics, low.car, 3, () => ({}));
    drive(std.physics, std.car, 3, () => ({}));
    expect(std.car.body.translation().y - low.car.body.translation().y).toBeCloseTo(0.05, 2);
    expect(low.car.wheels[0]!.mount.x - std.car.wheels[0]!.mount.x).toBeCloseTo(0.05, 3);
    expect(low.car.wheels[0]!.camber).toBeCloseTo((-4 * Math.PI) / 180, 4);
  });

  it('every setup can hold a keyboard drift on the throttle, the drift setup best of all', async () => {
    for (const def of CARS) {
      for (const name of ['Stock', 'Track', 'Drift']) {
        const tune = PRESETS[name]!(stockTune(def.cfg), def.cfg);
        const { physics, car } = await makeSim(applyTune(def.cfg, tune));
        Object.assign(car.assists, { tc: tune.tc, abs: tune.abs, esp: tune.esp });
        const r = driftRun(physics, car);
        console.log(def.id, name, 'drift held', r.held.toFixed(1), 's, mean angle', r.meanAngle.toFixed(0), 'deg, max', r.maxAngle.toFixed(0), 'at', r.meanKmh.toFixed(0), 'km/h');
        // Stock and grip setups too: the aids let the wheels spin in a held slide, the throttle
        // pushes the car on and four-wheel drive sends its torque to the rear.
        expect(r.held).toBeGreaterThan(name === 'Drift' ? 5 : 3);
        expect(r.maxAngle).toBeLessThan(55);
        expect(r.spun).toBe(false);
      }
    }
  }, 180_000);

  it('the rally setup slides on dirt and asphalt and still grips', async () => {
    const def = CARS.find((c) => c.id === 'sedan')!;
    const tune = PRESETS['Rally']!(stockTune(def.cfg), def.cfg);
    const cfg = applyTune(def.cfg, tune);
    const { createPhysics, GROUP, groups } = await import('../src/core/physics');
    const { Vehicle } = await import('../src/vehicle/Vehicle');
    for (const surface of ['asphalt', 'dirt'] as const) {
      const make = async (): Promise<{ physics: Awaited<ReturnType<typeof createPhysics>>; car: InstanceType<typeof Vehicle> }> => {
        const physics = await createPhysics();
        const { RAPIER, world } = physics;
        const ground = world.createCollider(
          RAPIER.ColliderDesc.cuboid(5000, 1, 5000).setTranslation(0, -1, 0).setCollisionGroups(groups(GROUP.WORLD, 0xffff)),
          world.createRigidBody(RAPIER.RigidBodyDesc.fixed()),
        );
        physics.groundColliders.add(ground.handle);
        physics.surfaceAt = () => surface;
        const car = new Vehicle(physics, cfg, 0, 0, 0);
        Object.assign(car.assists, { tc: tune.tc, abs: tune.abs, esp: tune.esp });
        return { physics, car };
      };
      let { physics, car } = await make();
      const r = driftRun(physics, car);
      ({ physics, car } = await make());
      drive(physics, car, 20, (_t, c) => ({ throttle: hold(80)(c) }));
      const k = new Keys();
      const s = drive(physics, car, 3, (_t, c) => ({ throttle: hold(80)(c), steer: k.step(1) }), 1);
      console.log('rally', surface, 'drift held', r.held.toFixed(1), 's at', r.meanKmh.toFixed(0), 'km/h; 80 km/h corner', s.meanLatG.toFixed(2), 'g, slip', s.maxSlip.toFixed(0));
      expect(r.held).toBeGreaterThan(5);
      expect(r.spun).toBe(false);
      expect(r.meanKmh).toBeGreaterThan(70);
      expect(s.meanLatG).toBeGreaterThan(1.2);
      expect(s.spun).toBe(false);
    }
  }, 60_000);

  it('dirt and grass grip less than asphalt but stay controllable', async () => {
    const { createPhysics, GROUP, groups } = await import('../src/core/physics');
    const { Vehicle } = await import('../src/vehicle/Vehicle');
    for (const def of CARS) {
      const g: Record<string, number> = {};
      for (const surface of ['asphalt', 'dirt', 'grass'] as const) {
        const physics = await createPhysics();
        const { RAPIER, world } = physics;
        const ground = world.createCollider(
          RAPIER.ColliderDesc.cuboid(5000, 1, 5000).setTranslation(0, -1, 0).setCollisionGroups(groups(GROUP.WORLD, 0xffff)),
          world.createRigidBody(RAPIER.RigidBodyDesc.fixed()),
        );
        physics.groundColliders.add(ground.handle);
        physics.surfaceAt = () => surface;
        const car = new Vehicle(physics, def.cfg, 0, 0, 0);
        drive(physics, car, 20, (_t, c) => ({ throttle: hold(70)(c) }));
        const k = new Keys();
        const corner = drive(physics, car, 3, (_t, c) => ({ throttle: hold(70)(c), steer: k.step(1) }), 1);
        const k2 = new Keys();
        const slalom = drive(physics, car, 5, (t, c) => ({ throttle: hold(70)(c), steer: k2.step(Math.floor(t / 1.1) % 2 ? -1 : 1) }));
        console.log(def.id, surface, 'corner', corner.meanLatG.toFixed(2), 'g, slalom max slip', slalom.maxSlip.toFixed(0), 'deg');
        g[surface] = corner.meanLatG;
        expect(slalom.spun).toBe(false);
        expect(slalom.maxSlip).toBeLessThan(25);
      }
      // All-terrain tyres (the 4x4) hold about as well on dirt as on asphalt; road tyres do not.
      if ((def.cfg.tire.looseGrip ?? 1) <= 1) expect(g['dirt']!).toBeLessThan(g['asphalt']!);
      else expect(g['dirt']!).toBeLessThan(g['asphalt']! * 1.1);
      expect(g['grass']!).toBeLessThan(g['dirt']!);
      expect(g['grass']!).toBeGreaterThan(0.7);
    }
  }, 120_000);

  it('a handbrake pull keeps the gear (clutch in), a manual box shifts on demand', async () => {
    const { physics, car } = await cruising(CARS[0]!.cfg, 60);
    const g = car.gear;
    drive(physics, car, 0.6, () => ({ handbrake: 1 }));
    expect(car.gear).toBe(g);
    car.manual = true;
    car.shiftDown();
    drive(physics, car, 0.5, () => ({ throttle: 0.5 }));
    expect(car.gear).toBe(g - 1);
    car.shiftUp();
    car.shiftUp();
    drive(physics, car, 0.5, () => ({ throttle: 0.5 }));
    expect(car.gear).toBe(g + 1);
  });
});
