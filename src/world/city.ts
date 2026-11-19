import * as THREE from 'three';
import { GROUP, groups, type Physics } from '../core/physics';
import { Furniture, local } from './furniture';
import { ASPHALT, type SurfaceMap } from './surface';

/** City grid: avenues run along z (at these x), streets along x (at these z). */
export const AVENUES = [300, 410, 520, 630, 740, 850];
export const STREETS = [-840, -720, -600, -480, -360, -240, -120, 0, 120, 240];
const ROAD = 14;
const HALF = ROAD / 2;
const WALK = 3;
const CURB = 0.12;
const CENTRE = { x: 575, z: -300 };

/** Deterministic random numbers (the city is the same on every load). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

type Facade = 'glass' | 'office' | 'brick' | 'concrete';
/** One texture tile = 4 windows x 4 floors = 16 m x 14 m. */
const TILE_W = 16;
const TILE_H = 14;

function facadeTexture(kind: Facade, seed: number): THREE.CanvasTexture {
  const r = rng(seed);
  return canvasTex(256, 224, (g) => {
    const wall = { glass: '#5b6c7d', office: '#cfc6b4', brick: '#8a4a36', concrete: '#a9a9a3' }[kind];
    g.fillStyle = wall;
    g.fillRect(0, 0, 256, 224);
    for (let fy = 0; fy < 4; fy++) {
      for (let wx = 0; wx < 4; wx++) {
        const x = wx * 64;
        const y = fy * 56;
        if (kind === 'glass') {
          const v = 70 + r() * 50;
          g.fillStyle = `rgb(${v * 0.75},${v * 0.95},${v * 1.25})`;
          g.fillRect(x + 2, y + 6, 60, 48);
          g.fillStyle = 'rgba(255,255,255,0.08)';
          g.fillRect(x + 2, y + 6, 60, 14);
        } else {
          const lit = r() < 0.12;
          const v = lit ? 190 + r() * 40 : 35 + r() * 30;
          g.fillStyle = lit ? `rgb(${v},${v * 0.92},${v * 0.7})` : `rgb(${v},${v * 1.05},${v * 1.15})`;
          const ww = kind === 'office' ? 48 : 32;
          g.fillRect(x + (64 - ww) / 2, y + 12, ww, 34);
          g.fillStyle = 'rgba(0,0,0,0.18)';
          g.fillRect(x + (64 - ww) / 2, y + 44, ww, 4);
        }
      }
      g.fillStyle = 'rgba(0,0,0,0.12)';
      g.fillRect(0, fy * 56, 256, 3);
    }
  });
}

/** Builds wall and roof geometry for many boxes, merged per material. */
class BoxBatch {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly uv: number[] = [];
  readonly idx: number[] = [];

  private quad(a: number[], b: number[], c: number[], d: number[], n: number[], uw: number, vh: number): void {
    const base = this.pos.length / 3;
    this.pos.push(...a, ...b, ...c, ...d);
    for (let k = 0; k < 4; k++) this.nor.push(...n);
    this.uv.push(0, 0, uw, 0, uw, vh, 0, vh);
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** Four walls, UVs in texture tiles so windows keep their size. */
  walls(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, tw: number, th: number, v0 = 0): void {
    const h = (y1 - y0) / th;
    const vb = v0;
    const quad = (a: number[], b: number[], c: number[], d: number[], n: number[], w: number): void => {
      const base = this.pos.length / 3;
      this.pos.push(...a, ...b, ...c, ...d);
      for (let k = 0; k < 4; k++) this.nor.push(...n);
      const uw = w / tw;
      this.uv.push(0, vb, uw, vb, uw, vb + h, 0, vb + h);
      this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], x1 - x0);
    quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], x1 - x0);
    quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], z1 - z0);
    quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], z1 - z0);
  }

  top(x0: number, x1: number, y: number, z0: number, z1: number, tile: number): void {
    this.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0], (x1 - x0) / tile, (z1 - z0) / tile);
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

export interface City {
  group: THREE.Group;
  furniture: Furniture;
  /** Advance the traffic-light cycle. */
  update(t: number): void;
}

