import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { CarModel, DeformableMeshData } from '../render/carModel';
import type { VehicleConfig } from '../vehicle/types';
import { convexQuery, type Cabin } from './cabin';

/** A plastic contact reported by the crumple zones during one physics step. */
export interface ImprintContact {
  collider: RAPIER.Collider;
  /** World-space contact point. */
  point: THREE.Vector3;
  /** Crush direction in the chassis frame (unit, pointing OUT of the car through the contact). */
  dir: THREE.Vector3;
  /** Surface normal of the obstacle at the contact, world space, pointing towards the car. */
  normal: THREE.Vector3;
  /** The obstacle is another car with its own crumple zones (share the overlap). */
  shared: boolean;
}

interface MeshBinding {
  mesh: THREE.Mesh;
  data: DeformableMeshData;
  pos: Float32Array;
  /** Inverse rest matrix (16 values, column-major): chassis displacement back to the mesh frame. */
  invRot: Float64Array;
  /** Rest positions in the chassis frame. */
  restC: Float32Array;
  restN: Float32Array;
  /** Lattice cell (flat index of its min corner) and fractional coords per vertex. */
  cell: Int32Array;
  cellXYZ: Uint16Array;
  frac: Float32Array;
  /** Bounding box in lattice cells (to skip meshes far from a change). */
  cmin: [number, number, number];
  cmax: [number, number, number];
  hash: number;
  maxDisp: number;
  /** Vertex index with the largest displacement. */
  maxIndex: number;
  needsNormals: boolean;
}

const H = 0.1; // lattice spacing (m)
/** Vertices whose normals are recomputed per frame at most (after a crash). */
const NORMALS_BUDGET = 40000;
const WAVE = 0.13; // crumple wavelength (m)
const DECAY = 0.12; // screened-Laplace decay per iteration (larger = more local dents)
/** Lattice nodes beyond which a dirty region counts as big (a rollover), and how often those update (ms). */
const BIG_REGION = 9000;
const BIG_EVERY = 66;

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

const _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _d = new THREE.Vector3();
const _pt = { x: 0, y: 0, z: 0 };
/** How far inside the car the open-surface test starts (m): deeper than any dent. */
const OPEN_REACH = 1.0;
/** How far on the car's side of a surface's tangent plane a node can still be past a curved surface (m). */
const OPEN_SLACK = 0.12;

/** Shapes with an inside (containsPoint works); terrain, road decks and polylines are open surfaces. */
function hasInside(c: RAPIER.Collider): boolean {
  const t = c.shapeType();
  return t !== 4 && t !== 6 && t !== 7; // Polyline, TriMesh, HeightField
}

/**
 * Crash deformation as a volumetric field over the car.
 *
 * 1. Imprint: whenever the crumple zones yield against an obstacle, lattice nodes of the car that end
 *    up inside that obstacle are pushed back out along the crush direction, exactly to its surface,
 *    so the car takes the shape of what it hit (a pole leaves a V, a wall flattens the nose).
 * 2. Spread: a screened Laplace relaxation drags the surrounding metal along, decaying over ~30 cm,
 *    while nodes inside the passenger-cell core stay put.
 * 3. Crumple: where the field compresses a panel in its own plane, the sheet must fold (its length
 *    is conserved), so each vertex gets a wrinkle whose amplitude follows from the compression.
 * Everything is plastic and deterministic. Every mesh of the car but the wheels follows the field.
 */
export class Deformer {
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly origin = new THREE.Vector3();
  /** Displacement per node (chassis frame). */
  readonly D: Float32Array;
  /** 1 = pinned at zero (core), 2 = imprinted by an obstacle (fixed this solve). */
  private readonly flag: Uint8Array;
  /** Per-node in-plane compression (0..0.9) and its axis (0 x, 1 y, 2 z). */
  private readonly comp: Float32Array;
  private readonly compAxis: Uint8Array;
  private readonly bindings: MeshBinding[] = [];
  private readonly ray: RAPIER.Ray;
  private dirty = false;
  private normalsCursor = 0;
  // Per-call cache for nodes already found outside a collider.
  private readonly missCall: Uint32Array;
  private readonly missHandle: Float64Array;
  private imprintCall = 0;
  private dmin = [0, 0, 0];
  private dmax = [0, 0, 0];
  private lastNormals = 0;
  private lastBig = -Infinity;
  /** Total number of imprinted node updates (debug). */
  imprints = 0;

