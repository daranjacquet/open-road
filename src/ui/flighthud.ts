import type { GameAircraft } from '../game/GameAircraft';

const KT = 1.943844;
const FT = 3.28084;

/** Part of the damage diagram and the physics part it shows. */
const DIAGRAM: [string, string][] = [
  ['wingL', 'fd-wingL'],
  ['wingR', 'fd-wingR'],
  ['tailH', 'fd-tailH'],
  ['tailV', 'fd-tailV'],
  ['gearN', 'fd-gearN'],
  ['gearL', 'fd-gearL'],
  ['gearR', 'fd-gearR'],
  ['prop', 'fd-prop'],
];

/**
 * Flight instruments: attitude indicator, airspeed (knots), altitude (feet), vertical speed,
 * heading, load factor, throttle, rpm, flaps, the stall warning, and a top view of the aircraft
 * whose parts turn red as they come off.
 */
export class FlightHud {
  readonly el: HTMLElement;
  private readonly ias: HTMLElement;
  private readonly alt: HTMLElement;
  private readonly vs: HTMLElement;
  private readonly hdg: HTMLElement;
  private readonly gload: HTMLElement;
  private readonly thr: HTMLElement;
  private readonly thrFill: HTMLElement;
  private readonly rpm: HTMLElement;
  private readonly flaps: HTMLElement;
  private readonly lights: Record<'brake' | 'trim' | 'gnd' | 'prot' | 'boost', HTMLElement>;
  private readonly stall: HTMLElement;
  private readonly eng: HTMLElement;
  private readonly adi: HTMLCanvasElement;
  private readonly parts = new Map<string, SVGElement>();
  private last = 0;

