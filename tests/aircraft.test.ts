import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createPhysics, FIXED_DT, GROUP, groups } from '../src/core/physics';
import type { FlightInput } from '../src/core/input';
import { Aircraft, airDensity, liftCoefficient } from '../src/vehicle/aircraft/Aircraft';
import type { AircraftConfig } from '../src/vehicle/aircraft/types';
import cfgJson from '../src/vehicle/aircraft/sr22.json';

const cfg = cfgJson as unknown as AircraftConfig;
const clamp = THREE.MathUtils.clamp;
const KT = 1.943844;

async function setup(y = 1.18, z = 0) {
  const physics = await createPhysics();
  const { RAPIER, world } = physics;
  world.createCollider(RAPIER.ColliderDesc.cuboid(5000, 1, 5000).setTranslation(0, -1, 0).setFriction(1).setCollisionGroups(groups(GROUP.WORLD, 0xffff)));
  const ac = new Aircraft(physics, cfg, 0, y, z, 0);
  const input: FlightInput = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: 0, flaps: 0 };
  let t = 0;
  const step = (): void => {
    ac.fixedUpdate(FIXED_DT, input);
    physics.step();
    ac.afterPhysicsStep();
    physics.events.drainContactForceEvents((e) => {
      ac.contactForce(e.collider1(), e.totalForceMagnitude(), FIXED_DT);
      ac.contactForce(e.collider2(), e.totalForceMagnitude(), FIXED_DT);
    });
    t += FIXED_DT;
  };
  return { physics, ac, input, step, time: () => t };
}

const pitchOf = (ac: Aircraft): number => Math.asin(clamp(new THREE.Vector3(0, 0, 1).applyQuaternion(ac.currQuat).y, -1, 1));
/** Bank angle, right wing down positive. */
const rollOf = (ac: Aircraft): number => Math.asin(clamp(new THREE.Vector3(1, 0, 0).applyQuaternion(ac.currQuat).y, -1, 1));
function rate(ac: Aircraft, axis: THREE.Vector3): number {
  const av = ac.body.angvel();
  return new THREE.Vector3(av.x, av.y, av.z).dot(axis.clone().applyQuaternion(ac.currQuat));
}
/** A test pilot: holds a pitch attitude and the wings level. */
function pilot(ac: Aircraft, input: FlightInput, pitchTarget: number): void {
  input.pitch = clamp((pitchTarget - pitchOf(ac)) * 10 + rate(ac, new THREE.Vector3(1, 0, 0)) * 3, -1, 1);
  input.roll = clamp(-rollOf(ac) * 3 + rate(ac, new THREE.Vector3(0, 0, 1)) * 0.8, -1, 1);
}
const partsOff = (ac: Aircraft): string[] => [...ac.parts.values()].filter((p) => !p.on).map((p) => p.name);

/** Up and away in cruise trim: 250 m, 75 % power, wings level (the start of several tests). */
async function cruising() {
  const s = await setup(250);
  s.ac.body.setLinvel({ x: 0, y: 0, z: 75 }, true);
  s.input.throttle = 0.75;
  s.ac.controls.throttle = 0.75;
  for (let i = 0; i < 120 * 30; i++) {
    const target = clamp(0.02 + (250 - s.ac.body.translation().y) * 0.004 - s.ac.state.vs * 0.02, -0.15, 0.2);
    pilot(s.ac, s.input, target);
    s.step();
  }
  return s;
}

