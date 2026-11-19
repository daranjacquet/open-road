import * as THREE from 'three';
import type { CarModel, WheelNodes } from '../carModel';
import type { VehicleConfig } from '../../vehicle/types';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { keyCurve, loft } from './loft';

/** One face of the lofted shell, described for the panel classifier. */
export interface FaceInfo {
  cx: number;
  cy: number;
  cz: number;
  nx: number;
  ny: number;
  nz: number;
}

export interface CarBodySpec {
  /** Overall length extent (rear, front) in metres. */
  zMin: number;
  zMax: number;
  /** Keyframes [z, value]. */
  yb: [number, number][];
  belt: [number, number][];
  top: [number, number][];
  /** Half width at the shoulder and at the roof. */
  halfWidth: [number, number][];
  roofHalfWidth: [number, number][];
  crown: [number, number][];
  /** Wheel arch cut-outs: centre z, centre y, radius. */
  arches: { z: number; y: number; r: number }[];
  /** Maps a face to a part name; unmatched faces go to "body". */
  classify: (f: FaceInfo) => string;
  /** Pivot (chassis frame) per part; parts missing here pivot at their bounding-box centre. */
  pivots: Record<string, [number, number, number]>;
  paint: number;
  /** Interior block (visible through the glass). */
  interior: { center: [number, number, number]; half: [number, number, number] };
  /** Extra details: exhaust tips, wing, etc. Added as non-damageable meshes. */
  extras?: (root: THREE.Group, mats: CarMaterials, parts: Map<string, THREE.Mesh>) => void;
  /** Mirrors: positions of the mirror pivots. */
  mirrors: [number, number, number][];
  /** Re-parent small meshes onto panels so they follow them (child name -> panel name). */
  attach?: Record<string, string>;
}

export interface CarMaterials {
  paint: THREE.MeshPhysicalMaterial;
  glass: THREE.MeshPhysicalMaterial;
  headlight: THREE.MeshStandardMaterial;
  taillight: THREE.MeshStandardMaterial;
  trim: THREE.MeshStandardMaterial;
  tire: THREE.MeshStandardMaterial;
  rim: THREE.MeshStandardMaterial;
  disc: THREE.MeshStandardMaterial;
  interior: THREE.MeshStandardMaterial;
}

export function makeMaterials(paintColor: number): CarMaterials {
  return {
    paint: new THREE.MeshPhysicalMaterial({
      color: paintColor,
      metalness: 0.3,
      roughness: 0.42,
      clearcoat: 0.55,
      clearcoatRoughness: 0.18,
      envMapIntensity: 0.6,
      vertexColors: true,
    }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0x16212c,
      metalness: 0.1,
      roughness: 0.04,
      transparent: true,
      opacity: 0.55,
      envMapIntensity: 1.4,
      vertexColors: true,
    }),
    headlight: new THREE.MeshStandardMaterial({ color: 0xd8dde6, emissive: 0xfff2d0, emissiveIntensity: 0.35, roughness: 0.2, vertexColors: true }),
    taillight: new THREE.MeshStandardMaterial({ color: 0x8a0d10, emissive: 0xff1c1c, emissiveIntensity: 0.6, roughness: 0.25, vertexColors: true }),
    trim: new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.7, metalness: 0.2 }),
    tire: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.92 }),
    rim: new THREE.MeshStandardMaterial({ color: 0xc9ced6, roughness: 0.28, metalness: 0.95 }),
    disc: new THREE.MeshStandardMaterial({ color: 0x3b3d42, roughness: 0.5, metalness: 0.8 }),
    interior: new THREE.MeshStandardMaterial({ color: 0x101114, roughness: 0.9 }),
  };
}

const LIGHT_PARTS = new Set(['light_FL', 'light_FR', 'light_RL', 'light_RR']);

function materialFor(part: string, m: CarMaterials): THREE.Material {
  if (part.startsWith('glass')) return m.glass;
  if (part === 'light_FL' || part === 'light_FR') return m.headlight;
  if (LIGHT_PARTS.has(part)) return m.taillight;
  return m.paint;
}

