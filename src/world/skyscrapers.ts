import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type RAPIER from '@dimforge/rapier3d-compat';
import { FIXED_DT, GROUP, groups, type Physics } from '../core/physics';
import { SmokeClouds } from '../render/smoke';

/** A convex polygon in the horizontal plane, (x, z) pairs, relative to the tower's axis. */
export type Poly = [number, number][];

/** A stretch of a tower between two heights (relative to its foot), lofted between two sections. */
export interface Band {
  y0: number;
  y1: number;
  bottom: Poly;
  /** The same array as `bottom` for a straight prism. */
  top: Poly;
}

/** What can bring a tower down. */
export type Breaker = 'car' | 'aircraft';
const ALL_BREAKERS: readonly Breaker[] = ['car', 'aircraft'];

export interface TowerSpec {
  name: string;
  /** Axis and ground level. */
  x: number;
  z: number;
  y: number;
  /** From the ground up; the first one stands on the ground and gets the breakable ground floor. */
  bands: Band[];
  facade: THREE.Material;
  /** Mast or spire on the roof. */
  spire?: { r: number; h: number };
  /**
   * Which vehicles can break it (default: all). Other hits on it are ignored. The twin towers list
   * only cars: the game does not stage the September 11 attacks.
   */
  breakers?: readonly Breaker[];
  /**
   * An aircraft that brings it down flies on through it (default) rather than stopping dead. Off on
   * the twin towers: the game does not stage the September 11 attacks.
   */
  passThrough?: boolean;
}

/** Can this kind of vehicle break this tower? */
export function breakableBy(spec: TowerSpec, by: Breaker): boolean {
  return (spec.breakers ?? ALL_BREAKERS).includes(by);
}

export interface SkyscraperMaterials {
  roof: THREE.Material;
  /** Bare concrete: broken floors, cut faces, the core. */
  concrete: THREE.Material;
  mast: THREE.Material;
}

/** Lowest height (m above the foot) at which an aircraft breaks a tower; below it, it hits the ground floor like a car. */
const STRIKE_MIN = 5;
/** Seconds after a tower broken higher up loses its top before its stump and ground floor come down too. */
const BASE_FALLS_AFTER = 2.5;
/** Height of the breakable ground floor (m), thickness of its outer wall and width of a wall section. */
const BASE_H = 12;
const WALL = 3;
const CHUNK_W = 10;
/**
 * The tower above comes down when this share of its ground-floor wall is gone, or when one side
 * has lost this share of its own sections (it then falls that way).
 */
const COLLAPSE_AT = 0.3;
const SIDE_GONE = 0.75;
/** Window tile of the facade textures (m): matches the city's. */
const TILE_W = 16;
const TILE_H = 14;
/**
 * How finely a falling tower breaks up: pieces about this tall (m) and wide around the facade,
 * each wedge cut once more halfway out from the axis, at most this many pieces per tower.
 */
const PIECE_H = 8;
const PIECE_W = 15;
const MAX_PIECES = 320;
/** Debris density (kg/m3 of the building's volume: mostly air) and mass limits (kg). */
const DENSITY = 140;
const MASS_MIN = 4e3;
const MASS_MAX = 1.5e5;

// ---- convex polygon helpers -----------------------------------------------------------------------

function hull2(pts: [number, number][]): Poly {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: [number, number], a: [number, number], b: [number, number]): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 1e-9) lower.pop();
    lower.push(q);
  }
  const upper: [number, number][] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 1e-9) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Section of a band at height y: the lofted hull's cross-section is the weighted Minkowski sum. */
function sectionAt(b: Band, y: number): Poly {
  if (b.bottom === b.top) return b.bottom;
  const t = Math.min(1, Math.max(0, (y - b.y0) / (b.y1 - b.y0)));
  const pts: [number, number][] = [];
  for (const p of b.bottom) for (const q of b.top) pts.push([p[0] * (1 - t) + q[0] * t, p[1] * (1 - t) + q[1] * t]);
  return hull2(pts);
}

