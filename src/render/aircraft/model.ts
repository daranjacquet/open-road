import * as THREE from 'three';
import { parseCarGLB } from '../car/glb';

/**
 * The aircraft's model, one group per part at its hinge or bolt point (control surfaces under their
 * wing or tailplane, wheels under their leg), in the body frame (+z forward, +y up, +x left, origin
 * at the centre of gravity), built from art/build/plane.glb (see art/import_plane.py).
 */
export interface AircraftModel {
  root: THREE.Group;
  parts: Map<string, THREE.Group>;
  /** Hinge or spin axis of a part, in its own (= body) frame. */
  axes: Map<string, THREE.Vector3>;
  /** The cabin's insides (panel, instruments, seats): only seen through the glass from close by. */
  interior: THREE.Mesh[];
  dispose(): void;
}

/** Materials of the cabin's insides; the instruments among them are not worth drawing on parked aircraft. */
export const isInterior = (name: string): boolean => /^(Aviyonik|Joystick|Panel|interior)/.test(name);
export const isInstrument = (name: string): boolean => /^(Aviyonik|Joystick|Panel)/.test(name);

let template: THREE.Group | null = null;
let loading: Promise<void> | null = null;

export function aircraftLoaded(): boolean {
  return template !== null;
}

/** Fetch and parse the aircraft model once. */
export function loadAircraft(baseUrl: string): Promise<void> {
  loading ??= (async () => {
    const res = await fetch(`${baseUrl}models/plane.glb`);
    if (!res.ok) throw new Error(`Aircraft model: HTTP ${res.status}`);
    template = await parseCarGLB(await res.arrayBuffer());
  })();
  return loading;
}

/** For tests: use an already parsed model. */
export function setAircraftTemplate(t: THREE.Group): void {
  template = t;
}

const partOf = (o: THREE.Object3D): string | null => (typeof o.userData['part_name'] === 'string' ? (o.userData['part_name'] as string) : null);
const vec = (o: THREE.Object3D, key: string): THREE.Vector3 | null => {
  const p = o.userData[key] as number[] | undefined;
  return p && p.length === 3 ? new THREE.Vector3(p[0], p[1], p[2]) : null;
};

/** Float copy of a (possibly quantised) geometry, baked by a matrix. */
function bake(src: THREE.Mesh, m: THREE.Matrix4): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(src.geometry.attributes)) {
    const a = attr as THREE.BufferAttribute;
    const arr = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) arr[i * a.itemSize + k] = a.getComponent(i, k);
    g.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  if (src.geometry.index) g.setIndex(new THREE.BufferAttribute(new Uint32Array(src.geometry.index.array), 1));
  g.applyMatrix4(m);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

function tune(m: THREE.Material): THREE.Material {
  const s = m as THREE.MeshStandardMaterial;
  if (m.name === 'glass') {
    s.transparent = true;
    s.opacity = 0.35;
    s.depthWrite = false;
    s.roughness = 0.05;
    s.metalness = 0.2;
    s.side = THREE.DoubleSide;
  } else if (m.name === 'paint') {
    s.roughness = 0.32;
    s.metalness = 0.15;
    s.side = THREE.DoubleSide;
  } else if (isInterior(m.name)) {
    // Closed little objects seen from the seats or through the glass: their backs never show.
    s.side = THREE.FrontSide;
  } else {
    s.side = THREE.DoubleSide;
  }
  return m;
}

export function buildAircraftModel(): AircraftModel {
  if (!template) throw new Error('Aircraft model not loaded');
  template.updateMatrixWorld(true);
  const root = new THREE.Group();
  root.name = 'aircraft';
  const parts = new Map<string, THREE.Group>();
  const axes = new Map<string, THREE.Vector3>();
  const info = new Map<string, { pivot: THREE.Vector3; parent: string; meshes: THREE.Mesh[] }>();
  const mats = new Map<THREE.Material, THREE.Material>();
  const disposables: { dispose(): void }[] = [];
  const interior: THREE.Mesh[] = [];
  template.traverse((o) => {
    const name = partOf(o);
    if (!name) return;
    const meshes: THREE.Mesh[] = [];
    o.traverse((c) => {
      if (c instanceof THREE.Mesh && (c === o || !partOf(c))) meshes.push(c);
    });
    info.set(name, { pivot: vec(o, 'chassis_pivot') ?? new THREE.Vector3(), parent: (o.userData['parent_part'] as string) || '', meshes });
    const axis = vec(o, 'hinge_axis');
    if (axis) axes.set(name, axis.normalize());
  });
  for (const [name, p] of info) {
    const g = new THREE.Group();
    g.name = name;
    parts.set(name, g);
    const toLocal = new THREE.Matrix4().makeTranslation(-p.pivot.x, -p.pivot.y, -p.pivot.z);
    for (const src of p.meshes) {
      const geo = bake(src, toLocal.clone().multiply(src.matrixWorld));
      let mat = mats.get(src.material as THREE.Material);
      if (!mat) {
        mat = tune((src.material as THREE.Material).clone());
        mats.set(src.material as THREE.Material, mat);
        disposables.push(mat);
      }
      const mesh = new THREE.Mesh(geo, mat);
      const inside = isInterior(mat.name);
      // The shell casts the shadow; what is inside it or see-through does not.
      mesh.castShadow = mat.name !== 'glass' && !inside;
      mesh.receiveShadow = mat.name !== 'glass';
      if (inside) interior.push(mesh);
      g.add(mesh);
      disposables.push(geo);
    }
  }
  for (const [name, p] of info) {
    const g = parts.get(name)!;
    const parent = p.parent ? info.get(p.parent) : undefined;
    const base = parent?.pivot ?? new THREE.Vector3();
    g.position.copy(p.pivot).sub(base);
    (parent ? parts.get(p.parent)! : root).add(g);
  }
  return {
    root,
    parts,
    axes,
    interior,
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
