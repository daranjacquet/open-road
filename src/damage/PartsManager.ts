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
  test: RegExp;
  kind: PartKind;
  /** Dent depth (m) where the panel starts to pop open, where it is fully ajar, where it tears off. */
  ajarFrom?: number;
  ajarTo?: number;
  breakAt: number;
  mass: number;
}

/** Hinge axis and opening angle per part, from its name. */
function hinge(name: string): { axis: THREE.Vector3; angle: number } | null {
  if (name === 'hood') return { axis: new THREE.Vector3(1, 0, 0), angle: -0.55 };
  if (name === 'trunk') return { axis: new THREE.Vector3(1, 0, 0), angle: 0.5 };
  const m = /^door_([FR])([LR])$/.exec(name);
  if (m) return { axis: new THREE.Vector3(0, 1, 0), angle: (m[2] === 'L' ? -1 : 1) * 0.3 };
  return null;
}

const RULES: PartRule[] = [
  { test: /^hood$/, kind: 'panel', ajarFrom: 0.08, ajarTo: 0.3, breakAt: 0.55, mass: 16 },
  { test: /^trunk$/, kind: 'panel', ajarFrom: 0.06, ajarTo: 0.25, breakAt: 0.5, mass: 14 },
  { test: /^door_[FR][LR]$/, kind: 'panel', ajarFrom: 0.05, ajarTo: 0.14, breakAt: 0.22, mass: 24 },
  { test: /^bumper_[FR]$/, kind: 'panel', breakAt: 0.41, mass: 14 },
  { test: /^glass_/, kind: 'glass', breakAt: 0.07, mass: 0 },
  { test: /^light_[FR][LR]$/, kind: 'small', breakAt: 0.12, mass: 1 },
  { test: /^mirror_[LR]$/, kind: 'small', breakAt: 0.05, mass: 1.2 },
];

interface PartState {
  name: string;
  rule: PartRule;
  node: THREE.Object3D;
  homeParent: THREE.Object3D;
  homePos: THREE.Vector3;
  homeQuat: THREE.Quaternion;
  /** Chassis-frame position of the part's origin at rest. */
  restPos: THREE.Vector3;
  broken: boolean;
  body: RAPIER.RigidBody | null;
  ajar: number;
}

interface WheelDebris {
  body: RAPIER.RigidBody;
  node: THREE.Object3D;
}

const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _ax = new THREE.Vector3();
const _box = new THREE.Box3();
const _c = new THREE.Vector3();
const _size = new THREE.Vector3();
const _inv = new THREE.Matrix4();

function hashSigned(name: string, k: number): number {
  let h = 2166136261 + k * 16777619;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return ((h >>> 0) % 2000) / 1000 - 1;
}

/**
 * Panels that pop open, hang, and tear off; glass that shatters; lights and mirrors that break off;
 * wheels that come away. Driven by how far each part has been dented, so a given crash always breaks
 * the same things. Detached parts become rigid bodies that tumble and collide (keeping their dents).
 */
