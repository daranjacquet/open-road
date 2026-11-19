import * as THREE from 'three';

const VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec4 iData; // size, alpha, rotation, shade
varying vec2 vUv;
varying float vAlpha;
varying float vShade;
void main() {
  vUv = uv;
  vAlpha = iData.y;
  vShade = iData.w;
  float c = cos(iData.z), s = sin(iData.z);
  vec2 corner = vec2(c * position.x - s * position.y, s * position.x + c * position.y) * iData.x;
  // Camera-facing quad.
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  mv.xy += corner;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uLight;
varying vec2 vUv;
varying float vAlpha;
varying float vShade;
void main() {
  vec4 t = texture2D(uMap, vUv);
  float a = t.a * vAlpha;
  if (a < 0.004) discard;
  // Lit from above: the top of each puff a little brighter.
  vec3 col = vShade * mix(uLight * 0.78, uLight, vUv.y) * (0.82 + 0.18 * t.r);
  gl_FragColor = vec4(col, a);
}`;

/** A soft, lumpy puff texture (several overlapping blobs), generated once. */
function puffTexture(): THREE.Texture {
  // Headless (tests): a plain white texel is enough.
  if (typeof document === 'undefined') {
    const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    t.needsUpdate = true;
    return t;
  }
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  let seed = 7;
  const rnd = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 14; i++) {
    const a = rnd() * Math.PI * 2;
    const r = rnd() * size * 0.18;
    const x = size / 2 + Math.cos(a) * r;
    const y = size / 2 + Math.sin(a) * r;
    const rad = size * (0.2 + rnd() * 0.17);
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    const v = Math.round(200 + rnd() * 55);
    grad.addColorStop(0, `rgba(${v},${v},${v},0.5)`);
    grad.addColorStop(1, `rgba(${v},${v},${v},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Big billboarded smoke puffs (instanced quads, so no point-size limit): tyre smoke clouds that
 * grow, rise slowly and linger where the car slid.
 */
export class SmokeClouds {
  readonly mesh: THREE.Mesh;
  private readonly n: number;
  private readonly iPos: Float32Array;
  private readonly iData: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly size0: Float32Array;
  private readonly size1: Float32Array;
  private readonly alpha0: Float32Array;
  private readonly spin: Float32Array;
  private cursor = 0;
  private live = 0;
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly mat: THREE.ShaderMaterial;

  constructor(capacity: number) {
    const n = (this.n = capacity);
    this.iPos = new Float32Array(n * 3);
    this.iData = new Float32Array(n * 4);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    this.size0 = new Float32Array(n);
    this.size1 = new Float32Array(n);
    this.alpha0 = new Float32Array(n);
    this.spin = new Float32Array(n);
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.getAttribute('position'));
    this.geo.setAttribute('uv', quad.getAttribute('uv'));
    this.geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(this.iPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('iData', new THREE.InstancedBufferAttribute(this.iData, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.instanceCount = 0;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uMap: { value: puffTexture() }, uLight: { value: new THREE.Color(0.93, 0.93, 0.95) } },
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size0: number, size1: number, alpha: number, shade = 1): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.n;
    const o = i * 3;
    this.iPos[o] = x;
    this.iPos[o + 1] = y;
    this.iPos[o + 2] = z;
    this.vel[o] = vx;
    this.vel[o + 1] = vy;
    this.vel[o + 2] = vz;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size0[i] = size0;
    this.size1[i] = size1;
    this.alpha0[i] = alpha;
    this.spin[i] = (Math.random() - 0.5) * 0.8;
    this.iData[i * 4 + 2] = Math.random() * Math.PI * 2;
    this.iData[i * 4 + 3] = shade;
    this.live = Math.max(this.live, i + 1);
  }

  update(dt: number): void {
    const drag = Math.exp(-1.6 * dt);
    let last = 0;
    for (let i = 0; i < this.live; i++) {
      const d = i * 4;
      const l = this.life[i]!;
      if (l <= 0) {
        this.iData[d + 1] = 0;
        this.iData[d] = 0;
        continue;
      }
      last = i + 1;
      const o = i * 3;
      this.life[i] = l - dt;
      // Puffs slow down fast, then drift up a little.
      this.vel[o] = this.vel[o]! * drag;
      this.vel[o + 1] = this.vel[o + 1]! * drag + 0.35 * dt;
      this.vel[o + 2] = this.vel[o + 2]! * drag;
      this.iPos[o] = this.iPos[o]! + this.vel[o]! * dt;
      this.iPos[o + 1] = Math.max(this.iPos[o + 1]! + this.vel[o + 1]! * dt, 0.15);
      this.iPos[o + 2] = this.iPos[o + 2]! + this.vel[o + 2]! * dt;
      const t = 1 - Math.max(this.life[i]!, 0) / this.maxLife[i]!;
      // Grow fast first (ease out), fade in quickly and out slowly.
      this.iData[d] = this.size0[i]! + (this.size1[i]! - this.size0[i]!) * (1 - (1 - t) * (1 - t));
      this.iData[d + 1] = this.alpha0[i]! * Math.min(t * 8, 1) * Math.pow(1 - t, 1.5);
      this.iData[d + 2] = this.iData[d + 2]! + this.spin[i]! * dt;
    }
    this.live = last;
    this.geo.instanceCount = this.live;
    (this.geo.getAttribute('iPos') as THREE.InstancedBufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('iData') as THREE.InstancedBufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
    (this.mat.uniforms['uMap']!.value as THREE.Texture).dispose();
  }
}
