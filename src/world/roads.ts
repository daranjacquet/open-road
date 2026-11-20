import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { GROUP, groups, type Physics } from '../core/physics';
import type { Heightmap } from './heightmap';
import { smoothstep } from './noise';
import { ROAD_SINK, type RoadLine } from './roadline';
import { DIRT, type SurfaceMap } from './surface';

/** Gravel verge on each side of the asphalt (m). */
const SHOULDER = 1.3;
/** Samples per mesh piece (about 240 m): pieces are culled on their own. */
const PIECE = 120;
/** Texture period along the road (m): one centre dash and its gap. */
const PERIOD = 12;

function roadTexture(gravelOnly: boolean): THREE.CanvasTexture {
  const w = 256;
  const h = 512;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const img = g.createImageData(w, h);
  // Across: 1.3 m gravel | 8 m asphalt | 1.3 m gravel = 10.6 m over 256 px.
  const total = 8 + 2 * SHOULDER;
  const px = (m: number): number => Math.round((m / total) * w);
  const s0 = px(SHOULDER);
  const s1 = w - s0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gravel = gravelOnly || x < s0 || x >= s1;
      const n = Math.random();
      let r: number;
      let gg: number;
      let b: number;
      if (gravel) {
        const v = 92 + n * 60;
        r = v * 1.05;
        gg = v * 0.95;
        b = v * 0.8;
      } else {
        const v = 78 + n * 26 + (Math.random() < 0.02 ? 30 : 0);
        r = gg = v;
        b = v * 1.04;
      }
      const o = (y * w + x) * 4;
      img.data[o] = r;
      img.data[o + 1] = gg;
      img.data[o + 2] = b;
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  if (!gravelOnly) {
    g.fillStyle = 'rgba(236, 234, 222, 0.92)';
    const line = Math.max(3, px(0.15));
    g.fillRect(s0 + px(0.25), 0, line, h);
    g.fillRect(s1 - px(0.25) - line, 0, line, h);
    // Centre dash: 4 m painted, 8 m gap.
    g.fillRect(w / 2 - line / 2, 0, line, (h * 4) / PERIOD);
    // Wear: darker tyre tracks.
    g.fillStyle = 'rgba(0, 0, 0, 0.07)';
    for (const m of [1.2, 2.8]) {
      g.fillRect(s0 + px(m), 0, px(0.7), h);
      g.fillRect(s1 - px(m) - px(0.7), 0, px(0.7), h);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 16;
  return t;
}

export interface RoadMaterials {
  asphalt: THREE.MeshStandardMaterial;
  gravel: THREE.MeshStandardMaterial;
  concrete: THREE.MeshStandardMaterial;
  rail: THREE.MeshStandardMaterial;
}

export function roadMaterials(): RoadMaterials {
  return {
    asphalt: new THREE.MeshStandardMaterial({ map: roadTexture(false), roughness: 0.9 }),
    gravel: new THREE.MeshStandardMaterial({ map: roadTexture(true), roughness: 1 }),
    concrete: new THREE.MeshStandardMaterial({ color: 0xa3a19b, roughness: 0.9 }),
    rail: new THREE.MeshStandardMaterial({ color: 0xb7bcc2, roughness: 0.35, metalness: 0.7 }),
  };
}

/** Height of a road's surface at sample i, `off` m to its left (negative: right). */
type SurfaceY = (i: number, off: number) => number;

/**
 * Where a road starts or ends on an earlier one, its last metres take the other road's surface
 * (its grade and camber included), just under it: no step, no flicker, no ground showing through.
 */
function junctionSurface(road: RoadLine, earlier: RoadLine[]): SurfaceY {
  const ds = road.length / (road.n - 1);
  const ends = [0, road.n - 1]
    .map((i) => ({ i, other: earlier.find((o) => o.nearest(road.x[i]!, road.z[i]!).dist < 8) }))
    .filter((e): e is { i: number; other: RoadLine } => e.other !== undefined);
  return (i, off) => {
    let y = road.y[i]!;
    for (const e of ends) {
      if (Math.abs(i - e.i) * ds > 24) continue;
      const o = e.other;
      const px = road.x[i]! + road.leftX(i) * off;
      const pz = road.z[i]! + road.leftZ(i) * off;
      const k = o.nearest(px, pz).i;
      const ods = o.length / (o.n - 1);
      const k0 = Math.max(0, k - 1);
      const k1 = Math.min(o.n - 1, k + 1);
      const slope = (o.y[k1]! - o.y[k0]!) / ((k1 - k0) * ods);
      const along = (px - o.x[k]!) * o.tx[k]! + (pz - o.z[k]!) * o.tz[k]!;
      const lat = Math.abs((px - o.x[k]!) * o.leftX(k) + (pz - o.z[k]!) * o.leftZ(k));
      const w = 1 - smoothstep(o.def.width / 2 + 1, o.def.width / 2 + 10, lat);
      y += (o.y[k]! + slope * along - 0.015 - y) * w;
    }
    return y;
  };
}

const _l = new THREE.Vector3();
const _t = new THREE.Vector3();
const _n = new THREE.Vector3();

/** Visible ribbon of samples [a, b]: verges, asphalt, and skirts down to the ground. */
function pieceGeometry(road: RoadLine, a: number, b: number, surfaceY: SurfaceY): THREE.BufferGeometry {
  const hw = road.def.width / 2;
  const total = road.def.width + 2 * SHOULDER;
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const ds = road.length / (road.n - 1);
  // Cross-section, left to right: outer verge (sunk), asphalt edge, asphalt edge, outer verge.
  const cols = [
    { off: hw + SHOULDER, dy: -ROAD_SINK + 0.02, u: 0 },
    { off: hw, dy: 0, u: SHOULDER / total },
    { off: -hw, dy: 0, u: 1 - SHOULDER / total },
    { off: -hw - SHOULDER, dy: -ROAD_SINK + 0.02, u: 1 },
  ];
  const per = cols.length + 4; // + skirt top and bottom on each side
  for (let i = a; i <= b; i++) {
    const lx = road.leftX(i);
    const lz = road.leftZ(i);
    const ip = Math.max(0, i - 1);
    const inx = Math.min(road.n - 1, i + 1);
    const grade = (road.y[inx]! - road.y[ip]!) / ((inx - ip) * ds);
    _t.set(road.tx[i]!, grade, road.tz[i]!).normalize();
    _l.set(lx, 0, lz);
    _n.crossVectors(_t, _l).normalize();
    const v = (i * ds) / PERIOD;
    for (const c of cols) {
      pos.push(road.x[i]! + lx * c.off, surfaceY(i, Math.sign(c.off) * Math.min(Math.abs(c.off), hw)) + c.dy, road.z[i]! + lz * c.off);
      nor.push(_n.x, _n.y, _n.z);
      uv.push(c.u, v);
    }
    // Skirts hang 0.6 m below the outer verges (hide the seam with the terrain at a distance).
    for (const [c, side] of [
      [cols[0]!, 1],
      [cols[3]!, -1],
    ] as const) {
      const sx = road.x[i]! + lx * c.off;
      const sz = road.z[i]! + lz * c.off;
      const y = surfaceY(i, Math.sign(c.off) * hw);
      pos.push(sx, y + c.dy, sz, sx, y + c.dy - 0.6, sz);
      nor.push(lx * side, 0, lz * side, lx * side, 0, lz * side);
      uv.push(c.u, v, c.u, v);
    }
  }
  for (let i = 0; i < b - a; i++) {
    const p = i * per;
    const q = (i + 1) * per;
    for (let c = 0; c < cols.length - 1; c++) idx.push(p + c, p + c + 1, q + c, p + c + 1, q + c + 1, q + c);
    // Left skirt faces left, right skirt faces right.
    idx.push(p + 4, q + 4, p + 5, q + 4, q + 5, p + 5);
    idx.push(p + 6, p + 7, q + 6, q + 6, p + 7, q + 7);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** Collision surface of samples [a, b]: the asphalt only, oriented upwards. */
function pieceCollider(physics: Physics, body: RAPIER.RigidBody, road: RoadLine, a: number, b: number, surfaceY: SurfaceY): RAPIER.Collider {
  const { RAPIER, world } = physics;
  const hw = road.def.width / 2 + 0.2;
  const v = new Float32Array((b - a + 1) * 6);
  for (let i = a; i <= b; i++) {
    const o = (i - a) * 6;
    v[o] = road.x[i]! + road.leftX(i) * hw;
    v[o + 1] = surfaceY(i, hw);
    v[o + 2] = road.z[i]! + road.leftZ(i) * hw;
    v[o + 3] = road.x[i]! - road.leftX(i) * hw;
    v[o + 4] = surfaceY(i, -hw);
    v[o + 5] = road.z[i]! - road.leftZ(i) * hw;
  }
  const idx = new Uint32Array((b - a) * 6);
  for (let i = 0; i < b - a; i++) {
    const p = i * 2;
    const q = p + 2;
    idx.set([p, p + 1, q, p + 1, q + 1, q], i * 6);
  }
  return world.createCollider(
    RAPIER.ColliderDesc.trimesh(v, idx, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(1).setCollisionGroups(groups(GROUP.WORLD, 0xffff)),
    body,
  );
}

export interface BuiltRoads {
  group: THREE.Group;
  /** Guard rail and bridge segment count (stats). */
  rails: number;
}

/**
 * Meshes and colliders for the country roads: ribbons with verges, trimesh driving surfaces,
 * bridges (deck, pillars) where the road crosses a gap, guard rails where the ground drops away.
 */
export function buildRoads(physics: Physics, roads: RoadLine[], hm: Heightmap, surface: SurfaceMap, mats: RoadMaterials): BuiltRoads {
  const { RAPIER, world } = physics;
  const group = new THREE.Group();
  group.name = 'roads';
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const rails: { x: number; y: number; z: number; len: number; yaw: number }[] = [];
  const pillars: THREE.Matrix4[] = [];
  const decks: THREE.BufferGeometry[] = [];

  for (let r = 0; r < roads.length; r++) {
    const road = roads[r]!;
    const gravel = road.def.surface === 'gravel';
    const ds = road.length / (road.n - 1);
    const surfaceY = junctionSurface(road, roads.filter((_, k) => k < r));
    for (let a = 0; a < road.n - 1; a += PIECE) {
      const b = Math.min(road.n - 1, a + PIECE);
      const mesh = new THREE.Mesh(pieceGeometry(road, a, b, surfaceY), gravel ? mats.gravel : mats.asphalt);
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
      const col = pieceCollider(physics, body, road, a, b, surfaceY);
      if (gravel) physics.groundColliders.add(col.handle);
    }
    if (gravel) for (let i = 0; i < road.n; i++) surface.fillDisc(road.x[i]!, road.z[i]!, road.def.width / 2 + 1, DIRT);

    // Guard rails: both sides of bridges, and the side where the ground falls away steeply.
    const hw = road.def.width / 2;
    for (const side of [1, -1]) {
      let run = 0;
      for (let i = 0; i + 2 < road.n; i += 2) {
        const off = (hw + 0.6) * side;
        const px = road.x[i]! + road.leftX(i) * off;
        const pz = road.z[i]! + road.leftZ(i) * off;
        const drop = road.y[i]! - hm.heightAt(road.x[i]! + road.leftX(i) * (hw + 5) * side, road.z[i]! + road.leftZ(i) * (hw + 5) * side);
        const need = road.bridge[i] === 1 || drop > 2.2;
        run = need ? run + 1 : 0;
        if (!need) continue;
        const j = i + 2;
        const qx = road.x[j]! + road.leftX(j) * off;
        const qz = road.z[j]! + road.leftZ(j) * off;
        const len = Math.hypot(qx - px, qz - pz);
        rails.push({ x: (px + qx) / 2, y: (road.y[i]! + road.y[j]!) / 2, z: (pz + qz) / 2, len: len + 0.1, yaw: Math.atan2(qx - px, qz - pz) });
      }
    }

    // Bridges: a concrete deck under the road and pillars down to the ground.
    let i = 0;
    while (i < road.n) {
      if (!road.bridge[i]) {
        i++;
        continue;
      }
      let j = i;
      while (j < road.n && road.bridge[j]) j++;
      const a = Math.max(0, i - 2);
      const b = Math.min(road.n - 1, j + 1);
      decks.push(deckGeometry(road, a, b));
      const spacing = Math.round(28 / ds);
      for (let k = i + Math.round(spacing / 2); k < j; k += spacing) {
        const top = road.y[k]! - 1.2;
        const ground = hm.heightAt(road.x[k]!, road.z[k]!) - 1;
        const h = top - ground;
        if (h < 1) continue;
        const yaw = Math.atan2(road.tx[k]!, road.tz[k]!);
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
        pillars.push(new THREE.Matrix4().compose(new THREE.Vector3(road.x[k]!, ground + h / 2, road.z[k]!), q, new THREE.Vector3(hw * 1.2, h, 1.6)));
        world.createCollider(
          RAPIER.ColliderDesc.cuboid(hw * 0.6, h / 2, 0.8)
            .setTranslation(road.x[k]!, ground + h / 2, road.z[k]!)
            .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
            .setCollisionGroups(groups(GROUP.WORLD, 0xffff)),
          body,
        );
      }
      i = j;
    }
  }

  if (decks.length) {
    for (const g of decks) {
      const m = new THREE.Mesh(g, mats.concrete);
      m.castShadow = true;
      m.receiveShadow = true;
      m.matrixAutoUpdate = false;
      group.add(m);
    }
  }
  if (pillars.length) {
    const pm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mats.concrete, pillars.length);
    pillars.forEach((m, k) => pm.setMatrixAt(k, m));
    pm.computeBoundingSphere();
    pm.castShadow = true;
    pm.receiveShadow = true;
    group.add(pm);
  }
  if (rails.length) {
    const rm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mats.rail, rails.length);
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    rails.forEach((r, k) => {
      q.setFromAxisAngle(up, r.yaw);
      m.compose(p.set(r.x, r.y + 0.6, r.z), q, s.set(0.2, 0.32, r.len));
      rm.setMatrixAt(k, m);
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.12, 0.45, r.len / 2)
          .setTranslation(r.x, r.y + 0.45, r.z)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
          .setFriction(0.4)
          .setCollisionGroups(groups(GROUP.WORLD, 0xffff)),
        body,
      );
    });
    rm.computeBoundingSphere();
    group.add(rm);
  }
  return { group, rails: rails.length };
}

/** Deck slab under a bridge span: sides and underside, 1.2 m deep, a little wider than the road. */
function deckGeometry(road: RoadLine, a: number, b: number): THREE.BufferGeometry {
  const hw = road.def.width / 2 + SHOULDER + 0.3;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = a; i <= b; i++) {
    const lx = road.leftX(i);
    const lz = road.leftZ(i);
    const y = road.y[i]! - ROAD_SINK;
    for (const [off, dy] of [
      [hw, 0],
      [hw, -1.2],
      [-hw, -1.2],
      [-hw, 0],
    ] as const) {
      pos.push(road.x[i]! + lx * off, y + dy, road.z[i]! + lz * off);
    }
  }
  for (let i = 0; i < b - a; i++) {
    const p = i * 4;
    const q = p + 4;
    // Left side (faces left), underside (faces down), right side (faces right).
    idx.push(p, q, p + 1, q, q + 1, p + 1);
    idx.push(p + 1, q + 1, p + 2, q + 1, q + 2, p + 2);
    idx.push(p + 2, q + 2, p + 3, q + 2, q + 3, p + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}
