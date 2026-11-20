import * as THREE from 'three';
import { canvasTexture, StaticBatch } from './batch';
import type { Physics } from '../core/physics';

/** Floor-to-floor height of the car park (m). */
const LEVEL = 3.4;
const LEVELS = 3;

/**
 * A multi-storey car park you can drive up: three decks and a roof over a city block, joined by
 * stacked ramps along one side, with parapets, pillars and painted bays. Its floor is at `y0`.
 */
export function buildCarPark(physics: Physics, group: THREE.Group, x0: number, z0: number, x1: number, z1: number, y0: number): void {
  const b = new StaticBatch(physics);
  const concrete = new THREE.MeshStandardMaterial({ color: 0xa8a59e, roughness: 0.9 });
  const deck = new THREE.MeshStandardMaterial({ color: 0x6f7074, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -1 });
  const paint = new THREE.MeshStandardMaterial({ color: 0xf0f0ea, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -3 });
  const stripe = new THREE.MeshStandardMaterial({ color: 0xe0b020, roughness: 0.7 });
  const W = x1 - x0;
  const D = z1 - z0;
  // Ramp lane on the x0 side: 8 m wide, from z0 + 30 to z0 + 62 (10.6 % grade).
  const lane = 8;
  const r0 = z0 + 30;
  const r1 = z0 + 62;
  const t = 0.35;
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x7d7e81, roughness: 0.92 });
  const slab = (ax: number, az: number, bx: number, bz: number, y: number, mat: THREE.Material = floorMat): void => {
    b.box((ax + bx) / 2, y - t / 2, (az + bz) / 2, bx - ax, t, bz - az, mat);
  };
  for (let k = 1; k <= LEVELS; k++) {
    const y = y0 + k * LEVEL;
    // Deck with a hole over the ramp lane (where the ramp from below arrives).
    slab(x0 + lane, z0, x1, z1, y);
    slab(x0, z0, x0 + lane, r0, y);
    slab(x0, r1, x0 + lane, z1, y);
    // Parapets on the outer edges (open at the ramp lane).
    const ph = 1.0;
    b.box((x0 + x1) / 2, y + ph / 2, z0 + 0.2, W, ph, 0.4, concrete, 0, 0);
    b.box((x0 + x1) / 2, y + ph / 2, z1 - 0.2, W, ph, 0.4, concrete, 0, 0);
    b.box(x1 - 0.2, y + ph / 2, (z0 + z1) / 2, 0.4, ph, D, concrete, 0, 0);
    b.box(x0 + 0.2, y + ph / 2, (z0 + r0) / 2, 0.4, ph, r0 - z0, concrete, 0, 0);
    b.box(x0 + 0.2, y + ph / 2, (r1 + z1) / 2, 0.4, ph, z1 - r1, concrete, 0, 0);
    b.add(new THREE.BoxGeometry(W - lane, 0.12, 0.42), stripe, (x0 + lane + x1) / 2, y + ph + 0.06, z0 + 0.2, 0, 0, 0, false);
  }
  // Ramps: one per level, stacked in the lane, each a tilted slab from (r0, y) to (r1, y + LEVEL).
  const len = r1 - r0;
  const pitch = -Math.atan2(LEVEL, len);
  const rl = Math.hypot(LEVEL, len);
  for (let k = 0; k < LEVELS; k++) {
    const yMid = y0 + k * LEVEL + LEVEL / 2 - t / 2;
    b.box(x0 + lane / 2, yMid, (r0 + r1) / 2, lane - 0.4, t, rl, deck, 0, 0, true, pitch);
  }
  // Pillars every 16 m over the main deck area.
  for (let x = x0 + lane + 8; x < x1 - 4; x += 16) {
    for (let z = z0 + 10; z < z1 - 4; z += 16) {
      b.box(x, y0 + (LEVELS * LEVEL) / 2, z, 0.6, LEVELS * LEVEL, 0.6, concrete);
    }
  }
  // Bays painted on every floor (rows along x, facing the aisles).
  for (let k = 0; k <= LEVELS; k++) {
    const y = y0 + k * LEVEL + 0.02;
    for (const zr of [z0 + 6, z0 + 34, z0 + 62, z0 + 90]) {
      if (zr + 5 > z1) continue;
      for (let x = x0 + lane + 3; x < x1 - 2; x += 2.7) {
        const g = new THREE.PlaneGeometry(0.12, 5).rotateX(-Math.PI / 2);
        b.add(g, paint, x, y, zr, 0, 0, 0, false);
      }
    }
  }
  // Ground-floor deck colour (the block's pavement is under it).
  const floor = new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2);
  b.add(floor, deck, (x0 + x1) / 2, y0 + 0.01, (z0 + z1) / 2, 0, 0, 0, false);
  // A sign on the roof.
  const sign = canvasTexture(256, 64, (g) => {
    g.fillStyle = '#1d5fb8';
    g.fillRect(0, 0, 256, 64);
    g.fillStyle = '#fff';
    g.font = 'bold 44px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('P  PARKING', 128, 34);
  });
  const signMat = new THREE.MeshStandardMaterial({ map: sign, roughness: 0.5, emissive: 0xffffff, emissiveMap: sign, emissiveIntensity: 0.25 });
  const top = y0 + LEVELS * LEVEL;
  b.add(new THREE.PlaneGeometry(12, 3), signMat, (x0 + x1) / 2, top + 4, z0 - 0.3, Math.PI);
  b.add(new THREE.BoxGeometry(12.2, 3.2, 0.3), concrete, (x0 + x1) / 2, top + 4, z0, 0, 0, 0, true);
  b.box((x0 + x1) / 2 - 5, top + 1.25, z0 + 0.2, 0.3, 2.5, 0.3, concrete);
  b.box((x0 + x1) / 2 + 5, top + 1.25, z0 + 0.2, 0.3, 2.5, 0.3, concrete);
  b.build(group);
}

