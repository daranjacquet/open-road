import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CarModel, DeformableMeshData, WheelNodes } from '../carModel';
import { makeCrackable, tunePaint } from './paint';

/**
 * Cars exported by art/import_car.py (Blender), compressed with meshopt.
 * A template is parsed once; every car instance rebuilds its own hierarchy from it with float,
 * chassis-space geometry (meshopt quantisation folds scales into node transforms, so geometry is
 * baked and every part is re-centred on the `pivot` stored in the node extras).
 */
const templates = new Map<string, THREE.Group>();

export function getCarTemplate(id: string): THREE.Group | undefined {
  return templates.get(id);
}

export function registerCarTemplate(id: string, scene: THREE.Group): void {
  templates.set(id, scene);
}

export async function parseCarGLB(buffer: ArrayBuffer): Promise<THREE.Group> {
  await MeshoptDecoder.ready;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.parseAsync(buffer, '');
  gltf.scene.updateMatrixWorld(true);
  return gltf.scene;
}

/** Downloads in progress, so a car is never fetched twice (boot, background load, car swap). */
const inFlight = new Map<string, Promise<void>>();

/** Fetch and parse one car, streaming so `onBytes` can report progress. */
async function fetchTemplate(id: string, baseUrl: string, onBytes?: (bytes: number, total: number) => void): Promise<void> {
  const res = await fetch(`${baseUrl}models/${id}.glb`);
  if (!res.ok) throw new Error(`Car model ${id}: HTTP ${res.status}`);
  const total = Number(res.headers.get('Content-Length')) || 0;
  onBytes?.(0, total);
  const reader = res.body?.getReader();
  let buffer: ArrayBuffer;
  if (reader) {
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
      onBytes?.(value.byteLength, 0);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    buffer = bytes.buffer;
  } else {
    buffer = await res.arrayBuffer();
    onBytes?.(buffer.byteLength, 0);
  }
  templates.set(id, await parseCarGLB(buffer));
}

/** Load one car if it is not loaded or loading yet; resolves when its template is ready. */
export function ensureCarTemplate(id: string, baseUrl: string, onBytes?: (bytes: number, total: number) => void): Promise<void> {
  if (templates.has(id)) return Promise.resolve();
  let request = inFlight.get(id);
  if (!request) {
    request = fetchTemplate(id, baseUrl, onBytes).finally(() => inFlight.delete(id));
    inFlight.set(id, request);
  }
  return request;
}

/**
 * Load several cars in parallel. `onProgress(loaded, total)` reports downloaded bytes against the
 * announced sizes (total grows as responses arrive; 0 when the server sends no length).
 */
export async function loadCarTemplates(
  ids: string[],
  baseUrl: string,
  onProgress?: (loadedBytes: number, totalBytes: number) => void,
): Promise<string[]> {
  const unique = [...new Set(ids)];
  let loaded = 0;
  let total = 0;
  await Promise.all(
    unique.map((id) =>
      ensureCarTemplate(id, baseUrl, (bytes, size) => {
        loaded += bytes;
        total += size;
        onProgress?.(loaded, total);
      }),
    ),
  );
  return unique.filter((id) => templates.has(id));
}

const WHEEL_RE = /^(tire|rim|disc|nuts|caliper)_(FL|FR|RL|RR)$/;

const _axle = new THREE.Vector3();
const _x = new THREE.Vector3(1, 0, 0);
const _rot = new THREE.Matrix4();
const _q = new THREE.Quaternion();

