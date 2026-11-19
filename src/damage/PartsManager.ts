import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { clamp } from '../core/math';
import { GROUP, groups, type Physics } from '../core/physics';
import type { CarModel } from '../render/carModel';
import type { Vehicle } from '../vehicle/Vehicle';
import type { CrushSystem } from './CrushSystem';
import type { Deformer } from './Deformer';
import type { DamageModel } from './DamageModel';

type PartKind = 'panel' | 'glass' | 'small';

interface PartRule {
  name: string;
  kind: PartKind;
  /** Displacement (m) where the panel starts to pop open / where it comes off / breaks. */
  ajarFrom?: number;
  ajarTo?: number;
  /** Open angle at `ajarTo` (rad) about `axis` (local to the part). */
  ajarAngle?: number;
  axis?: [number, number, number];
  breakAt: number;
  /** Mass once detached (kg). */
  mass: number;
}

const RULES: PartRule[] = [
  { name: 'hood', kind: 'panel', ajarFrom: 0.04, ajarTo: 0.14, ajarAngle: -0.55, axis: [1, 0, 0], breakAt: 0.15, mass: 16 },
  { name: 'trunk', kind: 'panel', ajarFrom: 0.05, ajarTo: 0.16, ajarAngle: 0.5, axis: [1, 0, 0], breakAt: 0.2, mass: 12 },
  { name: 'door_FL', kind: 'panel', ajarFrom: 0.035, ajarTo: 0.11, ajarAngle: -0.28, axis: [0, 1, 0], breakAt: 0.125, mass: 22 },
  { name: 'door_FR', kind: 'panel', ajarFrom: 0.035, ajarTo: 0.11, ajarAngle: 0.28, axis: [0, 1, 0], breakAt: 0.125, mass: 22 },
  { name: 'bumper_F', kind: 'panel', breakAt: 0.4, mass: 14 },
  { name: 'bumper_R', kind: 'panel', breakAt: 0.4, mass: 12 },
  { name: 'glass_front', kind: 'glass', breakAt: 0.06, mass: 0 },
  { name: 'glass_rear', kind: 'glass', breakAt: 0.06, mass: 0 },
  { name: 'glass_L', kind: 'glass', breakAt: 0.045, mass: 0 },
  { name: 'glass_R', kind: 'glass', breakAt: 0.045, mass: 0 },
  { name: 'light_FL', kind: 'small', breakAt: 0.09, mass: 0.6 },
  { name: 'light_FR', kind: 'small', breakAt: 0.09, mass: 0.6 },
  { name: 'light_RL', kind: 'small', breakAt: 0.09, mass: 0.6 },
  { name: 'light_RR', kind: 'small', breakAt: 0.09, mass: 0.6 },
  { name: 'mirror_L', kind: 'small', breakAt: 0.06, mass: 0.8 },
  { name: 'mirror_R', kind: 'small', breakAt: 0.06, mass: 0.8 },
];

interface PartState {
  rule: PartRule;
  mesh: THREE.Mesh;
  homeParent: THREE.Object3D;
  homePos: THREE.Vector3;
  homeQuat: THREE.Quaternion;
  homeScale: THREE.Vector3;
  broken: boolean;
  /** Debris body when physically detached. */
  body: RAPIER.RigidBody | null;
  ajar: number;
}

interface WheelDebris {
  body: RAPIER.RigidBody;
  mesh: THREE.Object3D;
}

const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _ax = new THREE.Vector3();
const _box = new THREE.Box3();
const _c = new THREE.Vector3();
const _size = new THREE.Vector3();

function hashSigned(name: string, k: number): number {
  let h = 2166136261 + k * 16777619;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return ((h >>> 0) % 2000) / 1000 - 1;
}

/**
 * Panels that pop open, hang, and tear off; glass that shatters; lights and mirrors that break;
 * wheels that come off. Driven by how far each panel has been dented, so a given crash always
 * breaks the same things. Detached panels become real rigid bodies that tumble and collide.
 */
export class PartsManager {
  private readonly parts: PartState[] = [];
  private readonly wheels: WheelDebris[] = [];
  private readonly debris: PartState[] = [];
  private lastEnergy = -1;
  onGlassBreak: ((p: THREE.Vector3) => void) | null = null;
  onDetach: ((name: string, p: THREE.Vector3) => void) | null = null;
  /** Number of parts that have come off (for HUD/tests). */
  detached = 0;

