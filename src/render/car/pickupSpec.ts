import * as THREE from 'three';
import type { CarBodySpec } from './generator';

/** Full-size pickup: tall cab, long hood, flat bed. Chassis frame: +Y up, +Z forward, +X left. 5.3 m x 2.0 m x 1.7 m. */
export const pickupSpec: CarBodySpec = {
  zMin: -2.65,
  zMax: 2.65,
  paint: 0xd8d4c8,
  yb: [
    [-2.65, -0.42],
    [-2.4, -0.5],
    [2.2, -0.5],
    [2.65, -0.4],
  ],
  belt: [
    [-2.65, 0.3],
    [-2.5, 0.38],
    [-0.5, 0.4],
    [-0.3, 0.4],
    [0.9, 0.4],
    [1.0, 0.36],
    [1.9, 0.33],
    [2.65, 0.16],
  ],
  top: [
    [-2.65, 0.3],
    [-2.5, 0.38],
    [-0.5, 0.4],
    [-0.42, 0.62],
    [-0.3, 0.95],
    [-0.15, 1.0],
    [0.3, 1.0],
    [0.5, 0.88],
    [0.8, 0.55],
    [0.98, 0.4],
    [1.2, 0.35],
    [1.9, 0.33],
    [2.4, 0.28],
    [2.65, 0.18],
  ],
  halfWidth: [
    [-2.65, 0.9],
    [-2.4, 1.0],
    [1.9, 1.0],
    [2.4, 0.96],
    [2.65, 0.84],
  ],
  roofHalfWidth: [
    [-2.65, 0.8],
    [-0.5, 0.82],
    [-0.4, 0.8],
    [-0.2, 0.78],
    [0.4, 0.8],
    [0.9, 0.9],
    [2.65, 0.78],
  ],
  crown: [
    [-2.65, 0],
    [-0.5, 0.01],
    [1.0, 0.015],
    [2.65, 0],
  ],
  arches: [
    { z: 1.75, y: -0.33, r: 0.5 },
    { z: -1.45, y: -0.33, r: 0.5 },
  ],
  classify(f) {
    const ax = Math.abs(f.cx);
    const left = f.cx > 0;
    if (f.cz > 2.38 || (f.cz > 2.05 && f.cy < -0.3)) return 'bumper_F';
    if (f.cz < -2.5 || (f.cz < -2.1 && f.cy < -0.4)) return 'bumper_R';
    if (f.cz > 0.45 && f.cz < 1.0 && ax < 0.66 && f.nz > 0.2 && f.ny > 0.3 && f.cy > 0.42) return 'glass_front';
    if (f.cz < -0.18 && f.cz > -0.46 && ax < 0.6 && f.nz < -0.2 && f.cy > 0.5) return 'glass_rear';
    if (ax > 0.58 && f.cz > -0.2 && f.cz < 0.85 && f.cy > 0.46 && f.cy < 0.95) return left ? 'glass_L' : 'glass_R';
    if (ax > 0.58 && f.cz > -0.25 && f.cz < 0.9 && f.cy > -0.35 && f.cy < 0.46) return left ? 'door_FL' : 'door_FR';
    if (f.cz > 1.02 && f.cz < 2.38 && f.cy > 0.2 && ax < 0.92 && f.ny > 0.5) return 'hood';
    if (f.cz < -0.55 && f.cz > -2.45 && f.cy > 0.28 && ax < 0.92 && f.ny > 0.5) return 'trunk';
    return 'body';
  },
  pivots: {
    body: [0, 0, 0],
    hood: [0, 0.38, 1.02],
    trunk: [0, 0.4, -0.55],
    door_FL: [1.0, 0.1, 0.9],
    door_FR: [-1.0, 0.1, 0.9],
    bumper_F: [0, -0.1, 2.5],
    bumper_R: [0, -0.1, -2.5],
  },
  interior: { center: [0, 0.35, 0.2], half: [0.62, 0.45, 0.62] },
  mirrors: [
    [1.06, 0.62, 0.7],
    [-1.06, 0.62, 0.7],
  ],
  attach: {
    light_FL: 'bumper_F',
    light_FR: 'bumper_F',
    grille: 'bumper_F',
    light_RL: 'bumper_R',
    light_RR: 'bumper_R',
    exhaust_0: 'bumper_R',
    mirror_L: 'door_FL',
    mirror_R: 'door_FR',
  },
  extras(root, mats, parts) {
    const headGeo = new THREE.BoxGeometry(0.36, 0.16, 0.1);
    const tailGeo = new THREE.BoxGeometry(0.14, 0.34, 0.08);
    const lights: [string, THREE.BufferGeometry, THREE.Material, number, number, number, number][] = [
      ['light_FL', headGeo, mats.headlight, 0.78, 0.2, 2.5, 0.2],
      ['light_FR', headGeo, mats.headlight, -0.78, 0.2, 2.5, -0.2],
      ['light_RL', tailGeo, mats.taillight, 0.86, 0.22, -2.62, -0.05],
      ['light_RR', tailGeo, mats.taillight, -0.86, 0.22, -2.62, 0.05],
    ];
    for (const [name, geo, mat, x, y, z, yaw] of lights) {
      const m = new THREE.Mesh(geo, mat);
      m.name = name;
      m.position.set(x, y, z);
      m.rotation.y = yaw;
      root.add(m);
      parts.set(name, m);
    }
    const grille = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.3, 0.06), mats.trim);
    grille.name = 'grille';
    grille.position.set(0, 0.12, 2.6);
    root.add(grille);
    const pipe = new THREE.CylinderGeometry(0.05, 0.05, 0.2, 12);
    pipe.rotateX(Math.PI / 2);
    const ex = new THREE.Mesh(pipe, mats.rim);
    ex.name = 'exhaust_0';
    ex.position.set(-0.7, -0.38, -2.6);
    root.add(ex);
  },
};
