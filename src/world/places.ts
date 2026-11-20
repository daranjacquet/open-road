import * as THREE from 'three';
import { canvasTexture, gableRoof, rng, StaticBatch, tiledBox } from './batch';
import type { Heightmap } from './heightmap';
import { LAKE, PLACES, WATER_LEVEL } from './layout';
import type { RoadLine } from './roadline';
import { ASPHALT, DIRT, type SurfaceMap } from './surface';
import type { Physics } from '../core/physics';

export interface PlaceMaterials {
  plaster: THREE.MeshStandardMaterial;
  plaster2: THREE.MeshStandardMaterial;
  roof: THREE.MeshStandardMaterial;
  slate: THREE.MeshStandardMaterial;
  stone: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  barn: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  white: THREE.MeshStandardMaterial;
  concrete: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  asphalt: THREE.MeshStandardMaterial;
  paint: THREE.MeshStandardMaterial;
  rock: THREE.MeshStandardMaterial;
  dirt: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
}

/** A plaster wall tile: 4 m wide, 3 m tall (one floor), one window with shutters. */
function plasterTexture(base: string): THREE.CanvasTexture {
  return canvasTexture(128, 96, (g) => {
    g.fillStyle = base;
    g.fillRect(0, 0, 128, 96);
    for (let i = 0; i < 500; i++) {
      g.fillStyle = `rgba(0,0,0,${Math.random() * 0.05})`;
      g.fillRect(Math.random() * 128, Math.random() * 96, 2, 2);
    }
    g.fillStyle = '#5b4632';
    g.fillRect(34, 26, 12, 46);
    g.fillRect(82, 26, 12, 46);
    g.fillStyle = '#f2efe6';
    g.fillRect(46, 24, 36, 50);
    g.fillStyle = '#2d3b47';
    g.fillRect(49, 27, 30, 44);
    g.fillStyle = '#f2efe6';
    g.fillRect(63, 27, 2, 44);
    g.fillRect(49, 47, 30, 2);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(0, 92, 128, 4);
  });
}

