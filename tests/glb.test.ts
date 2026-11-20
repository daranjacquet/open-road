import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CARS } from '../src/game/catalog';
import { buildCarModel } from '../src/render/car';
import { buildCrushRays } from '../src/damage/rays';
import type { DeformableMeshData } from '../src/render/carModel';
import { loadModels } from './helpers/models';

beforeAll(loadModels);

const NEEDED = ['body', 'hood', 'trunk', 'door_FL', 'door_FR', 'bumper_F', 'bumper_R', 'glass_front', 'light_FL', 'light_FR', 'light_RL', 'light_RR', 'mirror_L', 'mirror_R'];

describe('Blender cars (GLB)', () => {
  for (const def of CARS) {
    describe(def.id, () => {
      it('has the named parts the damage system needs', () => {
        const m = buildCarModel(def.id);
        for (const n of NEEDED) expect(m.parts.has(n), `${def.id} missing ${n}`).toBe(true);
        expect([...m.parts.keys()].some((n) => n.startsWith('glass_F'))).toBe(true);
      });

      it('is in the chassis frame, sized like the physics, with wheels and a detailed body', () => {
        const m = buildCarModel(def.id);
        const box = new THREE.Box3();
        let tris = 0;
        m.root.updateMatrixWorld(true);
        for (const mesh of m.meshes) {
          mesh.geometry.computeBoundingBox();
          box.union(mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld));
          tris += (mesh.geometry.getIndex()?.count ?? 0) / 3;
        }
        const size = box.getSize(new THREE.Vector3());
        console.log(def.id, 'size', size.toArray().map((v) => v.toFixed(2)).join(' x '), 'body tris', tris);
        // The car points along +Z: longer than wide, wheels inside the length.
        expect(size.z).toBeGreaterThan(4.2);
        expect(size.z).toBeLessThan(5.6);
        expect(size.x).toBeGreaterThan(1.8);
        expect(size.x).toBeLessThan(2.4);
        expect(tris).toBeGreaterThan(12000); // hand-made models: detail from shape and textures, not triangles
        expect(tris).toBeLessThan(120000);
        // Outline box of the physics fits the visual body within a few centimetres.
        const o = def.cfg.outline[0]!;
        expect(Math.abs(o.center[2] + o.half[2] - box.max.z)).toBeLessThan(0.12);
        for (const w of m.wheels) expect(w.spin.children.length).toBeGreaterThanOrEqual(1);
      });

      it('has wheels that spin true (axle along X, round, centred on the hub)', () => {
        const m = buildCarModel(def.id);
        for (const w of m.wheels) {
          for (const mesh of w.spin.children as THREE.Mesh[]) {
            const p = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
            // Spread of the wheel's vertices along each axis (about their mean): least along the axle.
            const n = p.count;
            let mx = 0;
            let my = 0;
            let mz = 0;
            for (let i = 0; i < n; i++) {
              mx += p.getX(i) / n;
              my += p.getY(i) / n;
              mz += p.getZ(i) / n;
            }
            let sx = 0;
            let sy = 0;
            let sz = 0;
            let sxy = 0;
            let sxz = 0;
            for (let i = 0; i < n; i++) {
              const x = p.getX(i) - mx;
              const y = p.getY(i) - my;
              const z = p.getZ(i) - mz;
              sx += x * x;
              sy += y * y;
              sz += z * z;
              sxy += x * y;
              sxz += x * z;
            }
            // Correlation of x with y or z means a leaning wheel (it would wobble when spinning).
            const lean = (Math.max(Math.abs(sxy) / sy, Math.abs(sxz) / sz) * 180) / Math.PI;
            expect(lean, `${def.id} ${mesh.name} leans`).toBeLessThan(0.3);
            mesh.geometry.computeBoundingBox();
            const bb = mesh.geometry.boundingBox!;
            expect(Math.abs(bb.max.y - bb.max.z - (bb.min.z - bb.min.y)), `${def.id} ${mesh.name} round`).toBeLessThan(0.004);
            expect(Math.abs(bb.max.y + bb.min.y), `${def.id} ${mesh.name} centred`).toBeLessThan(0.004);
            expect(sx).toBeLessThan(Math.min(sy, sz));
          }
        }
      });

      it('gives every car instance its own deformable geometry with rest data', () => {
        const a = buildCarModel(def.id);
        const b = buildCarModel(def.id, 0x3355aa);
        const ha = a.meshes.find((m) => (m.userData as DeformableMeshData).part === 'hood')!;
        const hb = b.meshes.find((m) => (m.userData as DeformableMeshData).part === 'hood')!;
        expect(ha.geometry).not.toBe(hb.geometry);
        expect((ha.userData as DeformableMeshData).rest).toBeInstanceOf(Float32Array);
        expect((ha.geometry.getAttribute('position').array as Float32Array)).toBeInstanceOf(Float32Array);
      });

      it('hangs each door window in its door', () => {
        const m = buildCarModel(def.id);
        for (const [name, node] of m.parts) {
          const side = /^glass_([FR][LR])$/.exec(name)?.[1];
          if (side && m.parts.has(`door_${side}`) && !(def.id === 'offroad' && side.startsWith('R'))) expect(node.parent?.name, name).toBe(`door_${side}`);
        }
        expect(m.parts.get('glass_FL')!.parent!.name).toBe('door_FL');
        if (def.id === 'offroad') expect(m.parts.get('glass_RL')!.parent!.name).not.toMatch(/^door_/);
        expect(m.parts.get('glass_front')!.parent!.name).not.toMatch(/^door_/);
      });

      it('yields a crumple-ray set that covers every side', () => {
        const rays = buildCrushRays(def.cfg, buildCarModel(def.id));
        const kinds = new Set(rays.map((r) => r.kind));
        for (const k of ['front', 'rear', 'left', 'right', 'roof'] as const) expect(kinds.has(k), `${def.id} no ${k}`).toBe(true);
        expect(rays.length).toBeGreaterThan(90);
        for (const r of rays) expect(r.length).toBeLessThan(1.1);
      });
    });
  }
});