/** Keep the part of a convex polygon where a*x + c*z <= d. */
function clip(poly: Poly, a: number, c: number, d: number): Poly {
  const out: Poly = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const fp = a * p[0] + c * p[1] - d;
    const fq = a * q[0] + c * q[1] - d;
    if (fp <= 0) out.push(p);
    if (fp * fq < 0) {
      const t = fp / (fp - fq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}

/** The slice of a polygon between two directions from the axis (at most half a turn). */
function wedge(poly: Poly, a0: number, a1: number): Poly {
  const half1 = clip(poly, Math.sin(a0), -Math.cos(a0), 0);
  return clip(half1, -Math.sin(a1), Math.cos(a1), 0);
}

/** Shrink a convex polygon by `d` (its edges moved in and re-intersected). */
function inset(poly: Poly, d: number): Poly {
  const n = poly.length;
  // Orientation: positive area means counter-clockwise in (x, z).
  let area = 0;
  for (let i = 0; i < n; i++) area += poly[i]![0] * poly[(i + 1) % n]![1] - poly[(i + 1) % n]![0] * poly[i]![1];
  const s = area > 0 ? 1 : -1;
  const lines = poly.map((p, i) => {
    const q = poly[(i + 1) % n]!;
    const ex = q[0] - p[0];
    const ez = q[1] - p[1];
    const l = Math.hypot(ex, ez);
    // Inward normal.
    const nx = (-ez / l) * s;
    const nz = (ex / l) * s;
    return { px: p[0] + nx * d, pz: p[1] + nz * d, ex, ez };
  });
  return lines.map((l1, i) => {
    const l0 = lines[(i + n - 1) % n]!;
    const den = l0.ex * l1.ez - l0.ez * l1.ex;
    const t = ((l1.px - l0.px) * l1.ez - (l1.pz - l0.pz) * l1.ex) / den;
    return [l0.px + l0.ex * t, l0.pz + l0.ez * t] as [number, number];
  });
}

function radius(poly: Poly): number {
  let r = 0;
  for (const p of poly) r = Math.max(r, Math.hypot(p[0], p[1]));
  return r;
}

/** Distance from a point to a convex polygon's boundary. */
function edgeDistance(poly: Poly, x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const ex = q[0] - p[0];
    const ez = q[1] - p[1];
    const t = Math.max(0, Math.min(1, ((x - p[0]) * ex + (z - p[1]) * ez) / (ex * ex + ez * ez)));
    best = Math.min(best, Math.hypot(p[0] + ex * t - x, p[1] + ez * t - z));
  }
  return best;
}

// ---- geometry ------------------------------------------------------------------------------------------

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _n = new THREE.Vector3();

/**
 * A convex solid as a mesh with two material groups: facade (0) on the faces that lie on the
 * tower's outer skin, and `inner` (1) everywhere else (broken floors, cut faces). Roof tops are
 * group 2 when `roofAt` is given. Facade UVs are in window tiles from world coordinates, so every
 * piece keeps the windows where they were. Positions are relative to `origin`, scaled by `scale`.
 */
function solidGeometry(points: THREE.Vector3[], onSkin: (cx: number, cy: number, cz: number) => boolean, roofAt = Infinity, origin = new THREE.Vector3(), scale = 1): THREE.BufferGeometry {
  const src = new ConvexGeometry(points);
  const pos = src.getAttribute('position');
  const buckets: number[][] = [[], [], []];
  for (let t = 0; t < pos.count; t += 3) {
    _a.fromBufferAttribute(pos, t);
    _b.fromBufferAttribute(pos, t + 1);
    _c.fromBufferAttribute(pos, t + 2);
    _n.crossVectors(_b.clone().sub(_a), _c.clone().sub(_a)).normalize();
    const cx = (_a.x + _b.x + _c.x) / 3;
    const cy = (_a.y + _b.y + _c.y) / 3;
    const cz = (_a.z + _b.z + _c.z) / 3;
    const side = Math.abs(_n.y) < 0.75;
    const g = side ? (onSkin(cx, cy, cz) ? 0 : 1) : _n.y > 0 && Math.abs(cy - roofAt) < 0.05 ? 2 : 1;
    const tx = -_n.z;
    const tz = _n.x;
    const tl = Math.hypot(tx, tz) || 1;
    for (const v of [_a, _b, _c]) {
      const u = side ? (v.x * tx + v.z * tz) / tl / TILE_W : v.x / 8;
      const w = side ? v.y / TILE_H : v.z / 8;
      buckets[g]!.push((v.x - origin.x) * scale, (v.y - origin.y) * scale, (v.z - origin.z) * scale, _n.x, _n.y, _n.z, u, w);
    }
  }
  src.dispose();
  const out = new THREE.BufferGeometry();
  const all = buckets[0]!.concat(buckets[1]!, buckets[2]!);
  const n = all.length / 8;
  const p = new Float32Array(n * 3);
  const nr = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    p.set(all.slice(i * 8, i * 8 + 3), i * 3);
    nr.set(all.slice(i * 8 + 3, i * 8 + 6), i * 3);
    uv.set(all.slice(i * 8 + 6, i * 8 + 8), i * 2);
  }
  out.setAttribute('position', new THREE.BufferAttribute(p, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nr, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  let start = 0;
  buckets.forEach((b, k) => {
    const c = b.length / 8;
    if (c) out.addGroup(start, c, k);
    start += c;
  });
  out.computeBoundingSphere();
  return out;
}

/** Split a grouped geometry into one geometry per material slot (for merging across towers). */
function bySlot(g: THREE.BufferGeometry): THREE.BufferGeometry[] {
  return [0, 1, 2].map((slot) => {
    const grp = g.groups.find((x) => x.materialIndex === slot);
    const out = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'uv'] as const) {
      const a = g.getAttribute(name);
      const s = grp ? (a.array as Float32Array).slice(grp.start * a.itemSize, (grp.start + grp.count) * a.itemSize) : new Float32Array(0);
      out.setAttribute(name, new THREE.BufferAttribute(s, a.itemSize));
    }
    return out;
  });
}

// ---- towers ----------------------------------------------------------------------------------------------

const _m = new THREE.Matrix4();
const _pp = new THREE.Vector3();
const _qq = new THREE.Quaternion();
const _one = new THREE.Vector3(1, 1, 1);

interface Chunk {
  tower: Tower;
  /** Index around the ground-floor wall (neighbours are i - 1 and i + 1), and the side it is on. */
  i: number;
  side: number;
  points: THREE.Vector3[];
  geo: THREE.BufferGeometry[];
  desc: RAPIER.ColliderDesc;
  collider: RAPIER.Collider | null;
  /** Outward direction (horizontal). */
  out: THREE.Vector3;
  damage: number;
  lastHit: number;
}

interface Tower {
  spec: TowerSpec;
  chunks: Chunk[];
  /** Ground-floor wall strength per section (J of impact energy). */
  strength: number;
  /** Static colliders of everything above the ground floor, and of the core. */
  upperDescs: RAPIER.ColliderDesc[];
  upper: RAPIER.Collider[];
  /** Intact geometry above the ground floor (and the core), per material slot. */
  intact: THREE.BufferGeometry[];
  collapsed: boolean;
  /** Seconds of dust left after a collapse. */
  dust: number;
  /** After a strike high up: the stump's fixed blocks, and the physics time they come down (-1: never). */
  stump: RAPIER.RigidBody[];
  baseFallsAt: number;
  /** Impact energy taken above the ground floor (J), and the physics time of the last strike. */
  struck: number;
  lastStrike: number;
}

interface Debris {
  body: RAPIER.RigidBody;
  /** Its own mesh (a broken ground-floor section), or its instances in a collapse's batched meshes. */
  mesh: THREE.Mesh | null;
  batch: { meshes: THREE.BatchedMesh[]; ids: number[] } | null;
  /** Falling fast last frame (dust when it lands). */
  falling: boolean;
  /** Seconds it has barely moved: rubble that keeps rocking in a pile is made static. */
  still: number;
}

