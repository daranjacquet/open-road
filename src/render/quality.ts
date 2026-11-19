import type * as THREE from 'three';

/**
 * Adaptive render resolution. On a high-DPI screen the canvas has up to 4x the pixels of the CSS
 * size; this keeps the frame rate by lowering the pixel ratio when frames run long and raising it
 * back when there is headroom. Changes are rare (at most every 1.5 s) because each one reallocates
 * the drawing buffer.
 */
export class AdaptiveResolution {
  /** Current pixel ratio. */
  ratio: number;
  /** Set to a number to pin the ratio (garage "Resolution" setting); null = automatic. */
  fixed: number | null = null;
  private avg = 1 / 60;
  private since = 0;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    readonly min = 0.6,
    readonly max = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio : 1, 1.5),
  ) {
    this.ratio = this.max;
    renderer.setPixelRatio(this.ratio);
  }

  /** Call once per frame with the frame duration (s). */
  sample(frameDt: number): void {
    if (this.fixed !== null) {
      if (this.ratio !== this.fixed) this.apply(this.fixed);
      return;
    }
    // Ignore throttled or stalled frames (background tab, breakpoints).
    if (frameDt <= 0 || frameDt > 0.2) return;
    this.avg += (frameDt - this.avg) * 0.05;
    this.since += frameDt;
    if (this.since < 1.5) return;
    if (this.avg > 1 / 50 && this.ratio > this.min) {
      this.apply(Math.max(this.min, this.ratio - 0.15));
    } else if (this.avg < 1 / 75 && this.ratio < this.max) {
      this.apply(Math.min(this.max, this.ratio + 0.1));
    }
  }

  private apply(r: number): void {
    this.ratio = Math.round(r * 100) / 100;
    this.renderer.setPixelRatio(this.ratio);
    this.since = 0;
  }
}
