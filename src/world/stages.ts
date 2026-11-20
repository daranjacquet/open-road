import * as THREE from 'three';
import { canvasTexture, StaticBatch } from './batch';
import type { RoadLine } from './roadline';
import type { Physics } from '../core/physics';

/** A timed stage on a road: its line and the samples of the start and finish lines. */
export interface Stage {
  id: string;
  name: string;
  line: RoadLine;
  startI: number;
  finishI: number;
}

function bannerTexture(text: string, name: string): THREE.CanvasTexture {
  return canvasTexture(
    512,
    96,
    (g) => {
      // Chequered ends, the word in the middle.
      for (let y = 0; y < 2; y++) {
        for (let x = 0; x < 6; x++) {
          g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4';
          g.fillRect(x * 16, y * 48, 16, 48);
          g.fillRect(512 - 96 + x * 16, y * 48, 16, 48);
        }
      }
      g.fillStyle = text === 'START' ? '#1d7a3a' : '#b32020';
      g.fillRect(96, 0, 320, 96);
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = 'bold 44px system-ui, sans-serif';
      g.fillText(text, 256, 38);
      g.font = '600 18px system-ui, sans-serif';
      g.fillText(name.toUpperCase(), 256, 76);
    },
    false,
  );
}

/**
 * Start and finish gantries over every stage road (posts, a banner, a chequered line across the
 * road) and the stage descriptions the timer needs.
 */
export function buildStages(physics: Physics, roads: RoadLine[], group: THREE.Group): Stage[] {
  const stages: Stage[] = [];
  const post = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.6 });
  const checkerTex = canvasTexture(64, 16, (g) => {
    for (let y = 0; y < 2; y++) for (let x = 0; x < 8; x++) {
      g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4';
      g.fillRect(x * 8, y * 8, 8, 8);
    }
  });
  checkerTex.magFilter = THREE.NearestFilter;
  for (const road of roads) {
    const st = road.def.stage;
    if (!st) continue;
    const startI = Math.round(st.start * (road.n - 1));
    const finishI = Math.round(st.finish * (road.n - 1));
    stages.push({ id: road.def.id, name: st.name, line: road, startI, finishI });
    const b = new StaticBatch(physics);
    for (const [i, text] of [
      [startI, 'START'],
      [finishI, 'FINISH'],
    ] as const) {
      const x = road.x[i]!;
      const z = road.z[i]!;
      const y = road.y[i]!;
      const yaw = Math.atan2(road.tx[i]!, road.tz[i]!);
      const off = road.def.width / 2 + 2;
      for (const side of [-1, 1]) {
        const px = x + road.leftX(i) * off * side;
        const pz = z + road.leftZ(i) * off * side;
        b.box(px, y + 3, pz, 0.45, 6, 0.45, post, yaw);
      }
      const banner = new THREE.MeshStandardMaterial({ map: bannerTexture(text, st.name), roughness: 0.6 });
      const w = off * 2 + 0.45;
      // Both faces of the banner (a box textured on its front and back).
      b.add(new THREE.BoxGeometry(w, 1.3, 0.3), banner, x, y + 5.6, z, yaw);
      // Chequered line across the road, on its surface.
      const line = new THREE.MeshStandardMaterial({ map: checkerTex.clone(), roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -4 });
      line.map!.repeat.set(road.def.width / 2, 1);
      line.map!.wrapS = THREE.RepeatWrapping;
      line.map!.needsUpdate = true;
      b.add(new THREE.PlaneGeometry(road.def.width, 1.5).rotateX(-Math.PI / 2), line, x, y + 0.012, z, yaw, -Math.atan(road.slope(i)), 0, false);
    }
    b.build(group);
  }
  return stages;
}
