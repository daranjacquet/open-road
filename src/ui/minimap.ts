import type { Location } from '../world/map';
import type { Overview } from '../world/overview';

/** Radius of the minimap (CSS px) and the ground it covers (m). */
const R = 85;
const RANGE = 360;

/**
 * Minimap (bottom left, turning with the car, north marker on its rim) and the big map (N key):
 * the whole world with every place to visit; clicking a place drives you there.
 */
export class Minimap {
  private readonly small: HTMLCanvasElement;
  private readonly sg: CanvasRenderingContext2D;
  private readonly big: HTMLDivElement;
  private readonly bigCanvas: HTMLCanvasElement;
  private readonly bg: CanvasRenderingContext2D;
  private readonly dpr = Math.min(2, window.devicePixelRatio || 1);
  private player = { x: 0, z: 0, yaw: 0 };
  private open = false;
  private hits: { x: number; y: number; loc: Location }[] = [];

  constructor(
    root: HTMLElement,
    private readonly ov: Overview,
    private readonly places: Location[],
    private readonly onGo: (loc: Location) => void,
  ) {
    const style = document.createElement('style');
    style.textContent = `
      .mm{position:fixed;left:112px;bottom:20px;width:${2 * R}px;height:${2 * R}px;border-radius:50%;overflow:hidden;
        box-shadow:0 0 0 2px rgba(255,255,255,.55),0 3px 12px rgba(0,0,0,.45);background:#2a3a2a}
      .bigmap{position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(6,10,14,.72);pointer-events:auto;cursor:default}
      .bigmap.on{display:flex}
      .bigmap canvas{border-radius:10px;box-shadow:0 10px 40px rgba(0,0,0,.6)}
      .bigmap .hint{position:absolute;top:14px;left:50%;transform:translateX(-50%);font-size:13px;opacity:.85}`;
    root.appendChild(style);
    this.small = document.createElement('canvas');
    this.small.className = 'mm';
    this.small.width = this.small.height = 2 * R * this.dpr;
    root.appendChild(this.small);
    this.sg = this.small.getContext('2d')!;
    this.big = document.createElement('div');
    this.big.className = 'bigmap';
    this.big.innerHTML = '<div class="hint">Click a place to go there &middot; N or Esc to close</div>';
    this.bigCanvas = document.createElement('canvas');
    this.big.appendChild(this.bigCanvas);
    root.appendChild(this.big);
    this.bg = this.bigCanvas.getContext('2d')!;
    this.bigCanvas.addEventListener('mousemove', (e) => {
      this.bigCanvas.style.cursor = this.pick(e) ? 'pointer' : 'default';
    });
    this.bigCanvas.addEventListener('click', (e) => {
      const loc = this.pick(e);
      if (!loc) return;
      this.toggle(false);
      this.onGo(loc);
    });
    this.big.addEventListener('click', (e) => {
      if (e.target === this.big) this.toggle(false);
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.open) this.toggle(false);
    });
  }

  get isOpen(): boolean {
    return this.open;
  }

  toggle(open = !this.open): void {
    this.open = open;
    this.big.classList.toggle('on', open);
    if (open) this.drawBig();
  }

  private pick(e: MouseEvent): Location | null {
    const r = this.bigCanvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    for (const h of this.hits) if ((h.x - x) ** 2 + (h.y - y) ** 2 < 14 * 14) return h.loc;
    return null;
  }

  /** Called at HUD rate with the car's position and heading. */
  update(x: number, z: number, yaw: number): void {
    this.player = { x, z, yaw };
    this.drawSmall();
    if (this.open) this.drawBig();
  }

  private drawSmall(): void {
    const g = this.sg;
    const { x, z, yaw } = this.player;
    const d = this.dpr;
    const k = (R / RANGE) * this.ov.scale * d; // canvas px per overview px
    const px = (x + this.ov.half) / this.ov.scale;
    const py = (z + this.ov.half) / this.ov.scale;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#2a3a2a';
    g.fillRect(0, 0, 2 * R * d, 2 * R * d);
    g.translate(R * d, R * d);
    // Heading up: the car's forward (sin yaw, cos yaw) maps to the screen's up.
    g.rotate(yaw - Math.PI);
    // Only the part of the overview around the car.
    const src = (RANGE * 1.5) / this.ov.scale;
    g.imageSmoothingEnabled = true;
    g.drawImage(this.ov.canvas, px - src, py - src, src * 2, src * 2, -src * k, -src * k, src * 2 * k, src * 2 * k);
    // Places in range.
    for (const p of this.places) {
      const dx = ((p.x + this.ov.half) / this.ov.scale - px) * k;
      const dy = ((p.z + this.ov.half) / this.ov.scale - py) * k;
      if (dx * dx + dy * dy > (R * d) ** 2) continue;
      g.beginPath();
      g.arc(dx, dy, 3.5 * d, 0, Math.PI * 2);
      g.fillStyle = '#ffcf3a';
      g.fill();
      g.lineWidth = d;
      g.strokeStyle = '#3a2a00';
      g.stroke();
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    // North marker on the rim.
    const na = yaw - Math.PI - Math.PI / 2;
    const nx = R * d + Math.cos(na) * (R - 10) * d;
    const ny = R * d + Math.sin(na) * (R - 10) * d;
    g.font = `bold ${11 * d}px system-ui,sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = 'rgba(0,0,0,.55)';
    g.beginPath();
    g.arc(nx, ny, 8 * d, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff';
    g.fillText('N', nx, ny + 0.5 * d);
    this.arrow(g, R * d, R * d, 0, 7 * d);
  }

  private arrow(g: CanvasRenderingContext2D, x: number, y: number, rot: number, s: number): void {
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    g.beginPath();
    g.moveTo(0, -s * 1.3);
    g.lineTo(s * 0.85, s);
    g.lineTo(0, s * 0.45);
    g.lineTo(-s * 0.85, s);
    g.closePath();
    g.fillStyle = '#ff3b30';
    g.fill();
    g.lineWidth = s * 0.25;
    g.strokeStyle = '#fff';
    g.stroke();
    g.restore();
  }

  private drawBig(): void {
    const css = Math.floor(Math.min(window.innerWidth, window.innerHeight) * 0.88);
    const d = this.dpr;
    if (this.bigCanvas.width !== css * d) {
      this.bigCanvas.width = this.bigCanvas.height = css * d;
      this.bigCanvas.style.width = this.bigCanvas.style.height = `${css}px`;
    }
    const g = this.bg;
    const s = (css * d) / this.ov.canvas.width;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = true;
    g.drawImage(this.ov.canvas, 0, 0, css * d, css * d);
    const toCanvas = (x: number, z: number): [number, number] => [((x + this.ov.half) / this.ov.scale) * s, ((z + this.ov.half) / this.ov.scale) * s];
    this.hits = [];
    g.font = `600 ${12 * d}px system-ui,sans-serif`;
    g.textBaseline = 'middle';
    for (const p of this.places) {
      const [cx, cy] = toCanvas(p.x, p.z);
      g.beginPath();
      g.arc(cx, cy, 6 * d, 0, Math.PI * 2);
      g.fillStyle = '#ffcf3a';
      g.fill();
      g.lineWidth = 1.5 * d;
      g.strokeStyle = '#3a2a00';
      g.stroke();
      const w = g.measureText(p.name).width;
      g.fillStyle = 'rgba(10,14,20,.7)';
      g.fillRect(cx + 9 * d, cy - 9 * d, w + 8 * d, 18 * d);
      g.fillStyle = '#fff';
      g.textAlign = 'left';
      g.fillText(p.name, cx + 13 * d, cy + 0.5 * d);
      this.hits.push({ x: cx / d, y: cy / d, loc: p });
    }
    const [px, py] = toCanvas(this.player.x, this.player.z);
    this.arrow(g, px, py, Math.PI - this.player.yaw, 8 * d);
  }
}
