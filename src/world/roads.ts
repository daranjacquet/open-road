import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { GROUP, groups, type Physics } from '../core/physics';
import type { Heightmap } from './heightmap';
import { junctionSurface, ROAD_SINK, type RoadLine, type SurfaceY } from './roadline';
import { DIRT, type SurfaceMap } from './surface';

/** Gravel verge on each side of the asphalt (m). */
const SHOULDER = 1.3;
/** Samples per mesh piece (about 240 m): pieces are culled on their own. */
const PIECE = 120;
/** Texture period along the road (m): one centre dash and its gap. */
const PERIOD = 12;

function roadTexture(gravelOnly: boolean, painted = true): THREE.CanvasTexture {
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
  if (!gravelOnly && painted) {
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
  /** Asphalt without markings (aprons, access lanes). */
  plain: THREE.MeshStandardMaterial;
  gravel: THREE.MeshStandardMaterial;
  concrete: THREE.MeshStandardMaterial;
  rail: THREE.MeshStandardMaterial;
}

export function roadMaterials(): RoadMaterials {
  return {
    asphalt: new THREE.MeshStandardMaterial({ map: roadTexture(false), roughness: 0.9 }),
    plain: new THREE.MeshStandardMaterial({ map: roadTexture(false, false), roughness: 0.9 }),
    gravel: new THREE.MeshStandardMaterial({ map: roadTexture(true), roughness: 1 }),
    concrete: new THREE.MeshStandardMaterial({ color: 0xa3a19b, roughness: 0.9 }),
    rail: new THREE.MeshStandardMaterial({ color: 0xb7bcc2, roughness: 0.35, metalness: 0.7 }),
  };
}

const _l = new THREE.Vector3();
const _t = new THREE.Vector3();
const _n = new THREE.Vector3();

/** Visible ribbon of samples [a, b] (b may run past the last sample of a loop): verges, asphalt,
 * and skirts down to the ground. */
function pieceGeometry(road: RoadLine, a: number, b: number, surfaceY: SurfaceY): THREE.BufferGeometry {
  const hw = road.def.width / 2;
  const total = road.def.width + 2 * SHOULDER;
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const ds = road.ds;
  // Cross-section, left to right: outer verge (sunk), asphalt edge, asphalt edge, outer verge.
  const cols = [
    { off: hw + SHOULDER, dy: -ROAD_SINK + 0.02, u: 0 },
    { off: hw, dy: 0, u: SHOULDER / total },
    { off: -hw, dy: 0, u: 1 - SHOULDER / total },
    { off: -hw - SHOULDER, dy: -ROAD_SINK + 0.02, u: 1 },
  ];
  const per = cols.length + 4; // + skirt top and bottom on each side
  for (let s = a; s <= b; s++) {
    const i = road.wrap(s);
    const lx = road.leftX(i);
    const lz = road.leftZ(i);
    _t.set(road.tx[i]!, road.slope(i), road.tz[i]!).normalize();
    _l.set(lx, 0, lz);
    _n.crossVectors(_t, _l).normalize();
    const v = (s * ds) / PERIOD;
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
  for (let s = a; s <= b; s++) {
    const i = road.wrap(s);
    const o = (s - a) * 6;
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

  // Where roads meet: the ends of every open road (they start or stop on another one, or in a
  // flat asphalt area).
  const junctions: [number, number][] = [];
  for (const road of roads) if (!road.closed) junctions.push([road.x[0]!, road.z[0]!], [road.x[road.n - 1]!, road.z[road.n - 1]!]);
  const surfaces: SurfaceY[] = [];
  const nearJunction = (x: number, z: number): boolean => junctions.some(([jx, jz]) => (x - jx) ** 2 + (z - jz) ** 2 < 20 * 20);

  for (let r = 0; r < roads.length; r++) {
    const road = roads[r]!;
    const gravel = road.def.surface === 'gravel';
    const ds = road.ds;
    const surfaceY = junctionSurface(road, roads.filter((_, k) => k < r));
    surfaces.push(surfaceY);
    // A loop's last piece runs back to its first sample.
    const last = road.closed ? road.n : road.n - 1;
    for (let a = 0; a < last; a += PIECE) {
      const b = Math.min(last, a + PIECE);
      const mesh = new THREE.Mesh(pieceGeometry(road, a, b, surfaceY), gravel ? mats.gravel : road.def.lines === false ? mats.plain : mats.asphalt);
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
      const col = pieceCollider(physics, body, road, a, b, surfaceY);
      if (gravel) physics.groundColliders.add(col.handle);
    }
    if (gravel) for (let i = 0; i < road.n; i++) surface.fillDisc(road.x[i]!, road.z[i]!, road.def.width / 2 + 1, DIRT);

    // Guard rails: both sides of bridges, and the side where the ground falls away steeply; never
    // across a junction.
    const hw = road.def.width / 2;
    for (const side of [1, -1]) {
      for (let i = 0; i + 2 < last + 1; i += 2) {
        const j = road.wrap(i + 2);
        if (nearJunction(road.x[i]!, road.z[i]!) || nearJunction(road.x[j]!, road.z[j]!)) continue;
        const off = (hw + 0.6) * side;
        const px = road.x[i]! + road.leftX(i) * off;
        const pz = road.z[i]! + road.leftZ(i) * off;
        const drop = road.y[i]! - hm.heightAt(road.x[i]! + road.leftX(i) * (hw + 5) * side, road.z[i]! + road.leftZ(i) * (hw + 5) * side);
        const need = road.bridge[i] === 1 || drop > 2.2;
        if (!need) continue;
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

  junctionFillets(roads, surfaces, physics, body, mats, group);
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

/**
 * Rounded asphalt corners where a road ends on another one (both sides of the mouth): a fan from
 * the corner to a curve tangent to the two road edges, at the main road's surface height.
 */
function junctionFillets(roads: RoadLine[], surfaces: SurfaceY[], physics: Physics, body: RAPIER.RigidBody, mats: RoadMaterials, group: THREE.Group): void {
  const { RAPIER, world } = physics;
  const R = 9;
  const N = 10;
  const asphalt: number[] = [];
  const gravel: number[] = [];
  roads.forEach((road, r) => {
    if (road.closed) return;
    for (const end of [0, road.n - 1]) {
      const main = roads.find((o, k) => k < r && o.nearest(road.x[end]!, road.z[end]!).dist < 1);
      if (!main) continue;
      const jx = road.x[end]!;
      const jz = road.z[end]!;
      // Direction from the spur into the junction, and the spur's half width.
      const s = end === 0 ? -1 : 1;
      const dx = road.tx[end]! * s;
      const dz = road.tz[end]! * s;
      const hw = road.def.width / 2;
      const m = main.nearest(jx, jz).i;
      const tx = main.tx[m]!;
      const tz = main.tz[m]!;
      // The main road's edge on the spur's side.
      const sideM = -(dx * main.leftX(m) + dz * main.leftZ(m)) >= 0 ? 1 : -1;
      const ex = jx + main.leftX(m) * (main.def.width / 2) * sideM;
      const ez = jz + main.leftZ(m) * (main.def.width / 2) * sideM;
      for (const side of [1, -1]) {
        const nx = dz * side;
        const nz = -dx * side;
        // Spur edge: (jx + nx hw) - d u. Main edge: e + t v. Corner = their intersection.
        const px = jx + nx * hw;
        const pz = jz + nz * hw;
        const det = -dx * tz + dz * tx;
        if (Math.abs(det) < 0.2) continue; // nearly parallel: no corner to round
        const u = ((ex - px) * tz - (ez - pz) * tx) / det;
        const cx = px - dx * u;
        const cz = pz - dz * u;
        // Along the main edge, away from the spur on this side.
        const away = tx * nx + tz * nz >= 0 ? 1 : -1;
        const ax = cx - dx * R;
        const az = cz - dz * R;
        const bx = cx + tx * away * R;
        const bz = cz + tz * away * R;
        // Height: the spur's surface along its edge, the main road's along its own, blended
        // in between by distance to each edge.
        const spurY = surfaces[r]!;
        const yAt = (x: number, z: number): number => {
          const k = main.nearest(x, z).i;
          const along = (x - main.x[k]!) * main.tx[k]! + (z - main.z[k]!) * main.tz[k]!;
          const lat = Math.abs((x - main.x[k]!) * main.leftX(k) + (z - main.z[k]!) * main.leftZ(k));
          const ym = main.y[k]! + main.slope(k) * along;
          const ks = road.nearest(x, z).i;
          const latS = (x - road.x[ks]!) * road.leftX(ks) + (z - road.z[ks]!) * road.leftZ(ks);
          const ys = spurY(ks, Math.sign(latS) * hw);
          const dm = Math.max(0, lat - main.def.width / 2);
          const dsp = Math.max(0, Math.abs(latS) - hw);
          const w = dm + dsp > 1e-3 ? dsp / (dm + dsp) : 0.5;
          return ys + (ym - ys) * w - 0.02;
        };
        const out = road.def.surface === 'gravel' ? gravel : asphalt;
        let qx = ax;
        let qz = az;
        for (let k = 1; k <= N; k++) {
          const t = k / N;
          // Quadratic curve A -> B with control point C.
          const fx = (1 - t) * (1 - t) * ax + 2 * (1 - t) * t * cx + t * t * bx;
          const fz = (1 - t) * (1 - t) * az + 2 * (1 - t) * t * cz + t * t * bz;
          // Upward winding.
          const cross = (qx - cx) * (fz - cz) - (qz - cz) * (fx - cx);
          const tri = cross < 0 ? [cx, cz, qx, qz, fx, fz] : [cx, cz, fx, fz, qx, qz];
          for (let v = 0; v < 6; v += 2) out.push(tri[v]!, yAt(tri[v]!, tri[v + 1]!), tri[v + 1]!);
          qx = fx;
          qz = fz;
        }
      }
    }
  });
  for (const [pos, mat] of [
    [asphalt, mats.asphalt],
    [gravel, mats.gravel],
  ] as const) {
    if (!pos.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    // Plain asphalt (or gravel) from the road texture, away from the painted lines.
    const uv = new Float32Array((pos.length / 3) * 2);
    for (let i = 0; i < pos.length / 3; i++) {
      uv[i * 2] = 0.32;
      uv[i * 2 + 1] = pos[i * 3]! / PERIOD + pos[i * 3 + 2]! / 37;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    const idx = new Uint32Array(pos.length / 3).map((_, i) => i);
    world.createCollider(RAPIER.ColliderDesc.trimesh(Float32Array.from(pos), idx).setFriction(1).setCollisionGroups(groups(GROUP.WORLD, 0xffff)), body);
  }
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
