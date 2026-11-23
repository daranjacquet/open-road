import { clamp, damp, moveToward } from './math';

/** What the driver asks of a car this step (keyboard, gamepad, AI or a test script). */
export interface DriveInput {
  /** 0..1 */
  throttle: number;
  /** 0..1 (also reverse when stopped) */
  brake: number;
  /** -1..1, +1 = left */
  steer: number;
  /** 0..1 */
  handbrake: number;
}

/**
 * What the pilot asks of an aircraft this step. Stick and pedals -1..1: pitch +1 = stick back (nose
 * up), roll +1 = right wing down, yaw +1 = left pedal (nose left). Throttle lever, brakes 0..1;
 * flaps 0..1 of full travel.
 */
export interface FlightInput {
  pitch: number;
  roll: number;
  yaw: number;
  throttle: number;
  brake: number;
  flaps: number;
}

/** Flap settings the flap lever steps through (share of full travel). */
export const FLAP_NOTCHES = [0, 0.5, 1] as const;

/** True for an element that takes typed text or arrow keys itself (value fields, menus). */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true;
  if (target instanceof HTMLInputElement) return !['checkbox', 'radio', 'button', 'submit', 'range', 'color'].includes(target.type);
  return false;
}

/** Keyboard + gamepad input. One call to `sample(dt)` per rendered frame returns the drive command. */
export class Input {
  private readonly down = new Set<string>();
  private readonly edges = new Set<string>();
  private steer = 0;
  private throttle = 0;
  private brake = 0;
  private padPressedPrev: boolean[] = [];
  usingPad = false;

