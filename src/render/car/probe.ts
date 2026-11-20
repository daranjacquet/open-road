import * as THREE from 'three';
import type { ProbeHit } from '../carModel';

/** Cell size of the probe grid (m): a few triangles per cell on a detailed body. */
const CELL = 0.08;

/**
 * Ray queries against a car's visible shell (chassis frame), fast enough to fit crumple zones to
 * the model with hundreds of probes: the triangles are binned in a uniform grid and a ray only tests
 * the cells it crosses, nearest first. Double-sided, like a raycast against DoubleSide meshes.
 */
export class ShellProbe {
  private readonly tri: Float32Array; // 9 floats per triangle
  private readonly partOf: Uint16Array;
  private readonly parts: string[] = [];
  private readonly o: [number, number, number];
  private readonly n: [number, number, number];
  private readonly start: Uint32Array; // per cell, into `items` (n cells + 1)
  private readonly items: Uint32Array;
  private readonly stamp: Uint32Array;
  private query = 0;

  constructor(meshes: readonly THREE.Mesh[], partName: (m: THREE.Mesh) => string) {
    const tris: number[] = [];
    const partIdx: number[] = [];
    const a = new THREE.Vector3();
    const box = new THREE.Box3();
    for (const m of meshes) {
      m.updateWorldMatrix(true, false);
      const pos = m.geometry.getAttribute('position');
      const index = m.geometry.getIndex();
      const count = index ? index.count : pos.count;
      let p = this.parts.indexOf(partName(m));
      if (p < 0) p = this.parts.push(partName(m)) - 1;
      for (let i = 0; i < count; i += 3) {
        for (let k = 0; k < 3; k++) {
          a.fromBufferAttribute(pos, index ? index.getX(i + k) : i + k).applyMatrix4(m.matrixWorld);
          tris.push(a.x, a.y, a.z);
          box.expandByPoint(a);
        }
        partIdx.push(p);
      }
    }
    this.tri = Float32Array.from(tris);
    this.partOf = Uint16Array.from(partIdx);
    const nt = partIdx.length;
    box.expandByScalar(0.01);
    this.o = [box.min.x, box.min.y, box.min.z];
    this.n = [0, 1, 2].map((k) => Math.max(1, Math.ceil((box.max.getComponent(k) - box.min.getComponent(k)) / CELL))) as [number, number, number];
    const cells = this.n[0] * this.n[1] * this.n[2];
    // Two passes: count, then fill (each triangle in every cell its bounding box overlaps).
    const counts = new Uint32Array(cells + 1);
    const span = (t: number, fn: (c: number) => void): void => {
      const lo = [Infinity, Infinity, Infinity];
      const hi = [-Infinity, -Infinity, -Infinity];
      for (let v = 0; v < 3; v++) {
        for (let k = 0; k < 3; k++) {
          const x = this.tri[t * 9 + v * 3 + k]!;
          lo[k] = Math.min(lo[k]!, x);
          hi[k] = Math.max(hi[k]!, x);
        }
      }
      const c0 = [0, 1, 2].map((k) => Math.min(this.n[k]! - 1, Math.max(0, Math.floor((lo[k]! - this.o[k]!) / CELL))));
      const c1 = [0, 1, 2].map((k) => Math.min(this.n[k]! - 1, Math.max(0, Math.floor((hi[k]! - this.o[k]!) / CELL))));
      for (let z = c0[2]!; z <= c1[2]!; z++) for (let y = c0[1]!; y <= c1[1]!; y++) for (let x = c0[0]!; x <= c1[0]!; x++) fn((z * this.n[1] + y) * this.n[0] + x);
    };
    for (let t = 0; t < nt; t++) span(t, (c) => counts[c + 1]!++);
    for (let c = 0; c < cells; c++) counts[c + 1]! += counts[c]!;
    this.start = counts.slice();
    this.items = new Uint32Array(counts[cells]!);
    const fill = counts.slice(0, cells);
    for (let t = 0; t < nt; t++) span(t, (c) => (this.items[fill[c]!++] = t));
    this.stamp = new Uint32Array(nt);
  }

