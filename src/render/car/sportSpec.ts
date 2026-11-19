import * as THREE from 'three';
import type { CarBodySpec } from './generator';

/** Two-door sport coupe, chassis frame: +Y up, +Z forward, +X left. Body shell 4.4 m x 1.84 m x ~1.1 m. */
export const sportSpec: CarBodySpec = {
  zMin: -2.2,
  zMax: 2.2,
  paint: 0xb3170d,
  yb: [
    [-2.2, -0.3],
    [-2.0, -0.37],
    [-1.5, -0.4],
    [1.5, -0.4],
    [2.0, -0.35],
    [2.2, -0.28],
  ],
  belt: [
    [-2.2, 0.18],
    [-1.9, 0.26],
    [-1.45, 0.3],
    [-0.9, 0.31],
    [0.5, 0.31],
    [0.8, 0.27],
    [1.0, 0.24],
    [1.7, 0.14],
    [2.2, 0.06],
  ],
  top: [
    [-2.2, 0.18],
    [-1.9, 0.26],
    [-1.62, 0.31],
    [-1.3, 0.46],
    [-1.0, 0.63],
    [-0.8, 0.7],
    [0.1, 0.7],
    [0.35, 0.62],
    [0.6, 0.42],
    [0.85, 0.28],
    [1.0, 0.25],
    [1.7, 0.15],
    [2.2, 0.07],
  ],
  halfWidth: [
    [-2.2, 0.74],
    [-2.0, 0.84],
    [-1.5, 0.9],
    [-0.5, 0.92],
    [0.8, 0.92],
    [1.6, 0.9],
    [2.0, 0.84],
    [2.2, 0.74],
  ],
  roofHalfWidth: [
    [-2.2, 0.6],
    [-1.6, 0.72],
    [-1.3, 0.62],
    [-1.0, 0.6],
    [0.1, 0.6],
    [0.35, 0.62],
    [0.7, 0.7],
    [0.95, 0.76],
    [2.2, 0.62],
  ],
  crown: [
    [-2.2, 0],
    [-1.6, 0.015],
    [-0.8, 0.005],
    [0.6, 0],
    [1.0, 0.02],
    [1.8, 0.012],
    [2.2, 0],
  ],
  arches: [
    { z: 1.36, y: -0.23, r: 0.4 },
    { z: -1.24, y: -0.23, r: 0.4 },
  ],
  classify(f) {
    const ax = Math.abs(f.cx);
    const left = f.cx > 0;
    if (f.cz > 1.88 || (f.cz > 1.62 && f.cy < -0.22)) return 'bumper_F';
    if (f.cz < -1.98 || (f.cz < -1.62 && f.cy < -0.22)) return 'bumper_R';
    // Glass
    if (f.cz > 0.18 && f.cz < 0.95 && ax < 0.52 && f.nz > 0.2 && f.ny > 0.3 && f.cy > 0.3) return 'glass_front';
    if (f.cz < -0.88 && f.cz > -1.55 && ax < 0.52 && f.nz < -0.25 && f.cy > 0.33) return 'glass_rear';
    if (ax > 0.5 && f.cz > -0.95 && f.cz < 0.62 && f.cy > 0.345 && f.cy < 0.66) return left ? 'glass_L' : 'glass_R';
    if (ax > 0.5 && f.cz > -0.62 && f.cz < 0.72 && f.cy > -0.28 && f.cy < 0.345) return left ? 'door_FL' : 'door_FR';
    if (f.cz > 0.9 && f.cz < 1.88 && f.cy > 0.1 && ax < 0.78 && f.ny > 0.5) return 'hood';
    if (f.cz < -1.45 && f.cz > -1.98 && f.cy > 0.15 && ax < 0.78 && f.ny > 0.5) return 'trunk';
    return 'body';
  },
  pivots: {
    body: [0, 0, 0],
    hood: [0, 0.26, 0.9],
    trunk: [0, 0.3, -1.45],
    door_FL: [0.92, 0.1, 0.72],
    door_FR: [-0.92, 0.1, 0.72],
    bumper_F: [0, -0.15, 2.0],
    bumper_R: [0, -0.15, -2.0],
  },
  interior: { center: [0, 0.16, -0.2], half: [0.5, 0.3, 0.72] },
  mirrors: [
    [0.99, 0.4, 0.5],
    [-0.99, 0.4, 0.5],
  ],
  extras(root, mats, parts) {
    const pipe = new THREE.CylinderGeometry(0.045, 0.045, 0.16, 14);
    pipe.rotateX(Math.PI / 2);
    for (const x of [0.5, -0.5, 0.36, -0.36]) {
      const m = new THREE.Mesh(pipe, mats.rim);
      m.position.set(x, -0.3, -2.17);
      root.add(m);
    }
    const wing = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.025, 0.28), mats.trim);
    wing.position.set(0, 0.4, -2.0);
    wing.castShadow = true;
    root.add(wing);
    for (const x of [0.55, -0.55]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.1, 0.08), mats.trim);
      post.position.set(x, 0.35, -1.98);
      root.add(post);
    }
    // Lights: small separate meshes so they can be broken independently.
    const headGeo = new THREE.BoxGeometry(0.32, 0.06, 0.1);
    const tailGeo = new THREE.BoxGeometry(0.4, 0.07, 0.06);
    const lights: [string, THREE.BufferGeometry, THREE.Material, number, number, number, number][] = [
      ['light_FL', headGeo, mats.headlight, 0.6, 0.065, 2.1, 0.3],
      ['light_FR', headGeo, mats.headlight, -0.6, 0.065, 2.1, -0.3],
      ['light_RL', tailGeo, mats.taillight, 0.58, 0.19, -2.12, -0.15],
      ['light_RR', tailGeo, mats.taillight, -0.58, 0.19, -2.12, 0.15],
    ];
    for (const [name, geo, mat, x, y, z, yaw] of lights) {
      const m = new THREE.Mesh(geo, mat);
      m.name = name;
      m.position.set(x, y, z);
      m.rotation.y = yaw;
      root.add(m);
      parts?.set(name, m);
    }
    // Front splitter.
    const splitter = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.015, 0.12), mats.trim);
    splitter.position.set(0, -0.375, 2.12);
    root.add(splitter);
  },
};