/** Eigenvector of the smallest eigenvalue of a symmetric 3x3 matrix (Jacobi rotations). */
function smallestAxis(c: number[][], out: THREE.Vector3): THREE.Vector3 {
  const a = c.map((r) => [...r]);
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let sweep = 0; sweep < 30; sweep++) {
    for (const [p, q] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ] as const) {
      if (Math.abs(a[p]![q]!) < 1e-14) continue;
      const theta = (a[q]![q]! - a[p]![p]!) / (2 * a[p]![q]!);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const cs = 1 / Math.sqrt(t * t + 1);
      const sn = t * cs;
      for (let k = 0; k < 3; k++) {
        const akp = a[k]![p]!;
        const akq = a[k]![q]!;
        a[k]![p] = cs * akp - sn * akq;
        a[k]![q] = sn * akp + cs * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p]![k]!;
        const aqk = a[q]![k]!;
        a[p]![k] = cs * apk - sn * aqk;
        a[q]![k] = sn * apk + cs * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k]![p]!;
        const vkq = v[k]![q]!;
        v[k]![p] = cs * vkp - sn * vkq;
        v[k]![q] = sn * vkp + cs * vkq;
      }
    }
  }
  let m = 0;
  for (let k = 1; k < 3; k++) if (a[k]![k]! < a[m]![m]!) m = k;
  return out.set(v[0]![m]!, v[1]![m]!, v[2]![m]!).normalize();
}

/**
 * Turn a wheel's geometry so its axle lies exactly along X and its hub sits on the origin. Some
 * models come with the wheels leaning (camber or toe modelled in); spun about X, such a wheel
 * wobbles as if buckled. The game adds the physics camber on top. A wheel is a flat disc: its
 * axle is the direction its vertices spread least along (principal component analysis).
 */
export function straightenWheel(meshes: THREE.Mesh[]): void {
  let n = 0;
  const mean = new THREE.Vector3();
  for (const m of meshes) {
    const p = m.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      mean.x += p.getX(i);
      mean.y += p.getY(i);
      mean.z += p.getZ(i);
      n++;
    }
  }
  if (n < 12) return;
  mean.divideScalar(n);
  const c = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (const m of meshes) {
    const p = m.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const d = [p.getX(i) - mean.x, p.getY(i) - mean.y, p.getZ(i) - mean.z];
      for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) c[r]![k]! += d[r]! * d[k]!;
    }
  }
  smallestAxis(c, _axle);
  if (_axle.x < 0) _axle.negate();
  if (_axle.angleTo(_x) < 0.0005) return;
  _q.setFromUnitVectors(_axle, _x);
  _rot.makeRotationFromQuaternion(_q);
  const box = new THREE.Box3();
  for (const m of meshes) {
    m.geometry.applyMatrix4(_rot);
    m.geometry.computeBoundingBox();
    box.union(m.geometry.boundingBox!);
  }
  // Hub back on the origin (the turn moved it a little).
  const cy = (box.min.y + box.max.y) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  for (const m of meshes) {
    m.geometry.translate(0, -cy, -cz);
    m.geometry.computeBoundingBox();
    m.geometry.computeBoundingSphere();
  }
}

function partName(o: THREE.Object3D): string | null {
  const n = o.userData['part_name'];
  return typeof n === 'string' ? n : null;
}

function pivotOf(o: THREE.Object3D): THREE.Vector3 | null {
  const p = o.userData['chassis_pivot'] as number[] | undefined;
  return p && p.length === 3 ? new THREE.Vector3(p[0], p[1], p[2]) : null;
}

/** Float, chassis-space copy of a (possibly quantised) mesh geometry. */
function bakeGeometry(src: THREE.Mesh, toChassis: THREE.Matrix4): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(src.geometry.attributes)) {
    const a = attr as THREE.BufferAttribute;
    const n = a.count;
    const size = a.itemSize;
    const arr = new Float32Array(n * size);
    for (let i = 0; i < n; i++) {
      arr[i * size] = a.getX(i);
      if (size > 1) arr[i * size + 1] = a.getY(i);
      if (size > 2) arr[i * size + 2] = a.getZ(i);
      if (size > 3) arr[i * size + 3] = a.getW(i);
    }
    g.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  if (src.geometry.index) g.setIndex(new THREE.BufferAttribute(new Uint32Array(src.geometry.index.array), 1));
  g.applyMatrix4(toChassis);
  const nrm = g.getAttribute('normal') as THREE.BufferAttribute | undefined;
  if (nrm) {
    // Re-normalise after quantisation / non-uniform node scales.
    const a = nrm.array as Float32Array;
    for (let i = 0; i < a.length; i += 3) {
      const l = Math.hypot(a[i]!, a[i + 1]!, a[i + 2]!) || 1;
      a[i]! /= l;
      a[i + 1]! /= l;
      a[i + 2]! /= l;
    }
  }
  return g;
}