describe('aircraft aerodynamics', () => {
  it('has the lift curve of a wing: linear, then a stall that keeps some lift', () => {
    const w = cfg.surfaces[0]!;
    const lo = liftCoefficient(w, 0, 0);
    expect(lo.cl).toBeCloseTo(w.cl0, 5);
    expect(lo.stall).toBe(0);
    const aStall = (w.clMax - w.cl0) / w.clAlpha;
    expect(liftCoefficient(w, aStall - 0.01, 0).stall).toBe(0);
    const deep = liftCoefficient(w, aStall + 0.2, 0);
    expect(deep.stall).toBe(1);
    expect(deep.cl).toBeLessThan(w.clMax);
    expect(deep.cl).toBeGreaterThan(0.5);
    // Flaps add lift and let the wing reach a higher coefficient before it stalls (at a lower angle).
    const aFlap = (w.clMax + 0.4 - w.cl0 - 0.5) / w.clAlpha;
    const flapped = liftCoefficient(w, aFlap - 0.001, 0.5, 0.4);
    expect(flapped.stall).toBe(0);
    expect(flapped.cl).toBeGreaterThan(w.clMax + 0.35);
    expect(aFlap).toBeLessThan(aStall);
    expect(airDensity(0)).toBeCloseTo(1.225, 3);
    expect(airDensity(3000)).toBeLessThan(0.95);
  });

  it('is built from the model: 13.4 m2 of wing, a centre of mass over the wing, 15 % on the nose wheel', async () => {
    const { ac, step } = await setup();
    const wing = cfg.surfaces.filter((s) => s.part.startsWith('wing')).reduce((a, s) => a + s.area, 0);
    expect(wing).toBeGreaterThan(13);
    expect(wing).toBeLessThan(14);
    expect(ac.mass).toBeGreaterThan(1400);
    expect(ac.mass).toBeLessThan(1600);
    const com = ac.body.localCom();
    expect(Math.abs(com.z)).toBeLessThan(0.1);
    for (let i = 0; i < 240; i++) step();
    const loads = ac.wheels.map((w) => w.load);
    const share = loads[0]! / loads.reduce((a, b) => a + b, 0);
    expect(share).toBeGreaterThan(0.1);
    expect(share).toBeLessThan(0.25);
    expect(ac.state.g).toBeCloseTo(1, 1);
    // Standing on its wheels at the model's rest height.
    expect(ac.body.translation().y).toBeCloseTo(1.15, 1);
  });
});

