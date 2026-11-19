/**
 * Ground surface raster (1 m cells over the whole world): roads, circuits and city streets are
 * painted into it when the map is built, and the tyre model reads it for grip.
 */
export type SurfaceCode = 0 | 1 | 2;
export const GRASS = 0;
export const ASPHALT = 1;
export const DIRT = 2;

export class SurfaceMap {
  readonly data: Uint8Array;
  readonly n: number;

  constructor(
    readonly size: number,
    readonly res = 1,
  ) {
    this.n = Math.ceil(size / res);
    this.data = new Uint8Array(this.n * this.n);
  }

  private cell(x: number, z: number): number {
    const i = Math.floor((x + this.size / 2) / this.res);
    const j = Math.floor((z + this.size / 2) / this.res);
    if (i < 0 || j < 0 || i >= this.n || j >= this.n) return -1;
    return j * this.n + i;
  }

  get(x: number, z: number): SurfaceCode {
    const c = this.cell(x, z);
    return c < 0 ? GRASS : (this.data[c] as SurfaceCode);
  }

  fillRect(x0: number, z0: number, x1: number, z1: number, code: SurfaceCode): void {
    for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z += this.res) {
      for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x += this.res) {
        const c = this.cell(x, z);
        if (c >= 0) this.data[c] = code;
      }
    }
  }

  fillDisc(cx: number, cz: number, r: number, code: SurfaceCode): void {
    const r2 = r * r;
    for (let z = cz - r; z <= cz + r; z += this.res) {
      for (let x = cx - r; x <= cx + r; x += this.res) {
        if ((x - cx) ** 2 + (z - cz) ** 2 > r2) continue;
        const c = this.cell(x, z);
        if (c >= 0) this.data[c] = code;
      }
    }
  }
}
