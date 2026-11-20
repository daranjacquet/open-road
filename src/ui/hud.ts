import type { GameCar } from '../game/GameCar';
import { formatLap, type LapState } from '../game/laps';
import type { Location } from '../world/map';
import type { Overview } from '../world/overview';
import { Minimap } from './minimap';

/** Minimal driving HUD: speed, gear, rpm bar, assist lights. Updated at ~20 Hz. */
export class Hud {
  private readonly speed: HTMLElement;
  private readonly gear: HTMLElement;
  private readonly rpmFill: HTMLElement;
  private readonly lights: Record<'tc' | 'abs' | 'esp' | 'man', HTMLElement>;
  private last = 0;
  private readonly zones: Record<'front' | 'rear' | 'left' | 'right' | 'roof', HTMLElement>;
  private readonly eng: HTMLElement;
  private readonly lapBox: HTMLElement;
  private readonly lapEls: Record<'track' | 'cur' | 'last' | 'best', HTMLElement>;
  private readonly toastEl: HTMLElement;
  private toastTimer = 0;
  private lastLaps = 0;
  /** Called by the on-screen repair button. */
  onRepair: (() => void) | null = null;
  private minimap: Minimap | null = null;
  private readonly root: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = `
      <style>
        .hud-box{position:fixed;right:24px;bottom:22px;text-align:right;font-weight:600}
        .hud-speed{font-size:56px;line-height:1;letter-spacing:-1px}
        .hud-unit{font-size:14px;opacity:.8;margin-left:6px}
        .hud-row{display:flex;gap:10px;justify-content:flex-end;align-items:center;margin-top:6px}
        .hud-gear{font-size:28px;min-width:34px}
        .hud-rpm{width:190px;height:8px;background:rgba(255,255,255,.18);border-radius:4px;overflow:hidden}
        .hud-rpm i{display:block;height:100%;width:0;background:linear-gradient(90deg,#6fd1ff,#ffd166 70%,#ff4d4d)}
        .hud-lights{display:flex;gap:6px;margin-top:8px;justify-content:flex-end}
        .hud-lights b{font-size:11px;padding:2px 6px;border-radius:4px;background:rgba(255,255,255,.14);opacity:.55}
        .hud-lights b.on{background:#ffb020;color:#111;opacity:1}
        .hud-dmg{position:fixed;left:24px;bottom:22px;width:74px;text-align:center;font-size:10px;opacity:.95}
        .hud-car{position:relative;width:46px;height:84px;margin:4px auto 0}
        .hud-car i{position:absolute;display:block;border-radius:4px;background:#4ade80;transition:background .3s}
        .hud-car .f{left:6px;right:6px;top:0;height:22px}.hud-car .r{left:6px;right:6px;bottom:0;height:22px}
        .hud-car .l{left:0;top:26px;width:8px;bottom:26px}.hud-car .rt{right:0;top:26px;width:8px;bottom:26px}
        .hud-car .roof{left:12px;right:12px;top:26px;bottom:26px;background:#4ade80}
        .hud-eng{margin-top:4px;opacity:.9}
        .hud-fix{pointer-events:auto;margin-top:8px;font:600 10px system-ui,sans-serif;color:#fff;background:rgba(10,14,20,.55);border:1px solid rgba(255,255,255,.35);border-radius:6px;padding:5px 2px;cursor:pointer;width:100%;white-space:nowrap}
        .hud-fix:hover{background:rgba(74,222,128,.35)}
        .hud-lap{position:fixed;left:24px;top:40px;font-weight:600;background:rgba(10,14,20,.45);padding:8px 12px;border-radius:8px;min-width:170px;display:none}
        .hud-lap .t{font-size:12px;opacity:.8;margin-bottom:2px}
        .hud-lap .c{font-size:30px;font-variant-numeric:tabular-nums;letter-spacing:-.5px}
        .hud-lap .r{font-size:13px;font-variant-numeric:tabular-nums;opacity:.9;display:flex;justify-content:space-between;gap:12px}
        .hud-toast{position:fixed;left:50%;top:38%;transform:translate(-50%,-50%);font-size:26px;font-weight:700;padding:10px 18px;border-radius:10px;background:rgba(10,14,20,.6);opacity:0;transition:opacity .35s;pointer-events:none;text-align:center}
        .hud-toast.on{opacity:1}
        .hud-help{position:fixed;left:50%;transform:translateX(-50%);top:10px;font-size:12px;opacity:.75;text-align:center;white-space:nowrap}
      </style>
      <div class="hud-box">
        <div><span class="hud-speed" id="hud-speed">0</span><span class="hud-unit">km/h</span></div>
        <div class="hud-row"><div class="hud-rpm"><i id="hud-rpm"></i></div><div class="hud-gear" id="hud-gear">1</div></div>
        <div class="hud-lights"><b id="hud-man">MANUAL</b><b id="hud-tc">TC</b><b id="hud-abs">ABS</b><b id="hud-esp">ESP</b></div>
      </div>
      <div class="hud-dmg">DAMAGE
        <div class="hud-car"><i class="f" id="dz-front"></i><i class="r" id="dz-rear"></i><i class="l" id="dz-left"></i><i class="rt" id="dz-right"></i><i class="roof" id="dz-roof"></i></div>
        <div class="hud-eng" id="dz-eng">ENGINE 100%</div>
        <button class="hud-fix" id="hud-fix" tabindex="-1" title="Repair the car where it is (F)">REPAIR (F)</button>
      </div>
      <div class="hud-lap" id="hud-lap"><div class="t" id="lap-track"></div><div class="c" id="lap-cur">0:00.000</div><div class="r"><span>Last</span><span id="lap-last"></span></div><div class="r"><span>Best</span><span id="lap-best"></span></div></div>
      <div class="hud-toast" id="hud-toast"></div>
      <div class="hud-help">W/S gas, brake, reverse &middot; A/D steer &middot; Space handbrake &middot; Q/E shift (manual) &middot; F repair &middot; G garage &middot; T teleport &middot; N map &middot; right-drag camera &middot; R flip &middot; Shift+R reset &middot; C camera &middot; V car &middot; B targets &middot; M mute</div>`;
    this.speed = root.querySelector('#hud-speed')!;
    this.gear = root.querySelector('#hud-gear')!;
    this.rpmFill = root.querySelector('#hud-rpm')!;
    this.zones = {
      front: root.querySelector('#dz-front')!,
      rear: root.querySelector('#dz-rear')!,
      left: root.querySelector('#dz-left')!,
      right: root.querySelector('#dz-right')!,
      roof: root.querySelector('#dz-roof')!,
    };
    this.eng = root.querySelector('#dz-eng')!;
    this.lapBox = root.querySelector('#hud-lap')!;
    this.lapEls = {
      track: root.querySelector('#lap-track')!,
      cur: root.querySelector('#lap-cur')!,
      last: root.querySelector('#lap-last')!,
      best: root.querySelector('#lap-best')!,
    };
    this.toastEl = root.querySelector('#hud-toast')!;
    const fix = root.querySelector<HTMLButtonElement>('#hud-fix')!;
    // Never take keyboard focus (Space would press it again).
    fix.addEventListener('mousedown', (e) => e.preventDefault());
    fix.addEventListener('click', () => this.onRepair?.());
    this.lights = {
      tc: root.querySelector('#hud-tc')!,
      abs: root.querySelector('#hud-abs')!,
      esp: root.querySelector('#hud-esp')!,
      man: root.querySelector('#hud-man')!,
    };
  }

  /** Add the minimap and the big map (N), whose places drive the car there through `onGo`. */
  attachMap(overview: Overview, places: Location[], onGo: (loc: Location) => void): void {
    this.minimap = new Minimap(this.root, overview, places, onGo);
  }

  toggleMap(): void {
    this.minimap?.toggle();
  }

  /** A short message in the middle of the screen. */
  toast(msg: string, ms = 2200): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('on');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('on'), ms);
  }

  /** Lap timer panel (null hides it). Updated every frame for a smooth clock. */
  laps(track: string | null, st: LapState | null): void {
    // The clock text changes every frame; 20 updates a second are plenty (and cheaper on layout).
    const now = performance.now();
    if (now - this.lastLaps < 50 && !(st?.completed)) return;
    this.lastLaps = now;
    if (!track || !st) {
      this.lapBox.style.display = 'none';
      return;
    }
    this.lapBox.style.display = 'block';
    this.lapEls.track.textContent = st.running ? `${track} - lap ${st.lap + 1}` : `${track} - cross the line to start`;
    this.lapEls.cur.textContent = formatLap(st.running ? st.current : 0);
    this.lapEls.last.textContent = formatLap(st.last);
    this.lapEls.best.textContent = formatLap(st.best);
  }

  update(gc: GameCar, now: number): void {
    if (now - this.last < 50) return;
    this.last = now;
    const car = gc.vehicle;
    this.speed.textContent = Math.round(car.speedKmh).toString();
    const g = car.gear;
    this.gear.textContent = g < 0 ? 'R' : g === 0 ? 'N' : String(g);
    const frac = Math.min(1, Math.max(0, (car.rpm - car.cfg.engine.idleRpm) / (car.cfg.engine.redlineRpm - car.cfg.engine.idleRpm)));
    this.rpmFill.style.width = `${(frac * 100).toFixed(0)}%`;
    const dm = gc.damage;
    for (const k of Object.keys(this.zones) as (keyof typeof this.zones)[]) {
      const v = dm.zone[k];
      // green (0) to yellow to red (1)
      const hue = Math.round(130 * (1 - Math.min(1, v * 1.15)));
      this.zones[k].style.background = `hsl(${hue} 80% 50%)`;
    }
    this.eng.textContent = `ENGINE ${Math.round((1 - dm.engine) * 100)}%`;
    this.lights.tc.classList.toggle('on', car.tcActive);
    this.lights.abs.classList.toggle('on', car.absActive);
    this.lights.esp.classList.toggle('on', car.espActivity > 0.05);
    this.lights.man.style.display = car.manual ? '' : 'none';
    if (this.minimap) {
      const t = car.body.translation();
      const q = car.body.rotation();
      this.minimap.update(t.x, t.z, Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x)));
    }
  }
}
