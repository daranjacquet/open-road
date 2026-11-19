/** F3 debug overlay: FPS, physics step time and free-form lines supplied by systems. */
export class DebugOverlay {
  private readonly el: HTMLElement;
  private visible = false;
  private readonly lines = new Map<string, string>();
  private fpsAcc = 0;
  private fpsFrames = 0;
  private fps = 0;
  private lastRender = 0;

  constructor(el: HTMLElement) {
    this.el = el;
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') {
        e.preventDefault();
        this.toggle();
      }
    });
  }

  toggle(force?: boolean): void {
    this.visible = force ?? !this.visible;
    this.el.style.display = this.visible ? 'block' : 'none';
  }

  get isVisible(): boolean {
    return this.visible;
  }

  set(key: string, value: string): void {
    this.lines.set(key, value);
  }

  /** Call once per rendered frame with the frame delta (seconds). */
  frame(dt: number, now: number): void {
    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
    // Refresh text at ~10 Hz to keep DOM cost negligible.
    if (!this.visible || now - this.lastRender < 100) return;
    this.lastRender = now;
    let text = `FPS ${this.fps.toFixed(0)}`;
    for (const [k, v] of this.lines) text += `\n${k}: ${v}`;
    this.el.textContent = text;
  }
}
