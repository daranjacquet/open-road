import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CARS } from '../src/game/catalog';
import { buildCarModel } from '../src/render/car';
import { parseCarGLB, registerCarTemplate } from '../src/render/car/glb';
import { buildCrushRays } from '../src/damage/rays';
import { Deformer } from '../src/damage/Deformer';
import { FIXED_DT, GROUP, groups } from '../src/core/physics';
import { makeSim } from './helpers/sim';

function bytes(id: string): ArrayBuffer {
  const b = readFileSync(new URL(`../public/models/${id}.glb`, import.meta.url));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

describe('Blender-exported cars (GLB)', () => {
  for (const def of CARS) {
    describe(def.id, () => {
      it('loads, has the same panels and triangle counts as the procedural model, in the chassis frame', async () => {
        const scene = await parseCarGLB(bytes(def.id));
        registerCarTemplate(def.id, scene);
        const glb = buildCarModel(def.cfg, def.body, undefined, def.id);
        const proc = buildCarModel(def.cfg, def.body);
        for (const [name, mesh] of proc.parts) {
          const g = glb.parts.get(name);
          expect(g, `GLB missing part ${name}`).toBeDefined();
          if (mesh.userData['rest']) {
            expect((g!.geometry.getIndex()?.count ?? 0) / 3, `${name} triangles`).toBe((mesh.geometry.getIndex()?.count ?? 0) / 3);
            expect(g!.position.distanceTo(mesh.position), `${name} pivot`).toBeLessThan(1e-4);
          }
        }
        // Bounds of the shell match (length along +Z, width along X, height along Y).
        const box = new THREE.Box3();
        for (const [, m] of glb.parts) {
          if (!m.userData['rest']) continue;
          m.geometry.computeBoundingBox();
          box.union(m.geometry.boundingBox!.clone().translate(m.position));
        }
        const box2 = new THREE.Box3();
        for (const [, m] of proc.parts) {
          if (!m.userData['rest']) continue;
          m.geometry.computeBoundingBox();
          box2.union(m.geometry.boundingBox!.clone().translate(m.position));
        }
        for (const k of ['x', 'y', 'z'] as const) {
          expect(box.min[k]).toBeCloseTo(box2.min[k], 2);
          expect(box.max[k]).toBeCloseTo(box2.max[k], 2);
        }
        expect(glb.wheels).toHaveLength(4);
        for (const w of glb.wheels) expect(w.spin.children.length).toBe(3);
      });

      it('gives dentable geometry with vertex colours and normals, owned per car instance', () => {
        const a = buildCarModel(def.cfg, def.body, undefined, def.id);
        const b = buildCarModel(def.cfg, def.body, 0x3355aa, def.id);
        const ha = a.parts.get('hood')!;
        const hb = b.parts.get('hood')!;
        expect(ha.geometry).not.toBe(hb.geometry);
        expect(ha.geometry.getAttribute('color')).toBeDefined();
        expect(ha.geometry.getAttribute('normal')).toBeDefined();
        expect(ha.userData['rest']).toBeInstanceOf(Float32Array);
      });

      it('yields a usable crumple-ray set', () => {
        const rays = buildCrushRays(def.cfg, buildCarModel(def.cfg, def.body, undefined, def.id));
        const proc = buildCrushRays(def.cfg, buildCarModel(def.cfg, def.body));
        expect(Math.abs(rays.length - proc.length)).toBeLessThanOrEqual(3);
      });
    });
  }

  it('a 100 km/h wall crash with the GLB sport car dents the nose like the procedural one', async () => {
    const def = CARS[0]!;
    registerCarTemplate(def.id, await parseCarGLB(bytes(def.id)));
    const model = buildCarModel(def.cfg, def.body, undefined, def.id);
    const rays = buildCrushRays(def.cfg, model);
    const { physics, car } = await makeSim(def.cfg, 0, 0, 0);
    const { RAPIER, world } = physics;
    const wb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 3, 151.5));
    world.createCollider(RAPIER.ColliderDesc.cuboid(40, 3, 1.5).setCollisionGroups(groups(GROUP.WORLD, 0xffff)), wb);
    car.assists.esp = false;
    const crush = car.attachCrush(rays);
    const deformer = new Deformer(crush, model.parts);
    const input = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
    let hit = false;
    for (let i = 0; i < 120 * 25; i++) {
      input.throttle = !hit && car.speedKmh < 100 ? 1 : 0;
      car.fixedUpdate(FIXED_DT, input);
      physics.step();
      car.afterPhysicsStep();
      if (i % 2 === 0) deformer.update(i * 8);
      if (crush.active > 0) hit = true;
    }
    deformer.update(1e9);
    expect(crush.energy / 1000).toBeGreaterThan(300);
    expect(deformer.maxDisplacement('bumper_F')).toBeGreaterThan(0.4);
  });
});
