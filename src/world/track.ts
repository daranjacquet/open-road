import * as THREE from 'three';
import { GROUP, groups, type Physics } from '../core/physics';
import { ASPHALT, type SurfaceMap } from './surface';

export interface TrackDef {
  id: string;
  name: string;
  /** Control points (x, z) of the closed centre line, driving direction. */
  points: [number, number][];
  /** Asphalt width (m). */
  width: number;
  /** Grass between the edge of the track and the wall (m). */
  runoff: number;
  wall: 'armco' | 'blocks';
  /** Extra asphalt circles [x, z, r] (drift pad). */
  pads?: [number, number, number][];
}

/** The sampled centre line of a closed circuit: position, direction and curvature every `step` m. */
export class TrackLine {
  readonly x: Float64Array;
  readonly z: Float64Array;
  /** Unit tangent. */
  readonly tx: Float64Array;
  readonly tz: Float64Array;
  /** Signed curvature (1/m, + = turning left). */
  readonly curv: Float64Array;
  readonly n: number;
  readonly length: number;

  constructor(
    readonly def: TrackDef,
    readonly step = 2,
  ) {
    const curve = new THREE.CatmullRomCurve3(
      def.points.map(([x, z]) => new THREE.Vector3(x, 0, z)),
      true,
      'centripetal',
    );
    this.length = curve.getLength();
    const n = (this.n = Math.round(this.length / step));
    const pts = curve.getSpacedPoints(n);
    this.x = new Float64Array(n);
    this.z = new Float64Array(n);
    this.tx = new Float64Array(n);
    this.tz = new Float64Array(n);
    this.curv = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      this.x[i] = pts[i]!.x;
      this.z[i] = pts[i]!.z;
    }
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n;
      const b = (i + 1) % n;
      const dx = this.x[b]! - this.x[a]!;
      const dz = this.z[b]! - this.z[a]!;
      const l = Math.hypot(dx, dz) || 1;
      this.tx[i] = dx / l;
      this.tz[i] = dz / l;
    }
    // Curvature over +-3 samples, smoothed: the angle the tangent turns per metre.
    for (let i = 0; i < n; i++) {
      const a = (i - 3 + n) % n;
      const b = (i + 3) % n;
      const cross = this.tx[a]! * this.tz[b]! - this.tz[a]! * this.tx[b]!;
      const dot = this.tx[a]! * this.tx[b]! + this.tz[a]! * this.tz[b]!;
      // Left normal is (tz, -tx): turning left rotates the tangent towards it.
      this.curv[i] = -Math.atan2(cross, dot) / (6 * step);
    }
  }

  /** Left-hand normal at sample i (x, z). */
  leftX(i: number): number {
    return this.tz[i]!;
  }
  leftZ(i: number): number {
    return -this.tx[i]!;
  }

  /** Nearest sample to (x, z). With a hint, searches around it first (cheap per-frame tracking). */
  nearest(x: number, z: number, hint = -1): { i: number; dist: number; lateral: number } {
    let best = -1;
    let bd = Infinity;
    const scan = (from: number, to: number): void => {
      for (let k = from; k <= to; k++) {
        const i = ((k % this.n) + this.n) % this.n;
        const d = (this.x[i]! - x) ** 2 + (this.z[i]! - z) ** 2;
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
    };
    if (hint >= 0) scan(hint - 40, hint + 40);
    if (best < 0 || Math.sqrt(bd) > 40) {
      bd = Infinity;
      scan(0, this.n - 1);
    }
    const i = best;
    const lateral = (x - this.x[i]!) * this.leftX(i) + (z - this.z[i]!) * this.leftZ(i);
    return { i, dist: Math.sqrt(bd), lateral };
  }

  /** Pose at arc length s (wraps): position and yaw for `Vehicle.placeAt`. */
  at(s: number): { x: number; z: number; yaw: number } {
    const i = ((Math.round(s / this.step) % this.n) + this.n) % this.n;
    return { x: this.x[i]!, z: this.z[i]!, yaw: Math.atan2(this.tx[i]!, this.tz[i]!) };
  }
}

