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

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      // Typing in a settings field is not driving.
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      this.down.add(e.code);
      this.edges.add(e.code);
      if (e.shiftKey) this.edges.add('Shift+' + e.code);
    });
    target.addEventListener('keyup', (e) => this.down.delete(e.code));
    target.addEventListener('blur', () => this.down.clear());
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
}