  constructor(
    private readonly physics: Physics,
    private readonly scene: THREE.Scene,
    private readonly vehicle: Vehicle,
    private readonly model: CarModel,
    private readonly crush: CrushSystem,
    private readonly deformer: Deformer,
    private readonly damage: DamageModel,
  ) {
    for (const rule of RULES) {
      const mesh = model.parts.get(rule.name);
      if (!mesh) continue;
      this.parts.push({
        rule,
        mesh,
        homeParent: mesh.parent!,
        homePos: mesh.position.clone(),
        homeQuat: mesh.quaternion.clone(),
        homeScale: mesh.scale.clone(),
        broken: false,
        body: null,
        ajar: 0,
      });
    }
    this.addInnerShells();
  }

  /** Dark inner faces so a torn-off panel shows a hollow, not the ground through the car. */
  private addInnerShells(): void {
    const mat = new THREE.MeshStandardMaterial({ color: 0x23252a, roughness: 0.9, side: THREE.BackSide });
    for (const [name, mesh] of this.model.parts) {
      if (!mesh.userData['rest'] || name.startsWith('glass')) continue;
      const inner = new THREE.Mesh(mesh.geometry, mat);
      inner.frustumCulled = false;
      mesh.add(inner);
    }
  }

  /** Displacement of a small separate part, estimated from the rays around it. */
  private smallDisplacement(mesh: THREE.Mesh): number {
    const c = this.crush;
    // Position in chassis space: parts are children of the car root or of another part.
    _p.copy(mesh.position);
    if (mesh.parent && mesh.parent !== this.model.root) _p.add(mesh.parent.position);
    let d = 0;
    for (let i = 0; i < c.rays.length; i++) {
      const cr = c.crush[i]!;
      if (cr <= 0) continue;
      const s = c.rays[i]!.surface;
      const dist = Math.hypot(_p.x - s[0], _p.y - s[1], _p.z - s[2]);
      if (dist < 0.55) d = Math.max(d, cr * (1 - dist / 0.55));
    }
    return d;
  }

  update(): void {
    // Only re-evaluate when something new was crushed.
    const e = this.crush.energy;
    if (e !== this.lastEnergy) {
      this.lastEnergy = e;
      for (const p of this.parts) {
        if (p.broken) continue;
        const disp = p.rule.kind === 'small' ? this.smallDisplacement(p.mesh) : this.deformer.maxDisplacement(p.rule.name);
        this.evaluate(p, disp);
      }
      this.evaluateWheels();
    }
    this.syncDebris();
  }

  private evaluate(p: PartState, disp: number): void {
    const r = p.rule;
    if (disp >= r.breakAt) {
      this.breakPart(p);
      return;
    }
    if (r.kind === 'panel' && r.ajarFrom !== undefined && r.ajarTo !== undefined && r.axis) {
      const t = clamp((disp - r.ajarFrom) / (r.ajarTo - r.ajarFrom), 0, 1);
      if (t > p.ajar) {
        p.ajar = t;
        _ax.set(r.axis[0], r.axis[1], r.axis[2]);
        p.mesh.quaternion.copy(p.homeQuat).multiply(_q.setFromAxisAngle(_ax, (r.ajarAngle ?? 0) * t));
      }
    }
  }

