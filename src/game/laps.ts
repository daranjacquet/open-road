import type { TrackLine } from '../world/track';

export interface LapState {
  /** On this circuit right now (near the centre line). */
  onTrack: boolean;
  /** A timed lap is running. */
  running: boolean;
  current: number;
  last: number | null;
  best: number | null;
  lap: number;
  /** Set for one update when a lap was completed. */
  completed: number | null;
  newBest: boolean;
}

const SECTORS = 4;

/**
 * Lap timing on one circuit. A lap starts on crossing the start line forwards and counts only if
 * the car went through every sector in order (no shortcuts across the grass).
 */
export class LapTimer {
  readonly state: LapState = { onTrack: false, running: false, current: 0, last: null, best: null, lap: 0, completed: null, newBest: false };
  private hint = -1;
  private prevI = -1;
  private start = 0;
  private sector = 0;

  constructor(
    readonly line: TrackLine,
    private readonly storageKey: string,
  ) {
    try {
      const b = localStorage.getItem(storageKey);
      if (b) this.state.best = Number(b);
    } catch {
      /* no storage: best laps last for the session */
    }
  }

  /** Call every physics step or frame with the car position and the game clock (s). */
  update(x: number, z: number, now: number): LapState {
    const st = this.state;
    st.completed = null;
    st.newBest = false;
    const near = this.line.nearest(x, z, this.hint);
    const margin = this.line.def.width / 2 + this.line.def.runoff + 6;
    st.onTrack = near.dist < margin;
    if (!st.onTrack) {
      // Left the circuit: the running lap is void.
      st.running = false;
      this.hint = -1;
      this.prevI = -1;
      return st;
    }
    this.hint = near.i;
    const n = this.line.n;
    const i = near.i;
    if (this.prevI >= 0) {
      const crossedForward = this.prevI > n * 0.9 && i < n * 0.1;
      const sec = Math.floor((i / n) * SECTORS);
      if (st.running && sec === this.sector + 1) this.sector = sec;
      if (crossedForward) {
        if (st.running && this.sector === SECTORS - 1) {
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
        st.running = true;
        this.start = now;
        this.sector = 0;
      }
    }
    this.prevI = i;
    st.current = st.running ? now - this.start : 0;
    return st;
  }

  /** Forget the running lap (teleport, respawn). */
  reset(): void {
    this.state.running = false;
    this.prevI = -1;
    this.hint = -1;
  }
}

export function formatLap(t: number | null): string {
  if (t === null) return '--:--.---';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}