export class PartsManager {
  private readonly parts: PartState[] = [];
  private readonly wheels: WheelDebris[] = [];
  private lastEnergy = -1;
  onGlassBreak: ((p: THREE.Vector3) => void) | null = null;
  onDetach: ((name: string, p: THREE.Vector3) => void) | null = null;
  /** Number of parts that have come off (HUD/tests). */
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
    model.root.updateMatrixWorld(true);
    _inv.copy(model.root.matrixWorld).invert();
    for (const [name, node] of model.parts) {
      const rule = RULES.find((r) => r.test.test(name));
      if (!rule) continue;
      node.updateWorldMatrix(true, false);
      const restPos = new THREE.Vector3().setFromMatrixPosition(node.matrixWorld).applyMatrix4(_inv);
      this.parts.push({
        name,
        rule,
        node,
        homeParent: node.parent!,
        homePos: node.position.clone(),
        homeQuat: node.quaternion.clone(),
        restPos,
        broken: false,
        body: null,
        ajar: 0,
      });
    }
  }

  /** Names of the parts that are currently broken or detached (tests, HUD). */
  brokenParts(): string[] {
    return this.parts.filter((p) => p.broken).map((p) => p.name);
  }

  ajarParts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const p of this.parts) if (p.ajar > 0 && !p.broken) out[p.name] = p.ajar;
    return out;
  }

  update(): void {
    const e = this.crush.energy;
    if (e !== this.lastEnergy) {
      this.lastEnergy = e;
      for (const p of this.parts) {
        if (p.broken) continue;
        // A part attached to a broken parent goes with it (e.g. lights in a torn-off bumper).
        let disp = this.deformer.maxDisplacement(p.name);
        if (p.rule.kind === 'small') disp = Math.max(disp, this.deformer.sample(p.restPos.x, p.restPos.y, p.restPos.z));
        this.evaluate(p, disp);
      }
      this.evaluateWheels();
    }
    this.syncDebris();
  }

  private evaluate(p: PartState, disp: number): void {
    const r = p.rule;
    if (r.kind === 'glass') {
      const crack = this.model.cracks.get(p.name);
      if (crack && disp > 0.015) {
        const c = clamp((disp - 0.015) / 0.04, 0, 1);
        if (c > crack.uCrack.value) {
          crack.uCrack.value = c;
          this.deformer.maxDisplacementPoint(p.name, crack.uCrackCenter.value);
        }
      }
    }
    if (disp >= r.breakAt) {
      this.breakPart(p);
      return;
    }
    const hg = hinge(p.name);
    if (hg && r.ajarFrom !== undefined && r.ajarTo !== undefined) {
      const t = clamp((disp - r.ajarFrom) / (r.ajarTo - r.ajarFrom), 0, 1);
      if (t > p.ajar) {
        p.ajar = t;
        p.node.quaternion.copy(p.homeQuat).multiply(_q.setFromAxisAngle(hg.axis, hg.angle * t));
      }
    }
  }

  private breakPart(p: PartState): void {
    p.broken = true;
    const node = p.node;
    node.updateWorldMatrix(true, true);
    node.matrixWorld.decompose(_w, _q, _s);
    if (p.rule.kind === 'glass') {
      node.visible = false;
      this.onGlassBreak?.(_w.clone());
      return;
    }
    // Collider from the part's bounding box in its own frame.
    _inv.copy(node.matrixWorld).invert();
    _box.makeEmpty();
    node.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.computeBoundingBox();
        const bb = o.geometry.boundingBox!.clone().applyMatrix4(o.matrixWorld).applyMatrix4(_inv);
        _box.union(bb);
      }
    });
    if (_box.isEmpty()) _box.set(new THREE.Vector3(-0.1, -0.1, -0.1), new THREE.Vector3(0.1, 0.1, 0.1));
    _box.getCenter(_c);
    _box.getSize(_size);
    const { RAPIER, world } = this.physics;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(_w.x, _w.y, _w.z)
        .setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w })
        .setCcdEnabled(true)
        .setLinearDamping(0.05)
        .setAngularDamping(0.15),
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(Math.max(_size.x / 2, 0.04), Math.max(_size.y / 2, 0.03), Math.max(_size.z / 2, 0.04))
        .setTranslation(_c.x, _c.y, _c.z)
        .setMass(p.rule.mass)
        .setFriction(0.5)
        .setRestitution(0.2)
        .setCollisionGroups(groups(GROUP.PART, GROUP.WORLD | GROUP.PROP | GROUP.PART)),
      body,
    );
    const v = this.vehicle.body.velocityAtPoint({ x: _w.x, y: _w.y, z: _w.z });
    const k = clamp(this.vehicle.speed / 12, 0.4, 2.2);
    const up = p.name === 'hood' || p.name === 'trunk' ? 4 : 1.5;
    body.setLinvel({ x: v.x * 0.85 + hashSigned(p.name, 1) * 2.5 * k, y: v.y + up * k * 0.6, z: v.z * 0.85 + hashSigned(p.name, 2) * 2.5 * k }, true);
    body.setAngvel({ x: hashSigned(p.name, 3) * 4 * k, y: hashSigned(p.name, 4) * 4 * k, z: hashSigned(p.name, 5) * 4 * k }, true);
    p.body = body;
    this.scene.attach(node);
    this.detached++;
    this.onDetach?.(p.name, _w.clone());
  }

  private evaluateWheels(): void {
    const v = this.vehicle;
    for (let i = 0; i < 4; i++) {
      const w = v.wheels[i]!;
      if (!w.detached && this.damage.wheel[i]! >= 0.995 && this.crush.energy > 800e3) this.detachWheel(i);
      this.model.wheels[i]!.spin.scale.set(1, w.flat ? 0.88 : 1, w.flat ? 0.88 : 1);
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
      RAPIER.RigidBodyDesc.dynamic().setTranslation(_w.x, _w.y, _w.z).setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }).setCcdEnabled(true).setAngularDamping(0.05),
    );
    const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
    world.createCollider(
      RAPIER.ColliderDesc.cylinder(v.cfg.wheel.width / 2, R)
        .setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w })
        .setMass(24)
        .setFriction(0.8)
        .setRestitution(0.35)
        .setCollisionGroups(groups(GROUP.PART, GROUP.WORLD | GROUP.PROP | GROUP.PART)),
      body,
    );
    const lv = v.body.velocityAtPoint({ x: _w.x, y: _w.y, z: _w.z });
    body.setLinvel({ x: lv.x * 0.9 + hashSigned('w', i) * 2, y: lv.y + 2, z: lv.z * 0.9 + hashSigned('w', i + 9) * 2 }, true);
    _ax.set(1, 0, 0).applyQuaternion(_q);
    body.setAngvel({ x: _ax.x * w.omega, y: _ax.y * w.omega, z: _ax.z * w.omega }, true);
    this.scene.attach(nodes.pivot);
    this.wheels.push({ body, node: nodes.pivot });
    this.detached++;
    this.onDetach?.('wheel', _w.clone());
  }

  private syncDebris(): void {
    for (const p of this.parts) {
      const b = p.body;
      if (!b) continue;
      const t = b.translation();
      const r = b.rotation();
      p.node.position.set(t.x, t.y, t.z);
      p.node.quaternion.set(r.x, r.y, r.z, r.w);
    }
    for (const w of this.wheels) {
      const t = w.body.translation();
      const r = w.body.rotation();
      w.node.position.set(t.x, t.y, t.z);
      w.node.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  /** Put every part back, remove debris. */
  repair(): void {
    const { world } = this.physics;
    for (const p of this.parts) {
      if (p.body) {
        world.removeRigidBody(p.body);
        p.body = null;
      }
      if (p.node.parent !== p.homeParent) p.homeParent.add(p.node);
      p.node.position.copy(p.homePos);
      p.node.quaternion.copy(p.homeQuat);
      p.node.visible = true;
      const crack = this.model.cracks.get(p.name);
      if (crack) crack.uCrack.value = 0;
      p.broken = false;
      p.ajar = 0;
    }
    for (const w of this.wheels) world.removeRigidBody(w.body);
    this.wheels.length = 0;
    this.vehicle.wheels.forEach((w, i) => {
      w.detached = false;
      const nodes = this.model.wheels[i]!;
      if (nodes.pivot.parent !== this.model.root) this.model.root.add(nodes.pivot);
      nodes.spin.scale.set(1, 1, 1);
    });
    this.detached = 0;
    this.lastEnergy = -1;
  }
}