/** Procedural car: a dense lofted shell split into named panels (dentable, detachable). */
export function generateCar(cfg: VehicleConfig, spec: CarBodySpec): CarModel {
  const mats = makeMaterials(spec.paint);
  const root = new THREE.Group();
  const parts = new Map<string, THREE.Mesh>();
  const disposables: { dispose(): void }[] = [...Object.values(mats)];

  const yb = keyCurve(spec.yb);
  const belt = keyCurve(spec.belt);
  const top = keyCurve(spec.top);
  const W = keyCurve(spec.halfWidth);
  const Wr = keyCurve(spec.roofHalfWidth);
  const crownC = keyCurve(spec.crown);
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

  const section = (z: number): [number, number][] => {
    const y0 = yb(z);
    const bl = belt(z);
    const tp = Math.max(top(z), bl);
    const w = W(z);
    const wr = Math.min(Wr(z), w);
    const hb = tp - bl;
    const crown = crownC(z);
    // Lower-side control heights, lifted over the wheel arches.
    const lift = (y: number, extra: number): number => {
      let out = y;
      for (const a of spec.arches) {
        const dz = z - a.z;
        if (Math.abs(dz) < a.r) out = Math.max(out, a.y + Math.sqrt(a.r * a.r - dz * dz) - extra);
      }
      return out;
    };
    const lowSide = Math.min(bl - 0.1, y0 + 0.5);
    const pts: [number, number][] = [
      [0, y0],
      [0.3 * w, y0],
      [0.62 * w, y0],
      [0.86 * w, lift(y0 + 0.03, 0)],
      [w, lift(y0 + 0.13, 0)],
      [w, lift(lerp(y0 + 0.13, lowSide, 0.55), 0)],
      [w, lift(lowSide, 0)],
      [w * 0.996, bl - 0.025],
      [w * 0.978, bl + 0.004],
      [lerp(w * 0.96, wr, 0.42), bl + hb * 0.4 + 0.004],
      [lerp(w * 0.96, wr, 0.85), bl + hb * 0.8 + 0.006],
      [wr, tp - Math.min(hb * 0.08, 0.03)],
      [wr * 0.8, tp + 0.004 + crown * 0.4],
      [wr * 0.42, tp + crown * 0.85],
      [0, tp + crown],
    ];
    // Keep the lower side monotonic in height so arches never fold the surface.
    for (let k = 4; k <= 7; k++) pts[k]![1] = Math.max(pts[k]![1], pts[k - 1]![1] + (k === 7 ? 0.01 : 0.004));
    return pts;
  };

  const L = loft({ zMin: spec.zMin, zMax: spec.zMax, stations: 168, perSpan: 4, section, endRound: 0.07 });
  const pos = L.positions;
  const idx = L.indices;

  // Smooth vertex normals computed once on the whole shell so panel edges shade continuously.
  const full = new THREE.BufferGeometry();
  full.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  full.setIndex(new THREE.BufferAttribute(idx, 1));
  full.computeVertexNormals();
  const nrm = full.getAttribute('normal').array as Float32Array;

  // Classify faces into parts.
  const faceCount = idx.length / 3;
  const partOfFace: string[] = new Array(faceCount);
  const partFaces = new Map<string, number[]>();
  const vertParts: Set<string>[] = new Array(pos.length / 3);
  const tri = new THREE.Vector3();
  for (let f = 0; f < faceCount; f++) {
    const a = idx[f * 3]!;
    const b = idx[f * 3 + 1]!;
    const c = idx[f * 3 + 2]!;
    const info: FaceInfo = {
      cx: (pos[a * 3]! + pos[b * 3]! + pos[c * 3]!) / 3,
      cy: (pos[a * 3 + 1]! + pos[b * 3 + 1]! + pos[c * 3 + 1]!) / 3,
      cz: (pos[a * 3 + 2]! + pos[b * 3 + 2]! + pos[c * 3 + 2]!) / 3,
      nx: (nrm[a * 3]! + nrm[b * 3]! + nrm[c * 3]!) / 3,
      ny: (nrm[a * 3 + 1]! + nrm[b * 3 + 1]! + nrm[c * 3 + 1]!) / 3,
      nz: (nrm[a * 3 + 2]! + nrm[b * 3 + 2]! + nrm[c * 3 + 2]!) / 3,
    };
    const name = spec.classify(info) || 'body';
    partOfFace[f] = name;
    let list = partFaces.get(name);
    if (!list) partFaces.set(name, (list = []));
    list.push(f);
    for (const v of [a, b, c]) (vertParts[v] ??= new Set()).add(name);
  }
  void tri;

  // Build one mesh per part. Vertices are re-indexed per part; edge vertices shared with another
  // part are tinted dark so panel gaps read as seams.
  for (const [name, faces] of partFaces) {
    const remap = new Map<number, number>();
    const p: number[] = [];
    const n: number[] = [];
    const col: number[] = [];
    const ind: number[] = [];
    let minV = [Infinity, Infinity, Infinity];
    let maxV = [-Infinity, -Infinity, -Infinity];
    for (const f of faces) {
      for (let k = 0; k < 3; k++) {
        const v = idx[f * 3 + k]!;
        let nv = remap.get(v);
        if (nv === undefined) {
          nv = p.length / 3;
          remap.set(v, nv);
          const x = pos[v * 3]!;
          const y = pos[v * 3 + 1]!;
          const z = pos[v * 3 + 2]!;
          p.push(x, y, z);
          n.push(nrm[v * 3]!, nrm[v * 3 + 1]!, nrm[v * 3 + 2]!);
          const seam = (vertParts[v]?.size ?? 1) > 1 && !name.startsWith('glass');
          const g = seam ? 0.22 : 1;
          col.push(g, g, g);
          minV = [Math.min(minV[0]!, x), Math.min(minV[1]!, y), Math.min(minV[2]!, z)];
          maxV = [Math.max(maxV[0]!, x), Math.max(maxV[1]!, y), Math.max(maxV[2]!, z)];
        }
        ind.push(nv);
      }
    }
    const pv = spec.pivots[name] ?? [(minV[0]! + maxV[0]!) / 2, (minV[1]! + maxV[1]!) / 2, (minV[2]! + maxV[2]!) / 2];
    for (let i = 0; i < p.length; i += 3) {
      p[i]! -= pv[0];
      p[i + 1]! -= pv[1];
      p[i + 2]! -= pv[2];
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(p), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
    geo.setIndex(ind);
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, materialFor(name, mats));
    mesh.name = name;
    mesh.position.set(pv[0], pv[1], pv[2]);
    mesh.castShadow = !name.startsWith('glass');
    mesh.receiveShadow = false;
    mesh.userData['pivot'] = pv;
    mesh.userData['rest'] = new Float32Array(p); // undeformed positions (part space)
    root.add(mesh);
    parts.set(name, mesh);
    disposables.push(geo);
  }

  // Interior block visible through the glass.
  const ib = new THREE.Mesh(new THREE.BoxGeometry(spec.interior.half[0] * 2, spec.interior.half[1] * 2, spec.interior.half[2] * 2), mats.interior);
  ib.position.set(...spec.interior.center);
  ib.name = 'interior';
  root.add(ib);
  parts.set('interior', ib);
  disposables.push(ib.geometry);

  // Mirrors (separate small meshes: left, right).
  const mirrorGeo = new THREE.BoxGeometry(0.16, 0.1, 0.07);
  disposables.push(mirrorGeo);
  spec.mirrors.forEach((m, i) => {
    const mesh = new THREE.Mesh(mirrorGeo, mats.paint);
    mesh.position.set(...m);
    mesh.name = i === 0 ? 'mirror_L' : 'mirror_R';
    mesh.castShadow = true;
    root.add(mesh);
    parts.set(mesh.name, mesh);
  });

  spec.extras?.(root, mats, parts);
  for (const [childName, parentName] of Object.entries(spec.attach ?? {})) {
    const child = root.getObjectByName(childName);
    const parent = parts.get(parentName);
    if (child && parent) parent.attach(child);
  }

  // Wheels.
  const wheels = buildWheels(cfg, mats, root, disposables);

  const probe = createProbe(parts, disposables);

  return {
    root,
    probe,
    wheels,
    parts,
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}

function buildWheels(cfg: VehicleConfig, mats: CarMaterials, root: THREE.Group, disposables: { dispose(): void }[]): CarModel['wheels'] {
  const R = cfg.wheel.radius;
  const Wd = cfg.wheel.width;
  const rimR = R * 0.68;

  // Tyre: lathe profile with a rounded shoulder, axis along X.
  const prof: THREE.Vector2[] = [];
  const hw = Wd / 2;
  const pts: [number, number][] = [
    [rimR * 0.96, -hw * 0.92],
    [rimR * 1.02, -hw],
    [R * 0.9, -hw * 0.98],
    [R * 0.975, -hw * 0.82],
    [R, -hw * 0.45],
    [R, hw * 0.45],
    [R * 0.975, hw * 0.82],
    [R * 0.9, hw * 0.98],
    [rimR * 1.02, hw],
    [rimR * 0.96, hw * 0.92],
  ];
  for (const [r, y] of pts) prof.push(new THREE.Vector2(r, y));
  const tireGeo = new THREE.LatheGeometry(prof, 36);
  tireGeo.rotateZ(Math.PI / 2);
  disposables.push(tireGeo);

  // Rim: barrel + spokes + cap merged into one mesh; face disc + brake disc merged into another.
  const makeRimGeos = (outerSign: number): { rim: THREE.BufferGeometry; dark: THREE.BufferGeometry } => {
    const rimParts: THREE.BufferGeometry[] = [];
    const darkParts: THREE.BufferGeometry[] = [];
    const barrel = new THREE.CylinderGeometry(rimR, rimR, Wd * 0.8, 28, 1, true);
    barrel.rotateZ(Math.PI / 2);
    rimParts.push(barrel);
    for (let s = 0; s < 5; s++) {
      const sp = new THREE.BoxGeometry(0.03, rimR * 0.9, rimR * 0.2);
      const a = (s / 5) * Math.PI * 2;
      sp.rotateX(-a);
      sp.translate(outerSign * (hw * 0.55 + 0.012), Math.cos(a) * rimR * 0.5, Math.sin(a) * rimR * 0.5);
      rimParts.push(sp);
    }
    const cap = new THREE.CylinderGeometry(rimR * 0.2, rimR * 0.2, 0.05, 16);
    cap.rotateZ(Math.PI / 2);
    cap.translate(outerSign * (hw * 0.55 + 0.02), 0, 0);
    rimParts.push(cap);
    const face = new THREE.CylinderGeometry(rimR * 0.96, rimR * 0.96, 0.02, 28);
    face.rotateZ(Math.PI / 2);
    face.translate(outerSign * hw * 0.55, 0, 0);
    darkParts.push(face);
    const disc = new THREE.CylinderGeometry(rimR * 0.82, rimR * 0.82, 0.025, 28);
    disc.rotateZ(Math.PI / 2);
    disc.translate(-outerSign * hw * 0.25, 0, 0);
    darkParts.push(disc);
    const rim = mergeGeometries(rimParts)!;
    const dark = mergeGeometries(darkParts)!;
    disposables.push(rim, dark);
    return { rim, dark };
  };
  const rimsL = makeRimGeos(1);
  const rimsR = makeRimGeos(-1);
  (mats.rim as THREE.MeshStandardMaterial).side = THREE.DoubleSide;

  const make = (outerSign: number): WheelNodes => {
    const pivot = new THREE.Group();
    const spin = new THREE.Group();
    const g = outerSign > 0 ? rimsL : rimsR;
    const tire = new THREE.Mesh(tireGeo, mats.tire);
    tire.castShadow = true;
    spin.add(tire, new THREE.Mesh(g.rim, mats.rim), new THREE.Mesh(g.dark, mats.disc));
    pivot.add(spin);
    root.add(pivot);
    return { pivot, spin };
  };
  // FL, FR, RL, RR: left wheels (+X) face outwards towards +X.
  return [make(1), make(-1), make(1), make(-1)];
}


/** Probe: back-face raycasts from inside the car against the undeformed shell (build-time use). */
export function createProbe(parts: Map<string, THREE.Mesh>, disposables: { dispose(): void }[]): CarModel['probe'] {
  const probeMat = new THREE.MeshBasicMaterial({ side: THREE.BackSide });
  disposables.push(probeMat);
  const probeMeshes: THREE.Mesh[] = [];
  for (const [name, mesh] of parts) {
    if (!mesh.userData['rest']) continue;
    mesh.updateWorldMatrix(true, false);
    const pm = new THREE.Mesh(mesh.geometry, probeMat);
    pm.position.copy(mesh.position);
    pm.name = name;
    pm.updateMatrixWorld(true);
    probeMeshes.push(pm);
  }
  const rc = new THREE.Raycaster();
  const o = new THREE.Vector3();
  const d = new THREE.Vector3();
  return (origin, dir, maxDist) => {
    rc.set(o.set(origin[0], origin[1], origin[2]), d.set(dir[0], dir[1], dir[2]).normalize());
    rc.near = 0;
    rc.far = maxDist;
    const hit = rc.intersectObjects(probeMeshes, false)[0];
    return hit ? { dist: hit.distance, part: hit.object.name } : null;
  };
}