/** A block of a collapse before it is drawn: its body, its geometry (about its centre), where it is. */
interface Block {
  body: RAPIER.RigidBody;
  geo: THREE.BufferGeometry;
  falling: boolean;
}

/** How a tower breaks up: storey slices of `seg` metres, `k` wedges around the axis, each cut in two. */
function breakUp(spec: TowerSpec): { seg: number; k: number } {
  const r = radius(spec.bands[0]!.bottom);
  const k = THREE.MathUtils.clamp(Math.round((2 * Math.PI * r) / PIECE_W), 4, 8);
  const height = spec.bands[spec.bands.length - 1]!.y1 - BASE_H;
  return { seg: Math.max(PIECE_H, (height * k * 2) / MAX_PIECES), k };
}

/** The storey slices of a band above the ground floor (heights relative to the foot). */
function slices(band: Band, seg: number): [number, number][] {
  const ya = Math.max(band.y0, BASE_H);
  if (ya >= band.y1) return [];
  const n = Math.max(1, Math.round((band.y1 - ya) / seg));
  return Array.from({ length: n }, (_, s) => [ya + ((band.y1 - ya) * s) / n, ya + ((band.y1 - ya) * (s + 1)) / n]);
}

/**
 * Skyscrapers that come down. Each one is static and cheap while intact (a few colliders, merged
 * meshes). Its ground floor is a ring of wall sections around an indestructible core: a car that
 * hits a section hard enough knocks it in (the hit's kinetic energy against the section's strength,
 * the rest carries to its neighbours). When too much of the ring is gone the whole tower comes down:
 * it is cut into storey blocks, split around its axis, that fall as rigid bodies and lean towards the
 * side that gave way. Dust rises from the breaks and where the blocks land. `rebuild` puts it all back.
 */
export class Skyscrapers {
  readonly group = new THREE.Group();
  /** Collapses so far (HUD, tests). */
  collapses = 0;
  private readonly towers: Tower[] = [];
  private readonly chunkOf = new Map<number, Chunk>();
  private readonly body: RAPIER.RigidBody;
  private readonly debris: Debris[] = [];
  private readonly intactMeshes: THREE.Mesh[] = [];
  private readonly baseMeshes: THREE.Mesh[] = [];
  /** Dust clouds (none in headless runs). */
  private readonly dust: SmokeClouds | null;
  private readonly slotMats: THREE.Material[][];
  private time = 0;
  /** Physics time (s), advanced by `flush` once per step: what crash cooldowns count in. */
  private stepTime = 0;
  private lastSeconds = -1;
  private readonly pending: { c: Chunk; energy: number; dx: number; dz: number }[] = [];
  /** Colliders above the ground floor (and the core), by handle. */
  private readonly upperOf = new Map<number, Tower>();
  private readonly strikes: { t: Tower; energy: number; dx: number; dz: number; at: number }[] = [];
  /**
   * Set by `flush` when an aircraft's strike brought a tower down that it may fly through: the share
   * of its kinetic energy it keeps (the rest went into breaking the tower). The game reads and clears it.
   */
  breakThrough: number | null = null;

  constructor(
    private readonly physics: Physics,
    specs: TowerSpec[],
    private readonly mats: SkyscraperMaterials,
    dust = true,
  ) {
    this.group.name = 'skyscrapers';
    this.dust = dust ? new SmokeClouds(1600) : null;
    if (this.dust) this.group.add(this.dust.mesh);
    const { RAPIER, world } = physics;
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const facades = [...new Set(specs.map((s) => s.facade))];
    this.slotMats = facades.map((f) => [f, mats.concrete, mats.roof]);
    for (const spec of specs) this.towers.push(this.makeTower(spec));
    for (const t of this.towers) this.restore(t);
    this.remesh();
  }

  private slotsOf(t: Tower): THREE.Material[] {
    return this.slotMats.find((m) => m[0] === t.spec.facade)!;
  }

