import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { VehicleConfig } from '../../vehicle/types';
import type { CarModel, WheelNodes } from '../carModel';
import { createProbe, makeMaterials, type CarMaterials } from './generator';

/** Cars exported by `art/build_cars.py` (Blender) are loaded once as templates and cloned per car. */
const templates = new Map<string, THREE.Group>();

export function getCarTemplate(id: string): THREE.Group | undefined {
  return templates.get(id);
}

export async function parseCarGLB(buffer: ArrayBuffer): Promise<THREE.Group> {
  const gltf = await new GLTFLoader().parseAsync(buffer, '');
  return gltf.scene;
}

/** Fetch and register the GLB of each car; a failure leaves that car on the procedural fallback. */
export async function loadCarTemplates(ids: string[], baseUrl: string): Promise<string[]> {
  const loaded: string[] = [];
  await Promise.all(
    ids.map(async (id) => {
      try {
        const res = await fetch(`${baseUrl}models/${id}.glb`);
        if (!res.ok) throw new Error(`${res.status}`);
        templates.set(id, await parseCarGLB(await res.arrayBuffer()));
        loaded.push(id);
      } catch (e) {
        console.warn(`Car model "${id}" not loaded, using the procedural fallback`, e);
      }
    }),
  );
  return loaded;
}

export function registerCarTemplate(id: string, scene: THREE.Group): void {
  templates.set(id, scene);
}

const SHELL = /^(body|hood|trunk|door_[A-Z]{2}|bumper_[FR]|glass_(front|rear|L|R))$/;
const SMALL = /^(light_[FR][LR]|mirror_[LR])$/;

function materialFor(name: string, m: CarMaterials): THREE.Material {
  if (name.startsWith('glass')) return m.glass;
  if (name === 'light_FL' || name === 'light_FR') return m.headlight;
  if (name.startsWith('light_')) return m.taillight;
  if (name.startsWith('mirror_') || SHELL.test(name)) return m.paint;
  if (name === 'interior') return m.interior;
  if (name.startsWith('tire_')) return m.tire;
  if (name.startsWith('rim_') || name.startsWith('exhaust')) return m.rim;
  if (name.startsWith('disc_')) return m.disc;
  return m.trim;
}

/** Build a CarModel (same interface as the procedural generator) from a Blender-exported template. */
export function modelFromTemplate(template: THREE.Group, cfg: VehicleConfig, paint?: number): CarModel {
  const mats = makeMaterials(paint ?? 0xb3170d);
  if (paint === undefined) {
    // Keep the colour the artist chose in Blender.
    template.traverse((o) => {
      if (o instanceof THREE.Mesh && o.name === 'body') {
        const src = (Array.isArray(o.material) ? o.material[0] : o.material) as THREE.MeshStandardMaterial;
        mats.paint.color.copy(src.color);
      }
    });
  }
  const root = new THREE.Group();
  const clone = template.clone(true);
  for (const child of [...clone.children]) root.add(child);
  const disposables: { dispose(): void }[] = [...Object.values(mats)];
  const parts = new Map<string, THREE.Mesh>();
  const wheelMeshes: Record<string, THREE.Mesh[]> = { FL: [], FR: [], RL: [], RR: [] };

  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const name = o.name;
    // Every car gets its own geometry for panels that deform; the rest is shared with the template.
    if (SHELL.test(name)) {
      o.geometry = o.geometry.clone();
      disposables.push(o.geometry);
      const pos = o.geometry.getAttribute('position') as THREE.BufferAttribute;
      pos.setUsage(THREE.DynamicDrawUsage);
      (o.geometry.getAttribute('normal') as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
      o.userData['rest'] = new Float32Array(pos.array as Float32Array);
      o.userData['pivot'] = [o.position.x, o.position.y, o.position.z];
      o.castShadow = !name.startsWith('glass');
    }
    o.material = materialFor(name, mats);
    // Materials that multiply vertex colours need the attribute on every mesh that uses them.
    if ((o.material as THREE.Material & { vertexColors?: boolean }).vertexColors && !o.geometry.getAttribute('color')) {
      const n = o.geometry.getAttribute('position').count;
      o.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    }
    if (SHELL.test(name) || SMALL.test(name) || name === 'interior') parts.set(name, o);
    const m = /^(tire|rim|disc)_(FL|FR|RL|RR)$/.exec(name);
    if (m) wheelMeshes[m[2]!]!.push(o);
  });

  const mk = (tag: string): WheelNodes => {
    const pivot = new THREE.Group();
    const spin = new THREE.Group();
    for (const mesh of wheelMeshes[tag]!) {
      mesh.removeFromParent();
      mesh.position.set(0, 0, 0);
      mesh.castShadow = mesh.name.startsWith('tire');
      spin.add(mesh);
    }
    pivot.add(spin);
    root.add(pivot);
    return { pivot, spin };
  };
  const wheels: CarModel['wheels'] = [mk('FL'), mk('FR'), mk('RL'), mk('RR')];
  const probe = createProbe(parts, disposables);
  void cfg;
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
