import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import sport from '../src/vehicle/cars/sport.json';
import type { VehicleConfig } from '../src/vehicle/types';
import { buildCarModel } from '../src/render/car';

const cfg = sport as unknown as VehicleConfig;

describe('procedural sport coupe model', () => {
  const model = buildCarModel(cfg);

  it('exposes the named parts used for damage', () => {
    for (const n of ['body', 'hood', 'trunk', 'door_FL', 'door_FR', 'bumper_F', 'bumper_R', 'glass_front', 'glass_rear', 'glass_L', 'glass_R', 'light_FL', 'light_FR', 'light_RL', 'light_RR', 'mirror_L', 'mirror_R', 'interior']) {
      expect(model.parts.has(n), `missing part ${n}`).toBe(true);
    }
  });

  it('is dense enough to dent (20k to 45k triangles in the shell) and sized like a real car', () => {
    let tris = 0;
    const box = new THREE.Box3();
    const report: string[] = [];
    for (const [name, mesh] of model.parts) {
      const g = mesh.geometry;
      const t = (g.getIndex()?.count ?? 0) / 3;
      if (mesh.userData['rest']) tris += t;
      g.computeBoundingBox();
      const b = g.boundingBox!.clone().translate(mesh.position);
      box.union(b);
      report.push(`${name}: ${t} tris, size ${(b.max.x - b.min.x).toFixed(2)} x ${(b.max.y - b.min.y).toFixed(2)} x ${(b.max.z - b.min.z).toFixed(2)}`);
    }
    console.log(report.join('\n'));
    console.log('shell triangles:', tris, 'bounds', box.min.toArray().map((v) => v.toFixed(2)), box.max.toArray().map((v) => v.toFixed(2)));
    expect(tris).toBeGreaterThan(20000);
    expect(tris).toBeLessThan(45000);
    expect(box.max.z - box.min.z).toBeGreaterThan(4.2);
    expect(box.max.z - box.min.z).toBeLessThan(4.7);
    expect(box.max.x - box.min.x).toBeLessThan(2.2); // includes mirrors
    expect(box.max.y).toBeLessThan(0.8);
  });

  it('has a windshield and rear window with real surface area', () => {
    for (const n of ['glass_front', 'glass_rear', 'glass_L', 'glass_R']) {
      const tris = (model.parts.get(n)!.geometry.getIndex()?.count ?? 0) / 3;
      expect(tris, n).toBeGreaterThan(150);
    }
  });
});