  private makeTower(spec: TowerSpec): Tower {
    const { RAPIER } = this.physics;
    const { x, z, y } = spec;
    const b0 = spec.bands[0]!;
    const outer = b0.bottom;
    const inner = inset(outer, WALL);
    // The core fills the ground floor right behind the wall: a vehicle that knocks a section in
    // stops against it rather than driving on into a hollow under the tower.
    const coreP = inset(outer, WALL + 0.05);
    const skin = (band: Band) => (cx: number, cy: number, cz: number): boolean => edgeDistance(sectionAt(band, cy - y), cx - x, cz - z) < 0.3;
    const v3 = (p: [number, number], h: number): THREE.Vector3 => new THREE.Vector3(x + p[0], y + h, z + p[1]);
    const hullDesc = (pts: THREE.Vector3[]): RAPIER.ColliderDesc =>
      RAPIER.ColliderDesc.convexHull(Float32Array.from(pts.flatMap((p) => [p.x, p.y, p.z])))!.setFriction(0.8).setCollisionGroups(groups(GROUP.WORLD, 0xffff));
    const tower: Tower = { spec, chunks: [], strength: 150e3 + 1200 * (spec.bands[spec.bands.length - 1]!.y1), upperDescs: [], upper: [], intact: [], collapsed: false, dust: 0, struck: 0, lastStrike: -1, stump: [], baseFallsAt: -1 };

    // Ground-floor wall: sections along each edge, from the outer skin to the inner face.
    for (let e = 0; e < outer.length; e++) {
      const o0 = outer[e]!;
      const o1 = outer[(e + 1) % outer.length]!;
      const i0 = inner[e]!;
      const i1 = inner[(e + 1) % inner.length]!;
      const len = Math.hypot(o1[0] - o0[0], o1[1] - o0[1]);
      const n = Math.max(1, Math.round(len / CHUNK_W));
      for (let k = 0; k < n; k++) {
        const lerp = (a: [number, number], b: [number, number], t: number): [number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        const quad = [lerp(o0, o1, k / n), lerp(o0, o1, (k + 1) / n), lerp(i0, i1, (k + 1) / n), lerp(i0, i1, k / n)];
        const pts = [...quad.map((p) => v3(p, 0)), ...quad.map((p) => v3(p, BASE_H))];
        const mid = lerp(o0, o1, (k + 0.5) / n);
        const out = new THREE.Vector3(mid[0], 0, mid[1]).normalize();
        tower.chunks.push({ tower, i: tower.chunks.length, side: e, points: pts, geo: bySlot(solidGeometry(pts, skin(b0))), desc: hullDesc(pts), collider: null, out, damage: 0, lastHit: -1 });
      }
    }
    // The core: indestructible while the tower stands.
    const corePts = [...coreP.map((p) => v3(p, 0)), ...coreP.map((p) => v3(p, BASE_H))];
    tower.upperDescs.push(hullDesc(corePts));
    const parts: THREE.BufferGeometry[][] = [bySlot(solidGeometry(corePts, () => false))];
    // Everything above the ground floor, band by band.
    const top = spec.bands[spec.bands.length - 1]!.y1;
    for (const band of spec.bands) {
      const ya = Math.max(band.y0, BASE_H);
      if (ya >= band.y1) continue;
      const pts = [...sectionAt(band, ya).map((p) => v3(p, ya)), ...sectionAt(band, band.y1).map((p) => v3(p, band.y1))];
      tower.upperDescs.push(hullDesc(pts));
      parts.push(bySlot(solidGeometry(pts, skin(band), y + band.y1)));
    }
    if (spec.spire) {
      const s = new THREE.CylinderGeometry(spec.spire.r * 0.35, spec.spire.r, spec.spire.h, 10).translate(x, y + top + spec.spire.h / 2, z);
      const rings = [0.15, 0.35, 0.55].map((f) => new THREE.CylinderGeometry(spec.spire!.r * 2.2, spec.spire!.r * 2.2, 1.2, 12).translate(x, y + top + spec.spire!.h * f, z));
      const g = mergeGeometries([s, ...rings].map((q) => q.toNonIndexed()))!;
      parts.push([emptyLike(g), g, emptyLike(g)]);
      tower.upperDescs.push(RAPIER.ColliderDesc.cylinder(spec.spire.h / 2, spec.spire.r).setTranslation(x, y + top + spec.spire.h / 2, z).setCollisionGroups(groups(GROUP.WORLD, 0xffff)));
    }
    tower.intact = [0, 1, 2].map((slot) => mergeAll(parts.map((p) => p[slot]!)));
    return tower;
  }

  /** Put a tower back up: colliders, wall sections, meshes (call `remesh` after). */
  private restore(t: Tower): void {
    const world = this.physics.world;
    for (const c of t.chunks) {
      if (!c.collider) {
        c.collider = world.createCollider(c.desc, this.body);
        this.chunkOf.set(c.collider.handle, c);
      }
      c.damage = 0;
      c.lastHit = -1;
    }
    if (t.upper.length === 0) {
      t.upper = t.upperDescs.map((d) => world.createCollider(d, this.body));
      for (const c of t.upper) this.upperOf.set(c.handle, t);
    }
    t.collapsed = false;
    t.dust = 0;
    t.struck = 0;
    t.lastStrike = -1;
    t.stump = [];
    t.baseFallsAt = -1;
  }

  /** Rebuild the merged meshes of the standing parts. */
  private remesh(): void {
    for (const m of [...this.intactMeshes, ...this.baseMeshes]) {
      this.group.remove(m);
      m.geometry.dispose();
    }
    this.intactMeshes.length = 0;
    this.baseMeshes.length = 0;
    for (const mats of this.slotMats) {
      const standing = this.towers.filter((t) => !t.collapsed && t.spec.facade === mats[0]);
      for (let slot = 0; slot < 3; slot++) {
        const up = mergeAll(standing.map((t) => t.intact[slot]!));
        // The ground floor of a tower broken higher up still stands.
        const all = this.towers.filter((t) => t.spec.facade === mats[0]);
        const base = mergeAll(all.flatMap((t) => t.chunks.filter((c) => c.collider).map((c) => c.geo[slot]!)));
        for (const [g, list] of [
          [up, this.intactMeshes],
          [base, this.baseMeshes],
        ] as const) {
          if (!g.getAttribute('position')?.count) continue;
          const mesh = new THREE.Mesh(g, mats[slot]!);
          mesh.castShadow = slot !== 2;
          mesh.receiveShadow = true;
          list.push(mesh);
          this.group.add(mesh);
        }
      }
    }
  }

  /**
   * A vehicle (`by`, a car by default) hit something with `energy` joules of kinetic energy along
   * (dx, dz). If it is a ground-floor wall section of a tower that kind of vehicle can break, it
   * takes the hit at the next `flush`. Repeated contacts of one crash count once.
   */
  hit(handle: number, energy: number, dx: number, dz: number, by: Breaker = 'car'): void {
    const c = this.chunkOf.get(handle);
    if (!c || c.tower.collapsed || !breakableBy(c.tower.spec, by) || this.stepTime - c.lastHit < 0.4) return;
    c.lastHit = this.stepTime;
    this.pending.push({ c, energy, dx, dz });
  }

  /**
   * An aircraft hit the collider `handle` with `energy` joules of kinetic energy, flying along
   * (dx, dz), at height `y`. Below STRIKE_MIN it is a hit like a car's. From there up, the tower
   * takes it as a whole: once it has taken the energy that would knock out the share of its
   * ground floor that brings it down, it breaks at that height and the part above falls over the
   * way the aircraft was going (see `strikeLimit`). Towers whose `breakers` leave out aircraft
   * ignore it.
   */
  strike(handle: number, energy: number, dx: number, dz: number, y: number): void {
    const c = this.chunkOf.get(handle);
    const t = c ? c.tower : this.upperOf.get(handle);
    if (!t || t.collapsed || !breakableBy(t.spec, 'aircraft')) return;
    // Low on the ground floor it is a hit like a car's; from STRIKE_MIN up the whole tower takes it.
    if (c && y - t.spec.y < STRIKE_MIN) {
      this.hit(handle, energy, dx, dz, 'aircraft');
      return;
    }
    if (this.stepTime - t.lastStrike < 0.4) return;
    t.lastStrike = this.stepTime;
    this.strikes.push({ t, energy, dx, dz, at: y - t.spec.y });
  }

  /**
   * Energy (J) a tower takes above its ground floor before it breaks: half of what knocking out the
   * share of the ground floor that brings it down takes (a light aircraft from about 65 kt).
   */
  private strikeLimit(t: Tower): number {
    return 0.5 * t.chunks.length * COLLAPSE_AT * t.strength;
  }

  /**
   * Apply the hits of the last physics step: break sections, bring towers down. Call it after the
   * physics step, never during one: colliders the cars still hold for this step must stay alive.
   */
  flush(): void {
    this.stepTime += FIXED_DT;
    let bases = false;
    for (const t of this.towers) {
      if (t.baseFallsAt >= 0 && this.stepTime >= t.baseFallsAt) {
        this.baseFalls(t);
        bases = true;
      }
    }
    if (!this.pending.length && !this.strikes.length) {
      if (bases) this.remesh();
      return;
    }
    const touched = new Set<Tower>();
    for (const h of this.pending) {
      this.damage(h.c, h.energy, h.dx, h.dz);
      touched.add(h.c.tower);
    }
    this.pending.length = 0;
    for (const s of this.strikes) {
      const t = s.t;
      if (t.collapsed) continue;
      t.struck += s.energy;
      const at = THREE.MathUtils.clamp(s.at, STRIKE_MIN, t.spec.bands[t.spec.bands.length - 1]!.y1);
      // A burst of dust and debris where it hit, whether the tower holds or not.
      const r = radius(sectionAt(t.spec.bands.find((b) => at <= b.y1) ?? t.spec.bands[0]!, at));
      for (let k = 0; k < 14; k++) this.puff(t.spec.x - s.dx * r, t.spec.y + at, t.spec.z - s.dz * r, 6, 14, 6);
      if (t.struck >= this.strikeLimit(t)) {
        this.collapse(t, { at, dx: s.dx, dz: s.dz });
        if (t.spec.passThrough !== false) this.breakThrough = Math.max(0.25, 1 - this.strikeLimit(t) / Math.max(s.energy, 1));
      }
      touched.add(t);
    }
    this.strikes.length = 0;
    for (const t of touched) if (!t.collapsed && this.unstable(t)) this.collapse(t);
    this.remesh();
  }

  private unstable(t: Tower): boolean {
    const gone = t.chunks.filter((k) => !k.collider);
    if (gone.length >= t.chunks.length * COLLAPSE_AT) return true;
    const sides = t.spec.bands[0]!.bottom.length;
    for (let e = 0; e < sides; e++) {
      const all = t.chunks.filter((k) => k.side === e).length;
      if (gone.filter((k) => k.side === e).length >= all * SIDE_GONE) return true;
    }
    return false;
  }

  private damage(c: Chunk, energy: number, dx: number, dz: number): void {
    if (!c.collider) return;
    c.damage += energy;
    const over = c.damage - c.tower.strength;
    if (over < 0) return;
    this.breakChunk(c, dx, dz, 3);
    // What the section did not take carries on to its neighbours.
    const n = c.tower.chunks.length;
    for (const k of [(c.i + 1) % n, (c.i + n - 1) % n]) this.damage(c.tower.chunks[k]!, over * 0.5, dx, dz);
  }

  private breakChunk(c: Chunk, dx: number, dz: number, push: number): void {
    if (!c.collider) return;
    this.chunkOf.delete(c.collider.handle);
    this.physics.world.removeCollider(c.collider, false);
    c.collider = null;
    const v = new THREE.Vector3(dx, 0, dz).normalize().multiplyScalar(push);
    this.spawn(c.points, (cx, cy, cz) => this.chunkSkin(c, cx, cy, cz), this.slotsOf(c.tower), v, new THREE.Vector3(), false);
    const mid = c.points.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / c.points.length);
    for (let k = 0; k < 10; k++) this.puff(mid.x, mid.y - 4, mid.z, 5, 12, 4);
  }