  private breakPart(p: PartState): void {
    p.broken = true;
    const mesh = p.mesh;
    mesh.updateWorldMatrix(true, false);
    mesh.matrixWorld.decompose(_w, _q, _s);
    if (p.rule.kind === 'glass') {
      mesh.visible = false;
      this.onGlassBreak?.(_w.clone());
      return;
    }
    // Detach as a rigid body.
    const { RAPIER, world } = this.physics;
    mesh.geometry.computeBoundingBox();
    _box.copy(mesh.geometry.boundingBox!);
    _box.getCenter(_c);
    _box.getSize(_size);
    const half = [Math.max(_size.x / 2, 0.04), Math.max(_size.y / 2, 0.03), Math.max(_size.z / 2, 0.04)];
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(_w.x, _w.y, _w.z)
        .setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w })
        .setCcdEnabled(true)
        .setLinearDamping(0.05)
        .setAngularDamping(0.15),
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(half[0]!, half[1]!, half[2]!)
        .setTranslation(_c.x, _c.y, _c.z)
        .setMass(p.rule.mass)
        .setFriction(0.5)
        .setRestitution(0.2)
        .setCollisionGroups(groups(GROUP.PART, GROUP.WORLD | GROUP.PROP | GROUP.PART)),
      body,
    );
    // Launch with the car's velocity plus a deterministic kick.
    const v = this.vehicle.body.velocityAtPoint({ x: _w.x, y: _w.y, z: _w.z });
    const k = clamp(this.vehicle.speed / 12, 0.4, 2.2);
    const up = p.rule.name === 'hood' || p.rule.name === 'trunk' ? 4 : 1.5;
    body.setLinvel(
      { x: v.x * 0.85 + hashSigned(p.rule.name, 1) * 2.5 * k, y: v.y + up * k * 0.6, z: v.z * 0.85 + hashSigned(p.rule.name, 2) * 2.5 * k },
      true,
    );
    body.setAngvel({ x: hashSigned(p.rule.name, 3) * 4 * k, y: hashSigned(p.rule.name, 4) * 4 * k, z: hashSigned(p.rule.name, 5) * 4 * k }, true);
    p.body = body;
    this.scene.attach(mesh);
    mesh.castShadow = true;
    this.debris.push(p);
    this.detached++;
    this.onDetach?.(p.rule.name, _w.clone());
  }

  private evaluateWheels(): void {
    const v = this.vehicle;
    for (let i = 0; i < 4; i++) {
      const w = v.wheels[i]!;
      if (w.detached) continue;
      if (this.damage.wheel[i]! >= 0.995 && this.crush.energy > 800e3) this.detachWheel(i);
    }
    // Flat tyres squash the visible wheel.
    for (let i = 0; i < 4; i++) {
      const w = v.wheels[i]!;
      this.model.wheels[i]!.spin.scale.set(1, w.flat ? 0.86 : 1, w.flat ? 0.86 : 1);
    }
  }

  private detachWheel(i: number): void {
    const v = this.vehicle;
    const w = v.wheels[i]!;
    const nodes = this.model.wheels[i]!;
    w.detached = true;
    const { RAPIER, world } = this.physics;
    nodes.pivot.updateWorldMatrix(true, false);
    nodes.pivot.matrixWorld.decompose(_w, _q, _s);
    const R = v.cfg.wheel.radius;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(_w.x, _w.y, _w.z)
        .setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w })
        .setCcdEnabled(true)
        .setAngularDamping(0.05),
    );
    const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
    world.createCollider(
      RAPIER.ColliderDesc.cylinder(v.cfg.wheel.width / 2, R)
        .setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w })
        .setMass(22)
        .setFriction(0.8)
        .setRestitution(0.35)
        .setCollisionGroups(groups(GROUP.PART, GROUP.WORLD | GROUP.PROP | GROUP.PART)),
      body,
    );
    const lv = v.body.velocityAtPoint({ x: _w.x, y: _w.y, z: _w.z });
    body.setLinvel({ x: lv.x * 0.9 + hashSigned('w', i) * 2, y: lv.y + 2, z: lv.z * 0.9 + hashSigned('w', i + 9) * 2 }, true);
    // Keep spinning about its own axle.
    _ax.set(1, 0, 0).applyQuaternion(_q);
    body.setAngvel({ x: _ax.x * w.omega, y: _ax.y * w.omega, z: _ax.z * w.omega }, true);
    this.scene.attach(nodes.pivot);
    this.wheels.push({ body, mesh: nodes.pivot });
    this.detached++;
    this.onDetach?.('wheel', _w.clone());
  }

  private syncDebris(): void {
    for (const p of this.debris) {
      const b = p.body;
      if (!b) continue;
      const t = b.translation();
      const r = b.rotation();
      p.mesh.position.set(t.x, t.y, t.z);
      p.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
    for (const w of this.wheels) {
      const t = w.body.translation();
      const r = w.body.rotation();
      w.mesh.position.set(t.x, t.y, t.z);
      w.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  /** Put every panel back, remove debris. */
  repair(): void {
    const { world } = this.physics;
    for (const p of this.parts) {
      if (p.body) {
        world.removeRigidBody(p.body);
        p.body = null;
      }
      if (p.mesh.parent !== p.homeParent) p.homeParent.add(p.mesh);
      p.mesh.position.copy(p.homePos);
      p.mesh.quaternion.copy(p.homeQuat);
      p.mesh.scale.copy(p.homeScale);
      p.mesh.visible = true;
      p.broken = false;
      p.ajar = 0;
    }
    this.debris.length = 0;
    for (const w of this.wheels) {
      world.removeRigidBody(w.body);
    }
    this.wheels.length = 0;
    this.vehicle.wheels.forEach((w, i) => {
      w.detached = false;
      const nodes = this.model.wheels[i]!;
      if (nodes.pivot.parent !== this.model.root) this.model.root.add(nodes.pivot);
      nodes.pivot.scale.set(1, 1, 1);
      nodes.spin.scale.set(1, 1, 1);
    });
    this.detached = 0;
    this.lastEnergy = -1;
  }
}
