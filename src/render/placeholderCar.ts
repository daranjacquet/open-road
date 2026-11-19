import * as THREE from 'three';
import type { VehicleConfig } from '../vehicle/types';
import type { CarModel, WheelNodes } from './carModel';

/** Box-and-cylinder stand-in used until the real car model (milestone 3) is wired in. */
export function buildPlaceholderCar(cfg: VehicleConfig): CarModel {
  const root = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: 0xc8261a, roughness: 0.35, metalness: 0.4 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1b2430, roughness: 0.1, metalness: 0.6 });
  const tire = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 });
  const rim = new THREE.MeshStandardMaterial({ color: 0xbfc4cc, roughness: 0.3, metalness: 0.9 });
  const parts = new Map<string, THREE.Mesh>();

  const col = cfg.colliders;
  const bodyC = col[0]!;
  const body = new THREE.Mesh(new THREE.BoxGeometry(bodyC.half[0] * 2, bodyC.half[1] * 2, bodyC.half[2] * 2), paint);
  body.position.set(...bodyC.center);
  body.castShadow = true;
  root.add(body);
  parts.set('body', body);
  const cabC = col[1]!;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(cabC.half[0] * 2, cabC.half[1] * 2, cabC.half[2] * 2), glass);
  cabin.position.set(...cabC.center);
  cabin.castShadow = true;
  root.add(cabin);

  const R = cfg.wheel.radius;
  const W = cfg.wheel.width;
  const mk = (): WheelNodes => {
    const pivot = new THREE.Group();
    const spin = new THREE.Group();
    const t = new THREE.Mesh(new THREE.CylinderGeometry(R, R, W, 28), tire);
    t.rotation.z = Math.PI / 2;
    t.castShadow = true;
    const r = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.62, R * 0.62, W * 1.02, 12), rim);
    r.rotation.z = Math.PI / 2;
    // A visible spoke so wheel rotation is readable.
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(W * 1.05, R * 1.1, R * 0.12), rim);
    spin.add(t, r, spoke);
    pivot.add(spin);
    root.add(pivot);
    return { pivot, spin };
  };
  const wheels: CarModel['wheels'] = [mk(), mk(), mk(), mk()];

  return {
    root,
    wheels,
    parts,
    dispose() {
      root.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
      paint.dispose();
      glass.dispose();
      tire.dispose();
      rim.dispose();
    },
  };
}
