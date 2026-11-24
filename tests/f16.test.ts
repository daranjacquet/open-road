import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createPhysics, FIXED_DT, GROUP, groups } from '../src/core/physics';
import { Aircraft } from '../src/vehicle/aircraft/Aircraft';
import type { FlightInput } from '../src/core/input';
import type { AircraftConfig } from '../src/vehicle/aircraft/types';
import cfgJson from '../src/vehicle/aircraft/f16.json';

const cfg = cfgJson as unknown as AircraftConfig;

async function setup(y = cfg.restHeight!, vz = 0) {
  const physics = await createPhysics();
  physics.world.createCollider(physics.RAPIER.ColliderDesc.cuboid(20000, 1, 20000).setTranslation(0, -1, 0).setFriction(1).setCollisionGroups(groups(GROUP.WORLD, 0xffff)));
  const ac = new Aircraft(physics, cfg, 0, y, 0, 0);
  ac.assists.arcade = true;
  ac.body.setLinvel({ x: 0, y: 0, z: vz }, true);
  const input: FlightInput = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: 0, flaps: 0 };
  const step = (): void => {
    ac.fixedUpdate(FIXED_DT, input);
    physics.step();
    ac.afterPhysicsStep();
    // Contacts hurt the parts as in the game (a tail strike on the runway reaches the engine).
    physics.events.drainContactForceEvents((e) => {
      ac.contactForce(e.collider1(), e.totalForceMagnitude(), FIXED_DT);
      ac.contactForce(e.collider2(), e.totalForceMagnitude(), FIXED_DT);
    });
  };
  return { ac, input, step };
}

const broken = (ac: Aircraft): string[] => [...ac.parts.values()].filter((p) => !p.on).map((p) => p.name);
/** Body-frame angular velocity (x pitch down, y yaw left, z roll right). */
const rates = (ac: Aircraft): THREE.Vector3 => {
  const w = ac.body.angvel();
  return new THREE.Vector3(w.x, w.y, w.z).applyQuaternion(ac.currQuat.clone().invert());
};

