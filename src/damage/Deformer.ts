import * as THREE from 'three';
import type { CrushSystem } from './CrushSystem';

interface PartMap {
  name: string;
  mesh: THREE.Mesh;
  rest: Float32Array;
  pos: Float32Array;
  /** CSR layout: rays influencing vertex v are rayIdx[start[v] .. start[v+1]). */
  start: Uint32Array;
  rayIdx: Uint16Array;
  rayW: Float32Array;
  /** Per vertex deterministic crumple factors. */
  noise: Float32Array;
  needsNormals: boolean;
  /** Largest displacement (m) of any vertex of this part. */
  maxDisp: number;
}

const INFLUENCE = 0.42; // metres: radius of a ray's dent

function hash3(x: number, y: number, z: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Turns per-ray crush depths into dented panels. Each vertex is pushed back along the crush
 * direction of the rays near it. Deterministic: the same impact always gives the same dent.
 */
export class Deformer {
  private readonly parts: PartMap[] = [];
  /** For each ray: which (part, vertex) pairs it influences. */
  private readonly rayVerts: { part: number; verts: Uint32Array }[][];
  private readonly lastCrush: Float32Array;
  private readonly dirty = new Set<number>();
  private lastNormals = 0;

  constructor(
    private readonly crush: CrushSystem,
    parts: Map<string, THREE.Mesh>,
  ) {
    const rays = crush.rays;
    this.lastCrush = new Float32Array(rays.length);
    this.rayVerts = rays.map(() => []);
    const R2 = INFLUENCE * INFLUENCE;

    for (const [name, mesh] of parts) {
      const rest = mesh.userData['rest'] as Float32Array | undefined;
      if (!rest) continue;
      const pv = mesh.userData['pivot'] as [number, number, number];
      const n = rest.length / 3;
      const start = new Uint32Array(n + 1);
      const idx: number[] = [];
      const w: number[] = [];
      const noise = new Float32Array(n * 3);
      const perRay: number[][] = rays.map(() => []);
      for (let v = 0; v < n; v++) {
        const x = rest[v * 3]! + pv[0];
        const y = rest[v * 3 + 1]! + pv[1];
        const z = rest[v * 3 + 2]! + pv[2];
        start[v] = idx.length;
        for (let r = 0; r < rays.length; r++) {
          const s = rays[r]!.surface;
          const dx = x - s[0];
          const dy = y - s[1];
          const dz = z - s[2];
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < R2) {
            const t = 1 - Math.sqrt(d2) / INFLUENCE;
            idx.push(r);
            w.push(t * t);
            perRay[r]!.push(v);
          }
        }
        noise[v * 3] = hash3(x * 9, y * 9, z * 9);
        noise[v * 3 + 1] = hash3(x * 13 + 1, y * 13, z * 13);
        noise[v * 3 + 2] = hash3(x * 17, y * 17 + 2, z * 17);
      }
      start[n] = idx.length;
      const pm: PartMap = {
        name,
        mesh,
        rest,
        pos: (mesh.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array,
        start,
        rayIdx: Uint16Array.from(idx),
        rayW: Float32Array.from(w),
        noise,
        needsNormals: false,
        maxDisp: 0,
      };
      const pi = this.parts.length;
      this.parts.push(pm);
      perRay.forEach((verts, r) => {
        if (verts.length) this.rayVerts[r]!.push({ part: pi, verts: Uint32Array.from(verts) });
      });
      mesh.frustumCulled = false;
    }
  }

  maxDisplacement(part: string): number {
    for (const p of this.parts) if (p.name === part) return p.maxDisp;
    return 0;
  }

  /** Call every frame: re-dents the vertices of rays whose crush changed. */
  update(now: number): void {
    const crush = this.crush;
    const rays = crush.rays;
    for (let r = 0; r < rays.length; r++) {
      if (crush.crush[r]! !== this.lastCrush[r]!) {
        this.lastCrush[r] = crush.crush[r]!;
        this.dirty.add(r);
      }
    }
    if (this.dirty.size > 0) {
      // Collect affected vertices per part.
      const touched: Set<number>[] = this.parts.map(() => new Set<number>());
      for (const r of this.dirty) for (const e of this.rayVerts[r]!) for (const v of e.verts) touched[e.part]!.add(v);
      this.dirty.clear();
      touched.forEach((verts, pi) => {
        if (verts.size === 0) return;
        const p = this.parts[pi]!;
        for (const v of verts) this.dentVertex(p, v);
        (p.mesh.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
        p.needsNormals = true;
      });
    }
    // Normals are costly: refresh at most ~12 times per second.
    if (now - this.lastNormals > 80) {
      for (const p of this.parts) {
        if (!p.needsNormals) continue;
        p.mesh.geometry.computeVertexNormals();
        p.needsNormals = false;
      }
      this.lastNormals = now;
    }
  }

  private dentVertex(p: PartMap, v: number): void {
    const crush = this.crush;
    const rays = crush.rays;
    let dx = 0;
    let dy = 0;
    let dz = 0;
    let wsum = 0;
    let depth = 0;
    for (let k = p.start[v]!; k < p.start[v + 1]!; k++) {
      const r = p.rayIdx[k]!;
      const c = crush.crush[r]!;
      if (c <= 0) continue;
      const w = p.rayW[k]!;
      const d = rays[r]!.dir;
      dx -= d[0] * c * w;
      dy -= d[1] * c * w;
      dz -= d[2] * c * w;
      wsum += w;
      depth = Math.max(depth, c);
    }
    const o = v * 3;
    if (wsum === 0) {
      p.pos[o] = p.rest[o]!;
      p.pos[o + 1] = p.rest[o + 1]!;
      p.pos[o + 2] = p.rest[o + 2]!;
      return;
    }
    const norm = 1 / Math.max(1, wsum);
    dx *= norm;
    dy *= norm;
    dz *= norm;
    // Crumpling: deterministic irregularity growing with depth.
    const k = Math.min(1, depth / 0.25);
    const crinkle = 0.78 + 0.44 * p.noise[o]!;
    const jitter = 0.09 * k * depth;
    p.pos[o] = p.rest[o]! + dx * crinkle + (p.noise[o + 1]! - 0.5) * jitter;
    p.pos[o + 1] = p.rest[o + 1]! + dy * crinkle + (p.noise[o + 2]! - 0.5) * jitter;
    p.pos[o + 2] = p.rest[o + 2]! + dz * crinkle + (p.noise[o]! - 0.5) * jitter;
    const disp = Math.hypot(dx, dy, dz) * crinkle;
    if (disp > p.maxDisp) p.maxDisp = disp;
  }

  /** Restore pristine panels. */
  reset(): void {
    this.lastCrush.fill(0);
    this.dirty.clear();
    for (const p of this.parts) {
      p.pos.set(p.rest);
      p.maxDisp = 0;
      (p.mesh.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      p.mesh.geometry.computeVertexNormals();
      p.needsNormals = false;
    }
  }
}
