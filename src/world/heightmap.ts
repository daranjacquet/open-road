/**
 * The terrain height grid shared by physics (Rapier heightfield), rendering (GPU-displaced chunks)
 * and placement (`heightAt`). Pure data, no three.js: it is built and tested headless.
 *
 * Grid: (n + 1) x (n + 1) vertices, `cell` metres apart, centred on the origin. Vertex (ix, iz) sits
 * at x = ix * cell - half, z = iz * cell - half. Storage is column-major as Rapier expects:
 * `heights[ix * (n + 1) + iz]`. Each cell is split along the diagonal from (x1, z0) to (x0, z1),
 * the same triangles the heightfield collider uses, so `heightAt` matches the physics exactly.
 */
export class Heightmap {
  readonly heights: Float32Array;
  readonly verts: number;
  readonly half: number;

  constructor(
    /** Cells per side. */
    readonly n: number,
    /** Cell size (m). */
    readonly cell: number,
    /** Existing heights to wrap (e.g. received from the world worker). */
    heights?: Float32Array,
  ) {
    this.verts = n + 1;
    this.half = (n * cell) / 2;
    this.heights = heights ?? new Float32Array(this.verts * this.verts);
  }

  get size(): number {
    return this.n * this.cell;
  }

  index(ix: number, iz: number): number {
    return ix * this.verts + iz;
  }

  /** World x (or z) of grid line i. */
  coord(i: number): number {
    return i * this.cell - this.half;
  }

  get(ix: number, iz: number): number {
    const v = this.verts - 1;
    return this.heights[(ix < 0 ? 0 : ix > v ? v : ix) * this.verts + (iz < 0 ? 0 : iz > v ? v : iz)]!;
  }

  /** Fill every vertex from a height function of world (x, z). */
  fill(f: (x: number, z: number) => number): void {
    const { verts, heights } = this;
    for (let ix = 0; ix < verts; ix++) {
      const x = this.coord(ix);
      const o = ix * verts;
      for (let iz = 0; iz < verts; iz++) heights[o + iz] = f(x, this.coord(iz));
    }
  }

  /** Height of the ground surface at (x, z), on the physics triangles. Clamped at the edges. */
  heightAt(x: number, z: number): number {
    const gx = (x + this.half) / this.cell;
    const gz = (z + this.half) / this.cell;
    const max = this.n - 1e-6;
    const cx = gx < 0 ? 0 : gx > max ? max : gx;
    const cz = gz < 0 ? 0 : gz > max ? max : gz;
    const ix = Math.floor(cx);
    const iz = Math.floor(cz);
    const fx = cx - ix;
    const fz = cz - iz;
    const h = this.heights;
    const v = this.verts;
    const h00 = h[ix * v + iz]!;
    const h10 = h[(ix + 1) * v + iz]!;
    const h01 = h[ix * v + iz + 1]!;
    const h11 = h[(ix + 1) * v + iz + 1]!;
    if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
    return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  }

  /** Upward unit normal of the surface at (x, z) (central differences over one cell). */
  normalAt(x: number, z: number, out: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
    const d = this.cell;
    const nx = this.heightAt(x - d, z) - this.heightAt(x + d, z);
    const nz = this.heightAt(x, z - d) - this.heightAt(x, z + d);
    const ny = 2 * d;
    const l = Math.hypot(nx, ny, nz);
    out.x = nx / l;
    out.y = ny / l;
    out.z = nz / l;
    return out;
  }

  /** Lowest and highest vertex in a rectangle of cells (for chunk bounds). */
  range(ix0: number, iz0: number, ix1: number, iz1: number): [number, number] {
    let lo = Infinity;
    let hi = -Infinity;
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const y = this.get(ix, iz);
        if (y < lo) lo = y;
        if (y > hi) hi = y;
      }
    }
    return [lo, hi];
  }
}