/** Own meshes of a node: itself when it is a Mesh, plus everything below it that is not another part
 *  (primitive groups and the extra nodes meshopt inserts to hold quantised meshes). */
function ownMeshes(o: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  if (o instanceof THREE.Mesh) out.push(o);
  const walk = (n: THREE.Object3D): void => {
    for (const c of n.children) {
      if (partName(c)) continue;
      if (c instanceof THREE.Mesh) out.push(c);
      walk(c);
    }
  };
  walk(o);
  return out;
}

/** Child parts of a node (possibly nested below helper nodes). */
function childParts(o: THREE.Object3D): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  const walk = (n: THREE.Object3D): void => {
    for (const c of n.children) {
      if (partName(c)) out.push(c);
      else walk(c);
    }
  };
  walk(o);
  return out;
}

export interface BuildOptions {
  /** Body colour override (dummy cars). */
  paint?: number;
}

/** Build one car instance from a template. */
/** Glass keeps its transparency settings after cloning (onBeforeCompile is replaced by the crack shader). */
function tunePaintGlass(m: THREE.Material): void {
  m.transparent = true;
  m.depthWrite = false;
  m.side = THREE.DoubleSide;
}

export function modelFromTemplate(template: THREE.Group, opts: BuildOptions = {}): CarModel {
  const root = new THREE.Group();
  root.name = 'car';
  const parts = new Map<string, THREE.Object3D>();
  const meshes: THREE.Mesh[] = [];
  const disposables: { dispose(): void }[] = [];
  const wheelMeshes: Record<string, THREE.Mesh[]> = { FL: [], FR: [], RL: [], RR: [] };
  const matCache = new Map<THREE.Material, THREE.Material>();
  const cracks = new Map<string, ReturnType<typeof makeCrackable>>();

  const material = (m: THREE.Material): THREE.Material => {
    let out = matCache.get(m);
    if (!out) {
      out = m.name === 'paint' && opts.paint !== undefined ? m.clone() : m;
      if (out !== m) {
        (out as THREE.MeshPhysicalMaterial).color.setHex(opts.paint!);
        disposables.push(out);
      }
      tunePaint(out);
      matCache.set(m, out);
    }
    return out;
  };

  const rebuild = (src: THREE.Object3D, parentPivot: THREE.Vector3, parent: THREE.Object3D): void => {
    const pv = pivotOf(src) ?? parentPivot.clone();
    const srcName = partName(src) ?? src.name;
    const wheel = WHEEL_RE.exec(srcName);
    if (wheel) {
      // Wheels are built at the origin in Blender; keep their geometry centred on the hub.
      for (const m of ownMeshes(src)) {
        const g = bakeGeometry(m, m.matrixWorld);
        const mesh = new THREE.Mesh(g, material(m.material as THREE.Material));
        mesh.name = srcName;
        mesh.castShadow = wheel[1] === 'tire';
        wheelMeshes[wheel[2]!]!.push(mesh);
        disposables.push(g);
      }
      return;
    }
    const node = new THREE.Group();
    const name = srcName;
    node.name = name;
    node.position.copy(pv).sub(parentPivot);
    parent.add(node);
    parts.set(name, node);
    const toLocal = new THREE.Matrix4().makeTranslation(-pv.x, -pv.y, -pv.z);
    for (const m of ownMeshes(src)) {
      const toChassis = m.matrixWorld;
      const g = bakeGeometry(m, toChassis);
      g.applyMatrix4(toLocal);
      const pos = g.getAttribute('position') as THREE.BufferAttribute;
      pos.setUsage(THREE.DynamicDrawUsage);
      const nrm = g.getAttribute('normal') as THREE.BufferAttribute | undefined;
      nrm?.setUsage(THREE.DynamicDrawUsage);
      let mat = material(m.material as THREE.Material);
      if (/^glass/.test(name) && /^glass(_dark)?$/.test(mat.name)) {
        // Each pane gets its own material so it can crack on its own.
        mat = mat.clone();
        disposables.push(mat);
        const nrmArr = g.getAttribute('normal')?.array as Float32Array | undefined;
        const avg = new THREE.Vector3();
        if (nrmArr) {
          for (let k = 0; k < nrmArr.length; k += 3) {
            avg.x += nrmArr[k]!;
            avg.y += nrmArr[k + 1]!;
            avg.z += nrmArr[k + 2]!;
          }
        }
        if (avg.lengthSq() === 0) avg.set(0, 0, 1);
        const uniforms = makeCrackable(mat, avg);
        tunePaintGlass(mat);
        cracks.set(name, uniforms);
      }
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = `${name}:${mat.name}`;
      const glassLike = /glass|lens/.test(mat.name);
      mesh.castShadow = /^(paint|carbon|trim_matte|underbody)$/.test(mat.name);
      mesh.receiveShadow = !glassLike;
      mesh.frustumCulled = false;
      const data: DeformableMeshData = {
        rest: new Float32Array(pos.array as Float32Array),
        restNormal: nrm ? new Float32Array(nrm.array as Float32Array) : new Float32Array(pos.count * 3),
        restMatrix: new THREE.Matrix4().makeTranslation(pv.x, pv.y, pv.z).toArray(),
        part: name,
        painted: mat.name === 'paint' || mat.name === 'carbon',
      };
      Object.assign(mesh.userData, data);
      node.add(mesh);
      meshes.push(mesh);
      disposables.push(g);
    }
    for (const c of childParts(src)) rebuild(c, pv, node);
  };

  template.updateMatrixWorld(true);
  const origin = new THREE.Vector3();
  for (const c of childParts(template)) rebuild(c, origin, root);

  mergeStatic(root, parts, meshes, disposables);

  const mk = (tag: string): WheelNodes => {
    const pivot = new THREE.Group();
    const spin = new THREE.Group();
    pivot.name = `wheel_${tag}`;
    const spinning = wheelMeshes[tag]!.filter((m) => !m.name.startsWith('caliper'));
    straightenWheel(spinning);
    for (const m of wheelMeshes[tag]!) {
      if (m.name.startsWith('caliper')) pivot.add(m);
      else spin.add(m);
    }
    pivot.add(spin);
    root.add(pivot);
    return { pivot, spin };
  };
  const wheels: CarModel['wheels'] = [mk('FL'), mk('FR'), mk('RL'), mk('RR')];
  root.updateMatrixWorld(true);

  // Probe against the painted shell and glass (what the crumple rays measure).
  const shell = meshes.filter((m) => {
    const n = (m.material as THREE.Material).name;
    return n === 'paint' || n === 'carbon' || n === 'glass' || n === 'glass_dark' || n === 'trim_matte' || n === 'honeycomb';
  });
  const probeMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  disposables.push(probeMat);
  const probeMeshes = shell.map((m) => {
    const pm = new THREE.Mesh(m.geometry, probeMat);
    m.updateWorldMatrix(true, false);
    pm.matrixAutoUpdate = false;
    pm.matrix.copy(m.matrixWorld);
    pm.matrixWorld.copy(m.matrixWorld);
    pm.userData['part'] = m.userData['part'];
    return pm;
  });
  const rc = new THREE.Raycaster();
  const o = new THREE.Vector3();
  const d = new THREE.Vector3();
  const probe: CarModel['probe'] = (origin3, dir, maxDist) => {
    rc.set(o.set(origin3[0], origin3[1], origin3[2]), d.set(dir[0], dir[1], dir[2]).normalize());
    rc.near = 0;
    rc.far = maxDist;
    const hit = rc.intersectObjects(probeMeshes, false)[0];
    return hit ? { dist: hit.distance, part: String(hit.object.userData['part']) } : null;
  };

  return {
    root,
    wheels,
    parts,
    meshes,
    cracks,
    probe,
    dispose() {
      for (const x of disposables) x.dispose();
    },
  };
}