  readonly out: DriveInput = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
  readonly flight: FlightInput = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: 0, flaps: 0 };
  private flapNotch = 0;

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      // Typing in a settings field is not driving (a focused checkbox or button does not count).
      // The focus, not the event target: a panel may have just let go of it for this very key.
      if (isTextEntry(document.activeElement)) return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Enter'].includes(e.code)) e.preventDefault();
      this.down.add(e.code);
      this.edges.add(e.code);
      if (e.shiftKey) this.edges.add('Shift+' + e.code);
    });
    target.addEventListener('keyup', (e) => this.down.delete(e.code));
    target.addEventListener('blur', () => this.down.clear());
  }

  /** Forget key presses nobody has read yet (switching between car and aircraft). */
  clearEdges(): void {
    this.edges.clear();
  }

  /** True once per key press (edge-triggered). */
  pressed(code: string): boolean {
    const had = this.edges.has(code);
    this.edges.delete(code);
    return had;
  }

  private key(...codes: string[]): boolean {
    for (const c of codes) if (this.down.has(c)) return true;
    return false;
  }

  sample(dt: number): DriveInput {
    const o = this.out;
    // Keyboard targets.
    const tThrottle = this.key('KeyW', 'ArrowUp') ? 1 : 0;
    const tBrake = this.key('KeyS', 'ArrowDown') ? 1 : 0;
    const tSteer = (this.key('KeyA', 'ArrowLeft') ? 1 : 0) - (this.key('KeyD', 'ArrowRight') ? 1 : 0);
    let handbrake = this.key('Space') ? 1 : 0;

    // Keyboard smoothing: gentle pedal ramps, steering that eases in and returns quickly.
    const steerRate = tSteer === 0 ? 6 : Math.sign(tSteer) !== Math.sign(this.steer) && this.steer !== 0 ? 9 : 3.4;
    this.steer = moveToward(this.steer, tSteer, steerRate * dt);
    this.throttle += (tThrottle - this.throttle) * damp(14, dt);
    this.brake += (tBrake - this.brake) * damp(14, dt);
    let steer = this.steer;
    let throttle = this.throttle;
    let brake = this.brake;

    // Gamepad overrides when it is being used.
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = pads.find((p) => p && p.connected);
    if (pad) {
      const ax = pad.axes[0] ?? 0;
      const dz = Math.abs(ax) < 0.12 ? 0 : (Math.abs(ax) - 0.12) / 0.88;
      const padSteer = -Math.sign(ax) * Math.pow(dz, 1.4);
      const rt = pad.buttons[7]?.value ?? 0;
      const lt = pad.buttons[6]?.value ?? 0;
      const active = Math.abs(padSteer) > 0.02 || rt > 0.02 || lt > 0.02;
      if (active) this.usingPad = true;
      if (this.usingPad) {
        steer = padSteer;
        throttle = Math.max(rt, tThrottle ? throttle : 0);
        brake = Math.max(lt, tBrake ? brake : 0);
        if (pad.buttons[0]?.pressed || pad.buttons[2]?.pressed) handbrake = 1;
      }
      const pressedNow = pad.buttons.map((b) => b.pressed);
      const edge = (i: number, code: string): void => {
        if (pressedNow[i] && !this.padPressedPrev[i]) this.edges.add(code);
      };
      edge(3, 'KeyR');
      edge(1, 'KeyC');
      edge(9, 'Enter'); // Start: get in or out of the aircraft
      edge(4, 'KeyQ'); // LB: shift down
      edge(5, 'KeyE'); // RB: shift up
      this.padPressedPrev = pressedNow;
    }
    o.throttle = clamp(throttle, 0, 1);
    o.brake = clamp(brake, 0, 1);
    o.steer = clamp(steer, -1, 1);
    o.handbrake = handbrake;
    return o;
  }

  /** The flight controls (stick ramps, lever positions) as they are now, without sampling. */
  resetFlight(throttle = 0, flaps = 0): void {
    const f = this.flight;
    f.pitch = f.roll = f.yaw = f.brake = 0;
    f.throttle = throttle;
    this.flapNotch = Math.max(0, FLAP_NOTCHES.findIndex((n) => n >= flaps - 1e-3));
    f.flaps = FLAP_NOTCHES[this.flapNotch]!;
  }

  /**
   * Flight controls, once per rendered frame. Keyboard: S/Down stick back (nose up), W/Up stick
   * forward, A/D (Left/Right) roll, Q/E rudder, Shift/Ctrl throttle up/down, X flaps (0, 50, 100 %,
   * Shift+X back a notch), Space brakes. Keys ramp the stick in and centre it quickly, like a hand on a
   * stick. Gamepad: left stick pitch and roll, triggers move the throttle, bumpers the rudder, A
   * brakes, X flaps.
   */
  sampleFlight(dt: number): FlightInput {
    const f = this.flight;
    const tPitch = (this.key('KeyS', 'ArrowDown') ? 1 : 0) - (this.key('KeyW', 'ArrowUp') ? 1 : 0);
    const tRoll = (this.key('KeyD', 'ArrowRight') ? 1 : 0) - (this.key('KeyA', 'ArrowLeft') ? 1 : 0);
    const tYaw = (this.key('KeyQ') ? 1 : 0) - (this.key('KeyE') ? 1 : 0);
    const ramp = (cur: number, target: number, rateIn: number, rateOut: number): number =>
      moveToward(cur, target, (target === 0 || Math.sign(target) !== Math.sign(cur) ? rateOut : rateIn) * dt);
    let pitch = ramp(f.pitch, tPitch, 2.2, 5);
    let roll = ramp(f.roll, tRoll, 4, 6);
    let yaw = ramp(f.yaw, tYaw, 2.5, 5);
    let throttle = f.throttle + ((this.key('ShiftLeft', 'ShiftRight') ? 1 : 0) - (this.key('ControlLeft', 'ControlRight') ? 1 : 0)) * 0.5 * dt;
    let brake = this.key('Space') ? 1 : 0;
    if (this.pressed('Shift+KeyX')) {
      this.edges.delete('KeyX');
      this.flapNotch = Math.max(0, this.flapNotch - 1);
    } else if (this.pressed('KeyX')) this.flapNotch = (this.flapNotch + 1) % FLAP_NOTCHES.length;

    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = pads.find((p) => p && p.connected);
    if (pad) {
      const axis = (i: number): number => {
        const a = pad.axes[i] ?? 0;
        const d = Math.abs(a) < 0.1 ? 0 : (Math.abs(a) - 0.1) / 0.9;
        return Math.sign(a) * Math.pow(d, 1.5);
      };
      const sx = axis(0);
      const sy = axis(1);
      const rt = pad.buttons[7]?.value ?? 0;
      const lt = pad.buttons[6]?.value ?? 0;
      const lb = pad.buttons[4]?.pressed ? 1 : 0;
      const rb = pad.buttons[5]?.pressed ? 1 : 0;
      if (Math.abs(sx) > 0.02 || Math.abs(sy) > 0.02 || rt > 0.02 || lt > 0.02 || lb || rb) this.usingPad = true;
      if (this.usingPad) {
        if (!tPitch) pitch = sy;
        if (!tRoll) roll = sx;
        if (!tYaw) yaw = lb - rb;
        throttle += (rt - lt) * 0.6 * dt;
        if (pad.buttons[0]?.pressed) brake = 1;
      }
      const pressedNow = pad.buttons.map((b) => b.pressed);
      const edge = (i: number, code: string): void => {
        if (pressedNow[i] && !this.padPressedPrev[i]) this.edges.add(code);
      };
      edge(3, 'KeyR');
      edge(1, 'KeyC');
      edge(9, 'Enter');
      if (pressedNow[2] && !this.padPressedPrev[2]) this.flapNotch = (this.flapNotch + 1) % FLAP_NOTCHES.length;
      this.padPressedPrev = pressedNow;
    }
    f.pitch = clamp(pitch, -1, 1);
    f.roll = clamp(roll, -1, 1);
    f.yaw = clamp(yaw, -1, 1);
    f.throttle = clamp(throttle, 0, 1);
    f.brake = brake;
    f.flaps = FLAP_NOTCHES[this.flapNotch]!;
    return f;
  }
}
