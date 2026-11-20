import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type RAPIER from '@dimforge/rapier3d-compat';
import { GROUP, groups, type Physics } from '../core/physics';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);

/** A box whose UVs count in tiles of `tile` metres, so textures keep their scale on any size. */
export function tiledBox(sx: number, sy: number, sz: number, tileU = 1, tileV = tileU): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  // Face order: +x, -x, +y, -y, +z, -z; 4 vertices each.
  const size = [
    [sz, sy],
    [sz, sy],
    [sx, sz],
    [sx, sz],
    [sx, sy],
    [sx, sy],
  ];
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, (uv.getX(i) * size[f]![0]!) / tileU, (uv.getY(i) * size[f]![1]!) / tileV);
    }
  }
  return g;
}

/** A gable roof (triangular prism) over a w x d footprint, ridge along z, h tall, base at y = 0. */
export function gableRoof(w: number, d: number, h: number, overhang = 0.4): THREE.BufferGeometry {
  const x = w / 2 + overhang;
  const z = d / 2 + overhang;
  const slope = Math.hypot(x, h);
  const pos: number[] = [];
  const uv: number[] = [];
  // Triangles listed counter-clockwise seen from outside; UVs in metres / 2.
  const tri = (a: number[], b: number[], c: number[], ua: number[], ub: number[], uc: number[]): void => {
    pos.push(...a, ...b, ...c);
    uv.push(...ua, ...ub, ...uc);
  };
  const L = slope / 2;
  const Z = (2 * z) / 2;
  // Left slope.
  tri([-x, 0, -z], [0, h, z], [0, h, -z], [0, 0], [Z, L], [0, L]);
  tri([-x, 0, -z], [-x, 0, z], [0, h, z], [0, 0], [Z, 0], [Z, L]);
  // Right slope.
  tri([x, 0, z], [0, h, -z], [0, h, z], [0, 0], [Z, L], [0, L]);
  tri([x, 0, z], [x, 0, -z], [0, h, -z], [0, 0], [Z, 0], [Z, L]);
  // Gable ends.
  tri([-x, 0, z], [x, 0, z], [0, h, z], [0, 0], [x, 0], [x / 2, h / 2]);
  tri([x, 0, -z], [-x, 0, -z], [0, h, -z], [0, 0], [x, 0], [x / 2, h / 2]);
  // Underside.
  tri([-x, 0, z], [x, 0, -z], [x, 0, z], [0, 0], [1, 1], [1, 0]);
  tri([-x, 0, z], [-x, 0, -z], [x, 0, -z], [0, 0], [0, 1], [1, 1]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/**
 * Static scenery builder: collects transformed geometries per material and merges them into one
 * mesh per material (one draw call each); box and cylinder colliders go on one fixed body.
 */
export class StaticBatch {
  private readonly parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private readonly shadows = new Map<THREE.Material, boolean>();
  readonly body: RAPIER.RigidBody;

  constructor(private readonly physics: Physics) {
    this.body = physics.world.createRigidBody(physics.RAPIER.RigidBodyDesc.fixed());
  }

  /** Add a geometry placed at (x, y, z) with a yaw (and optional pitch, roll), scaled. */
  add(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, yaw = 0, pitch = 0, roll = 0, castShadow = true): void {
    _q.setFromEuler(_e.set(pitch, yaw, roll, 'YXZ'));
    _m.compose(_p.set(x, y, z), _q, _s);
    const g = (geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(_m);
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    let list = this.parts.get(mat);
    if (!list) this.parts.set(mat, (list = []));
    list.push(g);
    if (castShadow) this.shadows.set(mat, true);
  }

  /** A solid box (mesh and collider), centre at (x, y, z). */
  box(x: number, y: number, z: number, sx: number, sy: number, sz: number, mat: THREE.Material, yaw = 0, tile = 0, collide = true, pitch = 0): void {
    this.add(tile > 0 ? tiledBox(sx, sy, sz, tile) : new THREE.BoxGeometry(sx, sy, sz), mat, x, y, z, yaw, pitch);
    if (collide) this.collideBox(x, y, z, sx / 2, sy / 2, sz / 2, yaw, pitch);
  }

  collideBox(x: number, y: number, z: number, hx: number, hy: number, hz: number, yaw = 0, pitch = 0): void {
    const { RAPIER, world } = this.physics;
    _q.setFromEuler(_e.set(pitch, yaw, 0, 'YXZ'));
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz)
        .setTranslation(x, y, z)
        .setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w })
        .setFriction(0.8)
        .setCollisionGroups(groups(GROUP.WORLD, 0xffff)),
      this.body,
    );
  }

  collideCylinder(x: number, y: number, z: number, halfHeight: number, radius: number): void {
    const { RAPIER, world } = this.physics;
    world.createCollider(RAPIER.ColliderDesc.cylinder(halfHeight, radius).setTranslation(x, y, z).setCollisionGroups(groups(GROUP.WORLD, 0xffff)), this.body);
  }

  /** Merge everything added so far into `group`. */
  build(group: THREE.Group): void {
    for (const [mat, list] of this.parts) {
      const geo = mergeGeometries(list);
      for (const g of list) g.dispose();
      if (!geo) continue;
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = this.shadows.get(mat) ?? false;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
    this.parts.clear();
  }
}

/** A canvas texture (sRGB, mipmapped, anisotropic). */
export function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.anisotropy = 8;
  return t;
}

/** Deterministic random numbers. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