  private chunkSkin(c: Chunk, cx: number, cy: number, cz: number): boolean {
    const s = c.tower.spec;
    return edgeDistance(c.tower.spec.bands[0]!.bottom, cx - s.x, cz - s.z) < 0.3 && cy - s.y < BASE_H + 0.1;
  }

  /**
   * A block's body from the convex hull of `points` (world space), dynamic or fixed (the stump of a
   * tower broken higher up), and its geometry about its centre.
   */
  private block(points: THREE.Vector3[], onSkin: (cx: number, cy: number, cz: number) => boolean, vel: THREE.Vector3, ang: THREE.Vector3, falling: boolean, roofAt = Infinity, fixed = false): Block | null {
    const { RAPIER, world } = this.physics;
    const centre = points.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / points.length);
    // Blocks of a falling tower start a little apart: no contacts to resolve between them at once.
    const k = falling ? 0.95 : 1;
    const local = Float32Array.from(points.flatMap((p) => [(p.x - centre.x) * k, (p.y - centre.y) * k, (p.z - centre.z) * k]));
    const desc = RAPIER.ColliderDesc.convexHull(local);
    if (!desc) return null;
    const geo = solidGeometry(points, onSkin, roofAt, centre, k);
    geo.computeBoundingBox();
    const size = geo.boundingBox!.getSize(new THREE.Vector3());
    const volume = Math.max(1, size.x * size.y * size.z * 0.6);
    const mass = THREE.MathUtils.clamp(volume * DENSITY, MASS_MIN, MASS_MAX);
    const body = world.createRigidBody(
      (fixed ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.dynamic())
        .setTranslation(centre.x, centre.y, centre.z)
        .setLinvel(vel.x, vel.y, vel.z)
        .setAngvel({ x: ang.x, y: ang.y, z: ang.z })
        .setLinearDamping(0.05)
        .setAngularDamping(0.4)
        .setCanSleep(true),
    );
    world.createCollider(desc.setDensity(mass / volume).setFriction(0.45).setRestitution(0.02).setCollisionGroups(groups(fixed ? GROUP.WORLD : GROUP.PROP, 0xffff)), body);
    return { body, geo, falling };
  }

  /** One block with its own mesh (a broken ground-floor section, a spire). */
  private spawn(points: THREE.Vector3[], onSkin: (cx: number, cy: number, cz: number) => boolean, slots: THREE.Material[], vel: THREE.Vector3, ang: THREE.Vector3, falling: boolean, roofAt = Infinity): void {
    const b = this.block(points, onSkin, vel, ang, falling, roofAt);
    if (!b) return;
    const mesh = new THREE.Mesh(b.geo, slots);
    const t = b.body.translation();
    mesh.position.set(t.x, t.y, t.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.debris.push({ body: b.body, mesh, batch: null, falling, still: 0 });
  }

  /** The blocks of a collapse drawn together: one batched mesh per material slot (a few draw calls for hundreds of blocks). */
  private batch(blocks: Block[], slots: THREE.Material[]): void {
    const perSlot = blocks.map((b) => bySlot(b.geo));
    const meshes: THREE.BatchedMesh[] = [];
    const slotOf: number[] = [];
    for (let slot = 0; slot < 3; slot++) {
      let verts = 0;
      let n = 0;
      for (const g of perSlot) {
        const c = g[slot]!.getAttribute('position').count;
        if (c) {
          verts += c;
          n++;
        }
      }
      if (!n) continue;
      const m = new THREE.BatchedMesh(n, verts, 0, slots[slot]!);
      m.castShadow = slot !== 2;
      m.receiveShadow = true;
      meshes.push(m);
      slotOf.push(slot);
      this.group.add(m);
    }
    const mat = new THREE.Matrix4();
    blocks.forEach((b, i) => {
      const ids: number[] = [];
      meshes.forEach((m, j) => {
        const g = perSlot[i]![slotOf[j]!]!;
        if (!g.getAttribute('position').count) {
          ids.push(-1);
          return;
        }
        const id = m.addInstance(m.addGeometry(g));
        const t = b.body.translation();
        m.setMatrixAt(id, mat.makeTranslation(t.x, t.y, t.z));
        ids.push(id);
      });
      b.geo.dispose();
      this.debris.push({ body: b.body, mesh: null, batch: { meshes, ids }, falling: b.falling, still: 0 });
    });
  }

  /** The ground floor's remaining sections burst out and fall over, as blocks for `add`. */
  private burstGround(t: Tower, add: (b: Block | null) => void): void {
    const world = this.physics.world;
    for (const c of t.chunks) {
      if (!c.collider) continue;
      this.chunkOf.delete(c.collider.handle);
      world.removeCollider(c.collider, false);
      c.collider = null;
      const tip = new THREE.Vector3(c.out.z, 0, -c.out.x).multiplyScalar(0.9);
      add(this.block(c.points, (cx, cy, cz) => this.chunkSkin(c, cx, cy, cz), c.out.clone().multiplyScalar(4).add(new THREE.Vector3(0, -0.5, 0)), tip, true));
    }
  }

  /** The stump of a tower broken higher up gives way too: its blocks fall, its ground floor bursts. */
  private baseFalls(t: Tower): void {
    t.baseFallsAt = -1;
    const { RAPIER } = this.physics;
    const { x, z, y } = t.spec;
    for (const b of t.stump) {
      if (!b.isValid() || !b.isFixed()) continue;
      b.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      const p = b.translation();
      const out = new THREE.Vector3(p.x - x, 0, p.z - z);
      const len = out.length() || 1;
      out.multiplyScalar((1 + 0.03 * (p.y - y)) / len);
      b.setLinvel({ x: out.x + (Math.random() - 0.5), y: -1 - Math.random() * 2, z: out.z + (Math.random() - 0.5) }, true);
      b.setAngvel({ x: (Math.random() - 0.5) * 0.4, y: (Math.random() - 0.5) * 0.2, z: (Math.random() - 0.5) * 0.4 }, true);
    }
    for (const d of this.debris) if (t.stump.includes(d.body)) d.falling = true;
    t.stump = [];
    const blocks: Block[] = [];
    this.burstGround(t, (b) => {
      if (b) blocks.push(b);
    });
    if (blocks.length) this.batch(blocks, this.slotsOf(t));
    t.dust = 6;
  }

  /**
   * The tower gives way: storey blocks, split around the axis, lean and fall. From the ground floor
   * (the side that gave way decides where it leans), or, struck higher up (`at` metres above its
   * foot, along `dx`, `dz`), from that height: the blocks above fall over that way, the stump below
   * stays standing as fixed blocks, the ground floor too.
   */
  private collapse(t: Tower, struck?: { at: number; dx: number; dz: number }): void {
    if (t.collapsed) return;
    t.collapsed = true;
    this.collapses++;
    const world = this.physics.world;
    for (const c of t.upper) {
      this.upperOf.delete(c.handle);
      world.removeCollider(c, false);
    }
    t.upper = [];
    const lean = new THREE.Vector3();
    if (struck) lean.set(struck.dx, 0, struck.dz);
    else for (const c of t.chunks) if (!c.collider) lean.add(c.out);
    if (lean.lengthSq() < 1e-6) lean.set(1, 0, 0);
    lean.normalize();
    const { x, z, y } = t.spec;
    const top = t.spec.bands[t.spec.bands.length - 1]!.y1;
    // Where it breaks: blocks that end at or below this height stay.
    const breakAt = struck ? struck.at : 0;
    const { seg, k } = breakUp(t.spec);
    let pivotY = top;
    for (const band of t.spec.bands) for (const [y0, y1] of slices(band, seg)) if (y1 > breakAt + 0.01) pivotY = Math.min(pivotY, y0);
    // Struck within the ground floor: it all goes from there, ground floor included.
    const low = struck !== undefined && breakAt < BASE_H;
    if (low) pivotY = breakAt;
    if (!struck) pivotY = 0;
    // Tipping rate of a column of that height falling over (a short one goes over faster).
    const height = Math.max(20, top - pivotY);
    const w = 0.75 * Math.sqrt(9.81 / height) * (0.9 + Math.random() * 0.2);
    const omega = new THREE.Vector3(lean.z, 0, -lean.x).multiplyScalar(w);
    const pivotBand = t.spec.bands.find((b) => pivotY <= b.y1) ?? t.spec.bands[0]!;
    const pivot = new THREE.Vector3(x, y + pivotY, z).addScaledVector(lean, radius(sectionAt(pivotBand, pivotY)) * 0.7);
    const r = new THREE.Vector3();
    // Each block also moves out from the axis a little: a stack of blocks resting on each other
    // would otherwise stand like a column of bricks.
    const velAt = (p: THREE.Vector3): THREE.Vector3 => {
      const out = new THREE.Vector3(p.x - x, 0, p.z - z);
      const len = out.length();
      if (len > 1e-3) out.multiplyScalar((1.5 + 0.015 * (p.y - y)) / len);
      return new THREE.Vector3()
        .crossVectors(omega, r.copy(p).sub(pivot))
        .add(out)
        .add(new THREE.Vector3((Math.random() - 0.5) * 2, -1.5 - Math.random() * 2, (Math.random() - 0.5) * 2));
    };
    const spin = (): THREE.Vector3 => omega.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.3));
    const slots = this.slotsOf(t);
    const blocks: Block[] = [];
    const add = (b: Block | null): void => {
      if (b) blocks.push(b);
    };
    // The rest of the ground floor bursts out and falls over: nothing holds the tower up.
    if (!struck || low) this.burstGround(t, add);
    const phase = Math.PI / 4;
    for (const band of t.spec.bands) {
      const skin = (cx: number, cy: number, cz: number): boolean => edgeDistance(sectionAt(band, cy - y), cx - x, cz - z) < 0.3;
      for (const [y0, y1] of slices(band, seg)) {
        const sec0 = sectionAt(band, y0);
        const sec1 = sectionAt(band, y1);
        // Halfway out from the axis, each wedge is cut once more: an inner and an outer piece.
        const cut = 0.5 * Math.min(radius(sec0), radius(sec1));
        for (let q = 0; q < k; q++) {
          const a0 = phase + (q / k) * Math.PI * 2;
          const a1 = phase + ((q + 1) / k) * Math.PI * 2;
          const am = (a0 + a1) / 2;
          const ca = Math.cos(am);
          const sa = Math.sin(am);
          const w0 = wedge(sec0, a0, a1);
          const w1 = wedge(sec1, a0, a1);
          for (const [p0, p1] of [
            [clip(w0, ca, sa, cut), clip(w1, ca, sa, cut)],
            [clip(w0, -ca, -sa, -cut), clip(w1, -ca, -sa, -cut)],
          ] as const) {
            if (p0.length < 3 && p1.length < 3) continue;
            const pts = [...p0.map((p) => new THREE.Vector3(x + p[0], y + y0, z + p[1])), ...p1.map((p) => new THREE.Vector3(x + p[0], y + y1, z + p[1]))];
            if (pts.length < 4) continue;
            const centre = pts.reduce((m, p) => m.add(p), new THREE.Vector3()).multiplyScalar(1 / pts.length);
            if (y1 < pivotY + 0.01) {
              const b = this.block(pts, skin, new THREE.Vector3(), new THREE.Vector3(), false, y + band.y1, true);
              if (b) t.stump.push(b.body);
              add(b);
            }
            else add(this.block(pts, skin, velAt(centre), spin(), true, y + band.y1));
          }
        }
      }
    }
    this.batch(blocks, slots);
    if (t.spec.spire) {
      const { r, h } = t.spec.spire;
      const pts: THREE.Vector3[] = [];
      for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2;
        pts.push(new THREE.Vector3(x + Math.cos(ang) * r, y + top, z + Math.sin(ang) * r), new THREE.Vector3(x + Math.cos(ang) * r * 0.35, y + top + h, z + Math.sin(ang) * r * 0.35));
      }
      this.spawn(pts, () => false, [this.mats.mast, this.mats.mast, this.mats.mast], velAt(new THREE.Vector3(x, y + top + h / 2, z)), spin(), true);
    }
    t.dust = struck ? 5 : 9;
    // A stump left standing comes down a little later, ground floor and all.
    if (t.stump.length || (struck && !low)) t.baseFallsAt = this.stepTime + BASE_FALLS_AFTER;
  }

  /** A dust puff around (x, y, z), `size` metres across at first, rolling out `out` m/s. */
  private puff(x: number, y: number, z: number, size: number, spread: number, out = 3): void {
    const a = Math.random() * Math.PI * 2;
    const v = out * (0.4 + Math.random() * 0.6);
    this.dust?.spawn(
      x + (Math.random() - 0.5) * spread, y + Math.random() * size * 0.3, z + (Math.random() - 0.5) * spread,
      Math.cos(a) * v, 0.5 + Math.random() * 2.5, Math.sin(a) * v,
      7 + Math.random() * 7, size, size * (3 + Math.random() * 2), 0.85, 0.82,
    );
  }

  /** Per frame (absolute time in seconds): falling blocks, dust. */
  update(seconds: number): void {
    const dt = this.lastSeconds < 0 ? 0 : Math.min(0.1, Math.max(0, seconds - this.lastSeconds));
    this.lastSeconds = seconds;
    this.time += dt;
    for (const d of this.debris) {
      const b = d.body;
      if (b.isSleeping() || b.isFixed()) continue;
      const p = b.translation();
      const q = b.rotation();
      if (d.mesh) {
        d.mesh.position.set(p.x, p.y, p.z);
        d.mesh.quaternion.set(q.x, q.y, q.z, q.w);
      } else if (d.batch) {
        _m.compose(_pp.set(p.x, p.y, p.z), _qq.set(q.x, q.y, q.z, q.w), _one);
        d.batch.meshes.forEach((m, j) => {
          const id = d.batch!.ids[j]!;
          if (id >= 0) m.setMatrixAt(id, _m);
        });
      }
      const vy = b.linvel().y;
      if (d.falling && vy > -3 && p.y < 60) {
        // Landed: a cloud where it hit, and rubble settles (and sleeps) rather than rocking on.
        for (let k = 0; k < 5; k++) this.puff(p.x, p.y - 4, p.z, 14, 20, 8);
        b.setLinearDamping(0.8);
        b.setAngularDamping(2);
      }
      d.falling = vy < -8;
      const v = b.linvel();
      const w = b.angvel();
      if (v.x * v.x + v.y * v.y + v.z * v.z < 1 && w.x * w.x + w.y * w.y + w.z * w.z < 0.5) {
        d.still += dt;
        // Settled rubble (tonnes of it: no car moves it) turns static and costs nothing more.
        if (d.still > 0.8) b.setBodyType(this.physics.RAPIER.RigidBodyType.Fixed, true);
      } else d.still = 0;
    }
    for (const t of this.towers) {
      if (t.dust <= 0) continue;
      t.dust -= dt;
      // A wall of dust rolling out from the foot of the tower.
      const r = radius(t.spec.bands[0]!.bottom);
      const n = Math.ceil(dt * 50);
      // The puffs barely rise on their own (they slow down fast): seed them up to the height of
      // the neighbours, thicker low down, so the cloud stands as a column that spreads.
      for (let k = 0; k < n; k++) {
        const a = Math.random() * Math.PI * 2;
        const h = Math.random() ** 2 * (40 + r * 1.5);
        this.puff(t.spec.x + Math.cos(a) * r, t.spec.y + h, t.spec.z + Math.sin(a) * r, 18 + r * 0.35, r * 1.2, 10);
      }
    }
    this.dust?.update(dt);
  }

  /** Clear the rubble and put every tower back up. */
  rebuild(): void {
    this.pending.length = 0;
    this.strikes.length = 0;
    if (!this.debris.length && this.towers.every((t) => !t.collapsed && t.struck === 0 && t.chunks.every((c) => c.collider))) return;
    const batches = new Set<THREE.BatchedMesh>();
    for (const d of this.debris) {
      this.physics.world.removeRigidBody(d.body);
      if (d.mesh) {
        this.group.remove(d.mesh);
        d.mesh.geometry.dispose();
      }
      for (const m of d.batch?.meshes ?? []) batches.add(m);
    }
    for (const m of batches) {
      this.group.remove(m);
      m.dispose();
    }
    this.debris.length = 0;
    this.dust?.clear();
    for (const t of this.towers) this.restore(t);
    this.remesh();
  }

  /** Towers standing / total, and debris blocks (tests, debug). */
  get stats(): { towers: number; standing: number; debris: number; names: string[] } {
    return { towers: this.towers.length, standing: this.towers.filter((t) => !t.collapsed).length, debris: this.debris.length, names: this.towers.map((t) => t.spec.name) };
  }

  /** The tower named `name`: its foot, its ground-floor sections still standing (debug, tests). */
  tower(name: string): { x: number; z: number; y: number; sections: number; standing: number; collapsed: boolean; handles: number[]; upper: number[]; struck: number } | null {
    const t = this.towers.find((k) => k.spec.name === name);
    if (!t) return null;
    const alive = t.chunks.filter((c) => c.collider);
    return {
      x: t.spec.x,
      z: t.spec.z,
      y: t.spec.y,
      sections: t.chunks.length,
      standing: alive.length,
      collapsed: t.collapsed,
      handles: alive.map((c) => c.collider!.handle),
      upper: t.upper.map((c) => c.handle),
      struck: t.struck,
    };
  }
}