function stripes(base: string, line: string, h: number, every: number): THREE.CanvasTexture {
  return canvasTexture(64, 64, (g) => {
    g.fillStyle = base;
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = line;
    for (let y = 0; y < 64; y += every) g.fillRect(0, y, 64, h);
    for (let i = 0; i < 200; i++) {
      g.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`;
      g.fillRect(Math.random() * 64, Math.random() * 64, 2, 2);
    }
  });
}

export function placeMaterials(asphaltMap: THREE.Texture): PlaceMaterials {
  const std = (o: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ roughness: 0.85, ...o });
  const asphalt = asphaltMap.clone();
  asphalt.needsUpdate = true;
  asphalt.repeat.set(1 / 6, 1 / 6);
  return {
    plaster: std({ map: plasterTexture('#e6dcc8') }),
    plaster2: std({ map: plasterTexture('#e9cfae') }),
    roof: std({ map: stripes('#9c4a2c', '#7a3620', 3, 8) }),
    slate: std({ map: stripes('#4a4e55', '#383b40', 2, 6) }),
    stone: std({ map: stripes('#a7a197', '#8f897f', 2, 10) }),
    wood: std({ map: stripes('#7a5634', '#5e4027', 2, 9) }),
    barn: std({ map: stripes('#8e2b20', '#6e2018', 2, 7) }),
    metal: std({ map: stripes('#a9adb2', '#8d9196', 3, 6), metalness: 0.5, roughness: 0.5 }),
    white: std({ color: 0xf1f1ee }),
    concrete: std({ color: 0x9f9d97, roughness: 0.9 }),
    glass: std({ color: 0x1d2a35, roughness: 0.08, metalness: 0.4 }),
    asphalt: std({ map: asphalt, color: 0x8f9298, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -2 }),
    paint: std({ color: 0xf2f2ee, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -4 }),
    rock: std({ color: 0x77736c, roughness: 0.95, flatShading: true }),
    dirt: std({ color: 0x6b5238, roughness: 1, flatShading: true }),
    accent: std({ color: 0xd8261c, roughness: 0.6 }),
  };
}

/** A flat decal (asphalt apron, paint mark) lying on the ground at height y. */
function decal(b: StaticBatch, mat: THREE.Material, x: number, y: number, z: number, w: number, d: number, yaw = 0): void {
  const g = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * d);
  b.add(g, mat, x, y, z, yaw, 0, 0, false);
}

/**
 * A decal that follows the ground (2 m grid, `lift` above it): forecourts, squares and car parks
 * next to roads, where the ground is not quite flat.
 */
function groundDecal(b: StaticBatch, hm: Heightmap, mat: THREE.Material, x: number, z: number, w: number, d: number, yaw = 0, lift = 0.03): void {
  const g = new THREE.PlaneGeometry(w, d, Math.max(1, Math.ceil(w / 2)), Math.max(1, Math.ceil(d / 2))).rotateX(-Math.PI / 2).rotateY(yaw);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i) + x;
    const pz = pos.getZ(i) + z;
    pos.setXYZ(i, px, hm.heightAt(px, pz) + lift, pz);
    uv.setXY(i, uv.getX(i) * w, uv.getY(i) * d);
  }
  g.computeVertexNormals();
  b.add(g, mat, 0, 0, 0, 0, 0, 0, false);
}

/** A house with a pitched roof: footprint w (along its front) x d, walls h; front faces yaw. */
function house(b: StaticBatch, m: PlaceMaterials, x: number, y: number, z: number, w: number, d: number, h: number, yaw: number, wall: THREE.Material, roof: THREE.Material): void {
  b.add(tiledBox(w, h, d, 4, 3), wall, x, y + h / 2, z, yaw);
  b.collideBox(x, y + h / 2, z, w / 2, h / 2, d / 2, yaw);
  // Ridge parallel to the front.
  b.add(gableRoof(d, w, Math.min(3.2, d * 0.38)), roof, x, y + h, z, yaw + Math.PI / 2);
  // Front door.
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  b.add(new THREE.BoxGeometry(1.1, 2.1, 0.1), m.wood, x + s * (d / 2 + 0.02), y + 1.05, z + c * (d / 2 + 0.02), yaw, 0, 0, false);
}

export interface Places {
  group: THREE.Group;
  /** Teleport targets: name, position on the ground, heading. */
  spots: { name: string; x: number; y: number; z: number; yaw: number }[];
}

/** Village on the lake, harbour, petrol station, airfield, farm, quarry, summit viewpoint. */
export function buildPlaces(physics: Physics, hm: Heightmap, roads: RoadLine[], surface: SurfaceMap, m: PlaceMaterials): Places {
  const group = new THREE.Group();
  group.name = 'places';
  const spots: Places['spots'] = [];
  const road = (id: string): RoadLine => roads.find((r) => r.def.id === id)!;
  const ground = (x: number, z: number): number => hm.heightAt(x, z);
  const rand = rng(77);

  // ---- village: houses on both sides of the lake road, a church on a little square ----
  {
    const b = new StaticBatch(physics);
    const lake = road('ring');
    const v = PLACES.village;
    const church = { x: v.x - 34, z: v.z + 6 };
    let lastS = -1e9;
    for (let i = 0; i < lake.n; i++) {
      const s = i * lake.ds;
      if (Math.hypot(lake.x[i]! - v.x, lake.z[i]! - v.z) > 150 || s - lastS < 19) continue;
      lastS = s;
      for (const side of [1, -1]) {
        if (rand() < 0.15) continue;
        const w = 8 + rand() * 4;
        const d = 7.5 + rand() * 3;
        const off = 11 + d / 2 + rand() * 2;
        const x = lake.x[i]! + lake.leftX(i) * off * side;
        const z = lake.z[i]! + lake.leftZ(i) * off * side;
        if (Math.hypot(x - church.x, z - church.z) < 26) continue;
        // Facing the road.
        const yaw = Math.atan2(-lake.leftX(i) * side, -lake.leftZ(i) * side);
        const h = rand() < 0.5 ? 5.6 : 8.4;
        house(b, m, x, ground(x, z) - 0.2, z, w, d, h, yaw, rand() < 0.5 ? m.plaster : m.plaster2, rand() < 0.75 ? m.roof : m.slate);
      }
    }
    // Church: nave, bell tower, spire, and the square in front.
    const cy = ground(church.x, church.z);
    b.add(tiledBox(11, 9, 22, 4, 3), m.stone, church.x, cy + 4.5, church.z);
    b.collideBox(church.x, cy + 4.5, church.z, 5.5, 4.5, 11);
    b.add(gableRoof(11, 22, 4.5), m.slate, church.x, cy + 9, church.z);
    b.box(church.x, cy + 11, church.z + 12.5, 5, 22, 5, m.stone, 0, 3);
    b.add(new THREE.ConeGeometry(3.7, 9, 4).rotateY(Math.PI / 4), m.slate, church.x, cy + 26.5, church.z + 12.5);
    // The square runs from the church to the road's verge (never over the road).
    const k = lake.nearest(church.x, church.z).i;
    const verge = lake.x[k]! - (lake.def.width / 2 + 1.6);
    const sx0 = church.x + 6;
    groundDecal(b, hm, m.asphalt, (sx0 + verge) / 2, church.z, verge - sx0, 34);
    spots.push({ name: 'Lake village', x: lake.x[lake.nearest(v.x, v.z).i]!, y: cy, z: lake.z[lake.nearest(v.x, v.z).i]!, yaw: Math.PI });
    b.build(group);
  }

  // ---- harbour: a wooden jetty out into the lake (drivable), moored boats ----
  {
    const b = new StaticBatch(physics);
    const h = PLACES.harbour;
    const dx = LAKE.x - h.x;
    const dz = LAKE.z - h.z;
    const l = Math.hypot(dx, dz);
    const ux = dx / l;
    const uz = dz / l;
    // Walk towards the lake until the shore.
    let sx = h.x;
    let sz = h.z;
    for (let k = 0; k < 200 && ground(sx, sz) > WATER_LEVEL + 0.4; k++) {
      sx += ux * 2;
      sz += uz * 2;
    }
    const yaw = Math.atan2(ux, uz);
    const len = 52;
    const deckY = WATER_LEVEL + 1.0;
    const cx = sx + ux * (len / 2 - 8);
    const cz = sz + uz * (len / 2 - 8);
    b.add(tiledBox(5, 0.4, len, 2), m.wood, cx, deckY - 0.2, cz, yaw);
    b.collideBox(cx, deckY - 0.2, cz, 2.5, 0.2, len / 2, yaw);
    for (let k = -len / 2 + 2; k <= len / 2; k += 6) {
      for (const side of [-1, 1]) {
        const px = cx + ux * k + uz * side * 2.2;
        const pz = cz + uz * k - ux * side * 2.2;
        b.add(new THREE.CylinderGeometry(0.18, 0.18, 4, 6), m.wood, px, deckY - 2.2, pz);
      }
    }
    // Boats moored alongside.
    for (let k = 0; k < 3; k++) {
      const along = 6 + k * 14;
      const side = k % 2 ? 1 : -1;
      const bx = sx + ux * along + uz * side * 6;
      const bz = sz + uz * along - ux * side * 6;
      b.box(bx, WATER_LEVEL + 0.35, bz, 2.4, 1.0, 7, m.white, yaw);
      b.add(new THREE.BoxGeometry(1.8, 1.1, 2.6), k === 1 ? m.accent : m.wood, bx, WATER_LEVEL + 1.4, bz - uz * 0.5, yaw);
    }
    spots.push({ name: 'Harbour', x: sx - ux * 10, y: ground(sx - ux * 10, sz - uz * 10), z: sz - uz * 10, yaw });
    b.build(group);
  }

  // ---- petrol station on the east road ----
  {
    const b = new StaticBatch(physics);
    const p = PLACES.petrol;
    const y = ground(p.x, p.z);
    // Forecourt from the shop to the road's verge (never over the road).
    const east = road('east');
    const k = east.nearest(p.x, p.z).i;
    const edge = east.z[k]! - (east.def.width / 2 + 1.6);
    const back = p.z - 17;
    groundDecal(b, hm, m.asphalt, p.x, (back + edge) / 2, 66, edge - back);
    surface.fillRect(p.x - 33, back, p.x + 33, edge, ASPHALT);
    // Canopy on four pillars, two pump islands.
    b.add(new THREE.BoxGeometry(22, 0.7, 12), m.white, p.x, y + 5.6, p.z);
    b.add(new THREE.BoxGeometry(22.1, 0.55, 12.1), m.accent, p.x, y + 5.67, p.z, 0, 0, 0, false);
    for (const [ox, oz] of [[-8, -4], [8, -4], [-8, 4], [8, 4]] as const) {
      b.box(p.x + ox, y + 2.7, p.z + oz, 0.45, 5.4, 0.45, m.white);
    }
    for (const ox of [-4, 4]) {
      b.box(p.x + ox, y + 0.1, p.z, 1.4, 0.2, 7, m.concrete, 0, 0, false);
      for (const oz of [-1.8, 1.8]) b.box(p.x + ox, y + 0.95, p.z + oz, 0.7, 1.7, 1.0, m.accent);
    }
    // Shop at the back, price sign at the road.
    b.add(tiledBox(16, 4.2, 9, 4, 3), m.plaster, p.x + 4, y + 2.1, p.z - 13);
    b.collideBox(p.x + 4, y + 2.1, p.z - 13, 8, 2.1, 4.5);
    b.add(new THREE.BoxGeometry(16.4, 0.5, 9.4), m.accent, p.x + 4, y + 4.3, p.z - 13, 0, 0, 0, false);
    b.add(new THREE.BoxGeometry(6, 2.4, 0.1), m.glass, p.x + 4, y + 1.5, p.z - 8.45, 0, 0, 0, false);
    b.box(p.x - 26, y + 3.5, p.z + 9, 0.4, 7, 0.4, m.metal);
    b.add(new THREE.BoxGeometry(2.6, 2.2, 0.4), m.accent, p.x - 26, y + 6.6, p.z + 9);
    spots.push({ name: 'Petrol station', x: p.x - 14, y, z: p.z, yaw: Math.PI / 2 });
    b.build(group);
  }

  // ---- airfield: runway, taxiway, apron, hangars, tower ----
  {
    const b = new StaticBatch(physics);
    const a = PLACES.airfield;
    const y = 0;
    const len = a.x1 - a.x0;
    const cx = (a.x0 + a.x1) / 2;
    decal(b, m.asphalt, cx, y + 0.02, a.z, len, 45);
    surface.fillRect(a.x0, a.z - 23, a.x1, a.z + 23, ASPHALT);
    // Markings: centre line, edge lines, threshold bars.
    for (let x = a.x0 + 120; x < a.x1 - 120; x += 50) decal(b, m.paint, x, y + 0.03, a.z, 28, 0.9);
    for (const side of [-1, 1]) decal(b, m.paint, cx, y + 0.03, a.z + side * 21.5, len - 4, 0.8);
    for (const end of [a.x0 + 22, a.x1 - 22]) {
      for (let k = -6; k <= 6; k += 1.6) if (Math.abs(k) > 1) decal(b, m.paint, end, y + 0.03, a.z + k * 2.2, 30, 1.6);
    }
    // Taxiway and links.
    const tz = a.z + 66;
    decal(b, m.asphalt, cx, y + 0.02, tz, len - 120, 16);
    surface.fillRect(a.x0 + 60, tz - 8, a.x1 - 60, tz + 8, ASPHALT);
    for (const x of [a.x0 + 70, cx, a.x1 - 70]) {
      decal(b, m.asphalt, x, y + 0.021, (a.z + tz) / 2, 16, tz - a.z - 30);
      surface.fillRect(x - 8, a.z, x + 8, tz, ASPHALT);
    }
    // Apron up to the road, and a link to the airfield road.
    const ax = 690;
    decal(b, m.asphalt, ax, y + 0.022, tz + 40, 260, 64);
    surface.fillRect(ax - 130, tz, ax + 130, tz + 72, ASPHALT);
    // Hangars with arched roofs on the apron's west and east ends.
    for (const hx of [ax - 160, ax + 160]) {
      const hz = tz + 46;
      b.add(tiledBox(36, 7, 30, 3, 2), m.metal, hx, y + 3.5, hz);
      b.collideBox(hx, y + 6, hz, 18, 6, 15);
      const arch = new THREE.CylinderGeometry(18, 18, 30, 20, 1, true, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2).scale(1, 0.38, 1);
      b.add(arch, m.metal, hx, y + 7, hz);
      b.add(new THREE.BoxGeometry(30, 6.2, 0.2), m.concrete, hx, y + 3.2, hz - 15.05, 0, 0, 0, false);
    }
    // Control tower.
    const tx = ax + 150;
    const tzz = tz + 14;
    b.add(new THREE.CylinderGeometry(2.4, 2.8, 18, 12), m.concrete, tx, y + 9, tzz);
    b.collideCylinder(tx, y + 9, tzz, 9, 2.8);
    b.add(new THREE.CylinderGeometry(4.4, 3.6, 3.6, 8), m.glass, tx, y + 19.8, tzz);
    b.add(new THREE.CylinderGeometry(4.8, 4.8, 0.6, 8), m.white, tx, y + 21.9, tzz);
    // Two parked light aircraft.
    for (const [px, pz, yaw] of [[ax - 60, tz + 30, 0.4], [ax + 20, tz + 26, -0.3]] as const) {
      b.add(new THREE.CylinderGeometry(0.6, 0.45, 7.5, 10).rotateX(Math.PI / 2), m.white, px, y + 1.4, pz, yaw);
      b.add(new THREE.BoxGeometry(10.5, 0.15, 1.5), m.white, px, y + 1.8, pz, yaw);
      b.add(new THREE.BoxGeometry(3.6, 0.12, 0.9), m.white, px - Math.sin(yaw) * 3.3, y + 1.6, pz - Math.cos(yaw) * 3.3, yaw);
      b.add(new THREE.BoxGeometry(0.12, 1.3, 1.0), m.accent, px - Math.sin(yaw) * 3.4, y + 2.2, pz - Math.cos(yaw) * 3.4, yaw);
      b.collideBox(px, y + 1.4, pz, 5.2, 0.8, 3.6, yaw);
    }
    // Windsock.
    b.box(a.x0 + 60, y + 3, a.z - 40, 0.15, 6, 0.15, m.metal);
    b.add(new THREE.ConeGeometry(0.45, 2.6, 8, 1, true).rotateZ(Math.PI / 2), m.accent, a.x0 + 61.3, y + 5.8, a.z - 40);
    spots.push({ name: 'Airfield runway', x: a.x0 + 40, y, z: a.z, yaw: Math.PI / 2 });
    b.build(group);
  }

  // ---- farm: barn, farmhouse, silos, hay bales ----
  {
    const b = new StaticBatch(physics);
    const f = PLACES.farm;
    const y = ground(f.x, f.z);
    b.add(tiledBox(14, 8, 24, 3, 2), m.barn, f.x - 18, y + 4, f.z);
    b.collideBox(f.x - 18, y + 4, f.z, 7, 4, 12);
    b.add(gableRoof(14, 24, 5.5, 0.6), m.slate, f.x - 18, y + 8, f.z);
    house(b, m, f.x + 20, y, f.z + 10, 11, 9, 6, Math.PI, m.plaster2, m.roof);
    for (const k of [0, 1]) {
      const sx = f.x - 2 + k * 8;
      const sz = f.z - 22;
      b.add(new THREE.CylinderGeometry(3.2, 3.2, 14, 16), m.metal, sx, y + 7, sz);
      b.add(new THREE.ConeGeometry(3.4, 2.4, 16), m.metal, sx, y + 15.2, sz);
      b.collideCylinder(sx, y + 7, sz, 7, 3.2);
    }
    for (let k = 0; k < 8; k++) {
      const hx = f.x + 4 + (k % 4) * 2.1;
      const hz = f.z + 22 + Math.floor(k / 4) * 2.4;
      b.add(new THREE.CylinderGeometry(0.85, 0.85, 1.4, 12).rotateZ(Math.PI / 2), m.wood, hx, y + 0.85, hz);
    }
    b.collideBox(f.x + 7.2, y + 0.85, f.z + 23.2, 4.4, 0.85, 2.4);
    surface.fillDisc(f.x, f.z, 45, DIRT);
    spots.push({ name: 'Farm', x: f.x + 5, y, z: f.z + 45, yaw: Math.PI });
    b.build(group);
  }

  // ---- quarry: a dirt pit with jumps, mounds, rocks and a crusher ----
  {
    const b = new StaticBatch(physics);
    const q = PLACES.quarry;
    const y = ground(q.x, q.z);
    surface.fillDisc(q.x, q.z, 160, DIRT);
    // Jump ramps (tilted slabs), each with a landing mound.
    for (const [ox, oz, yaw] of [[-40, 10, 0.3], [30, -35, 2.2], [10, 50, -1.1]] as const) {
      const x = q.x + ox;
      const z = q.z + oz;
      const pitch = -0.24;
      b.add(new THREE.BoxGeometry(7, 0.5, 11), m.dirt, x, y + 1.15, z, yaw, pitch);
      b.collideBox(x, y + 1.15, z, 3.5, 0.25, 5.5, yaw, pitch);
    }
    for (const [ox, oz, r, hh] of [[-10, -10, 9, 3], [45, 25, 12, 4], [-55, -45, 10, 3.5]] as const) {
      const g = new THREE.SphereGeometry(1, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(r, hh, r);
      b.add(g, m.dirt, q.x + ox, y - 0.2, q.z + oz);
      const pts = g.getAttribute('position').array as Float32Array;
      const moved = new Float32Array(pts.length);
      for (let i = 0; i < pts.length; i += 3) {
        moved[i] = pts[i]! + q.x + ox;
        moved[i + 1] = pts[i + 1]! + y - 0.2;
        moved[i + 2] = pts[i + 2]! + q.z + oz;
      }
      const { RAPIER, world } = physics;
      const desc = RAPIER.ColliderDesc.convexHull(moved);
      if (desc) world.createCollider(desc, b.body);
    }
    for (let k = 0; k < 14; k++) {
      const a = rand() * Math.PI * 2;
      const d = 60 + rand() * 45;
      const s = 1 + rand() * 2.2;
      const x = q.x + Math.cos(a) * d;
      const z = q.z + Math.sin(a) * d;
      b.add(new THREE.IcosahedronGeometry(s, 0), m.rock, x, ground(x, z) + s * 0.4, z, rand() * 3, rand());
      b.collideCylinder(x, ground(x, z) + s * 0.4, z, s * 0.6, s * 0.75);
    }
    // Crusher and conveyor.
    b.box(q.x + 70, y + 5, q.z + 55, 10, 10, 8, m.metal, 0.6, 2);
    b.add(new THREE.BoxGeometry(1.4, 0.5, 30), m.metal, q.x + 82, y + 9, q.z + 70, 0.6, -0.42);
    b.add(new THREE.ConeGeometry(9, 7, 12), m.dirt, q.x + 92, y + 3.4, q.z + 84);
    b.collideCylinder(q.x + 92, y + 2.5, q.z + 84, 2.5, 6);
    spots.push({ name: 'Quarry', x: q.x, y, z: q.z - 70, yaw: 0 });
    b.build(group);
  }

  // ---- summit viewpoint on the pass: car park, parapet, chalet ----
  {
    const b = new StaticBatch(physics);
    const pass = road('ring');
    const v = PLACES.viewpoint;
    const i = pass.nearest(v.x, v.z).i;
    const yaw = Math.atan2(pass.tx[i]!, pass.tz[i]!);
    const y = pass.y[i]!;
    // Car park on the downhill (south) side of the road.
    const side = pass.leftZ(i) < 0 ? 1 : -1;
    // From the road's verge (5.6 m off its centre) out to 26 m.
    const px = pass.x[i]! + pass.leftX(i) * 15.8 * side;
    const pz = pass.z[i]! + pass.leftZ(i) * 15.8 * side;
    const gy = ground(px, pz);
    // 18 m deep (across the road), 34 m long (along it).
    groundDecal(b, hm, m.asphalt, px, pz, 20.4, 34, yaw);
    surface.fillRect(px - 17, pz - 17, px + 17, pz + 17, ASPHALT);
    for (let k = -14; k <= 14; k += 3.5) {
      groundDecal(b, hm, m.paint, px + Math.sin(yaw) * k + pass.leftX(i) * side * 3, pz + Math.cos(yaw) * k + pass.leftZ(i) * side * 3, 5, 0.15, yaw, 0.045);
    }
    const wx = px + pass.leftX(i) * side * 10.8;
    const wz = pz + pass.leftZ(i) * side * 10.8;
    b.box(wx, gy + 0.45, wz, 0.6, 0.9, 34, m.stone, yaw, 1);
    b.box(wx - pass.leftX(i) * side * 1.2, gy + 0.6, wz - pass.leftZ(i) * side * 1.2, 0.15, 1.2, 0.15, m.metal);
    b.add(new THREE.CylinderGeometry(0.15, 0.2, 0.8, 8).rotateX(-0.6), m.metal, wx - pass.leftX(i) * side * 1.2, gy + 1.3, wz - pass.leftZ(i) * side * 1.2, yaw);
    // Chalet across the road.
    const hx = pass.x[i]! - pass.leftX(i) * 20 * side;
    const hz = pass.z[i]! - pass.leftZ(i) * 20 * side;
    house(b, m, hx, ground(hx, hz) - 0.3, hz, 12, 9, 5, Math.atan2(pass.leftX(i) * side, pass.leftZ(i) * side), m.wood, m.slate);
    spots.push({ name: 'Summit viewpoint', x: pass.x[i]!, y, z: pass.z[i]!, yaw });
    b.build(group);
  }

  return { group, spots };
}
