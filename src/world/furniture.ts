import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { GROUP, groups, type Physics } from '../core/physics';

interface PartSpec {
  mesh: string;
  local: THREE.Matrix4;
}

interface ItemSpec {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Pole collider: half height and radius; the body origin is at its foot. */
  halfHeight: number;
  radius: number;
  mass: number;
  parts: PartSpec[];
}

interface Item {
  body: RAPIER.RigidBody;
  parts: { mesh: THREE.InstancedMesh; index: number; local: THREE.Matrix4 }[];
  synced: boolean;
}

const _m = new THREE.Matrix4();
const _b = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Street furniture on poles (lamps, signs, traffic lights): dynamic bodies that sleep until a car
 * knocks them over, drawn with one instanced mesh per part type.
 */
export class Furniture {
  readonly group = new THREE.Group();
  private readonly defs = new Map<string, { geo: THREE.BufferGeometry; mat: THREE.Material; shadow: boolean }>();
  private readonly specs: ItemSpec[] = [];
  private readonly items: Item[] = [];
  readonly meshes = new Map<string, THREE.InstancedMesh>();

  defineMesh(name: string, geo: THREE.BufferGeometry, mat: THREE.Material, shadow = true): void {
    this.defs.set(name, { geo, mat, shadow });
  }

  place(spec: ItemSpec): void {
    this.specs.push(spec);
  }

  /** Create the bodies and instanced meshes. */
  finish(physics: Physics): void {
    const { RAPIER, world } = physics;
    const counts = new Map<string, number>();
    for (const s of this.specs) for (const p of s.parts) counts.set(p.mesh, (counts.get(p.mesh) ?? 0) + 1);
    for (const [name, n] of counts) {
      const d = this.defs.get(name)!;
      const mesh = new THREE.InstancedMesh(d.geo, d.mat, n);
      mesh.castShadow = d.shadow;
      mesh.receiveShadow = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.meshes.set(name, mesh);
      this.group.add(mesh);
    }
    for (const s of this.specs) {
      _q.setFromAxisAngle(UP, s.yaw);
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(s.x, s.y, s.z)
          .setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w })
          .setSleeping(true)
          .setAngularDamping(0.4)
          .setLinearDamping(0.1),
      );
      world.createCollider(
        RAPIER.ColliderDesc.cylinder(s.halfHeight, s.radius)
          .setTranslation(0, s.halfHeight, 0)
          .setMass(s.mass)
          .setFriction(0.8)
          .setRestitution(0.05)
          .setCollisionGroups(groups(GROUP.PROP, 0xffff)),
        body,
      );
      const parts = s.parts.map((p) => {
        const mesh = this.meshes.get(p.mesh)!;
        const index = mesh.count++;
        return { mesh, index, local: p.local };
      });
      this.items.push({ body, parts, synced: false });
    }
    this.specs.length = 0;
    this.update();
  }

  /** Sync the parts of bodies that moved (sleeping ones are skipped once drawn). */
  update(): void {
    for (const it of this.items) {
      const sleeping = it.body.isSleeping();
      if (sleeping && it.synced) continue;
      const t = it.body.translation();
      const r = it.body.rotation();
      _b.compose(_p.set(t.x, t.y, t.z), _q.set(r.x, r.y, r.z, r.w), _one);
      for (const p of it.parts) {
        _m.multiplyMatrices(_b, p.local);
        p.mesh.setMatrixAt(p.index, _m);
        p.mesh.instanceMatrix.needsUpdate = true;
      }
      it.synced = sleeping;
      // Fell through the world or flew off: park it.
      if (t.y < -20) it.body.setEnabled(false);
    }
  }

  get count(): number {
    return this.items.length;
  }
}

/** Local transform helper for parts (position, yaw, pitch, scale). */
export function local(x: number, y: number, z: number, yaw = 0, sx = 1, sy = 1, sz = 1, pitch = 0): THREE.Matrix4 {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
}