  constructor(RAPIER_: typeof RAPIER, model: CarModel, cfg: VehicleConfig, cabin: Cabin | null = null) {
    // Lattice bounds: every deformable vertex in the chassis frame, plus a margin.
    const box = new THREE.Box3();
    const m4 = new THREE.Matrix4();
    for (const mesh of model.meshes) {
      const data = mesh.userData as DeformableMeshData;
      m4.fromArray(data.restMatrix);
      const r = data.rest;
      for (let i = 0; i < r.length; i += 3) box.expandByPoint(_v.set(r[i]!, r[i + 1]!, r[i + 2]!).applyMatrix4(m4));
    }
    box.expandByScalar(0.25);
    this.origin.copy(box.min);
    const size = box.getSize(_v);
    this.nx = Math.ceil(size.x / H) + 1;
    this.ny = Math.ceil(size.y / H) + 1;
    this.nz = Math.ceil(size.z / H) + 1;
    const n = this.nx * this.ny * this.nz;
    this.D = new Float32Array(n * 3);
    this.flag = new Uint8Array(n);
    this.missCall = new Uint32Array(n);
    this.missHandle = new Float64Array(n);
    this.comp = new Float32Array(n);
    this.compAxis = new Uint8Array(n);
    this.ray = new RAPIER_.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });

    // Pin the hard core (colliders shrunk a little): the lower body's box and the passenger cell.
    const s = 0.05;
    cfg.colliders.forEach((c, k) => {
      if (cabin && k === cabin.collider) return;
      const [cx, cy, cz] = c.center;
      const [hx, hy, hz] = c.half;
      this.forBox(cx - hx + s, cy - hy + s, cz - hz + s, cx + hx - s, cy + hy - s, cz + hz - s, (i) => (this.flag[i] = 1));
    });
    if (cabin) this.pinHull(RAPIER_, cabin, s);

    // Bind every vertex to its lattice cell.
    for (const mesh of model.meshes) {
      const data = mesh.userData as DeformableMeshData;
      m4.fromArray(data.restMatrix);
      const rest = data.rest;
      const nv = rest.length / 3;
      const restC = new Float32Array(rest.length);
      const restN = new Float32Array(rest.length);
      const cell = new Int32Array(nv);
      const cellXYZ = new Uint16Array(nv * 3);
      const frac = new Float32Array(nv * 3);
      const n3 = new THREE.Matrix3().setFromMatrix4(m4);
      const cmin: [number, number, number] = [1e9, 1e9, 1e9];
      const cmax: [number, number, number] = [-1e9, -1e9, -1e9];
      for (let v = 0; v < nv; v++) {
        _v.set(rest[v * 3]!, rest[v * 3 + 1]!, rest[v * 3 + 2]!).applyMatrix4(m4);
        restC[v * 3] = _v.x;
        restC[v * 3 + 1] = _v.y;
        restC[v * 3 + 2] = _v.z;
        _w.set(data.restNormal[v * 3]!, data.restNormal[v * 3 + 1]!, data.restNormal[v * 3 + 2]!).applyMatrix3(n3).normalize();
        restN[v * 3] = _w.x;
        restN[v * 3 + 1] = _w.y;
        restN[v * 3 + 2] = _w.z;
        const gx = Math.min(Math.max((_v.x - this.origin.x) / H, 0), this.nx - 1.001);
        const gy = Math.min(Math.max((_v.y - this.origin.y) / H, 0), this.ny - 1.001);
        const gz = Math.min(Math.max((_v.z - this.origin.z) / H, 0), this.nz - 1.001);
        const ix = Math.floor(gx);
        const iy = Math.floor(gy);
        const iz = Math.floor(gz);
        cell[v] = this.idx(ix, iy, iz);
        cellXYZ[v * 3] = ix;
        cellXYZ[v * 3 + 1] = iy;
        cellXYZ[v * 3 + 2] = iz;
        frac[v * 3] = gx - ix;
        frac[v * 3 + 1] = gy - iy;
        frac[v * 3 + 2] = gz - iz;
        cmin[0] = Math.min(cmin[0], ix);
        cmin[1] = Math.min(cmin[1], iy);
        cmin[2] = Math.min(cmin[2], iz);
        cmax[0] = Math.max(cmax[0], ix + 1);
        cmax[1] = Math.max(cmax[1], iy + 1);
        cmax[2] = Math.max(cmax[2], iz + 1);
      }
      // Inverse of the rest matrix, column-major like Matrix4.elements (only its rotation part is read).
      const invRot = Float64Array.from(new THREE.Matrix4().copy(m4).invert().elements);
      this.bindings.push({
        mesh,
        data,
        pos: (mesh.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array,
        invRot,
        restC,
        restN,
        cell,
        cellXYZ,
        frac,
        cmin,
        cmax,
        hash: hashStr(data.part),
        maxDisp: 0,
        maxIndex: 0,
        needsNormals: false,
      });
    }
  }

  /** Pin the nodes inside the passenger cell's hull, shrunk by `s` towards its centre. */
  private pinHull(R: typeof RAPIER, cabin: Cabin, s: number): void {
    const [cx, cy, cz] = cabin.centre;
    const pts = Float32Array.from(cabin.core);
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pts.length; i += 3) {
      const dx = pts[i]! - cx;
      const dy = pts[i + 1]! - cy;
      const dz = pts[i + 2]! - cz;
      const k = Math.max(0, 1 - s / (Math.hypot(dx, dy, dz) || 1));
      pts[i] = cx + dx * k;
      pts[i + 1] = cy + dy * k;
      pts[i + 2] = cz + dz * k;
      for (let a = 0; a < 3; a++) {
        lo[a] = Math.min(lo[a]!, pts[i + a]!);
        hi[a] = Math.max(hi[a]!, pts[i + a]!);
      }
    }
    const hull = convexQuery(R, pts);
    if (!hull) return;
    this.forBox(lo[0]!, lo[1]!, lo[2]!, hi[0]!, hi[1]!, hi[2]!, (i, ix, iy, iz) => {
      _pt.x = this.origin.x + ix * H;
      _pt.y = this.origin.y + iy * H;
      _pt.z = this.origin.z + iz * H;
      if (hull.contains(_pt)) this.flag[i] = 1;
    });
    hull.free();
  }

  idx(ix: number, iy: number, iz: number): number {
    return (iz * this.ny + iy) * this.nx + ix;
  }

  private forBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, fn: (i: number, ix: number, iy: number, iz: number) => void): void {
    const ix0 = Math.max(0, Math.ceil((x0 - this.origin.x) / H));
    const iy0 = Math.max(0, Math.ceil((y0 - this.origin.y) / H));
    const iz0 = Math.max(0, Math.ceil((z0 - this.origin.z) / H));
    const ix1 = Math.min(this.nx - 1, Math.floor((x1 - this.origin.x) / H));
    const iy1 = Math.min(this.ny - 1, Math.floor((y1 - this.origin.y) / H));
    const iz1 = Math.min(this.nz - 1, Math.floor((z1 - this.origin.z) / H));
    for (let iz = iz0; iz <= iz1; iz++) for (let iy = iy0; iy <= iy1; iy++) for (let ix = ix0; ix <= ix1; ix++) fn(this.idx(ix, iy, iz), ix, iy, iz);
  }

  private markDirty(ix: number, iy: number, iz: number): void {
    if (!this.dirty) {
      this.dirty = true;
      this.dmin[0] = ix;
      this.dmin[1] = iy;
      this.dmin[2] = iz;
      this.dmax[0] = ix;
      this.dmax[1] = iy;
      this.dmax[2] = iz;
      return;
    }
    this.dmin[0] = Math.min(this.dmin[0]!, ix);
    this.dmin[1] = Math.min(this.dmin[1]!, iy);
    this.dmin[2] = Math.min(this.dmin[2]!, iz);
    this.dmax[0] = Math.max(this.dmax[0]!, ix);
    this.dmax[1] = Math.max(this.dmax[1]!, iy);
    this.dmax[2] = Math.max(this.dmax[2]!, iz);
  }

  /**
   * Push lattice nodes that ended up inside obstacles back out to their surface.
   * Call once per physics step with the plastic contacts of that step (car transform before the step).
   */
  imprint(
    carPos: THREE.Vector3,
    carQuat: THREE.Quaternion,
    contacts: readonly ImprintContact[],
    crushNear?: (x: number, y: number, z: number) => number,
  ): void {
    if (contacts.length === 0) return;
    _q.copy(carQuat);
    _qi.copy(carQuat).invert();
    const R = 0.75;
    // Many contacts of one step are on the same obstacle with overlapping boxes: each node is handled
    // at most once per obstacle per call (found outside it, or pushed out / capped by it).
    this.imprintCall = (this.imprintCall % 0xfffffffe) + 1;
    const call = this.imprintCall;
    for (const c of contacts) {
      // Contact point in the chassis frame.
      _v.copy(c.point).sub(carPos).applyQuaternion(_qi);
      const inward = _d.copy(c.dir).negate();
      const handle = c.collider.handle;
      const solid = hasInside(c.collider);
      this.forBox(_v.x - R, _v.y - R, _v.z - R, _v.x + R, _v.y + R, _v.z + R, (i, ix, iy, iz) => {
        if (this.flag[i] === 1) return;
        if (this.missCall[i] === call && this.missHandle[i] === handle) return;
        const o = i * 3;
        // Deformed node position, chassis then world.
        _w.set(this.origin.x + ix * H + this.D[o]!, this.origin.y + iy * H + this.D[o + 1]!, this.origin.z + iz * H + this.D[o + 2]!);
        _w.applyQuaternion(_q).add(carPos);
        _pt.x = _w.x;
        _pt.y = _w.y;
        _pt.z = _w.z;
        const dirW = _w.copy(inward).applyQuaternion(_q);
        let toi: number;
        if (solid) {
          if (!c.collider.containsPoint(_pt)) {
            this.missCall[i] = call;
            this.missHandle[i] = handle;
            return;
          }
          // Exit distance along the inward crush direction.
          this.ray.origin.x = _pt.x;
          this.ray.origin.y = _pt.y;
          this.ray.origin.z = _pt.z;
          this.ray.dir.x = dirW.x;
          this.ray.dir.y = dirW.y;
          this.ray.dir.z = dirW.z;
          toi = c.collider.castRay(this.ray, 1.5, false);
          if (!(toi >= 0)) return;
        } else {
          // Terrain and road decks have no inside: the node is past the surface when a ray cast
          // outward from a point well inside the car meets the surface before reaching the node.
          // Nodes clearly on the car's side of the surface's tangent plane are skipped first.
          const above = (_pt.x - c.point.x) * c.normal.x + (_pt.y - c.point.y) * c.normal.y + (_pt.z - c.point.z) * c.normal.z;
          if (above > OPEN_SLACK) {
            this.missCall[i] = call;
            this.missHandle[i] = handle;
            return;
          }
          this.ray.origin.x = _pt.x + dirW.x * OPEN_REACH;
          this.ray.origin.y = _pt.y + dirW.y * OPEN_REACH;
          this.ray.origin.z = _pt.z + dirW.z * OPEN_REACH;
          this.ray.dir.x = -dirW.x;
          this.ray.dir.y = -dirW.y;
          this.ray.dir.z = -dirW.z;
          const t = c.collider.castRay(this.ray, OPEN_REACH, false);
          if (!(t >= 0)) {
            this.missCall[i] = call;
            this.missHandle[i] = handle;
            return;
          }
          toi = OPEN_REACH - t;
        }
        toi = Math.min(toi + 0.004, 0.9);
        if (c.shared) toi *= 0.5;
        let nx = this.D[o]! + inward.x * toi;
        let ny = this.D[o + 1]! + inward.y * toi;
        let nz = this.D[o + 2]! + inward.z * toi;
        const len = Math.hypot(nx, ny, nz);
        // The obstacle overlap also holds the elastic travel of the bumper (which springs back), and
        // against another car we only see its undeformed outline: cap the dent to what our own
        // crumple zone actually took for good at this node, so the metal follows the physics. The
        // cap belongs to the node, not to the contact, so it does not matter which contact got here first.
        const cap = crushNear ? crushNear(this.origin.x + ix * H, this.origin.y + iy * H, this.origin.z + iz * H) * 1.1 + 0.01 : Infinity;
        if (len > cap) {
          const k = Math.max(cap, Math.hypot(this.D[o]!, this.D[o + 1]!, this.D[o + 2]!)) / len;
          nx *= k;
          ny *= k;
          nz *= k;
        }
        this.D[o] = nx;
        this.D[o + 1] = ny;
        this.D[o + 2] = nz;
        // Done for this obstacle in this call: pushed out, or held at the crush cap (the dent may not
        // exceed what the crumple zone took). Later contacts of the same obstacle would only redo it.
        this.missCall[i] = call;
        this.missHandle[i] = handle;
        this.flag[i] = 2;
        this.imprints++;
        this.markDirty(ix, iy, iz);
      });
    }
  }

  /** Spread, compute crumples and update meshes (call once per rendered frame). */
  update(now: number): void {
    if (this.dirty) {
      const pad = 5;
      const x0 = Math.max(1, this.dmin[0]! - pad);
      const y0 = Math.max(1, this.dmin[1]! - pad);
      const z0 = Math.max(1, this.dmin[2]! - pad);
      const x1 = Math.min(this.nx - 2, this.dmax[0]! + pad);
      const y1 = Math.min(this.ny - 2, this.dmax[1]! + pad);
      const z1 = Math.min(this.nz - 2, this.dmax[2]! + pad);
      // A car tumbling over dents most of its shell every step: re-skin a region that large at
      // most every BIG_EVERY ms (the dents keep accumulating in between, nothing is lost).
      const big = (x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > BIG_REGION;
      if (big && now - this.lastBig < BIG_EVERY && now >= this.lastBig) return this.updateNormals(now);
      if (big) this.lastBig = now;
      this.dirty = false;
      this.relax(x0, y0, z0, x1, y1, z1);
      this.computeCompression(x0, y0, z0, x1, y1, z1);
      this.updateMeshes(x0 - 1, y0 - 1, z0 - 1, x1 + 1, y1 + 1, z1 + 1);
    }
    this.updateNormals(now);
  }

  /**
   * Normals of dented meshes: a vertex budget per frame, round-robin, so a big crash spreads the
   * work over a few frames instead of one long stall.
   */
  private updateNormals(now: number): void {
    if (now - this.lastNormals > 30 || now < this.lastNormals) {
      this.lastNormals = now;
      let budget = NORMALS_BUDGET;
      const n = this.bindings.length;
      for (let k = 0; k < n && budget > 0; k++) {
        const b = this.bindings[(this.normalsCursor + k) % n]!;
        if (!b.needsNormals) continue;
        b.mesh.geometry.computeVertexNormals();
        b.needsNormals = false;
        budget -= b.cell.length;
        this.normalsCursor = (this.normalsCursor + k + 1) % n;
      }
    }
  }

  private relax(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    const D = this.D;
    const nx = this.nx;
    const sy = nx;
    const sz = nx * this.ny;
    const k6 = 1 / (6 * (1 + DECAY));
    const sy3 = sy * 3;
    const sz3 = sz * 3;
    for (let it = 0; it < 14; it++) {
      for (let iz = z0; iz <= z1; iz++) {
        for (let iy = y0; iy <= y1; iy++) {
          for (let ix = x0; ix <= x1; ix++) {
            const i = (iz * this.ny + iy) * nx + ix;
            if (this.flag[i] !== 0) continue;
            const o = i * 3;
            for (let a = o; a < o + 3; a++) {
              const nv = (D[a - 3]! + D[a + 3]! + D[a - sy3]! + D[a + sy3]! + D[a - sz3]! + D[a + sz3]!) * k6;
              // Plastic: the field never springs back.
              if (Math.abs(nv) > Math.abs(D[a]!)) D[a] = nv;
            }
          }
        }
      }
    }
  }

  private computeCompression(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    const D = this.D;
    const nx = this.nx;
    const sy = nx;
    const sz = nx * this.ny;
    for (let iz = z0; iz <= z1; iz++) {
      for (let iy = y0; iy <= y1; iy++) {
        for (let ix = x0; ix <= x1; ix++) {
          const i = (iz * this.ny + iy) * nx + ix;
          let best = 0;
          let axis = 2;
          for (let a = 0; a < 3; a++) {
            const step = a === 0 ? 1 : a === 1 ? sy : sz;
            // Stretch of the lattice axis a: |e_a + dD/da|.
            const gx = (D[(i + step) * 3]! - D[(i - step) * 3]!) / (2 * H);
            const gy = (D[(i + step) * 3 + 1]! - D[(i - step) * 3 + 1]!) / (2 * H);
            const gz = (D[(i + step) * 3 + 2]! - D[(i - step) * 3 + 2]!) / (2 * H);
            const ex = (a === 0 ? 1 : 0) + gx;
            const ey = (a === 1 ? 1 : 0) + gy;
            const ez = (a === 2 ? 1 : 0) + gz;
            const c = 1 - Math.sqrt(ex * ex + ey * ey + ez * ez);
            if (c > best) {
              best = c;
              axis = a;
            }
          }
          if (best > this.comp[i]!) {
            this.comp[i] = Math.min(best, 0.9);
            this.compAxis[i] = axis;
          }
        }
      }
    }
  }

  /**
   * Re-skin the vertices whose lattice cell lies in the box. Contract: the box must start one cell
   * below the changed nodes (a vertex in cell x0 - 1 interpolates node x0), which `update` does by
   * passing the relaxed region grown by one cell.
   */
  private updateMeshes(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    const D = this.D;
    const nx = this.nx;
    const sy = nx;
    const sz = nx * this.ny;
    for (const b of this.bindings) {
      if (b.cmax[0] < x0 || b.cmin[0] > x1 || b.cmax[1] < y0 || b.cmin[1] > y1 || b.cmax[2] < z0 || b.cmin[2] > z1) continue;
      const e = b.invRot;
      const nv = b.cell.length;
      let maxDisp = b.maxDisp;
      let maxIndex = b.maxIndex;
      for (let v = 0; v < nv; v++) {
        const co = v * 3;
        if (b.cellXYZ[co]! < x0 || b.cellXYZ[co]! > x1 || b.cellXYZ[co + 1]! < y0 || b.cellXYZ[co + 1]! > y1 || b.cellXYZ[co + 2]! < z0 || b.cellXYZ[co + 2]! > z1) continue;
        const i = b.cell[v]!;
        const fx = b.frac[v * 3]!;
        const fy = b.frac[v * 3 + 1]!;
        const fz = b.frac[v * 3 + 2]!;
        let dx = 0;
        let dy = 0;
        let dz = 0;
        let cp = 0;
        // Trilinear blend of the 8 corners.
        for (let c = 0; c < 8; c++) {
          const ox = c & 1;
          const oy = (c >> 1) & 1;
          const oz = (c >> 2) & 1;
          const w = (ox ? fx : 1 - fx) * (oy ? fy : 1 - fy) * (oz ? fz : 1 - fz);
          if (w === 0) continue;
          const j = i + ox + oy * sy + oz * sz;
          dx += D[j * 3]! * w;
          dy += D[j * 3 + 1]! * w;
          dz += D[j * 3 + 2]! * w;
          cp += this.comp[j]! * w;
        }
        const o = v * 3;
        const disp = Math.hypot(dx, dy, dz);
        // Crumple: fold the sheet across the compression axis, amplitude from length conservation.
        if (cp > 0.02) {
          const ax = this.compAxis[i]!;
          const nxv = b.restN[o]!;
          const nyv = b.restN[o + 1]!;
          const nzv = b.restN[o + 2]!;
          // Compression axis projected into the tangent plane.
          let tx = ax === 0 ? 1 : 0;
          let ty = ax === 1 ? 1 : 0;
          let tz = ax === 2 ? 1 : 0;
          const dn = tx * nxv + ty * nyv + tz * nzv;
          tx -= dn * nxv;
          ty -= dn * nyv;
          tz -= dn * nzv;
          const tl = Math.hypot(tx, ty, tz);
          if (tl > 0.25) {
            tx /= tl;
            ty /= tl;
            tz /= tl;
            const c = Math.min(cp, 0.85);
            const amp = Math.min(0.05, (WAVE / Math.PI) * Math.sqrt(Math.max(0, 1 / (1 - c) - 1))) * tl;
            const px = b.restC[o]!;
            const py = b.restC[o + 1]!;
            const pz = b.restC[o + 2]!;
            const s = px * tx + py * ty + pz * tz;
            // Second tangent for a cross-modulation so folds are not perfectly parallel.
            const bx = nyv * tz - nzv * ty;
            const by = nzv * tx - nxv * tz;
            const bz = nxv * ty - nyv * tx;
            const u = px * bx + py * by + pz * bz;
            const ph = b.hash * 6.283;
            const wav = Math.sin((s / WAVE) * 6.283 + ph + 0.8 * Math.sin((u / 0.37) * 6.283 + ph * 1.7)) * 0.75 + 0.35;
            const mod = 0.65 + 0.35 * Math.sin((u / 0.29) * 6.283 + ph * 2.3);
            const a = amp * wav * mod;
            dx += nxv * a;
            dy += nyv * a;
            dz += nzv * a;
          }
        }
        // Back to the mesh's local frame (rotation/translation of its rest matrix).
        const lx = e[0]! * dx + e[4]! * dy + e[8]! * dz;
        const ly = e[1]! * dx + e[5]! * dy + e[9]! * dz;
        const lz = e[2]! * dx + e[6]! * dy + e[10]! * dz;
        b.pos[o] = b.data.rest[o]! + lx;
        b.pos[o + 1] = b.data.rest[o + 1]! + ly;
        b.pos[o + 2] = b.data.rest[o + 2]! + lz;
        if (disp > maxDisp) {
          maxDisp = disp;
          maxIndex = v;
        }
      }
      b.maxDisp = maxDisp;
      b.maxIndex = maxIndex;
      (b.mesh.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      b.needsNormals = true;
    }
  }

  /** Largest displacement (m) of the meshes belonging to a part. */
  maxDisplacement(part: string): number {
    let m = 0;
    for (const b of this.bindings) if (b.data.part === part && b.maxDisp > m) m = b.maxDisp;
    return m;
  }

  /** Rest position (mesh-local) of the most displaced vertex of a part, or null if undamaged. */
  maxDisplacementPoint(part: string, out: THREE.Vector3): THREE.Vector3 | null {
    let best: MeshBinding | null = null;
    for (const b of this.bindings) if (b.data.part === part && (!best || b.maxDisp > best.maxDisp)) best = b;
    if (!best || best.maxDisp === 0) return null;
    const i = best.maxIndex * 3;
    return out.set(best.data.rest[i]!, best.data.rest[i + 1]!, best.data.rest[i + 2]!);
  }

  /** Displacement of the field at a chassis-frame point (used for small parts). */
  sample(x: number, y: number, z: number): number {
    const gx = Math.min(Math.max((x - this.origin.x) / H, 0), this.nx - 1.001);
    const gy = Math.min(Math.max((y - this.origin.y) / H, 0), this.ny - 1.001);
    const gz = Math.min(Math.max((z - this.origin.z) / H, 0), this.nz - 1.001);
    const i = this.idx(Math.round(gx), Math.round(gy), Math.round(gz)) * 3;
    return Math.hypot(this.D[i]!, this.D[i + 1]!, this.D[i + 2]!);
  }

  reset(): void {
    this.D.fill(0);
    this.comp.fill(0);
    for (let i = 0; i < this.flag.length; i++) if (this.flag[i] === 2) this.flag[i] = 0;
    this.dirty = false;
    for (const b of this.bindings) {
      b.pos.set(b.data.rest);
      b.maxDisp = 0;
      b.maxIndex = 0;
      (b.mesh.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      const nrm = b.mesh.geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
      if (nrm) {
        (nrm.array as Float32Array).set(b.data.restNormal);
        nrm.needsUpdate = true;
      }
      b.needsNormals = false;
    }
  }
}