  constructor(root: HTMLElement) {
    const el = (this.el = document.createElement('div'));
    el.className = 'fl';
    el.style.display = 'none';
    el.innerHTML = `
      <style>
        .fl-box{position:fixed;right:24px;bottom:22px;display:flex;gap:16px;align-items:flex-end;font-weight:600}
        .fl-adi{width:132px;height:132px;border-radius:50%;box-shadow:0 2px 10px rgba(0,0,0,.45)}
        .fl-col{text-align:right;font-variant-numeric:tabular-nums}
        .fl-ias{font-size:52px;line-height:1;letter-spacing:-1px}
        .fl-u{font-size:13px;opacity:.8;margin-left:5px}
        .fl-row{font-size:15px;margin-top:5px;display:flex;gap:12px;justify-content:flex-end}
        .fl-row span b{font-size:11px;opacity:.7;margin-right:4px;font-weight:600}
        .fl-thr{width:150px;height:7px;background:rgba(255,255,255,.18);border-radius:4px;overflow:hidden;align-self:center}
        .fl-thr i{display:block;height:100%;width:0;background:linear-gradient(90deg,#6fd1ff,#ffd166)}
        .fl-lights{display:flex;gap:6px;margin-top:7px;justify-content:flex-end}
        .fl-lights b{font-size:11px;padding:2px 6px;border-radius:4px;background:rgba(255,255,255,.14);opacity:.55}
        .fl-lights b.on{background:#ffb020;color:#111;opacity:1}
        .fl-stall{position:fixed;left:50%;top:18%;transform:translateX(-50%);font-size:30px;font-weight:800;letter-spacing:3px;color:#fff;background:#d42a1f;padding:4px 16px;border-radius:6px;display:none}
        .fl-stall.on{display:block;animation:fl-blink .5s steps(2) infinite}
        @keyframes fl-blink{50%{opacity:.25}}
        .fl-dmg{position:fixed;left:24px;bottom:22px;width:74px;text-align:center;font-size:10px}
        .fl-dmg svg{display:block;margin:4px auto 0}
        .fl-dmg svg .p{fill:#4ade80;transition:fill .3s}
        .fl-dmg svg .p.off{fill:#ef4444}
        .fl-dmg svg .b{fill:rgba(255,255,255,.5)}
      </style>
      <div class="fl-dmg">AIRCRAFT
        <svg width="74" height="65" viewBox="-48 -6 96 84">
          <rect class="p" id="fd-prop" x="-9" y="-4" width="18" height="3" rx="1.5"/>
          <rect class="b" x="-4" y="0" width="8" height="64" rx="4"/>
          <rect class="p" id="fd-wingL" x="-46" y="18" width="42" height="11" rx="3"/>
          <rect class="p" id="fd-wingR" x="4" y="18" width="42" height="11" rx="3"/>
          <rect class="p" id="fd-tailH" x="-16" y="60" width="32" height="7" rx="2"/>
          <rect class="p" id="fd-tailV" x="-1.5" y="56" width="3" height="16" rx="1.5"/>
          <circle class="p" id="fd-gearN" cx="0" cy="9" r="3"/>
          <circle class="p" id="fd-gearL" cx="-14" cy="33" r="3"/>
          <circle class="p" id="fd-gearR" cx="14" cy="33" r="3"/>
        </svg>
        <div class="hud-eng" id="fl-eng">ENGINE 100%</div>
        <button class="hud-fix" id="fl-fix" tabindex="-1" title="Repair the aircraft where it is (F)">REPAIR (F)</button>
      </div>
      <div class="fl-stall" id="fl-stall">STALL</div>
      <div class="fl-box">
        <canvas class="fl-adi" id="fl-adi" width="264" height="264"></canvas>
        <div class="fl-col">
          <div><span class="fl-ias" id="fl-ias">0</span><span class="fl-u">kt</span></div>
          <div class="fl-row"><span><b>ALT</b><span id="fl-alt">0</span> ft</span><span><b>VS</b><span id="fl-vs">0</span> ft/min</span></div>
          <div class="fl-row"><span><b>HDG</b><span id="fl-hdg">000</span></span><span><b>G</b><span id="fl-g">1.0</span></span><span><b>RPM</b><span id="fl-rpm">0</span></span></div>
          <div class="fl-row"><b style="font-size:11px;opacity:.7">THR</b><div class="fl-thr"><i id="fl-thr-fill"></i></div><span id="fl-thr">0%</span></div>
          <div class="fl-lights"><b id="fl-flaps">FLAPS 0</b><b id="fl-trim">AUTO-TRIM</b><b id="fl-prot">STALL PROT</b><b id="fl-boost">BOOST</b><b id="fl-gnd">GROUND</b><b id="fl-brake">BRAKE</b></div>
        </div>
      </div>`;
    root.appendChild(el);
    const q = <T extends Element = HTMLElement>(id: string): T => el.querySelector(`#${id}`) as T;
    this.ias = q('fl-ias');
    this.alt = q('fl-alt');
    this.vs = q('fl-vs');
    this.hdg = q('fl-hdg');
    this.gload = q('fl-g');
    this.thr = q('fl-thr');
    this.thrFill = q('fl-thr-fill');
    this.rpm = q('fl-rpm');
    this.flaps = q('fl-flaps');
    this.lights = { brake: q('fl-brake'), trim: q('fl-trim'), gnd: q('fl-gnd'), prot: q('fl-prot'), boost: q('fl-boost') };
    this.stall = q('fl-stall');
    this.eng = q('fl-eng');
    this.adi = q<HTMLCanvasElement>('fl-adi');
    for (const [part, id] of DIAGRAM) this.parts.set(part, q<SVGElement>(id));
    const fix = q<HTMLButtonElement>('fl-fix');
    fix.addEventListener('mousedown', (e) => e.preventDefault());
    fix.addEventListener('click', () => this.onRepair?.());
  }

  onRepair: (() => void) | null = null;

  set visible(v: boolean) {
    this.el.style.display = v ? '' : 'none';
  }

  /** True while the stall warning shows (the game sounds the horn with it). */
  stallWarning = false;

  update(plane: GameAircraft, brake: number, now: number): void {
    const ac = plane.aircraft;
    const st = ac.state;
    // The stall warning sounds a few knots before the stall, in the air only.
    this.stallWarning = !st.onGround && st.airspeed > 10 && (st.stallMargin < 0.035 || st.stall > 0.05);
    if (now - this.last < 50) return;
    this.last = now;
    const fwd = plane.view.quat;
    this.ias.textContent = Math.round(st.airspeed * KT).toString();
    // Altimeter: height above the sea (the lake, and the airfield, are at sea level), wheels down.
    this.alt.textContent = String(Math.max(0, Math.round(((st.altitude - 1.15) * FT) / 10) * 10));
    const vs = Math.round((st.vs * FT * 60) / 50) * 50;
    this.vs.textContent = (vs > 0 ? '+' : '') + vs;
    // Compass heading: north is -z on the map, east +x (the state's heading is the yaw from +z).
    const hdg = ((Math.round(180 - (st.heading * 180) / Math.PI) % 360) + 360) % 360;
    this.hdg.textContent = String(hdg === 0 ? 360 : hdg).padStart(3, '0');
    this.gload.textContent = st.g.toFixed(1);
    this.rpm.textContent = (Math.round(st.rpm / 10) * 10).toString();
    const thr = Math.round(ac.controls.throttle * 100);
    this.thr.textContent = `${thr}%`;
    this.thrFill.style.width = `${thr}%`;
    const fl = Math.round(ac.controls.flaps * 100);
    this.flaps.textContent = `FLAPS ${fl}`;
    this.flaps.classList.toggle('on', fl > 2);
    this.lights.trim.classList.toggle('on', ac.assists.trim && Math.abs(ac.controls.trim) > 0.01);
    this.lights.gnd.classList.toggle('on', st.onGround);
    this.lights.prot.classList.toggle('on', ac.assists.protect);
    this.lights.boost.classList.toggle('on', ac.boost > 1);
    this.lights.brake.classList.toggle('on', brake > 0.5);
    this.stall.classList.toggle('on', this.stallWarning);
    for (const [part, svg] of this.parts) svg.classList.toggle('off', !(ac.parts.get(part)?.on ?? true));
    this.eng.textContent = ac.propBroken ? 'PROPELLER GONE' : ac.engineHealth <= 0 ? 'ENGINE DEAD' : `ENGINE ${Math.round(ac.engineHealth * 100)}%`;
    this.drawAttitude(fwd);
  }