/** Parts that move on their own (open, break, tear off) keep their own meshes. */
const KEEP = /^(body|hood|trunk|door_[FR][LR]|bumper_[FR]|glass_.+|light_[FR][LR]|mirror_[LR]|spare_wheel)$/;

/**
 * Cut draw calls: every mesh that does not belong to a part that moves on its own is merged, per
 * material, into the nearest such part above it (root-level fixed parts go into the body).
 */
function mergeStatic(root: THREE.Group, parts: Map<string, THREE.Object3D>, meshes: THREE.Mesh[], disposables: { dispose(): void }[]): void {
  root.updateMatrixWorld(true);
  const body = parts.get('body');
  if (!body) return;
  const keepOf = (o: THREE.Object3D): THREE.Object3D => {
    let n: THREE.Object3D | null = o;
    while (n && n !== root) {
      if (KEEP.test(n.name) && parts.get(n.name) === n) return n;
      n = n.parent;
    }
    return body;
  };
  // Group meshes by (target part, material, attribute layout).
  const groupsMap = new Map<string, { target: THREE.Object3D; mat: THREE.Material; list: THREE.Mesh[] }>();
  for (const m of meshes) {
    const target = keepOf(m.parent!);
    const mat = m.material as THREE.Material;
    if (/^glass(_dark)?$/.test(mat.name)) continue; // panes keep their own crack material
    const sig = Object.keys(m.geometry.attributes).sort().join(',') + (m.geometry.index ? ':i' : '');
    const key = `${target.uuid}|${mat.uuid}|${sig}`;
    let g = groupsMap.get(key);
    if (!g) groupsMap.set(key, (g = { target, mat, list: [] }));
    g.list.push(m);
  }
  const kept = new Set<THREE.Mesh>(meshes);
  const merged: THREE.Mesh[] = [];
  const inv = new THREE.Matrix4();
  const rel = new THREE.Matrix4();
  for (const g of groupsMap.values()) {
    if (g.list.length < 2 && g.list[0]!.parent === g.target) continue;
    inv.copy(g.target.matrixWorld).invert();
    const geos = g.list.map((m) => {
      const geo = m.geometry.clone();
      rel.multiplyMatrices(inv, m.matrixWorld);
      geo.applyMatrix4(rel);
      return geo;
    });
    const geo = geos.length === 1 ? geos[0]! : mergeGeometries(geos, false);
    for (const x of geos) if (x !== geo) x.dispose();
    if (!geo) continue;
    (geo.getAttribute('position') as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
    (geo.getAttribute('normal') as THREE.BufferAttribute | undefined)?.setUsage(THREE.DynamicDrawUsage);
    const mesh = new THREE.Mesh(geo, g.mat);
    const first = g.list[0]!;
    mesh.name = `${g.target.name}:${g.mat.name}`;
    // Only the big painted / trim surfaces cast shadows: small parts cost draw calls for nothing.
    mesh.castShadow = /^(paint|carbon|trim_matte|underbody)$/.test(g.mat.name);
    mesh.receiveShadow = first.receiveShadow;
    mesh.frustumCulled = false;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const nrm = geo.getAttribute('normal') as THREE.BufferAttribute | undefined;
    const data: DeformableMeshData = {
      rest: new Float32Array(pos.array as Float32Array),
      restNormal: nrm ? new Float32Array(nrm.array as Float32Array) : new Float32Array(pos.count * 3),
      restMatrix: new THREE.Matrix4().copy(g.target.matrixWorld).premultiply(new THREE.Matrix4().copy(root.matrixWorld).invert()).toArray(),
      part: g.target.name,
      painted: g.mat.name === 'paint' || g.mat.name === 'carbon',
    };
    Object.assign(mesh.userData, data);
    g.target.add(mesh);
    merged.push(mesh);
    disposables.push(geo);
    for (const m of g.list) {
      m.removeFromParent();
      kept.delete(m);
    }
  }
  // Drop the now-empty helper nodes of merged parts (keep named parts that still matter).
  for (const [name, node] of [...parts]) {
    if (KEEP.test(name)) continue;
    let hasMesh = false;
    node.traverse((o) => {
      if (o instanceof THREE.Mesh) hasMesh = true;
    });
    if (!hasMesh && node.parent) {
      node.removeFromParent();
      parts.delete(name);
    }
  }
  meshes.length = 0;
  for (const m of kept) meshes.push(m);
  for (const m of merged) meshes.push(m);
}