describe('aircraft flight', () => {
  it('takes off like an SR22: flaps 50 %, full power, rotate at 66 kt, airborne within 400 m', async () => {
    const { ac, input, step, time } = await setup();
    for (let i = 0; i < 240; i++) step();
    input.throttle = 1;
    input.flaps = 0.5;
    let liftoff = -1;
    while (time() < 60 && ac.body.translation().y < 60) {
      if (ac.state.airspeed > 34) pilot(ac, input, 0.14);
      step();
      if (liftoff < 0 && ac.wheels.every((w) => !w.contact) && ac.state.airspeed > 30) liftoff = ac.body.translation().z;
    }
    console.log(`liftoff after ${liftoff.toFixed(0)} m, 60 m reached at ${time().toFixed(1)} s, ${(ac.state.airspeed * KT).toFixed(0)} kt`);
    expect(liftoff).toBeGreaterThan(200);
    expect(liftoff).toBeLessThan(400);
    expect(ac.body.translation().y).toBeGreaterThanOrEqual(60);
    expect(partsOff(ac)).toEqual([]);
    // Climbing out at full power, flaps up: 5-8 m/s (1000-1600 ft/min).
    input.flaps = 0;
    for (let i = 0; i < 120 * 25; i++) {
      pilot(ac, input, 0.1);
      step();
    }
    console.log(`climb ${ac.state.vs.toFixed(1)} m/s at ${(ac.state.airspeed * KT).toFixed(0)} kt`);
    expect(ac.state.vs).toBeGreaterThan(4);
    expect(ac.state.vs).toBeLessThan(9);
  }, 60_000);

  it('cruises at 75 % power near 160 kt and holds its altitude hands off (auto-trim)', async () => {
    const { ac, input, step } = await cruising();
    for (let i = 0; i < 120 * 60; i++) {
      const target = clamp(0.02 + (250 - ac.body.translation().y) * 0.004 - ac.state.vs * 0.02, -0.15, 0.2);
      pilot(ac, input, target);
      step();
    }
    const v = ac.state.airspeed * KT;
    console.log(`cruise ${v.toFixed(0)} kt`);
    expect(v).toBeGreaterThan(145);
    expect(v).toBeLessThan(180);
    const y0 = ac.body.translation().y;
    input.pitch = 0;
    input.roll = 0;
    for (let i = 0; i < 120 * 20; i++) step();
    const dy = ac.body.translation().y - y0;
    console.log(`hands off 20 s: ${dy.toFixed(1)} m, bank ${(rollOf(ac) * 57.3).toFixed(1)} deg`);
    expect(Math.abs(dy)).toBeLessThan(40);
    expect(Math.abs(rollOf(ac))).toBeLessThan(0.15);
  }, 60_000);

  it('stalls clean near 66 kt, sounds the warning first, and drops its nose', async () => {
    const { ac, input, step } = await cruising();
    input.throttle = 0;
    const y0 = ac.body.translation().y;
    let warnV = -1;
    let stallV = -1;
    let noseDrop = false;
    let after = 0;
    for (let i = 0; i < 120 * 150; i++) {
      if (stallV < 0) pilot(ac, input, clamp(0.05 + (y0 - ac.body.translation().y) * 0.01 + i * 0.00002, -0.1, 0.45));
      else {
        input.pitch = 1;
        input.roll = clamp(-rollOf(ac) * 3, -1, 1);
      }
      step();
      if (warnV < 0 && ac.state.stallMargin < 0.035) warnV = ac.state.airspeed;
      if (stallV < 0 && ac.state.stall > 0.5) stallV = ac.state.airspeed;
      if (stallV > 0 && rate(ac, new THREE.Vector3(1, 0, 0)) > 0.15) noseDrop = true;
      if (stallV > 0 && ++after > 120 * 4) break;
    }
    console.log(`stall warning ${(warnV * KT).toFixed(0)} kt, stall ${(stallV * KT).toFixed(0)} kt`);
    expect(stallV * KT).toBeGreaterThan(58);
    expect(stallV * KT).toBeLessThan(75);
    expect(warnV).toBeGreaterThan(stallV);
    expect(noseDrop).toBe(true);
  }, 60_000);

  it('lands on a 3 degree approach with full flaps: gentle touchdown, stops within 400 m, nothing broken', async () => {
    const { ac, input, step } = await setup(80, -1500);
    input.flaps = 1;
    ac.controls.flaps = 1;
    ac.body.setLinvel({ x: 0, y: -2.1, z: 40 }, true);
    let touch = NaN;
    let sink = 0;
    let stop = NaN;
    let landed = false;
    for (let i = 0; i < 120 * 120; i++) {
      const s = ac.state;
      const p = ac.body.translation();
      if (!landed) {
        const agl = s.agl - 1.0;
        const flare = agl < 6;
        const vsTarget = flare ? -0.4 - agl * 0.12 : -Math.tan(0.0524) * s.airspeed + (-p.z * 0.0524 - (p.y - 1.0)) * 0.05;
        input.throttle = flare ? 0 : clamp(0.35 + (36 - s.airspeed) * 0.08, 0, 1);
        pilot(ac, input, clamp(0.03 + (vsTarget - s.vs) * 0.06 + (flare ? 0.06 : 0), -0.12, 0.2));
        const v = ac.body.linvel().y;
        step();
        if (ac.wheels.some((w) => w.contact)) {
          landed = true;
          touch = ac.body.translation().z;
          sink = -v;
        }
      } else {
        Object.assign(input, { throttle: 0, pitch: 0, roll: 0, brake: 1 });
        step();
        if (ac.state.airspeed < 0.5) {
          stop = ac.body.translation().z;
          break;
        }
      }
    }
    console.log(`touchdown sink ${sink.toFixed(2)} m/s, ground roll ${(stop - touch).toFixed(0)} m`);
    expect(sink).toBeLessThan(2);
    expect(stop - touch).toBeGreaterThan(100);
    expect(stop - touch).toBeLessThan(400);
    expect(partsOff(ac)).toEqual([]);
  }, 60_000);
});