function signTexture(draw: (g: CanvasRenderingContext2D) => void): THREE.MeshStandardMaterial {
  const t = canvasTex(128, 128, draw);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.5 });
}

export function createCity(physics: Physics, surface: SurfaceMap, asphaltMap: THREE.Texture): City {
  const { RAPIER, world } = physics;
  const group = new THREE.Group();
  group.name = 'city';
  const rand = rng(1234);
  const x0 = AVENUES[0]! - HALF;
  const x1 = AVENUES[AVENUES.length - 1]! + HALF;
  const z0 = STREETS[0]! - HALF;
  const z1 = STREETS[STREETS.length - 1]! + HALF;

  // ---- road surface: one asphalt plane under the whole grid, plus the road from the test area ----
  surface.fillRect(x0, z0, x1, z1, ASPHALT);
  surface.fillRect(160, -120 - HALF, x0, -120 + HALF, ASPHALT);
  const roadMat = new THREE.MeshStandardMaterial({ map: asphaltMap.clone(), color: 0x9a9da4, roughness: 0.92 });
  roadMat.map!.needsUpdate = true;
  roadMat.map!.repeat.set((x1 - x0) / 6, (z1 - z0) / 6);
  roadMat.polygonOffset = true;
  roadMat.polygonOffsetFactor = -2;
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2), roadMat);
  plane.position.set((x0 + x1) / 2, 0.015, (z0 + z1) / 2);
  plane.receiveShadow = true;
  group.add(plane);
  const linkMat = roadMat.clone();
  linkMat.map = asphaltMap.clone();
  linkMat.map.needsUpdate = true;
  linkMat.map.repeat.set((x0 - 160) / 6, ROAD / 6);
  const link = new THREE.Mesh(new THREE.PlaneGeometry(x0 - 160, ROAD).rotateX(-Math.PI / 2), linkMat);
  link.position.set((160 + x0) / 2, 0.015, -120);
  link.receiveShadow = true;
  group.add(link);

  // ---- road markings (instanced quads) ----
  const paintMat = new THREE.MeshStandardMaterial({ color: 0xeeeee6, roughness: 0.7 });
  paintMat.polygonOffset = true;
  paintMat.polygonOffsetFactor = -5;
  const marks: THREE.Matrix4[] = [];
  const mark = (cx: number, cz: number, w: number, l: number, alongZ: boolean): void => {
    marks.push(new THREE.Matrix4().compose(new THREE.Vector3(cx, 0.03, cz), new THREE.Quaternion(), new THREE.Vector3(alongZ ? w : l, 1, alongZ ? l : w)));
  };
  const segment = (fixed: number, a: number, b: number, alongZ: boolean): void => {
    // Centre dashes.
    for (let s = a + 6; s < b - 6; s += 9) {
      if (alongZ) mark(fixed, s + 1.5, 0.18, 3, true);
      else mark(s + 1.5, fixed, 0.18, 3, false);
    }
    // Zebra crossings and stop lines at both ends.
    for (const [end, dir] of [
      [a, 1],
      [b, -1],
    ] as const) {
      const band = end + dir * 2.2;
      for (let k = -HALF + 1; k <= HALF - 1; k += 1.4) {
        if (alongZ) mark(fixed + k, band, 0.6, 3.2, true);
        else mark(band, fixed + k, 0.6, 3.2, false);
      }
      // Stop line across the incoming lane (right-hand traffic).
      const stop = end + dir * 4.4;
      const lane = dir > 0 ? 1 : -1; // incoming lane side
      if (alongZ) mark(fixed + (lane * HALF) / 2, stop, HALF, 0.4, false);
      else mark(stop, fixed - (lane * HALF) / 2, HALF, 0.4, true);
    }
  };
  for (const ax of AVENUES) for (let j = 0; j < STREETS.length - 1; j++) segment(ax, STREETS[j]! + HALF, STREETS[j + 1]! - HALF, true);
  for (const sz of STREETS) for (let i = 0; i < AVENUES.length - 1; i++) segment(sz, AVENUES[i]! + HALF, AVENUES[i + 1]! - HALF, false);
  for (let s = 166; s < x0 - 4; s += 9) mark(s + 1.5, -120, 0.18, 3, false);
  const markMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), paintMat, marks.length);
  marks.forEach((m, i) => markMesh.setMatrixAt(i, m));
  markMesh.receiveShadow = true;
  group.add(markMesh);

  // ---- blocks: raised pavement, buildings, parks, car parks ----
  const pavement = new BoxBatch();
  const grass = new BoxBatch();
  const lots = new BoxBatch();
  const facades: Record<Facade, BoxBatch> = { glass: new BoxBatch(), office: new BoxBatch(), brick: new BoxBatch(), concrete: new BoxBatch() };
  const roofs = new BoxBatch();
  const staticBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const solid = (cx: number, cy: number, cz: number, hx: number, hy: number, hz: number): void => {
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(cx, cy, cz).setFriction(0.8).setCollisionGroups(groups(GROUP.WORLD, 0xffff)),
      staticBody,
    );
  };
  const trees: { x: number; z: number; s: number }[] = [];
  const stalls: THREE.Matrix4[] = [];

  for (let i = 0; i < AVENUES.length - 1; i++) {
    for (let j = 0; j < STREETS.length - 1; j++) {
      const bx0 = AVENUES[i]! + HALF;
      const bx1 = AVENUES[i + 1]! - HALF;
      const bz0 = STREETS[j]! + HALF;
      const bz1 = STREETS[j + 1]! - HALF;
      // Kerb and pavement: the whole block is a slab 12 cm high.
      pavement.top(bx0, bx1, CURB, bz0, bz1, 3);
      pavement.walls(bx0, bx1, 0, CURB, bz0, bz1, 3, 3);
      solid((bx0 + bx1) / 2, CURB / 2, (bz0 + bz1) / 2, (bx1 - bx0) / 2, CURB / 2, (bz1 - bz0) / 2);

      const lx0 = bx0 + WALK;
      const lx1 = bx1 - WALK;
      const lz0 = bz0 + WALK;
      const lz1 = bz1 - WALK;
      const cx = (bx0 + bx1) / 2;
      const cz = (bz0 + bz1) / 2;
      const d = Math.hypot(cx - CENTRE.x, cz - CENTRE.z);
      const r = rand();
      if (r < 0.1 && d > 150) {
        // Park.
        grass.top(lx0, lx1, CURB + 0.01, lz0, lz1, 4);
        const n = 10 + Math.floor(rand() * 8);
        for (let k = 0; k < n; k++) trees.push({ x: lx0 + 4 + rand() * (lx1 - lx0 - 8), z: lz0 + 4 + rand() * (lz1 - lz0 - 8), s: 0.8 + rand() * 0.6 });
        continue;
      }
      if (r < 0.18 && d > 120) {
        // Car park.
        lots.top(lx0, lx1, CURB + 0.01, lz0, lz1, 6);
        for (let row = 0; row < 3; row++) {
          const zr = lz0 + 12 + row * 32;
          for (let x = lx0 + 4; x < lx1 - 4; x += 2.6) {
            stalls.push(new THREE.Matrix4().compose(new THREE.Vector3(x, CURB + 0.03, zr), new THREE.Quaternion(), new THREE.Vector3(0.15, 1, 5)));
            stalls.push(new THREE.Matrix4().compose(new THREE.Vector3(x, CURB + 0.03, zr + 11), new THREE.Quaternion(), new THREE.Vector3(0.15, 1, 5)));
          }
        }
        continue;
      }
      // Buildings on a 2 or 3 x 2 or 3 split of the block.
      const nx = rand() < 0.5 ? 2 : 3;
      const nz = rand() < 0.5 ? 2 : 3;
      const hmax = THREE.MathUtils.lerp(110, 16, THREE.MathUtils.clamp(d / 420, 0, 1));
      for (let a = 0; a < nx; a++) {
        for (let b = 0; b < nz; b++) {
          const fx0 = lx0 + ((lx1 - lx0) * a) / nx + 1;
          const fx1 = lx0 + ((lx1 - lx0) * (a + 1)) / nx - 1;
          const fz0 = lz0 + ((lz1 - lz0) * b) / nz + 1;
          const fz1 = lz0 + ((lz1 - lz0) * (b + 1)) / nz - 1;
          if (rand() < 0.08) continue; // small plaza
          const floors = Math.max(3, Math.round((hmax * (0.35 + rand() * 0.65)) / 3.5));
          const h = floors * 3.5;
          const kind: Facade = h > 45 ? (rand() < 0.6 ? 'glass' : 'office') : rand() < 0.5 ? 'brick' : rand() < 0.5 ? 'concrete' : 'office';
          const y0 = CURB;
          facades[kind].walls(fx0, fx1, y0, y0 + h, fz0, fz1, TILE_W, TILE_H);
          roofs.top(fx0, fx1, y0 + h, fz0, fz1, 8);
          solid((fx0 + fx1) / 2, y0 + h / 2, (fz0 + fz1) / 2, (fx1 - fx0) / 2, h / 2, (fz1 - fz0) / 2);
          // Set-back tower on the tall ones.
          if (h > 40 && rand() < 0.55) {
            const ins = 3 + rand() * 3;
            const h2 = Math.round((h * (0.25 + rand() * 0.35)) / 3.5) * 3.5;
            facades[kind].walls(fx0 + ins, fx1 - ins, y0 + h, y0 + h + h2, fz0 + ins, fz1 - ins, TILE_W, TILE_H, h / TILE_H);
            roofs.top(fx0 + ins, fx1 - ins, y0 + h + h2, fz0 + ins, fz1 - ins, 8);
          }
        }
      }
    }
  }

  const pavTex = canvasTex(128, 128, (g) => {
    g.fillStyle = '#b9b6ae';
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = 'rgba(70,70,70,0.35)';
    g.lineWidth = 2;
    for (let k = 0; k <= 128; k += 64) {
      g.beginPath();
      g.moveTo(k, 0);
      g.lineTo(k, 128);
      g.moveTo(0, k);
      g.lineTo(128, k);
      g.stroke();
    }
  });
  const grassTex = canvasTex(128, 128, (g) => {
    g.fillStyle = '#4f7a3a';
    g.fillRect(0, 0, 128, 128);
    for (let k = 0; k < 400; k++) {
      g.fillStyle = Math.random() < 0.5 ? '#5d8a43' : '#436b31';
      g.fillRect(Math.random() * 128, Math.random() * 128, 3, 3);
    }
  });
  const add = (b: BoxBatch, mat: THREE.Material, cast: boolean): void => {
    if (b.pos.length === 0) return;
    const mesh = new THREE.Mesh(b.geometry(), mat);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    group.add(mesh);
  };
  add(pavement, new THREE.MeshStandardMaterial({ map: pavTex, roughness: 0.95 }), false);
  add(grass, new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1 }), false);
  add(lots, new THREE.MeshStandardMaterial({ map: asphaltMap, color: 0x8f9298, roughness: 0.95 }), false);
  let seed = 11;
  for (const kind of Object.keys(facades) as Facade[]) {
    const glass = kind === 'glass';
    add(facades[kind], new THREE.MeshStandardMaterial({ map: facadeTexture(kind, seed++), roughness: glass ? 0.25 : 0.85, metalness: glass ? 0.5 : 0 }), true);
  }
  add(roofs, new THREE.MeshStandardMaterial({ color: 0x5d5f63, roughness: 0.95 }), false);
  if (stalls.length) {
    const sm = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), paintMat, stalls.length);
    stalls.forEach((m, k) => sm.setMatrixAt(k, m));
    group.add(sm);
  }

  // ---- trees (static) ----
  const trunkMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.3, 3, 8), new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 1 }), trees.length);
  const crownMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(2.4, 1), new THREE.MeshStandardMaterial({ color: 0x3f6e33, roughness: 1, flatShading: true }), trees.length);
  trees.forEach((t, k) => {
    trunkMesh.setMatrixAt(k, new THREE.Matrix4().compose(new THREE.Vector3(t.x, CURB + 1.5 * t.s, t.z), new THREE.Quaternion(), new THREE.Vector3(t.s, t.s, t.s)));
    crownMesh.setMatrixAt(k, new THREE.Matrix4().compose(new THREE.Vector3(t.x, CURB + 4.2 * t.s, t.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.x), new THREE.Vector3(t.s, t.s * 1.1, t.s)));
    world.createCollider(
      RAPIER.ColliderDesc.cylinder(1.5 * t.s, 0.3 * t.s).setTranslation(t.x, CURB + 1.5 * t.s, t.z).setCollisionGroups(groups(GROUP.WORLD, 0xffff)),
      staticBody,
    );
  });
  for (const m of [trunkMesh, crownMesh]) {
    m.castShadow = true;
    group.add(m);
  }

  // ---- street furniture: lamps, traffic lights, stop and speed signs ----
  const fur = new Furniture();
  const metal = new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.5, metalness: 0.6 });
  fur.defineMesh('pole', new THREE.CylinderGeometry(0.08, 0.11, 1, 8).translate(0, 0.5, 0), metal);
  fur.defineMesh('arm', new THREE.BoxGeometry(0.08, 0.08, 1).translate(0, 0, 0.5), metal);
  fur.defineMesh('lamp', new THREE.BoxGeometry(0.35, 0.12, 0.7), new THREE.MeshStandardMaterial({ color: 0xfff3d6, emissive: 0xffe0a0, emissiveIntensity: 0.6 }), false);
  fur.defineMesh('tlbox', new THREE.BoxGeometry(0.34, 1.0, 0.28), new THREE.MeshStandardMaterial({ color: 0x1c1f22, roughness: 0.6 }));
  const lampColors = { red: 0xff2a1a, amber: 0xffa21a, green: 0x2aff6a } as const;
  const lampMats: Record<string, THREE.MeshBasicMaterial> = {};
  for (const grp of ['A', 'B']) {
    for (const [c, hex] of Object.entries(lampColors)) {
      const m = new THREE.MeshBasicMaterial({ color: hex });
      lampMats[`${grp}${c}`] = m;
      fur.defineMesh(`tl${grp}${c}`, new THREE.CircleGeometry(0.1, 12), m, false);
    }
  }
  const stopMat = signTexture((g) => {
    g.fillStyle = '#c4161c';
    g.beginPath();
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
      g.lineTo(64 + Math.cos(a) * 62, 64 + Math.sin(a) * 62);
    }
    g.fill();
    g.strokeStyle = '#fff';
    g.lineWidth = 5;
    g.stroke();
    g.fillStyle = '#fff';
    g.font = 'bold 40px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('STOP', 64, 66);
  });
  stopMat.alphaTest = 0.5;
  const speedMat = signTexture((g) => {
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(64, 64, 62, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#d0181e';
    g.lineWidth = 14;
    g.beginPath();
    g.arc(64, 64, 54, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#111';
    g.font = 'bold 54px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('50', 64, 68);
  });
  speedMat.alphaTest = 0.5;
  fur.defineMesh('stop', new THREE.PlaneGeometry(0.75, 0.75), stopMat, false);
  fur.defineMesh('speed', new THREE.PlaneGeometry(0.7, 0.7), speedMat, false);
  fur.defineMesh('back', new THREE.CircleGeometry(0.37, 8).rotateY(Math.PI), metal, false);

  /** Faces the sign towards traffic coming along `dir` (unit x, z of its travel). */
  const faceYaw = (dx: number, dz: number): number => Math.atan2(-dx, -dz);
  const lamp = (x: number, z: number, armYaw: number): void => {
    fur.place({
      x, y: CURB, z, yaw: armYaw, halfHeight: 3.6, radius: 0.13, mass: 140,
      parts: [
        { mesh: 'pole', local: local(0, 0, 0, 0, 1, 7.4, 1) },
        { mesh: 'arm', local: local(0, 7.3, 0, 0, 1, 1, 1.8) },
        { mesh: 'lamp', local: local(0, 7.22, 1.75) },
      ],
    });
  };
  const sign = (x: number, z: number, yaw: number, face: 'stop' | 'speed'): void => {
    fur.place({
      x, y: CURB, z, yaw, halfHeight: 1.3, radius: 0.06, mass: 25,
      parts: [
        { mesh: 'pole', local: local(0, 0, 0, 0, 0.6, 2.6, 0.6) },
        { mesh: face, local: local(0, 2.35, 0.05) },
        { mesh: 'back', local: local(0, 2.35, 0.03) },
      ],
    });
  };
  const light = (x: number, z: number, yaw: number, grp: 'A' | 'B'): void => {
    fur.place({
      x, y: CURB, z, yaw, halfHeight: 2.2, radius: 0.12, mass: 160,
      parts: [
        { mesh: 'pole', local: local(0, 0, 0, 0, 1.2, 4.4, 1.2) },
        { mesh: 'tlbox', local: local(0, 3.9, 0.12) },
        { mesh: `tl${grp}red`, local: local(0, 4.22, 0.27) },
        { mesh: `tl${grp}amber`, local: local(0, 3.9, 0.27) },
        { mesh: `tl${grp}green`, local: local(0, 3.58, 0.27) },
      ],
    });
  };

  const k = HALF + 1.2; // pole distance from the road centre (on the pavement)
  for (let i = 0; i < AVENUES.length; i++) {
    for (let j = 0; j < STREETS.length; j++) {
      const ax = AVENUES[i]!;
      const sz = STREETS[j]!;
      const edgeX = i === 0 || i === AVENUES.length - 1;
      const edgeZ = j === 0 || j === STREETS.length - 1;
      if (edgeX && edgeZ) continue;
      if ((i + j) % 2 === 0) {
        // Traffic lights, one per approach on its near right-hand corner (right-hand traffic).
        if (j > 0) light(ax - k, sz - k, faceYaw(0, 1), 'A'); // northbound
        if (j < STREETS.length - 1) light(ax + k, sz + k, faceYaw(0, -1), 'A'); // southbound
        if (i > 0) light(ax - k, sz + k, faceYaw(1, 0), 'B'); // eastbound
        if (i < AVENUES.length - 1) light(ax + k, sz - k, faceYaw(-1, 0), 'B'); // westbound
      } else {
        // Stop signs on the streets; the avenues have priority.
        if (i > 0) sign(ax - k, sz + k, faceYaw(1, 0), 'stop');
        if (i < AVENUES.length - 1) sign(ax + k, sz - k, faceYaw(-1, 0), 'stop');
      }
    }
  }
  // Street lamps along every road, staggered, and a speed-limit sign after each junction.
  for (let i = 0; i < AVENUES.length; i++) {
    for (let j = 0; j < STREETS.length - 1; j++) {
      const ax = AVENUES[i]!;
      const a = STREETS[j]! + HALF + 10;
      const b = STREETS[j + 1]! - HALF - 10;
      for (let z = a; z <= b; z += 43) {
        if (i > 0) lamp(ax - HALF - 0.8, z, Math.PI / 2);
        if (i < AVENUES.length - 1) lamp(ax + HALF + 0.8, z + 21, -Math.PI / 2);
      }
      if (j % 2 === 0 && i > 0) sign(ax - HALF - 0.8, STREETS[j]! + HALF + 18, faceYaw(0, 1), 'speed');
    }
  }
  for (let j = 0; j < STREETS.length; j++) {
    for (let i = 0; i < AVENUES.length - 1; i++) {
      const sz = STREETS[j]!;
      const a = AVENUES[i]! + HALF + 10;
      const b = AVENUES[i + 1]! - HALF - 10;
      for (let x = a; x <= b; x += 45) {
        if (j < STREETS.length - 1) lamp(x, sz + HALF + 0.8, Math.PI);
        if (j > 0) lamp(x + 22, sz - HALF - 0.8, 0);
      }
    }
  }
  fur.finish(physics);
  group.add(fur.group);

  // Traffic-light cycle: avenues (A) and streets (B) take turns.
  const on = (m: THREE.MeshBasicMaterial, lit: boolean, hex: number): void => {
    m.color.setHex(hex).multiplyScalar(lit ? 1 : 0.12);
  };
  const update = (t: number): void => {
    const c = t % 24;
    const phase = (grp: 'A' | 'B', offset: number): void => {
      const p = (c - offset + 24) % 24;
      on(lampMats[`${grp}green`]!, p < 9, lampColors.green);
      on(lampMats[`${grp}amber`]!, p >= 9 && p < 11.5, lampColors.amber);
      on(lampMats[`${grp}red`]!, p >= 11.5, lampColors.red);
    };
    phase('A', 0);
    phase('B', 12);
  };
  update(0);

  return { group, furniture: fur, update };
}
