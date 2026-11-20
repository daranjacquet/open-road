import * as THREE from 'three';
import { LAKE, lakeRadius, WATER_LEVEL } from './layout';

export interface Water {
  mesh: THREE.Mesh;
  /** Scroll the ripples. */
  update(seconds: number): void;
  /** True when (x, y, z) is under the lake surface. */
  isUnder(x: number, y: number, z: number): boolean;
}

function rippleNormals(size: number): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const waves = [
    [3, 1, 0.9, 0.3],
    [-2, 4, 0.6, 1.7],
    [5, -3, 0.4, 2.9],
    [1, 6, 0.3, 0.8],
  ];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let dx = 0;
      let dy = 0;
      for (const [kx, ky, a, p] of waves) {
        const ph = ((x * kx! + y * ky!) / size) * Math.PI * 2 + p!;
        const c = Math.cos(ph) * a!;
        dx += c * kx!;
        dy += c * ky!;
      }
      const nx = -dx * 0.05;
      const ny = -dy * 0.05;
      const l = Math.hypot(nx, ny, 1);
      const o = (y * size + x) * 4;
      data[o] = Math.round(((nx / l) * 0.5 + 0.5) * 255);
      data[o + 1] = Math.round(((ny / l) * 0.5 + 0.5) * 255);
      data[o + 2] = Math.round(((1 / l) * 0.5 + 0.5) * 255);
      data[o + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** The lake surface: a disc following the shore (a little past it), with scrolling ripples. */
export function createWater(): Water {
  const seg = 96;
  const pos: number[] = [LAKE.x, WATER_LEVEL, LAKE.z];
  const uv: number[] = [LAKE.x / 5, LAKE.z / 5];
  for (let k = 0; k <= seg; k++) {
    const a = (k / seg) * Math.PI * 2;
    const ex = LAKE.x + Math.cos(a) * 1000;
    const ez = LAKE.z + Math.sin(a) * 1000;
    const r = lakeRadius(ex, ez) + 40;
    const x = LAKE.x + Math.cos(a) * r;
    const z = LAKE.z + Math.sin(a) * r;
    pos.push(x, WATER_LEVEL, z);
    uv.push(x / 5, z / 5);
  }
  const idx: number[] = [];
  for (let k = 1; k <= seg; k++) idx.push(0, k + 1, k);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  const normalMap = rippleNormals(128);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x14343d,
    roughness: 0.16,
    metalness: 0.1,
    normalMap,
    normalScale: new THREE.Vector2(0.18, 0.18),
    envMapIntensity: 0.55,
    transparent: true,
    opacity: 0.92,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'lake';
  mesh.receiveShadow = true;
  mesh.renderOrder = 2;
  return {
    mesh,
    update(seconds) {
      normalMap.offset.set(seconds * 0.011, seconds * 0.007);
    },
    isUnder(x, y, z) {
      if (y > WATER_LEVEL) return false;
      const d = Math.hypot(x - LAKE.x, z - LAKE.z);
      return d < lakeRadius(x, z) + 10;
    },
  };
}