  /** Nearest shell surface along a ray from `origin` (unit `dir` not required), within `maxDist`. */
  probe(origin: readonly [number, number, number], dir: readonly [number, number, number], maxDist: number): ProbeHit | null {
    const len = Math.hypot(dir[0], dir[1], dir[2]);
    const d = [dir[0] / len, dir[1] / len, dir[2] / len];
    const { o, n } = this;
    // Clip the ray to the grid box.
    let t0 = 0;
    let t1 = maxDist;
    for (let k = 0; k < 3; k++) {
      const lo = o[k]!;
      const hi = o[k]! + n[k]! * CELL;
      if (Math.abs(d[k]!) < 1e-12) {
        if (origin[k]! < lo || origin[k]! > hi) return null;
        continue;
      }
      let ta = (lo - origin[k]!) / d[k]!;
      let tb = (hi - origin[k]!) / d[k]!;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
    }
    if (t0 > t1) return null;
    this.query = (this.query + 1) >>> 0 || 1;
    const q = this.query;
    // 3D DDA from the entry point.
    const cell = [0, 0, 0];
    const step = [0, 0, 0];
    const tMax = [0, 0, 0];
    const tDelta = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const p = origin[k]! + d[k]! * t0;
      cell[k] = Math.min(n[k]! - 1, Math.max(0, Math.floor((p - o[k]!) / CELL)));
      if (d[k]! > 0) {
        step[k] = 1;
        tMax[k] = (o[k]! + (cell[k]! + 1) * CELL - origin[k]!) / d[k]!;
        tDelta[k] = CELL / d[k]!;
      } else if (d[k]! < 0) {
        step[k] = -1;
        tMax[k] = (o[k]! + cell[k]! * CELL - origin[k]!) / d[k]!;
        tDelta[k] = -CELL / d[k]!;
      } else {
        step[k] = 0;
        tMax[k] = Infinity;
        tDelta[k] = Infinity;
      }
    }
    let best = Infinity;
    let bestT = -1;
    const tri = this.tri;
    for (;;) {
      const c = (cell[2]! * n[1] + cell[1]!) * n[0] + cell[0]!;
      for (let j = this.start[c]!; j < this.start[c + 1]!; j++) {
        const t = this.items[j]!;
        if (this.stamp[t] === q) continue;
        this.stamp[t] = q;
        // Moller-Trumbore, both faces.
        const b = t * 9;
        const e1x = tri[b + 3]! - tri[b]!;
        const e1y = tri[b + 4]! - tri[b + 1]!;
        const e1z = tri[b + 5]! - tri[b + 2]!;
        const e2x = tri[b + 6]! - tri[b]!;
        const e2y = tri[b + 7]! - tri[b + 1]!;
        const e2z = tri[b + 8]! - tri[b + 2]!;
        const px = d[1]! * e2z - d[2]! * e2y;
        const py = d[2]! * e2x - d[0]! * e2z;
        const pz = d[0]! * e2y - d[1]! * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-12) continue;
        const inv = 1 / det;
        const sx = origin[0] - tri[b]!;
        const sy = origin[1] - tri[b + 1]!;
        const sz = origin[2] - tri[b + 2]!;
        const u = (sx * px + sy * py + sz * pz) * inv;
        if (u < 0 || u > 1) continue;
        const qx = sy * e1z - sz * e1y;
        const qy = sz * e1x - sx * e1z;
        const qz = sx * e1y - sy * e1x;
        const v = (d[0]! * qx + d[1]! * qy + d[2]! * qz) * inv;
        if (v < 0 || u + v > 1) continue;
        const dist = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (dist >= 0 && dist <= maxDist && dist < best) {
          best = dist;
          bestT = t;
        }
      }
      // The nearest hit is final once the ray has left the cell it lies in.
      const k = tMax[0]! < tMax[1]! ? (tMax[0]! < tMax[2]! ? 0 : 2) : tMax[1]! < tMax[2]! ? 1 : 2;
      if (best <= tMax[k]! || tMax[k]! > t1) break;
      cell[k]! += step[k]!;
      if (cell[k]! < 0 || cell[k]! >= n[k]!) break;
      tMax[k]! += tDelta[k]!;
    }
    return bestT < 0 ? null : { dist: best, part: this.parts[this.partOf[bestT]!]! };
  }
}