/** The central square: a fountain with a basin you can crash into, benches, flower beds. */
export function buildPlaza(physics: Physics, group: THREE.Group, cx: number, cz: number, y0: number): void {
  const b = new StaticBatch(physics);
  const stone = new THREE.MeshStandardMaterial({ color: 0xc9c3b6, roughness: 0.8 });
  const water = new THREE.MeshStandardMaterial({ color: 0x2f6b85, roughness: 0.08, metalness: 0.2 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x7a5634, roughness: 0.8 });
  const green = new THREE.MeshStandardMaterial({ color: 0x3f6e33, roughness: 1 });
  // Fountain: basin wall, water, column with a bowl.
  b.add(new THREE.CylinderGeometry(9, 9.3, 0.8, 32, 1, true), stone, cx, y0 + 0.4, cz, 0, 0, 0, true);
  b.add(new THREE.RingGeometry(8.4, 9.2, 32).rotateX(-Math.PI / 2), stone, cx, y0 + 0.8, cz, 0, 0, 0, false);
  b.add(new THREE.CircleGeometry(8.5, 32).rotateX(-Math.PI / 2), water, cx, y0 + 0.6, cz, 0, 0, 0, false);
  b.collideCylinder(cx, y0 + 0.4, cz, 0.4, 9.2);
  b.add(new THREE.CylinderGeometry(0.8, 1.1, 4.2, 12), stone, cx, y0 + 2.1, cz);
  b.add(new THREE.CylinderGeometry(2.6, 0.9, 0.7, 16), stone, cx, y0 + 4.4, cz);
  b.add(new THREE.CircleGeometry(2.4, 16).rotateX(-Math.PI / 2), water, cx, y0 + 4.76, cz, 0, 0, 0, false);
  b.collideCylinder(cx, y0 + 2.4, cz, 2.4, 1.2);
  // Benches facing the fountain, flower beds at the corners.
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    const x = cx + Math.cos(a) * 15;
    const z = cz + Math.sin(a) * 15;
    const yaw = Math.atan2(cx - x, cz - z);
    b.add(new THREE.BoxGeometry(2.2, 0.12, 0.6), wood, x, y0 + 0.5, z, yaw, 0, 0, true);
    b.add(new THREE.BoxGeometry(2.2, 0.5, 0.1), wood, x - Math.sin(yaw) * 0.3, y0 + 0.8, z - Math.cos(yaw) * 0.3, yaw);
  }
  for (const [ox, oz] of [[-30, -32], [30, -32], [-30, 32], [30, 32]] as const) {
    b.box(cx + ox, y0 + 0.25, cz + oz, 12, 0.5, 10, stone);
    b.add(new THREE.BoxGeometry(11.4, 0.1, 9.4), green, cx + ox, y0 + 0.52, cz + oz, 0, 0, 0, false);
  }
  b.build(group);
}