describe('F-16 flight model', () => {
  it('stands on its gear, most of the weight on the mains, the engine at idle', async () => {
    const { ac, step } = await setup();
    for (let i = 0; i < 240; i++) step();
    expect(ac.body.translation().y).toBeCloseTo(cfg.restHeight!, 1);
    const [nose, l, r] = ac.wheels.map((w) => w.load);
    const share = nose! / (nose! + l! + r!);
    expect(share).toBeGreaterThan(0.1);
    expect(share).toBeLessThan(0.25);
    expect(ac.state.rpm).toBeCloseTo(cfg.engine.idleRpm, 0);
    expect(ac.mass).toBeCloseTo(12160, -2);
  });

  it('rolls about its own axes: the controller sees the roll inertia, not the yaw inertia', async () => {
    const { ac } = await setup(3000, 200);
    // Rapier's principal frame comes in any order; a fighter's roll inertia is the smallest.
    const I = (ac as unknown as { bodyInertia(): THREE.Vector3 }).bodyInertia();
    expect(I.z).toBeLessThan(I.x / 3);
    expect(I.z).toBeLessThan(I.y / 3);
  });

  it('takes off with the afterburner within 450 m and climbs away; at military power within 650 m', async () => {
    for (const [throttle, limit] of [[1, 450], [0.85, 650]] as const) {
      const { ac, input, step } = await setup();
      for (let i = 0; i < 120; i++) step();
      input.throttle = throttle;
      let liftoff = -1;
      for (let i = 0; i < 120 * 35; i++) {
        // Rotate at 270 km/h and hold the stick back until 30 m up.
        input.pitch = ac.state.airspeed > 75 && ac.state.agl < 30 ? 1 : 0;
        step();
        if (liftoff < 0 && ac.wheels.every((w) => !w.contact) && ac.state.airspeed > 40) liftoff = ac.body.translation().z;
      }
      expect(liftoff, `throttle ${throttle}`).toBeGreaterThan(100);
      expect(liftoff, `throttle ${throttle}`).toBeLessThan(limit);
      expect(ac.body.translation().y).toBeGreaterThan(40);
      expect(broken(ac)).toEqual([]);
      // Stick held back through the lift-off: the nose waits for the wheels to rise, so the tail
      // (and the engine in it) never scrapes the runway.
      expect(ac.engineHealth, `throttle ${throttle}`).toBe(1);
    }
  });

  it('tops out near Mach 1 at sea level: about 0.95 dry, past 1 with the afterburner', async () => {
    const top = async (throttle: number): Promise<number> => {
      const { ac, input, step } = await setup(150, 250);
      input.throttle = throttle;
      for (let i = 0; i < 120 * 60; i++) {
        input.pitch = Math.max(-1, Math.min(1, -ac.state.vs * 0.05));
        step();
      }
      return ac.state.mach;
    };
    const dry = await top(0.85);
    const wet = await top(1);
    expect(dry).toBeGreaterThan(0.85);
    expect(dry).toBeLessThan(1.0);
    expect(wet).toBeGreaterThan(1.0);
    expect(wet).toBeLessThan(1.15);
  });

  it('arcade, GTA style: rolls at about 180 degrees a second and holds its bank, loops in about 5 s, nothing breaks', async () => {
    const { ac, input, step } = await setup(3000, 250);
    input.throttle = 0.9;
    for (let i = 0; i < 60; i++) step();
    input.roll = 1;
    for (let i = 0; i < 60; i++) step();
    expect(rates(ac).z * 57.3).toBeGreaterThan(150);
    expect(rates(ac).z * 57.3).toBeLessThan(230);
    // Let go mid-roll: a fighter holds the bank it has (no wing leveller).
    input.roll = 0;
    for (let i = 0; i < 120; i++) step();
    expect(Math.abs(rates(ac).z)).toBeLessThan(0.1);
    const x = new THREE.Vector3(1, 0, 0).applyQuaternion(ac.currQuat);
    expect(Math.abs(x.y)).toBeGreaterThan(0.2);
    // Full pull: the nose comes round at the same rate whatever the speed (about 75 degrees a
    // second), and in arcade flight no wing folds from it.
    input.pitch = 1;
    for (let i = 0; i < 120; i++) step();
    expect(-rates(ac).x * 57.3).toBeGreaterThan(60);
    for (let i = 0; i < 240; i++) step();
    expect(broken(ac)).toEqual([]);
  });

  it('arcade: goes where the nose points, and a bank alone turns it round', async () => {
    const { ac, input, step } = await setup(2000, 200);
    input.throttle = 0.85;
    for (let i = 0; i < 120; i++) step();
    const heading = (): number => {
      const v = ac.body.linvel();
      return Math.atan2(v.x, v.z) * 57.3;
    };
    const h0 = heading();
    const y0 = ac.body.translation().y;
    // Hold 70 degrees of bank for 6 s, no stick: it turns (it used to slide on the same way).
    for (let i = 0; i < 120 * 6; i++) {
      const b = Math.asin(new THREE.Vector3(1, 0, 0).applyQuaternion(ac.currQuat).y) * 57.3;
      input.roll = Math.max(-1, Math.min(1, (70 - b) * 0.05));
      step();
    }
    expect(Math.abs(heading() - h0)).toBeGreaterThan(100);
    expect(Math.abs(ac.body.translation().y - y0)).toBeLessThan(60);
    // The velocity stays within a few degrees of the nose.
    const lv = ac.body.linvel();
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(ac.currQuat);
    expect(new THREE.Vector3(lv.x, lv.y, lv.z).normalize().angleTo(fwd) * 57.3).toBeLessThan(6);
    expect(ac.state.airspeed).toBeGreaterThan(180);
  });

  it('in the simulation too, the flight computer holds 1 g hands off and stops a full pull near 9 g', async () => {
    const { ac, input, step } = await setup(2500, 300);
    ac.assists.arcade = false;
    input.throttle = 0.9;
    for (let i = 0; i < 360; i++) step();
    // Hands off: level-ish flight, no divergence.
    expect(ac.state.g).toBeGreaterThan(0.6);
    expect(ac.state.g).toBeLessThan(1.6);
    input.pitch = 1;
    let g = 0;
    for (let i = 0; i < 480; i++) {
      step();
      g = Math.max(g, ac.state.g);
    }
    // At 1,080 km/h the stabilator alone could pull past 20 g and fold the wings.
    expect(g).toBeGreaterThan(7);
    expect(g).toBeLessThan(10.5);
    expect(broken(ac)).toEqual([]);
  });
});
