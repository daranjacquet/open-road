import type { Vehicle } from '../vehicle/Vehicle';

/** Minimal driving HUD: speed, gear, rpm bar, assist lights. Updated at ~20 Hz. */
export class Hud {
  private readonly speed: HTMLElement;
  private readonly gear: HTMLElement;
  private readonly rpmFill: HTMLElement;
  private readonly lights: Record<'tc' | 'abs' | 'esp', HTMLElement>;
  private last = 0;

  constructor(root: HTMLElement) {
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
        .hud-help{position:fixed;left:50%;transform:translateX(-50%);bottom:14px;font-size:12px;opacity:.75;text-align:center;white-space:nowrap}
      </style>
      <div class="hud-box">
        <div><span class="hud-speed" id="hud-speed">0</span><span class="hud-unit">km/h</span></div>
        <div class="hud-row"><div class="hud-rpm"><i id="hud-rpm"></i></div><div class="hud-gear" id="hud-gear">1</div></div>
        <div class="hud-lights"><b id="hud-tc">TC</b><b id="hud-abs">ABS</b><b id="hud-esp">ESP</b></div>
      </div>
      <div class="hud-help">W/S gas, brake, reverse &middot; A/D steer &middot; Space handbrake &middot; R flip &middot; Shift+R reset &middot; C camera &middot; F3 debug</div>`;
    this.speed = root.querySelector('#hud-speed')!;
    this.gear = root.querySelector('#hud-gear')!;
    this.rpmFill = root.querySelector('#hud-rpm')!;
    this.lights = {
      tc: root.querySelector('#hud-tc')!,
      abs: root.querySelector('#hud-abs')!,
      esp: root.querySelector('#hud-esp')!,
    };
  }

  update(car: Vehicle, now: number): void {
    if (now - this.last < 50) return;
    this.last = now;
    this.speed.textContent = Math.round(car.speedKmh).toString();
    const g = car.gear;
    this.gear.textContent = g < 0 ? 'R' : g === 0 ? 'N' : String(g);
    const frac = Math.min(1, Math.max(0, (car.rpm - car.cfg.engine.idleRpm) / (car.cfg.engine.redlineRpm - car.cfg.engine.idleRpm)));
    this.rpmFill.style.width = `${(frac * 100).toFixed(0)}%`;
    this.lights.tc.classList.toggle('on', car.tcActive);
    this.lights.abs.classList.toggle('on', car.absActive);
    this.lights.esp.classList.toggle('on', car.espActivity > 0.05);
  }
}
