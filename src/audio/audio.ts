import { clamp } from '../core/math';
import type { ImpactInfo } from '../damage/DamageModel';
import type { Vehicle } from '../vehicle/Vehicle';
import type { Aircraft } from '../vehicle/aircraft/Aircraft';

/**
 * Procedural audio (Web Audio): engine tied to rpm and throttle, tyre squeal from slip,
 * wind from speed, crash sounds from absorbed energy. No audio files. M toggles mute.
 */
export class GameAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private engineGain!: GainNode;
  private engineFilter!: BiquadFilterNode;
  private osc1!: OscillatorNode;
  private osc2!: OscillatorNode;
  private noiseGain!: GainNode;
  private squealGain!: GainNode;
  private squealFilter!: BiquadFilterNode;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private hornGain!: GainNode;
  private noiseBuf!: AudioBuffer;
  muted = false;
  private pendingImpact = 0;
  private lastImpact = 0;
  private started = false;

  constructor() {
    const start = (): void => {
      if (this.started) return;
      this.started = true;
      this.init();
    };
    window.addEventListener('keydown', start, { once: true });
    window.addEventListener('pointerdown', start, { once: true });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM') this.toggleMute();
    });
  }

  private init(): void {
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = (this.ctx = new Ctor());
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(ctx.destination);

      // One second of white noise, looped by several sources.
      this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

      // Engine: two detuned saws + intake noise through a rpm-tracking low-pass.
      this.engineFilter = ctx.createBiquadFilter();
      this.engineFilter.type = 'lowpass';
      this.engineFilter.Q.value = 2;
      this.engineGain = ctx.createGain();
      this.engineGain.gain.value = 0;
      this.osc1 = ctx.createOscillator();
      this.osc1.type = 'sawtooth';
      this.osc2 = ctx.createOscillator();
      this.osc2.type = 'square';
      const g1 = ctx.createGain();
      g1.gain.value = 0.55;
      const g2 = ctx.createGain();
      g2.gain.value = 0.25;
      this.osc1.connect(g1).connect(this.engineFilter);
      this.osc2.connect(g2).connect(this.engineFilter);
      const intake = ctx.createBufferSource();
      intake.buffer = this.noiseBuf;
      intake.loop = true;
      this.noiseGain = ctx.createGain();
      this.noiseGain.gain.value = 0;
      intake.connect(this.noiseGain).connect(this.engineFilter);
      this.engineFilter.connect(this.engineGain).connect(this.master);
      this.osc1.start();
      this.osc2.start();
      intake.start();

      // Tyre squeal.
      const sq = ctx.createBufferSource();
      sq.buffer = this.noiseBuf;
      sq.loop = true;
      this.squealFilter = ctx.createBiquadFilter();
      this.squealFilter.type = 'bandpass';
      this.squealFilter.frequency.value = 1500;
      this.squealFilter.Q.value = 9;
      this.squealGain = ctx.createGain();
      this.squealGain.gain.value = 0;
      sq.connect(this.squealFilter).connect(this.squealGain).connect(this.master);
      sq.start();

      // Wind / road rumble.
      const w = ctx.createBufferSource();
      w.buffer = this.noiseBuf;
      w.loop = true;
      const wf = (this.windFilter = ctx.createBiquadFilter());
      wf.type = 'lowpass';
      wf.frequency.value = 500;
      this.windGain = ctx.createGain();
      this.windGain.gain.value = 0;
      w.connect(wf).connect(this.windGain).connect(this.master);
      w.start();

      // Stall warning horn (aircraft): a steady reedy tone, silent until the wing nears the stall.
      const horn = ctx.createOscillator();
      horn.type = 'square';
      horn.frequency.value = 2300;
      const hf = ctx.createBiquadFilter();
      hf.type = 'bandpass';
      hf.frequency.value = 2300;
      hf.Q.value = 3;
      this.hornGain = ctx.createGain();
      this.hornGain.gain.value = 0;
      horn.connect(hf).connect(this.hornGain).connect(this.master);
      horn.start();
    } catch {
      this.ctx = null; // no audio available: the game runs silently
    }
  }

  toggleMute(): void {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.5, this.ctx.currentTime, 0.05);
  }

  /** Queue an impact; played (merged) from `update` so a 100 ms crash is one big sound, not 100 clicks. */
  impact(i: ImpactInfo): void {
    this.pendingImpact += i.energy;
  }

  update(car: Vehicle, now: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    // A non-finite value would make setTargetAtTime throw every frame: skip the frame instead.
    if (!Number.isFinite(car.rpm) || !Number.isFinite(car.speed) || !Number.isFinite(car.throttleCmd)) return;
    if (ctx.state === 'suspended') void ctx.resume();
    const t = ctx.currentTime;
    const e = car.cfg.engine;
    const rpmN = clamp((car.rpm - e.idleRpm) / (e.redlineRpm - e.idleRpm), 0, 1);
    const throttle = car.throttleCmd;
    // Firing frequency of a 6-cylinder four-stroke: rpm/60 * 3.
    const f = (car.rpm / 60) * 3;
    this.osc1.frequency.setTargetAtTime(f, t, 0.03);
    this.osc2.frequency.setTargetAtTime(f * 2.01, t, 0.03);
    this.engineFilter.frequency.setTargetAtTime(260 + rpmN * 1800 + throttle * 900, t, 0.05);
    this.engineGain.gain.setTargetAtTime(0.1 + 0.18 * throttle + 0.08 * rpmN, t, 0.05);
    this.noiseGain.gain.setTargetAtTime(0.05 + 0.12 * throttle, t, 0.08);

    // Tyre squeal from the worst combined slip on asphalt.
    let slip = 0;
    for (const w of car.wheels) {
      if (!w.hit) continue;
      slip = Math.max(slip, Math.hypot(w.slipRatio, Math.tan(w.slipAngle) * 1.2));
    }
    const sq = car.speed > 3 ? clamp((slip - 0.3) * 1.3, 0, 1) : 0;
    this.squealGain.gain.setTargetAtTime(sq * 0.14, t, 0.04);
    this.squealFilter.frequency.setTargetAtTime(1100 + car.speed * 14 + slip * 300, t, 0.05);

    this.windGain.gain.setTargetAtTime(clamp((car.speed / 60) ** 2, 0, 1) * 0.35, t, 0.1);

    // Crash sound: merge impacts that arrive within one frame burst.
    if (this.pendingImpact > 0 && now - this.lastImpact > 60) {
      this.crash(this.pendingImpact);
      this.pendingImpact = 0;
      this.lastImpact = now;
    }
  }

  /**
   * Aircraft: a six-cylinder engine through the propeller (its blades pass at the firing rate, so
   * the two blend into one drone) or a jet's rumble, whine and roar; wind over the airframe from the airspeed, the stall horn, and
   * the crash sounds of parts hitting things.
   */
  updateAircraft(ac: Aircraft, now: number, stallWarning: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const st = ac.state;
    if (!Number.isFinite(st.rpm) || !Number.isFinite(st.airspeed)) return;
    if (ctx.state === 'suspended') void ctx.resume();
    const t = ctx.currentTime;
    const e = ac.cfg.engine;
    const running = !ac.propBroken && ac.engineHealth > 0;
    const rpmN = clamp((st.rpm - e.idleRpm) / (e.maxRpm - e.idleRpm), 0, 1);
    const throttle = running ? ac.controls.throttle : 0;
    if (e.kind === 'jet') {
      // Turbofan: a low rumble and the compressor's whine rising with the spool, under the roar of
      // the exhaust (broadband noise), which the afterburner doubles.
      const spool = running ? rpmN : 0;
      this.osc1.frequency.setTargetAtTime(42 + spool * 30, t, 0.2);
      this.osc2.frequency.setTargetAtTime(1400 + spool * 2600, t, 0.3);
      this.engineFilter.frequency.setTargetAtTime(900 + spool * 3200, t, 0.2);
      this.engineGain.gain.setTargetAtTime(running ? 0.05 + 0.07 * spool : 0, t, 0.2);
      this.noiseGain.gain.setTargetAtTime(running ? 0.1 + 0.25 * spool + (st.afterburner ? 0.3 : 0) : 0, t, 0.25);
    } else {
      const f = Math.max(8, (st.rpm / 60) * 3);
      this.osc1.frequency.setTargetAtTime(f, t, 0.05);
      this.osc2.frequency.setTargetAtTime(f * 2.0, t, 0.05);
      this.engineFilter.frequency.setTargetAtTime(220 + rpmN * 900 + throttle * 700, t, 0.08);
      this.engineGain.gain.setTargetAtTime(running ? 0.12 + 0.2 * throttle + 0.08 * rpmN : 0, t, 0.08);
      // Propeller wash: broadband noise that grows with power.
      this.noiseGain.gain.setTargetAtTime(running ? 0.08 + 0.22 * throttle * rpmN : 0.02 * rpmN, t, 0.1);
    }
    this.squealGain.gain.setTargetAtTime(0, t, 0.05);
    const v = st.airspeed;
    this.windFilter.frequency.setTargetAtTime(300 + v * 9, t, 0.2);
    this.windGain.gain.setTargetAtTime(clamp((v / 70) ** 2, 0, 1.2) * 0.3, t, 0.15);
    this.hornGain.gain.setTargetAtTime(stallWarning && !this.muted ? 0.05 : 0, t, 0.03);
    if (this.pendingImpact > 0 && now - this.lastImpact > 60) {
      this.crash(this.pendingImpact);
      this.pendingImpact = 0;
      this.lastImpact = now;
    }
  }

  /** Silence the aircraft-only sounds (back in a car). */
  leaveAircraft(): void {
    if (!this.ctx) return;
    this.hornGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02);
    this.windFilter.frequency.setTargetAtTime(500, this.ctx.currentTime, 0.1);
  }

  /** A short tyre chirp (a wheel touching the runway at speed), 0..1. */
  chirp(strength: number): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1300;
    bp.Q.value = 6;
    const g = ctx.createGain();
    const a = clamp(strength, 0.05, 1) * 0.35;
    g.gain.setValueAtTime(a, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + 0.3);
  }

  /** Queue an impact by its energy (J): an aircraft part hitting something. */
  impactEnergy(energy: number): void {
    this.pendingImpact += energy;
  }

  private crash(energy: number): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t = ctx.currentTime;
    const loud = clamp(Math.sqrt(energy) / 450, 0.08, 1);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 600 + loud * 4500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(loud, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18 + loud * 0.5);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 0.8);
    // Metallic ring + low thump.
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(70 + loud * 40, t);
    o.frequency.exponentialRampToValueAtTime(32, t + 0.25);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.7 * loud, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + 0.35);
  }
}
