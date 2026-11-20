import * as THREE from 'three';
import { canvasTexture, StaticBatch } from './batch';
import type { Heightmap } from './heightmap';
import type { Physics } from '../core/physics';

/** A direction sign at a junction: position, the way it faces, up to three lines of text. */
interface SignDef {
  x: number;
  z: number;
  /** Heading the board faces (towards the traffic that reads it). */
  yaw: number;
  lines: string[];
}

// Facing the traffic that reads them: yaw 0 faces +z (read by drivers heading -z), PI faces -z.
// Arrows are from the driver's seat: a driver heading +z has -x on the right.
const SIGNS: SignDef[] = [
  { x: 18, z: 838, yaw: Math.PI, lines: ['↑ Mountain pass', '↑ Summit viewpoint', '→ Forest road'] },
  { x: 866, z: -372, yaw: -Math.PI / 2, lines: ['↑ Petrol station', '↑ Lake village', '↑ Harbour'] },
  { x: 646, z: -862, yaw: 0, lines: ['↑ Airfield', '↑ Southern road'] },
  { x: -172, z: -126, yaw: Math.PI / 2, lines: ['↑ Quarry', '↑ Forest road'] },
  { x: 1104, z: -352, yaw: -Math.PI / 2, lines: ['→ Lake village', '→ Mountain pass', '← Airfield'] },
  { x: 640, z: -1192, yaw: 0, lines: ['↑ Airfield', '← Farm', '→ Lake village'] },
  { x: 32, z: 1070, yaw: Math.PI, lines: ['↑ Summit viewpoint', '→ Forest road'] },
  { x: -1296, z: -146, yaw: Math.PI / 2, lines: ['← Quarry', '← Forest road', '→ Southern road'] },
  { x: -640, z: -1330, yaw: Math.PI / 2, lines: ['→ Farm', '↑ Quarry', '↑ Forest road'] },
  { x: 534, z: 262, yaw: Math.PI, lines: ['↑ Rally stage', '(asphalt and gravel)'] },
  { x: -1404, z: -445, yaw: Math.PI, lines: ['→ Forest trail (4x4)', '↑ Quarry'] },
];

/** Green direction boards on posts at the main junctions, all drawn from one texture atlas. */
export function buildSigns(physics: Physics, hm: Heightmap, group: THREE.Group): void {
  const cols = 4;
  const rows = Math.ceil(SIGNS.length / cols);
  const w = 256;
  const h = 128;
  const atlas = canvasTexture(
    w * cols,
    h * rows,
    (g) => {
      SIGNS.forEach((s, k) => {
        const x = (k % cols) * w;
        const y = Math.floor(k / cols) * h;
        g.fillStyle = '#0f6b3a';
        g.fillRect(x, y, w, h);
        g.strokeStyle = '#f2f2f2';
        g.lineWidth = 5;
        g.strokeRect(x + 6, y + 6, w - 12, h - 12);
        g.fillStyle = '#ffffff';
        g.font = 'bold 26px system-ui, sans-serif';
        g.textBaseline = 'middle';
        const lh = (h - 24) / s.lines.length;
        s.lines.forEach((t, i) => g.fillText(t, x + 18, y + 12 + lh * (i + 0.5)));
      });
    },
    false,
  );
  const board = new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.6 });
  const post = new THREE.MeshStandardMaterial({ color: 0x8d9298, roughness: 0.4, metalness: 0.6 });
  const b = new StaticBatch(physics);
  SIGNS.forEach((s, k) => {
    const y = hm.heightAt(s.x, s.z);
    const u0 = (k % cols) / cols;
    const v1 = 1 - Math.floor(k / cols) / rows;
    const g = new THREE.PlaneGeometry(2.6, 1.3);
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) / cols, v1 - (1 - uv.getY(i)) / rows);
    b.add(g, board, s.x, y + 2.6, s.z, s.yaw);
    // The back of the board, and two posts.
    b.add(new THREE.BoxGeometry(2.62, 1.32, 0.04), post, s.x - Math.sin(s.yaw) * 0.03, y + 2.6, s.z - Math.cos(s.yaw) * 0.03, s.yaw);
    for (const side of [-0.9, 0.9]) {
      const px = s.x + Math.cos(s.yaw) * side - Math.sin(s.yaw) * 0.06;
      const pz = s.z - Math.sin(s.yaw) * side - Math.cos(s.yaw) * 0.06;
      b.add(new THREE.CylinderGeometry(0.05, 0.05, 3.2, 6), post, px, y + 1.6, pz);
    }
    b.collideBox(s.x, y + 1.6, s.z, 1.3, 1.6, 0.1, s.yaw);
  });
  b.build(group);
}