describe('aircraft damage', () => {
  it('folds a wing when pulled hard at high speed', async () => {
    const { ac, input, step } = await setup(600);
    const breaks: string[] = [];
    let wingBody: unknown = null;
    ac.onBreak = (e) => {
      breaks.push(`${e.part}:${e.reason}`);
      if (e.part.startsWith('wing')) wingBody = e.body;
    };
    ac.body.setLinvel({ x: 0, y: 0, z: 108 }, true);
    input.throttle = 1;
    input.pitch = 1;
    let g = 0;
    for (let i = 0; i < 240 && !breaks.length; i++) {
      step();
      g = Math.max(g, ac.state.g);
    }
    console.log(`broke at ${g.toFixed(1)} g: ${breaks.join(', ')}`);
    expect(breaks.some((b) => b.startsWith('wing') && b.endsWith('overload'))).toBe(true);
    expect(g).toBeGreaterThan(cfg.limits.wingG);
    expect(wingBody).not.toBeNull();
  });

  it('rolls hard towards a wing that is gone', async () => {
    const { ac, input, step } = await cruising();
    input.pitch = 0;
    input.roll = 0;
    ac.detach('wingL', 'impact');
    for (let i = 0; i < 120; i++) step();
    // The left wing gone: the left side drops, the bank goes negative (left wing down).
    console.log(`bank after 1 s without the left wing: ${(rollOf(ac) * 57.3).toFixed(0)} deg`);
    expect(rollOf(ac)).toBeLessThan(-0.5);
    expect(ac.surfaces.filter((s) => s.def.part === 'wingL').every((s) => !s.on)).toBe(true);
    // Lighter by the wing.
    expect(ac.mass).toBeLessThan(1541 - 200);
  });

  it('collapses its gear on a hard landing and strikes the propeller', async () => {
    const { ac, input, step } = await setup(4);
    ac.body.setLinvel({ x: 0, y: -6, z: 35 }, true);
    input.throttle = 0.6;
    ac.controls.throttle = 0.6;
    const reasons: string[] = [];
    ac.onBreak = (e) => reasons.push(`${e.part}:${e.reason}`);
    for (let i = 0; i < 120 * 3; i++) step();
    console.log(`hard landing: ${reasons.join(', ')}`);
    expect(reasons.some((r) => r.startsWith('gear') && r.endsWith('landing'))).toBe(true);
  });

  it('takes impacts: enough of them tear a wing off; repair puts everything back', async () => {
    const { ac, step } = await setup();
    for (let i = 0; i < 60; i++) step();
    const handle = ac.parts.get('wingR')!.colliders[0]!.handle;
    // 20 kN for a quarter of a second (5 kN s) is a bump; another three quarters (15 kN s) tears it off.
    for (let i = 0; i < 30; i++) ac.contactForce(handle, 20000, FIXED_DT);
    expect(ac.parts.get('wingR')!.on).toBe(true);
    for (let i = 0; i < 90; i++) ac.contactForce(handle, 20000, FIXED_DT);
    expect(ac.parts.get('wingR')!.on).toBe(false);
    ac.repair();
    expect(partsOff(ac)).toEqual([]);
    expect(ac.surfaces.every((s) => s.on)).toBe(true);
  });
});

