/**
 * Fixed-timestep accumulator. Physics always advances by exactly `fixedDt`,
 * whatever the display rate; rendering interpolates with `alpha`.
 * Pure + allocation-free so it is unit-testable.
 */
export interface StepResult {
  /** Number of fixed steps to run this frame. */
  steps: number;
  /** Remaining accumulator as a fraction of a step (0..1) for render interpolation. */
  alpha: number;
}

export class FixedStepper {
  private acc = 0;
  /** Set to true when a stall forced us to drop simulation time. */
  dropped = false;

  constructor(
    public readonly fixedDt = 1 / 120,
    /** Max steps per frame; beyond that we drop time instead of spiralling. */
    public readonly maxSteps = 8,
    /** Clamp for a single frame delta (tab switch, breakpoint). */
    public readonly maxFrameDt = 0.1,
  ) {}

  advance(frameDt: number, out: StepResult = { steps: 0, alpha: 0 }): StepResult {
    this.dropped = false;
    this.acc += Math.min(Math.max(frameDt, 0), this.maxFrameDt);
    let steps = 0;
    while (this.acc >= this.fixedDt && steps < this.maxSteps) {
      this.acc -= this.fixedDt;
      steps++;
    }
    if (this.acc >= this.fixedDt) {
      // Could not catch up: drop the backlog so a stall never launches everything.
      this.acc = this.acc % this.fixedDt;
      this.dropped = true;
    }
    out.steps = steps;
    out.alpha = this.acc / this.fixedDt;
    return out;
  }

  reset(): void {
    this.acc = 0;
  }
}
