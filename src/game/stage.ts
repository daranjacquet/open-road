import type { Stage } from '../world/stages';
import type { LapState } from './laps';

const CHECKPOINTS = 5;

/**
 * Point-to-point timing on a rally stage: the clock starts when the car crosses the start line
 * forwards and stops at the finish line, provided it went through every checkpoint in order and
 * never strayed far from the road (cutting a corner is fine, taking a shortcut is not).
 */
export class StageTimer {
  readonly state: LapState = { onTrack: false, running: false, current: 0, last: null, best: null, lap: 0, completed: null, newBest: false };
  private hint = -1;
  private prevI = -1;
  private start = 0;
  private checkpoint = 0;

  constructor(
    readonly stage: Stage,
    private readonly storageKey: string,
  ) {
    try {
      const b = localStorage.getItem(storageKey);
      if (b) this.state.best = Number(b);
    } catch {
      /* no storage: best times last for the session */
    }
  }

  private nearest(x: number, z: number): { i: number; dist: number } {
    const l = this.stage.line;
    let best = -1;
    let bd = Infinity;
    const scan = (a: number, b: number): void => {
      for (let i = Math.max(0, a); i <= Math.min(l.n - 1, b); i++) {
        const d = (l.x[i]! - x) ** 2 + (l.z[i]! - z) ** 2;
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
    };
    if (this.hint >= 0) scan(this.hint - 40, this.hint + 40);
    if (best < 0 || Math.sqrt(bd) > 40) {
      bd = Infinity;
      scan(0, l.n - 1);
    }
    return { i: best, dist: Math.sqrt(bd) };
  }

  /** Call every frame with the car position and the game clock (s). */
  update(x: number, z: number, now: number): LapState {
    const st = this.state;
    const { line, startI, finishI } = this.stage;
    st.completed = null;
    st.newBest = false;
    const near = this.nearest(x, z);
    const hw = line.def.width / 2;
    st.onTrack = near.dist < hw + 30;
    if (near.dist > hw + 45) {
      // Too far from the road: the run is void.
      st.running = false;
      this.hint = -1;
      this.prevI = -1;
      st.current = 0;
      return st;
    }
    this.hint = near.i;
    const i = near.i;
    // A jump along the road (teleport, or a shortcut far from it) voids the run.
    if (this.prevI >= 0 && Math.abs(i - this.prevI) >= 40) st.running = false;
    if (this.prevI >= 0 && Math.abs(i - this.prevI) < 40) {
      if (this.prevI < startI && i >= startI) {
        st.running = true;
        this.start = now;
        this.checkpoint = 0;
      }
      if (st.running) {
        const span = finishI - startI;
        const next = startI + ((this.checkpoint + 1) * span) / (CHECKPOINTS + 1);
        if (this.checkpoint < CHECKPOINTS && this.prevI < next && i >= next) this.checkpoint++;
        if (this.prevI < finishI && i >= finishI) {
          st.running = false;
          if (this.checkpoint === CHECKPOINTS) {
            const t = now - this.start;
            st.last = t;
            st.completed = t;
            st.lap++;
            if (st.best === null || t < st.best) {
              st.best = t;
              st.newBest = true;
              try {
                localStorage.setItem(this.storageKey, String(t));
              } catch {
                /* ignore */
              }
            }
          }
        }
      }
    }
    this.prevI = i;
    st.current = st.running ? now - this.start : 0;
    return st;
  }

  reset(): void {
    this.state.running = false;
    this.prevI = -1;
    this.hint = -1;
  }
}