describe('boosted engine', () => {
  it('quadruples the power: faster in level flight than the stock engine', async () => {
    const top = async (boost: number): Promise<number> => {
      const { ac, input, step } = await setup(250);
      ac.boost = boost;
      ac.body.setLinvel({ x: 0, y: 0, z: 75 }, true);
      input.throttle = 1;
      ac.controls.throttle = 1;
      for (let i = 0; i < 120 * 60; i++) {
        pilot(ac, input, clamp(0.02 + (250 - ac.body.translation().y) * 0.004 - ac.state.vs * 0.02, -0.15, 0.2));
        step();
      }
      return ac.state.airspeed * KT;
    };
    const stock = await top(1);
    const boosted = await top(4);
    console.log(`full power: stock ${stock.toFixed(0)} kt, boosted ${boosted.toFixed(0)} kt`);
    expect(boosted).toBeGreaterThan(stock + 25);
  }, 60_000);
});

describe('arcade flight', () => {
  it('takes off with the stick held back, never stalls, and climbs', async () => {
    const { ac, input, step } = await setup();
    ac.assists.arcade = true;
    for (let i = 0; i < 240; i++) step();
    Object.assign(input, { throttle: 1, flaps: 0.5 });
    let maxStall = 0;
    let groundPitch = 0;
    for (let i = 0; i < 120 * 40; i++) {
      // A keyboard pilot: stick fully back from 60 kt, kept there until 60 m up.
      input.pitch = ac.state.airspeed > 31 && ac.state.agl < 60 ? 1 : 0;
      step();
      maxStall = Math.max(maxStall, ac.state.stall);
      if (ac.wheels.some((w) => w.contact)) groundPitch = Math.max(groundPitch, pitchOf(ac));
    }
    // No tail strike: the rotation stops short of 12 degrees on the wheels.
    expect(groundPitch).toBeLessThan(0.2);
    console.log(`arcade: ${ac.body.translation().y.toFixed(0)} m, ${(ac.state.airspeed * KT).toFixed(0)} kt, pitch ${(pitchOf(ac) * 57.3).toFixed(0)} deg`);
    expect(maxStall).toBe(0);
    expect(ac.body.translation().y).toBeGreaterThan(50);
    expect(partsOff(ac)).toEqual([]);
  }, 60_000);

  it('levels its wings when the roll is let go, holds the attitude, and a full pull at 210 kt breaks nothing', async () => {
    const { ac, input, step } = await setup(400);
    ac.assists.arcade = true;
    ac.body.setLinvel({ x: 0, y: 0, z: 75 }, true);
    Object.assign(input, { throttle: 0.75 });
    ac.controls.throttle = 0.75;
    for (let i = 0; i < 120 * 2; i++) step();
    input.roll = 1;
    for (let i = 0; i < 60; i++) step();
    const banked = rollOf(ac);
    input.roll = 0;
    for (let i = 0; i < 120 * 5; i++) step();
    console.log(`bank ${(banked * 57.3).toFixed(0)} deg, 5 s after letting go ${(rollOf(ac) * 57.3).toFixed(1)} deg`);
    expect(banked).toBeGreaterThan(0.4);
    expect(Math.abs(rollOf(ac))).toBeLessThan(0.08);
    // Hard pull at high speed.
    ac.body.setLinvel(new THREE.Vector3(0, 0, 108).applyQuaternion(ac.currQuat), true);
    input.pitch = 1;
    let g = 0;
    for (let i = 0; i < 120 * 3; i++) {
      step();
      g = Math.max(g, ac.state.g);
    }
    console.log(`full pull at 210 kt: ${g.toFixed(1)} g`);
    expect(partsOff(ac)).toEqual([]);
  }, 60_000);
});

