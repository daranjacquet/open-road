import * as THREE from 'three';

export interface ParticleOptions {
  capacity: number;
  additive?: boolean;
  /** m/s^2 applied to velocity (negative = falls). */
  gravity?: number;
  /** Velocity damping per second. */
  drag?: number;
  /** Pixels-per-metre scale for point sizes. */
  sizeScale?: number;
}

const VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
varying float vAlpha;
varying vec3 vColor;
uniform float uScale;
void main() {
  vAlpha = aAlpha;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uScale / max(-mv.z, 0.1);
}`;

const FRAG = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float d = length(p) * 2.0;
  if (d > 1.0) discard;
  float a = (1.0 - d * d) * vAlpha;
  gl_FragColor = vec4(vColor, a);
}`;

/** Fixed-capacity CPU particle pool rendered as soft round points. No allocation after construction. */
export class ParticlePool {
  readonly points: THREE.Points;
  private readonly n: number;
  private readonly pos: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly color: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array; // remaining
  private readonly maxLife: Float32Array;
  private readonly size0: Float32Array;
  private readonly size1: Float32Array;
  private readonly alpha0: Float32Array;
  private cursor = 0;
  private readonly gravity: number;
  private readonly drag: number;
  private readonly geo: THREE.BufferGeometry;
  private readonly mat: THREE.ShaderMaterial;

  constructor(opt: ParticleOptions) {
    const n = (this.n = opt.capacity);
    this.gravity = opt.gravity ?? 0;
    this.drag = opt.drag ?? 0;
    this.pos = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.color = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    this.size0 = new Float32Array(n);
    this.size1 = new Float32Array(n);
    this.alpha0 = new Float32Array(n);
    // Park unused particles far below the world.
    for (let i = 0; i < n; i++) this.pos[i * 3 + 1] = -1e4;
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uScale: { value: opt.sizeScale ?? 600 } },
      transparent: true,
      depthWrite: false,
      blending: opt.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
  }

  spawn(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    life: number, size0: number, size1: number,
    r: number, g: number, b: number, alpha: number,
  ): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.n;
    const o = i * 3;
    this.pos[o] = x; this.pos[o + 1] = y; this.pos[o + 2] = z;
    this.vel[o] = vx; this.vel[o + 1] = vy; this.vel[o + 2] = vz;
    this.color[o] = r; this.color[o + 1] = g; this.color[o + 2] = b;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size0[i] = size0;
    this.size1[i] = size1;
    this.alpha0[i] = alpha;
    this.size[i] = size0;
    this.alpha[i] = alpha;
  }

  update(dt: number, viewportHeight: number): void {
    (this.mat.uniforms['uScale'] as { value: number }).value = viewportHeight * 0.6;
    const damp = Math.exp(-this.drag * dt);
    for (let i = 0; i < this.n; i++) {
      const l = this.life[i]!;
      if (l <= 0) {
        if (this.alpha[i]! !== 0) {
          this.alpha[i] = 0;
          this.pos[i * 3 + 1] = -1e4;
        }
        continue;
      }
      const o = i * 3;
      this.life[i] = l - dt;
      this.vel[o + 1] = this.vel[o + 1]! + this.gravity * dt;
      this.vel[o] = this.vel[o]! * damp;
      this.vel[o + 1] = this.vel[o + 1]! * damp;
      this.vel[o + 2] = this.vel[o + 2]! * damp;
      this.pos[o] = this.pos[o]! + this.vel[o]! * dt;
      this.pos[o + 1] = this.pos[o + 1]! + this.vel[o + 1]! * dt;
      this.pos[o + 2] = this.pos[o + 2]! + this.vel[o + 2]! * dt;
      if (this.pos[o + 1]! < 0.02 && this.gravity < 0) {
        this.pos[o + 1] = 0.02;
        this.vel[o + 1] = Math.abs(this.vel[o + 1]!) * 0.25;
        this.vel[o] = this.vel[o]! * 0.6;
        this.vel[o + 2] = this.vel[o + 2]! * 0.6;
      }
      const t = 1 - Math.max(this.life[i]!, 0) / this.maxLife[i]!;
      this.size[i] = this.size0[i]! + (this.size1[i]! - this.size0[i]!) * t;
      this.alpha[i] = this.alpha0[i]! * (1 - t) * (1 - t * 0.3);
    }
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}
