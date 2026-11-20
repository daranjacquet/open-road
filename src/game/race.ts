import type { Hud } from '../ui/hud';
import type { Stage } from '../world/stages';
import type { BuiltTrack } from '../world/track';
import { LapTimer } from './laps';
import { StageTimer } from './stage';

/**
 * Timing for the player's car: laps on every circuit, start-to-finish runs on every rally stage,
 * and the timing panel and toasts on the HUD.
 */
export class RaceSystem {
  private timers: LapTimer[] = [];
  private stageTimers: StageTimer[] = [];

  constructor(
    private readonly tracks: BuiltTrack[],
    private readonly hud: Hud,
    private readonly stages: Stage[] = [],
  ) {}

  /** New car: best times are kept per car and circuit or stage. */
  setCar(carId: string): void {
    this.timers = this.tracks.map((t) => new LapTimer(t.line, `open-road:best:${t.line.def.id}:${carId}`));
    this.stageTimers = this.stages.map((s) => new StageTimer(s, `open-road:best:stage-${s.id}:${carId}`));
  }

  /** Teleport or respawn: the running lap or stage run is void. */
  reset(): void {
    for (const t of this.timers) t.reset();
    for (const t of this.stageTimers) t.reset();
  }

  update(x: number, z: number, simTime: number): void {
    let shown = false;
    for (const t of this.timers) {
      const st = t.update(x, z, simTime);
      if (st.completed !== null) this.hud.toast(st.newBest ? `New best lap  ${st.completed.toFixed(3)} s` : `Lap  ${st.completed.toFixed(3)} s`);
      if (st.onTrack && !shown) {
        this.hud.laps(t.line.def.name, st);
        shown = true;
      }
    }
    for (const t of this.stageTimers) {
      const st = t.update(x, z, simTime);
      if (st.completed !== null) this.hud.toast(st.newBest ? `New best on the ${t.stage.name.toLowerCase()}  ${st.completed.toFixed(3)} s` : `${t.stage.name}  ${st.completed.toFixed(3)} s`);
      if (st.onTrack && !shown) {
        this.hud.laps(t.stage.name, st, true);
        shown = true;
      }
    }
    if (!shown) this.hud.laps(null, null);
  }
}
