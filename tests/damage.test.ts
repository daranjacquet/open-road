import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import sport from '../src/vehicle/cars/sport.json';
import type { VehicleConfig } from '../src/vehicle/types';
import { FIXED_DT, GROUP, groups } from '../src/core/physics';
import { buildCarModel } from '../src/render/car';
import { buildCrushRays } from '../src/damage/rays';
import { Deformer } from '../src/damage/Deformer';
import { DamageModel } from '../src/damage/DamageModel';
import { PartsManager } from '../src/damage/PartsManager';
import { makeSim } from './helpers/sim';

const cfg = sport as unknown as VehicleConfig;

async function crashAt(kmh: number, offset = 0) {
  const model = buildCarModel(cfg);
  const rays = buildCrushRays(cfg, model);
  const { physics, car } = await makeSim(cfg, offset, 0, 0);
  const { RAPIER, world } = physics;
  const wb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 3, 151.5));
  world.createCollider(RAPIER.ColliderDesc.cuboid(40, 3, 1.5).setCollisionGroups(groups(GROUP.WORLD, 0xffff)), wb);
  car.assists.esp = false;
  const crush = car.attachCrush(rays);
  const scene = new THREE.Scene();
  scene.add(model.root);
  const deformer = new Deformer(crush, model.parts);
  const damage = new DamageModel(car, crush);
  const parts = new PartsManager(physics, scene, car, model, crush, deformer, damage);
  const input = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
  let hit = false;
  let tHit = 0;
  for (let i = 0; i < 120 * 40; i++) {
    const t = i * FIXED_DT;
    input.throttle = !hit && car.speedKmh < kmh ? 1 : 0;
    car.fixedUpdate(FIXED_DT, input);
    physics.step();
    car.afterPhysicsStep();
    if (i % 2 === 0) {
      damage.update();
      deformer.update(t * 1000);
      parts.update();
    }
    if (!hit && crush.active > 0) {
      hit = true;
      tHit = t;
    }
    if (hit && t - tHit > 2.5) break;
  }
  damage.update();
  deformer.update(1e9);
  parts.update();
  const broken = parts['parts'].filter((p) => p.broken).map((p) => p.rule.name);
  const ajar = parts['parts'].filter((p) => p.ajar > 0 && !p.broken).map((p) => `${p.rule.name}:${p.ajar.toFixed(2)}`);
  return { car, crush, damage, deformer, parts, broken, ajar, model };
}

describe('crash outcomes (headless)', () => {
  it('20 km/h: light dents only, car fully drivable', async () => {
    const r = await crashAt(20);
    console.log('20 km/h', JSON.stringify({ broken: r.broken, ajar: r.ajar, engine: r.damage.engine.toFixed(2), power: r.car.powerScale.toFixed(2), bumperDisp: r.deformer.maxDisplacement('bumper_F').toFixed(2) }));
    expect(r.broken.filter((n) => !n.startsWith('light'))).toEqual([]);
    expect(r.car.powerScale).toBeGreaterThan(0.95);
    expect(r.deformer.maxDisplacement('bumper_F')).toBeGreaterThan(0.02);
    expect(r.deformer.maxDisplacement('bumper_F')).toBeLessThan(0.2);
  });

  it('50 km/h: heavy front damage, bonnet pops, bumper hangs on, car still moves', async () => {
    const r = await crashAt(50);
    console.log('50 km/h', JSON.stringify({ broken: r.broken, ajar: r.ajar, engine: r.damage.engine.toFixed(2), power: r.car.powerScale.toFixed(2), wheels: r.damage.wheel.map((x) => +x.toFixed(2)) }));
    expect(r.car.powerScale).toBeLessThan(1);
    expect(r.car.powerScale).toBeGreaterThan(0.3);
    expect(r.broken).not.toContain('door_FL');
  });

  it('100 km/h: front wrecked, panels torn off, drivability degraded', async () => {
    const r = await crashAt(100);
    console.log('100 km/h', JSON.stringify({ broken: r.broken, ajar: r.ajar, engine: r.damage.engine.toFixed(2), power: r.car.powerScale.toFixed(2), wheels: r.damage.wheel.map((x) => +x.toFixed(2)), flat: r.car.wheels.map((w) => w.flat), steerBias: r.car.wheels.map((w) => +w.steerBias.toFixed(3)) }));
    expect(r.broken).toContain('bumper_F');
    expect(r.ajar.some((a) => a.startsWith('hood')) || r.broken.includes('hood')).toBe(true);
    expect(r.damage.engine).toBeGreaterThan(0.8);
    expect(r.car.powerScale).toBeLessThan(0.5);
    expect(Math.abs(r.car.wheels[0]!.steerBias)).toBeGreaterThan(0.02);
  });

  it('is deterministic: the same crash gives the same damage', async () => {
    const a = await crashAt(70);
    const b = await crashAt(70);
    expect(b.broken).toEqual(a.broken);
    expect(b.crush.energy).toBeCloseTo(a.crush.energy, 3);
  });

  it('repair restores a pristine car', async () => {
    const r = await crashAt(100);
    r.parts.repair();
    r.crush.reset();
    r.deformer.reset();
    r.damage.reset();
    expect(r.car.powerScale).toBe(1);
    expect(r.parts['parts'].every((p) => !p.broken)).toBe(true);
    expect(r.deformer.maxDisplacement('bumper_F')).toBe(0);
    expect(r.car.wheels.every((w) => !w.detached && !w.flat)).toBe(true);
  });
});
