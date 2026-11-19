import type { Hud } from '../ui/hud';
import type { BuiltTrack } from '../world/track';
import { LapTimer } from './laps';

/** Lap timing on every circuit for the player's car, and the lap panel / toasts on the HUD. */
export class RaceSystem {
  private timers: LapTimer[] = [];

  constructor(
    private readonly tracks: BuiltTrack[],
    private readonly hud: Hud,
  ) {}

  /** New car: best laps are kept per car and circuit. */
  setCar(carId: string): void {
    this.timers = this.tracks.map((t) => new LapTimer(t.line, `open-road:best:${t.line.def.id}:${carId}`));
  }

  /** Teleport or respawn: the running lap is void. */
  reset(): void {
    for (const t of this.timers) t.reset();
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
    if (!shown) this.hud.laps(null, null);
  }
}
