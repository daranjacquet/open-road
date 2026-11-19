import * as THREE from 'three';
import type { CarBodySpec } from './generator';

/** Three-door city hatchback. Chassis frame: +Y up, +Z forward, +X left. About 3.96 m x 1.72 m x 1.42 m. */
export const hatchSpec: CarBodySpec = {
  zMin: -1.98,
  zMax: 1.98,
  paint: 0x2f8f5b,
  yb: [
    [-1.98, -0.28],
    [-1.8, -0.33],
    [-1.4, -0.35],
    [1.3, -0.35],
    [1.8, -0.32],
    [1.98, -0.26],
  ],
  belt: [
    [-1.98, 0.18],
    [-1.8, 0.28],
    [-1.0, 0.3],
    [0.4, 0.3],
    [0.8, 0.26],
    [1.2, 0.2],
    [1.98, 0.06],
  ],
  top: [
    [-1.98, 0.2],
    [-1.85, 0.3],
    [-1.78, 0.5],
    [-1.6, 0.8],
    [-1.35, 0.9],
    [-0.2, 0.93],
    [0.1, 0.9],
    [0.4, 0.6],
    [0.65, 0.3],
    [0.9, 0.24],
    [1.4, 0.17],
    [1.98, 0.08],
  ],
  halfWidth: [
    [-1.98, 0.72],
    [-1.8, 0.82],
    [-1.2, 0.86],
    [0.9, 0.86],
    [1.6, 0.84],
    [1.98, 0.72],
  ],
  roofHalfWidth: [
    [-1.98, 0.6],
    [-1.7, 0.7],
    [-1.5, 0.66],
    [-1.2, 0.66],
    [0.2, 0.66],
    [0.5, 0.7],
    [0.9, 0.74],
    [1.98, 0.6],
  ],
  crown: [
    [-1.98, 0],
    [-1.6, 0.01],
    [0.4, 0.005],
    [1.0, 0.015],
    [1.98, 0],
  ],
  arches: [
    { z: 1.2, y: -0.2, r: 0.38 },
    { z: -1.3, y: -0.2, r: 0.38 },
  ],
  classify(f) {
    const ax = Math.abs(f.cx);
    const left = f.cx > 0;
    if (f.cz > 1.78 || (f.cz > 1.5 && f.cy < -0.2)) return 'bumper_F';
    if (f.cz < -1.8 || (f.cz < -1.5 && f.cy < -0.2)) return 'bumper_R';
    if (f.cz > 0.0 && f.cz < 0.72 && ax < 0.55 && f.nz > 0.2 && f.ny > 0.3 && f.cy > 0.28) return 'glass_front';
    if (f.cz < -1.3 && f.cz > -1.75 && ax < 0.55 && f.nz < -0.15 && f.cy > 0.4) return 'glass_rear';
    if (ax > 0.52 && f.cz > -1.35 && f.cz < 0.4 && f.cy > 0.33 && f.cy < 0.86) return left ? 'glass_L' : 'glass_R';
    if (ax > 0.52 && f.cz > -0.65 && f.cz < 0.52 && f.cy > -0.28 && f.cy < 0.33) return left ? 'door_FL' : 'door_FR';
    if (f.cz > 0.8 && f.cz < 1.78 && f.cy > 0.08 && ax < 0.76 && f.ny > 0.5) return 'hood';
    if (f.cz < -1.4 && f.cz > -1.78 && f.cy > 0.3 && ax < 0.76) return 'trunk';
    return 'body';
  },
  pivots: {
    body: [0, 0, 0],
    hood: [0, 0.24, 0.82],
    trunk: [0, 0.9, -1.4],
    door_FL: [0.88, 0.1, 0.52],
    door_FR: [-0.88, 0.1, 0.52],
    bumper_F: [0, -0.12, 1.85],
    bumper_R: [0, -0.12, -1.85],
  },
  interior: { center: [0, 0.2, -0.45], half: [0.5, 0.34, 0.85] },
  mirrors: [
    [0.93, 0.42, 0.36],
    [-0.93, 0.42, 0.36],
  ],
  attach: {
    light_FL: 'bumper_F',
    light_FR: 'bumper_F',
    light_RL: 'bumper_R',
    light_RR: 'bumper_R',
    exhaust_0: 'bumper_R',
    mirror_L: 'door_FL',
    mirror_R: 'door_FR',
  },
  extras(root, mats, parts) {
    const pipe = new THREE.CylinderGeometry(0.04, 0.04, 0.14, 12);
    pipe.rotateX(Math.PI / 2);
    const ex = new THREE.Mesh(pipe, mats.rim);
    ex.name = 'exhaust_0';
    ex.position.set(0.42, -0.3, -1.95);
    root.add(ex);
    const headGeo = new THREE.BoxGeometry(0.3, 0.12, 0.08);
    const tailGeo = new THREE.BoxGeometry(0.1, 0.3, 0.06);
    const lights: [string, THREE.BufferGeometry, THREE.Material, number, number, number, number][] = [
      ['light_FL', headGeo, mats.headlight, 0.58, 0.09, 1.9, 0.35],
      ['light_FR', headGeo, mats.headlight, -0.58, 0.09, 1.9, -0.35],
      ['light_RL', tailGeo, mats.taillight, 0.7, 0.4, -1.86, -0.1],
      ['light_RR', tailGeo, mats.taillight, -0.7, 0.4, -1.86, 0.1],
    ];
    for (const [name, geo, mat, x, y, z, yaw] of lights) {
      const m = new THREE.Mesh(geo, mat);
      m.name = name;
      m.position.set(x, y, z);
      m.rotation.y = yaw;
      root.add(m);
      parts.set(name, m);
    }
  },
};