/** A strip between two lateral offsets along the line (only where `mask` is true). */
function ribbon(
  line: TrackLine,
  a: number,
  b: number,
  y: number,
  vScale: number,
  mask?: (i: number) => boolean,
  color?: (i: number) => [number, number, number],
  uScale = 1,
): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const n = line.n;
  let s = 0;
  for (let k = 0; k <= n; k++) {
    const i = k % n;
    if (k > 0) s += line.step;
    for (const [off, u] of [
      [a, 0],
      [b, uScale],
    ] as const) {
      pos.push(line.x[i]! + line.leftX(i) * off, y, line.z[i]! + line.leftZ(i) * off);
      uv.push(u, s / vScale);
      if (color) col.push(...color(i));
    }
    if (k > 0 && (!mask || (mask(i) && mask((i - 1 + n) % n)))) {
      const p = (k - 1) * 2;
      const q = k * 2;
      // Winding so the face points up whatever the order of a and b.
      if (b > a) idx.push(p, q, p + 1, q, q + 1, p + 1);
      else idx.push(p, p + 1, q, q, p + 1, q + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (color) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export interface TrackMaterials {
  asphalt: THREE.Material;
  paint: THREE.Material;
  curb: THREE.Material;
  armco: THREE.Material;
  blocks: THREE.Material;
  checker: THREE.Material;
  post: THREE.Material;
}

function checkerTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 16;
  const g = c.getContext('2d')!;
  for (let y = 0; y < 2; y++) {
    for (let x = 0; x < 8; x++) {
      g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4';
      g.fillRect(x * 8, y * 8, 8, 8);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function trackMaterials(asphaltMap: THREE.Texture): TrackMaterials {
  const asphalt = new THREE.MeshStandardMaterial({ map: asphaltMap, color: 0x8a8d94, roughness: 0.9 });
  asphalt.polygonOffset = true;
  asphalt.polygonOffsetFactor = -2;
  const paint = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.7 });
  paint.polygonOffset = true;
  paint.polygonOffsetFactor = -5;
  const curb = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
  curb.polygonOffset = true;
  curb.polygonOffsetFactor = -3;
  const checker = new THREE.MeshStandardMaterial({ map: checkerTexture(), roughness: 0.6 });
  checker.polygonOffset = true;
  checker.polygonOffsetFactor = -6;
  return {
    asphalt,
    paint,
    curb,
    armco: new THREE.MeshStandardMaterial({ color: 0xb7bcc2, roughness: 0.35, metalness: 0.7 }),
    blocks: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }),
    checker,
    post: new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.6 }),
  };
}

export interface BuiltTrack {
  line: TrackLine;
  group: THREE.Group;
}

