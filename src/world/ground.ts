import * as THREE from 'three';
import type { Physics } from '../core/physics';
import type { Surface } from '../core/physics';
import { ASPHALT, DIRT, type SurfaceMap } from './surface';

export type { Surface } from '../core/physics';

export { SURFACE_GRIP } from '../core/physics';

export interface AsphaltZone {
  cx: number;
  cz: number;
  hx: number;
  hz: number;
}

/** Axis-aligned asphalt patches (test pads, drag strip). Everything else is grass. */
export const asphaltZones: AsphaltZone[] = [
  { cx: 0, cz: 0, hx: 160, hz: 160 }, // big test pad
  { cx: 0, cz: 520, hx: 14, hz: 340 }, // long straight road
];
export const dirtZones: AsphaltZone[] = [{ cx: -260, cz: 60, hx: 90, hz: 120 }];

/**
 * Surface lookup for the test area (zones), with an optional painted raster (roads, circuits,
 * city) on top. `createGround` installs it on the physics world.
 */
export function surfaceLookup(raster: SurfaceMap | null): (x: number, z: number) => Surface {
  return (x, z) => {
    for (const a of asphaltZones) {
      if (Math.abs(x - a.cx) <= a.hx && Math.abs(z - a.cz) <= a.hz) return 'asphalt';
    }
    if (raster) {
      const c = raster.get(x, z);
      if (c === ASPHALT) return 'asphalt';
      if (c === DIRT) return 'dirt';
    }
    for (const d of dirtZones) {
      if (Math.abs(x - d.cx) <= d.hx && Math.abs(z - d.cz) <= d.hz) return 'dirt';
    }
    return 'grass';
  };
}

export function tileTexture(draw: (g: CanvasRenderingContext2D, s: number) => void, size = 256): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function noiseFill(g: CanvasRenderingContext2D, s: number, base: [number, number, number], amp: number): void {
  const img = g.createImageData(s, s);
  for (let i = 0; i < s * s; i++) {
    const n = (Math.random() - 0.5) * amp;
    img.data[i * 4] = base[0] + n;
    img.data[i * 4 + 1] = base[1] + n;
    img.data[i * 4 + 2] = base[2] + n;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}

export interface Ground {
  group: THREE.Group;
}

/**
 * Test-area markings on the flat ground: asphalt pads, the drag strip, the dirt patch and the lane
 * dashes. The ground itself (shape and collider) is the terrain built by the map.
 */
export function createGround(physics: Physics): Ground {
  physics.surfaceAt = surfaceLookup(null);
  const group = new THREE.Group();
  group.name = 'ground';

  // Asphalt patches (decals slightly above the base).
  const asphaltTex = tileTexture((g, s) => {
    noiseFill(g, s, [96, 98, 104], 24);
    g.strokeStyle = 'rgba(0,0,0,0.12)';
    g.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
      g.beginPath();
      g.moveTo(Math.random() * s, 0);
      g.lineTo(Math.random() * s, s);
      g.stroke();
    }
  });
  const asphaltMat = new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.92, metalness: 0 });
  for (const z of asphaltZones) {
    const m = asphaltMat.clone();
    m.map = asphaltTex.clone();
    m.map.needsUpdate = true;
    m.map.repeat.set((z.hx * 2) / 5, (z.hz * 2) / 5);
    m.polygonOffset = true;
    m.polygonOffsetFactor = -2;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(z.hx * 2, z.hz * 2), m);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(z.cx, 0.01, z.cz);
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  const dirtTex = tileTexture((g, s) => {
    noiseFill(g, s, [128, 98, 66], 44);
  });
  for (const z of dirtZones) {
    const t = dirtTex.clone();
    t.needsUpdate = true;
    t.repeat.set((z.hx * 2) / 4, (z.hz * 2) / 4);
    const m = new THREE.MeshStandardMaterial({ map: t, roughness: 1 });
    m.polygonOffset = true;
    m.polygonOffsetFactor = -2;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(z.hx * 2, z.hz * 2), m);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(z.cx, 0.012, z.cz);
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // Lane markings on the straight road.
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xe8e2c8 });
  lineMat.polygonOffset = true;
  lineMat.polygonOffsetFactor = -4;
  const road = asphaltZones[1]!;
  for (let z = road.cz - road.hz + 10; z < road.cz + road.hz - 10; z += 12) {
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 5), lineMat);
    dash.rotation.x = -Math.PI / 2;
    dash.position.set(road.cx, 0.02, z);
    group.add(dash);
  }

  return { group };
}