function emptyLike(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv'] as const) {
    const a = g.getAttribute(name);
    out.setAttribute(name, new THREE.BufferAttribute(new Float32Array(0), a ? a.itemSize : name === 'uv' ? 2 : 3));
  }
  return out;
}

function mergeAll(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const parts = list.filter((g) => (g.getAttribute('position')?.count ?? 0) > 0);
  if (!parts.length) return new THREE.BufferGeometry();
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)).map((p) => stripTo(p)))!;
  g.computeBoundingSphere();
  return g;
}

/** Keep position, normal and uv only (merging needs the same attributes). */
function stripTo(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', g.getAttribute('position'));
  out.setAttribute('normal', g.getAttribute('normal'));
  const uv = g.getAttribute('uv');
  out.setAttribute('uv', uv ?? new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
  return out;
}

// ---- shapes ----------------------------------------------------------------------------------------------

export function rect(hx: number, hz: number): Poly {
  return [
    [-hx, -hz],
    [hx, -hz],
    [hx, hz],
    [-hx, hz],
  ];
}

/**
 * A tower of the original World Trade Center (New York, 1973-2001): a plain square prism 63.4 m
 * wide and 417 m tall (the South Tower 415 m), the North Tower with its 110 m antenna. Cars can
 * bring it down; aircraft cannot (`breakers`).
 */
export function twinTower(name: string, x: number, z: number, y: number, facade: THREE.Material, north: boolean): TowerSpec {
  const plan = rect(31.7, 31.7);
  return {
    name,
    x,
    z,
    y,
    facade,
    bands: [{ y0: 0, y1: north ? 417 : 415, bottom: plan, top: plan }],
    ...(north ? { spire: { r: 1.8, h: 110 } } : {}),
    breakers: ['car', 'aircraft'],
    passThrough: true,
  };
}
