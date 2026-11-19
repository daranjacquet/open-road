import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { DeformableMeshData } from '../src/render/carModel';
import { loadModels } from './helpers/models';
import { crash } from './helpers/crash';

beforeAll(loadModels);

/** Displacement of the body surface along +Z at a few heights across the nose (m). */
function noseProfile(r: Awaited<ReturnType<typeof crash>>): number[] {
  const out: number[] = [];
  for (const x of [-0.6, -0.3, 0, 0.3, 0.6]) out.push(r.car.deformer.sample(x, 0.0, 2.1));
  return out;
}

describe('crash damage (Blender cars, deformation field)', () => {
  it('parking knocks: 8 km/h leaves no mark, 15 km/h only a small dent, on every car', async () => {
    for (const id of ['sedan', 'offroad', 'supercar'] as const) {
      const slow = await crash(id, 8);
      expect(slow.frontCrush).toBe(0);
      expect(slow.car.deformer.maxDisplacement('bumper_F')).toBe(0);
      const tap = await crash(id, 15);
      console.log(id, '15:', tap.frontCrush.toFixed(3), 'crush', tap.car.deformer.maxDisplacement('bumper_F').toFixed(3), 'visual');
      expect(tap.frontCrush).toBeLessThan(0.05);
      expect(tap.car.deformer.maxDisplacement('bumper_F')).toBeLessThan(0.07);
      expect(tap.car.parts.brokenParts()).toEqual([]);
      expect(tap.car.parts.ajarParts()).toEqual({});
    }
  });

  it('20 km/h: light dents only, nothing broken, engine fine', async () => {
    const r = await crash('sedan', 20);
    console.log('20', r.car.parts.brokenParts(), r.car.parts.ajarParts(), 'engine', r.car.damage.engine.toFixed(2));
    expect(r.car.parts.brokenParts()).toEqual([]);
    expect(r.car.vehicle.powerScale).toBeGreaterThan(0.9);
    expect(r.car.deformer.maxDisplacement('bumper_F')).toBeGreaterThan(0.02);
    expect(r.car.deformer.maxDisplacement('bumper_F')).toBeLessThan(0.12);
  });

  it('the car takes the imprint of what it hits: a pole dents the centre far more than the corners', async () => {
    const r = await crash('sedan', 50, 'pole', 0);
    const p = noseProfile(r);
    console.log('pole profile', p.map((v) => v.toFixed(2)).join(' '), 'imprints', r.car.deformer.imprints);
    expect(r.car.deformer.imprints).toBeGreaterThan(10);
    expect(p[2]!).toBeGreaterThan(0.25);
    expect(p[2]!).toBeGreaterThan(p[0]! * 2.5);
    expect(p[2]!).toBeGreaterThan(p[4]! * 2.5);
  });

  it('a wall flattens the whole nose evenly', async () => {
    const r = await crash('sedan', 60);
    const p = noseProfile(r);
    console.log('wall profile', p.map((v) => v.toFixed(2)).join(' '));
    const min = Math.min(...p.slice(1, 4));
    const max = Math.max(...p.slice(1, 4));
    expect(min).toBeGreaterThan(0.12);
    expect(max / min).toBeLessThan(2.2);
  });

  it('crumples: compressed panels fold rather than just shrink (bonnet surface is no longer smooth)', async () => {
    const r = await crash('sedan', 70);
    const hood = r.car.model.meshes.find((m) => (m.userData as DeformableMeshData).part === 'hood' && (m.material as THREE.Material).name === 'paint')!;
    const pos = hood.geometry.getAttribute('position').array as Float32Array;
    const rest = (hood.userData as DeformableMeshData).rest;
    // Vertical displacement relative to rest along the centre line of the bonnet.
    let up = 0;
    let down = 0;
    for (let i = 0; i < rest.length; i += 3) {
      if (Math.abs(rest[i]!) > 0.1) continue;
      const dy = pos[i + 1]! - rest[i + 1]!;
      up = Math.max(up, dy);
      down = Math.min(down, dy);
    }
    console.log('bonnet fold up', up.toFixed(3), 'down', down.toFixed(3), 'broken', r.car.parts.brokenParts(), 'ajar', r.car.parts.ajarParts());
    expect(up).toBeGreaterThan(0.01);
  });

  it('100 km/h: front wrecked, bumper off, engine dead, drivability degraded', async () => {
    const r = await crash('sedan', 100);
    console.log('100', r.car.parts.brokenParts(), r.car.parts.ajarParts(), 'engine', r.car.damage.engine.toFixed(2), 'power', r.car.vehicle.powerScale.toFixed(2));
    expect(r.car.parts.brokenParts()).toContain('bumper_F');
    expect(r.car.damage.engine).toBeGreaterThan(0.8);
    expect(r.car.vehicle.powerScale).toBeLessThan(0.5);
    expect(Math.abs(r.car.vehicle.wheels[0]!.steerBias)).toBeGreaterThan(0.02);
  });

  it('is deterministic and repairs to a pristine car', async () => {
    const a = await crash('supercar', 70);
    const b = await crash('supercar', 70);
    expect(b.car.parts.brokenParts()).toEqual(a.car.parts.brokenParts());
    expect(b.car.crush.energy).toBeCloseTo(a.car.crush.energy, 2);
    a.car.repair();
    expect(a.car.vehicle.powerScale).toBe(1);
    expect(a.car.parts.brokenParts()).toEqual([]);
    expect(a.car.deformer.maxDisplacement('bumper_F')).toBe(0);
  });

  it('every car survives a 80 km/h crash with sensible numbers', async () => {
    for (const id of ['offroad', 'supercar'] as const) {
      const r = await crash(id, 80);
      const pos = r.car.vehicle.body.translation();
      console.log(id, '80:', r.frontCrush.toFixed(2), 'm,', r.energyKJ.toFixed(0), 'kJ, broken', r.car.parts.brokenParts());
      expect(Number.isFinite(pos.x + pos.y + pos.z)).toBe(true);
      expect(r.energyKJ).toBeGreaterThan(100);
    }
  });
});