  /** Attitude indicator: sky and ground split by the horizon, pitch ladder, bank scale. */
  private drawAttitude(q: { x: number; y: number; z: number; w: number }): void {
    const g = this.adi.getContext('2d');
    if (!g) return;
    // Body axes in the world from the quaternion: forward (z) and left (x).
    const fy = 2 * (q.y * q.z - q.w * q.x);
    const ly = 2 * (q.x * q.y + q.w * q.z);
    const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
    const pitch = Math.asin(Math.max(-1, Math.min(1, fy)));
    // Bank, right wing down positive (from the heights of the left wing and the up axis). The
    // horizon turns the other way on the dial.
    const bank = -Math.atan2(ly, uy);
    const S = 264;
    const R = S / 2;
    const ppd = 4.2; // pixels per degree of pitch
    g.save();
    g.clearRect(0, 0, S, S);
    g.beginPath();
    g.arc(R, R, R - 2, 0, Math.PI * 2);
    g.clip();
    g.translate(R, R);
    g.rotate(bank);
    const off = (pitch * 180) / Math.PI * ppd;
    g.fillStyle = '#3d8fd6';
    g.fillRect(-S, -S * 2 + off, S * 2, S * 2);
    g.fillStyle = '#8a5a2b';
    g.fillRect(-S, off, S * 2, S * 2);
    g.strokeStyle = '#fff';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(-S, off);
    g.lineTo(S, off);
    g.stroke();
    g.lineWidth = 2;
    g.font = '600 15px system-ui,sans-serif';
    g.fillStyle = '#fff';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    for (let d = -30; d <= 30; d += 5) {
      if (d === 0) continue;
      const y = off - d * ppd;
      const w = d % 10 === 0 ? 34 : 16;
      g.beginPath();
      g.moveTo(-w, y);
      g.lineTo(w, y);
      g.stroke();
      if (d % 10 === 0) g.fillText(String(Math.abs(d)), w + 5, y);
    }
    g.restore();
    // Fixed aircraft symbol and bank pointer.
    g.save();
    g.translate(R, R);
    g.strokeStyle = '#ffd23a';
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(-62, 0);
    g.lineTo(-22, 0);
    g.lineTo(-12, 12);
    g.moveTo(62, 0);
    g.lineTo(22, 0);
    g.lineTo(12, 12);
    g.stroke();
    g.fillStyle = '#ffd23a';
    g.beginPath();
    g.arc(0, 0, 5, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#fff';
    g.lineWidth = 3;
    for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
      const r = (a * Math.PI) / 180;
      const l = a % 30 === 0 ? 16 : 9;
      g.beginPath();
      g.moveTo(Math.sin(r) * (R - 4), -Math.cos(r) * (R - 4));
      g.lineTo(Math.sin(r) * (R - 4 - l), -Math.cos(r) * (R - 4 - l));
      g.stroke();
    }
    g.rotate(bank);
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(0, -R + 24);
    g.lineTo(-8, -R + 38);
    g.lineTo(8, -R + 38);
    g.closePath();
    g.fill();
    g.restore();
    g.strokeStyle = 'rgba(0,0,0,.6)';
    g.lineWidth = 4;
    g.beginPath();
    g.arc(R, R, R - 2, 0, Math.PI * 2);
    g.stroke();
  }
}