/** Build a circuit: asphalt, lines, curbs, walls with colliders, start gantry, painted surface. */
export function buildTrack(physics: Physics, def: TrackDef, surface: SurfaceMap, mats: TrackMaterials): BuiltTrack {
  const { RAPIER, world } = physics;
  const line = new TrackLine(def);
  const group = new THREE.Group();
  group.name = `track-${def.id}`;
  const hw = def.width / 2;

  // Surface: asphalt plus curbs.
  for (let i = 0; i < line.n; i++) surface.fillDisc(line.x[i]!, line.z[i]!, hw + 1.6, ASPHALT);
  for (const [x, z, r] of def.pads ?? []) surface.fillDisc(x, z, r, ASPHALT);

  const road = new THREE.Mesh(ribbon(line, -hw, hw, 0.02, 6, undefined, undefined, def.width / 6), mats.asphalt);
  road.receiveShadow = true;
  group.add(road);
  for (const side of [-1, 1]) {
    const a = side * (hw - 0.6);
    const b = side * (hw - 0.3);
    group.add(new THREE.Mesh(ribbon(line, Math.min(a, b), Math.max(a, b), 0.03, 6), mats.paint));
  }

  // Curbs on the inside and outside of corners, red and white every 4 m.
  const corner = (i: number): boolean => {
    for (let k = -4; k <= 4; k++) if (Math.abs(line.curv[(i + k + line.n) % line.n]!) > 1 / 140) return true;
    return false;
  };
  const stripes = (i: number): [number, number, number] => (Math.floor(i / 2) % 2 ? [0.85, 0.08, 0.06] : [0.95, 0.95, 0.95]);
  group.add(new THREE.Mesh(ribbon(line, hw, hw + 1.4, 0.035, 4, corner, stripes), mats.curb));
  group.add(new THREE.Mesh(ribbon(line, -hw - 1.4, -hw, 0.035, 4, corner, stripes), mats.curb));

  // Drift pads: a disc of asphalt with a painted ring.
  for (const [x, z, r] of def.pads ?? []) {
    const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 72).rotateX(-Math.PI / 2), mats.asphalt);
    disc.position.set(x, 0.018, z);
    disc.receiveShadow = true;
    group.add(disc);
    for (const rr of [r * 0.45, r - 1.2]) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(rr - 0.15, rr + 0.15, 96).rotateX(-Math.PI / 2), mats.paint);
      ring.position.set(x, 0.03, z);
      group.add(ring);
    }
  }

  // Walls: boxes laid every 6 m at the edge of the run-off, skipped where the offset line would
  // fold back over the track (inside of tight corners).
  const off = hw + def.runoff;
  const segs: { x: number; z: number; len: number; yaw: number; side: number; k: number }[] = [];
  for (const side of [-1, 1]) {
    let prev: { x: number; z: number } | null = null;
    let k = 0;
    // One step past the end so the wall closes the loop at the start line.
    for (let i = 0; i <= line.n + 3; i += 3) {
      const j = i % line.n;
      const px = line.x[j]! + line.leftX(j) * off * side;
      const pz = line.z[j]! + line.leftZ(j) * off * side;
      const near = line.nearest(px, pz, j);
      const ok = near.dist > off - 0.6;
      if (ok && prev) {
        const dx = px - prev.x;
        const dz = pz - prev.z;
        const len = Math.hypot(dx, dz);
        if (len > 0.5 && len < 14) segs.push({ x: (px + prev.x) / 2, z: (pz + prev.z) / 2, len: len + 0.15, yaw: Math.atan2(dx, dz), side, k: k++ });
      }
      prev = ok ? { x: px, z: pz } : null;
    }
  }
  const armco = def.wall === 'armco';
  const h = armco ? 0.75 : 0.9;
  const t = armco ? 0.25 : 0.6;
  const wallMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), armco ? mats.armco : mats.blocks, segs.length);
  const wallBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const red = new THREE.Color(0xc8261c);
  const white = new THREE.Color(0xf0f0f0);
  segs.forEach((s, i) => {
    q.setFromAxisAngle(up, s.yaw);
    m.compose(new THREE.Vector3(s.x, h / 2 + (armco ? 0.15 : 0), s.z), q, new THREE.Vector3(t, h, s.len));
    wallMesh.setMatrixAt(i, m);
    if (!armco) wallMesh.setColorAt(i, s.k % 2 ? red : white);
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(t / 2 + 0.05, (h + (armco ? 0.15 : 0)) / 2, s.len / 2)
        .setTranslation(s.x, (h + (armco ? 0.15 : 0)) / 2, s.z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setFriction(0.45)
        .setCollisionGroups(groups(GROUP.WORLD, 0xffff)),
      wallBody,
    );
  });
  wallMesh.castShadow = true;
  wallMesh.receiveShadow = true;
  group.add(wallMesh);

  // Start / finish: chequered line across the track and a gantry over it.
  const s0 = line.at(0);
  const yawQ = new THREE.Quaternion().setFromAxisAngle(up, s0.yaw);
  const checker = (mats.checker as THREE.MeshStandardMaterial).clone();
  checker.map = checker.map!.clone();
  checker.map.repeat.set(def.width / 8, 1);
  const startLine = new THREE.Mesh(new THREE.PlaneGeometry(def.width, 2).rotateX(-Math.PI / 2), checker);
  startLine.position.set(s0.x, 0.04, s0.z);
  startLine.quaternion.copy(yawQ);
  group.add(startLine);
  const postOff = hw + Math.min(def.runoff - 1, 4);
  for (const side of [-1, 1]) {
    const lx = Math.cos(s0.yaw) * postOff * side;
    const lz = -Math.sin(s0.yaw) * postOff * side;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.6, 7, 0.6), mats.post);
    post.position.set(s0.x + lx, 3.5, s0.z + lz);
    post.castShadow = true;
    group.add(post);
    const pb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(s0.x + lx, 3.5, s0.z + lz));
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.3, 3.5, 0.3).setCollisionGroups(groups(GROUP.WORLD, 0xffff)), pb);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(postOff * 2 + 0.6, 1.2, 0.5), [mats.post, mats.post, mats.post, mats.post, mats.checker, mats.checker]);
  beam.position.set(s0.x, 6.6, s0.z);
  beam.quaternion.copy(yawQ);
  beam.castShadow = true;
  group.add(beam);

  return { line, group };
}