describe('arcade flight with the boosted engine', () => {
  it('takes off and climbs with S held, and a full pull at top speed breaks nothing', async () => {
    const { ac, input, step } = await setup();
    ac.assists.arcade = true;
    ac.boost = 4;
    for (let i = 0; i < 240; i++) step();
    Object.assign(input, { throttle: 1, flaps: 0.5 });
    let groundPitch = 0;
    let liftoff = -1;
    for (let i = 0; i < 120 * 20; i++) {
      input.pitch = ac.state.airspeed > 31 && ac.state.agl < 150 ? 1 : 0;
      step();
      if (ac.wheels.some((w) => w.contact)) groundPitch = Math.max(groundPitch, pitchOf(ac));
      else if (liftoff < 0) liftoff = ac.body.translation().z;
    }
    expect(groundPitch).toBeLessThan(0.2);
    expect(ac.body.translation().y).toBeGreaterThan(100);
    // Level at full power until it is fast, then pull as hard as the keys allow.
    input.flaps = 0;
    for (let i = 0; i < 120 * 40; i++) {
      input.pitch = clamp((ac.body.translation().y > 300 ? -0.3 : 0.3) - ac.state.vs * 0.05, -1, 1);
      step();
    }
    const v = ac.state.airspeed * KT;
    input.pitch = 1;
    let g = 0;
    for (let i = 0; i < 120 * 3; i++) {
      step();
      g = Math.max(g, ac.state.g);
    }
    console.log(`boosted arcade: liftoff after ${liftoff.toFixed(0)} m, ${v.toFixed(0)} kt, full pull ${g.toFixed(1)} g`);
    expect(v).toBeGreaterThan(220);
    expect(partsOff(ac)).toEqual([]);
  }, 60_000);
});

describe('arcade flight: pushing the stick', () => {
  it('noses down and descends within a second and a half, even at full boosted power', async () => {
    const { ac, input, step } = await setup(400);
    ac.assists.arcade = true;
    ac.boost = 4;
    ac.body.setLinvel({ x: 0, y: 0, z: 85 }, true);
    input.throttle = 1;
    ac.controls.throttle = 1;
    for (let i = 0; i < 240; i++) step();
    // Z on an AZERTY keyboard (W on QWERTY): stick forward, ramping in like the keys do.
    for (let i = 0; i < 180; i++) {
      input.pitch = Math.max(-1, input.pitch - 2.2 / 120);
      step();
    }
    console.log(`after 1.5 s of stick forward: pitch ${(pitchOf(ac) * 57.3).toFixed(0)} deg, ${ac.state.vs.toFixed(0)} m/s`);
    expect(pitchOf(ac)).toBeLessThan(-0.25);
    expect(ac.state.vs).toBeLessThan(-15);
  });
});

describe('arcade flight: no structural failure from flying', () => {
  it('a minute of hard keyboard flying at full boosted power, dives past 600 km/h included, keeps both wings', async () => {
    const { ac, input, step } = await setup(600);
    ac.assists.arcade = true;
    ac.boost = 4;
    ac.body.setLinvel({ x: 0, y: 0, z: 100 }, true);
    input.throttle = 1;
    ac.controls.throttle = 1;
    let vmax = 0;
    const seq = [['roll', 1, 1.5], ['pitch', 1, 2], ['roll', -1, 2], ['pitch', -1, 1.5], ['pitch', 1, 3], ['roll', 1, 3], ['pitch', 1, 2], ['roll', -1, 1], ['pitch', -1, 2], ['pitch', 1, 2]] as const;
    for (let k = 0; k < 3; k++) {
      for (const [axis, val, dur] of seq) {
        for (let i = 0; i < dur * 120; i++) {
          const cur = input[axis];
          input[axis] = clamp(cur + Math.sign(val - cur) * (axis === 'pitch' ? 2.2 : 4) / 120, -1, 1);
          step();
          vmax = Math.max(vmax, ac.state.airspeed);
          // Keep it in the sky: this is about flying, not crashing.
          const p = ac.body.translation();
          if (p.y < 80) ac.body.setTranslation({ x: p.x, y: 600, z: p.z }, true);
        }
        input.pitch = 0;
        input.roll = 0;
      }
    }
    console.log(`hard flying: top speed ${(vmax * 3.6).toFixed(0)} km/h, parts off: ${partsOff(ac).join(',') || 'none'}`);
    expect(vmax * 3.6).toBeGreaterThan(500);
    expect(partsOff(ac)).toEqual([]);
  }, 60_000);
});
