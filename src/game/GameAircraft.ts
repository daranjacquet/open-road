import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GROUP, groups, type Physics } from '../core/physics';
import type { FlightInput } from '../core/input';
import { buildAircraftModel, isInstrument, type AircraftModel } from '../render/aircraft/model';
import { SmokeClouds } from '../render/smoke';
import { Aircraft, type BreakEvent } from '../vehicle/aircraft/Aircraft';
import type { AircraftConfig } from '../vehicle/aircraft/types';
import sr22 from '../vehicle/aircraft/sr22.json';
import f16 from '../vehicle/aircraft/f16.json';

/** The light aircraft parked on the apron. */
export const SR22 = sr22 as unknown as AircraftConfig;
/** The fighter the player flies. */
export const F16 = f16 as unknown as AircraftConfig;

/**
 * Where each model carries its lights, in the body frame: the red wingtip light on the left wing
 * (the green one mirrors it), the strobes beside them, and the white tail light on its part.
 */
const LIGHTS: Record<string, { tip: [number, number, number]; strobe: [number, number, number]; tail: [string, number, number, number] }> = {
  plane: { tip: [5.79, 0.09, -0.12], strobe: [5.8, 0.09, -0.3], tail: ['rudder', 0, 0.15, -4.95] },
  jet: { tip: [4.83, -0.11, -1.72], strobe: [4.83, -0.11, -1.95], tail: ['tailV', 0, 3.2, -6.33] },
};

/** Parked: engine off, brakes on. */
export const PARKED: FlightInput = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: 1, flaps: 0 };

/** What the player reads about a part coming off. */
const BREAK_TEXT: Record<string, string> = {
  wingL: 'Left wing torn off',
  wingR: 'Right wing torn off',
  tailH: 'Tailplane torn off',
  engine: 'Engine torn off',
  tailV: 'Fin and rudder torn off',
  gearN: 'Nose gear collapsed',
  gearL: 'Left main gear collapsed',
  gearR: 'Right main gear collapsed',
  prop: 'Propeller strike!',
};

interface Debris {
  part: string;
  body: RAPIER.RigidBody;
  holder: THREE.Group;
}

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _box = new THREE.Box3();

/**
 * The aircraft in the game: flight physics, the Blender model with moving controls, spinning
 * propeller and working struts, navigation lights, engine smoke, tyre puffs, and the parts that
 * break off flying on as their own bodies.
 */
export class GameAircraft {
  readonly aircraft: Aircraft;
  readonly model: AircraftModel;
  /** Render-interpolated body transform. */
  readonly view = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
  readonly smoke = new SmokeClouds(600);
  /** Messages for the HUD (parts coming off, touchdowns), drained by the game. */
  readonly events: string[] = [];
  /** Touchdown strength (0..1) of this frame's landings, for the tyre chirp. */
  chirp = 0;
  /** Impact energy (J) since the game last read it, for the crash sound and camera shake. */
  impact = 0;
  private readonly debris: Debris[] = [];
  private readonly rest = new Map<string, { parent: THREE.Object3D; pos: THREE.Vector3; quat: THREE.Quaternion }>();
  /** Per gear leg: the wheel group's rest height in its parent, and the strut length the model shows. */
  private readonly wheelRest = new Map<string, { y: number; length: number }>();
  private readonly contact: boolean[];
  private readonly strobes: THREE.Mesh[] = [];
  private smokeCarry = 0;
  private time = 0;
  private readonly spawn: { x: number; y: number; z: number; yaw: number };
  /** Afterburner flame at the nozzle (jets only): an outer orange plume and a blue-white core. */
  private readonly flame: { group: THREE.Group; outer: THREE.Mesh; core: THREE.Mesh } | null = null;

  constructor(
    private readonly physics: Physics,
    private readonly scene: THREE.Scene,
    x: number,
    y: number,
    z: number,
    yaw: number,
    cfg: AircraftConfig = F16,
    private readonly modelId = 'jet',
  ) {
    this.spawn = { x, y, z, yaw };
    this.aircraft = new Aircraft(physics, cfg, x, y, z, yaw);
    this.model = buildAircraftModel(modelId);
    scene.add(this.model.root, this.smoke.mesh);
    for (const [name, g] of this.model.parts) this.rest.set(name, { parent: g.parent!, pos: g.position.clone(), quat: g.quaternion.clone() });
    this.model.root.updateMatrixWorld(true);
    for (const w of this.aircraft.wheels) {
      const g = this.model.parts.get(w.def.part.replace('gear', 'wheel'));
      if (g) this.wheelRest.set(w.def.part, { y: g.position.y, length: w.def.pos[1] - g.getWorldPosition(_v).y });
    }
    this.contact = this.aircraft.wheels.map(() => true);
    this.addLights();
    if (cfg.engine.kind === 'jet') this.flame = this.addFlame(cfg.engine.pos);
    this.aircraft.onBreak = (e) => this.broke(e);
    this.updateVisuals(1, 0);
  }

  /** Navigation lights (red left, green right, white tail) and wingtip strobes. */
  private addLights(): void {
    const dot = (color: number, r: number): THREE.Mesh => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), new THREE.MeshBasicMaterial({ color, toneMapped: false }));
      m.castShadow = false;
      return m;
    };
    // Positions in the body frame (the model's root is still at the origin here).
    const at = (part: string, mesh: THREE.Mesh, x: number, y: number, z: number): void => {
      const g = this.model.parts.get(part);
      if (!g) return;
      mesh.position.set(x, y, z).sub(g.getWorldPosition(_v));
      g.add(mesh);
    };
    const l = LIGHTS[this.modelId] ?? LIGHTS.plane!;
    const [tx, ty, tz] = l.tip;
    at('wingL', dot(0xff2a1a, 0.05), tx, ty, tz);
    at('wingR', dot(0x22ff55, 0.05), -tx, ty, tz);
    at(l.tail[0], dot(0xffffff, 0.04), l.tail[1], l.tail[2], l.tail[3]);
    for (const [part, sign] of [['wingL', 1], ['wingR', -1]] as const) {
      const s = dot(0xffffff, 0.07);
      at(part, s, l.strobe[0] * sign, l.strobe[1], l.strobe[2]);
      this.strobes.push(s);
    }
  }

  /** Two additive cones pointing aft from the nozzle; their length follows the afterburner. */
  private addFlame(pos: [number, number, number]): { group: THREE.Group; outer: THREE.Mesh; core: THREE.Mesh } {
    const cone = (r: number, color: number, opacity: number): THREE.Mesh => {
      // Unit length along -z from the nozzle: scaled per frame.
      const g = new THREE.ConeGeometry(r, 1, 16, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -0.5);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
      m.castShadow = false;
      m.renderOrder = 2;
      return m;
    };
    const group = new THREE.Group();
    group.name = 'afterburner';
    group.position.set(...pos);
    const outer = cone(0.4, 0xff6a1a, 0.32);
    const core = cone(0.27, 0x6f9bff, 0.5);
    group.add(outer, core);
    group.visible = false;
    this.model.root.add(group);
    return { group, outer, core };
  }

  get pos(): THREE.Vector3 {
    return this.aircraft.currPos;
  }

  private broke(e: BreakEvent): void {
    const g = this.model.parts.get(e.part === 'prop' ? 'prop' : e.part);
    this.events.push(BREAK_TEXT[e.part] ?? `${e.part} broke off`);
    const ac = this.aircraft;
    let body = e.body;
    if (!g) return;
    if (!body) {
      // Gear legs and the propeller: a body of their own, sized by the mesh, thrown clear.
      const { RAPIER, world } = this.physics;
      _box.setFromObject(g);
      const inv = this.model.root.matrixWorld.clone().invert();
      _box.applyMatrix4(inv);
      const c = _box.getCenter(new THREE.Vector3());
      const h = _box.getSize(new THREE.Vector3()).multiplyScalar(0.5).max(_w.set(0.05, 0.05, 0.05));
      const t = ac.body.translation();
      const r = ac.body.rotation();
      _q.set(r.x, r.y, r.z, r.w);
      _v.copy(c).applyQuaternion(_q).add(_w.set(t.x, t.y, t.z));
      const pv = ac.body.velocityAtPoint({ x: _v.x, y: _v.y, z: _v.z });
      body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(t.x, t.y, t.z)
          .setRotation(r)
          .setLinvel(pv.x + (Math.random() - 0.5) * 3, pv.y + 2, pv.z + (Math.random() - 0.5) * 3)
          .setAngvel({ x: (Math.random() - 0.5) * 8, y: (Math.random() - 0.5) * 8, z: (Math.random() - 0.5) * 8 })
          .setCcdEnabled(true),
      );
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(h.x, h.y, h.z).setTranslation(c.x, c.y, c.z).setMass(e.part === 'prop' ? 35 : 20).setFriction(0.7).setCollisionGroups(groups(GROUP.PROP, 0xffff)),
        body,
      );
    }
    // The part keeps its place relative to the aircraft's frame, which is where its body starts.
    const holder = new THREE.Group();
    holder.name = `debris-${e.part}`;
    const rest = this.rest.get(g.name)!;
    if (rest.parent !== this.model.root) {
      // A child of another part: carry its offset in the body frame.
      g.updateWorldMatrix(true, false);
      const m = this.model.root.matrixWorld.clone().invert().multiply(g.matrixWorld);
      m.decompose(g.position, g.quaternion, g.scale);
    }
    holder.add(g);
    // A main gear leg mounted in the wing goes with it, wheel and all.
    for (const name of e.carries ?? []) {
      const leg = this.model.parts.get(name);
      if (!leg) continue;
      leg.updateWorldMatrix(true, false);
      const m = this.model.root.matrixWorld.clone().invert().multiply(leg.matrixWorld);
      m.decompose(leg.position, leg.quaternion, leg.scale);
      holder.add(leg);
    }
    this.scene.add(holder);
    this.debris.push({ part: e.part, body, holder });
    this.syncDebris();
  }

  private syncDebris(): void {
    for (const d of this.debris) {
      const t = d.body.translation();
      const r = d.body.rotation();
      d.holder.position.set(t.x, t.y, t.z);
      d.holder.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  /** One fixed step (before `physics.step()`). */
  fixedUpdate(dt: number, input: FlightInput): void {
    const ac = this.aircraft;
    ac.fixedUpdate(dt, input);
    // Touchdowns: a wheel meeting the ground with the aircraft rolling fast chirps and puffs.
    for (let i = 0; i < ac.wheels.length; i++) {
      const w = ac.wheels[i]!;
      if (w.contact && !this.contact[i] && ac.state.airspeed > 15) {
        const k = Math.min(1, (ac.state.airspeed - 15) / 25 + Math.max(0, -ac.state.vs) * 0.3);
        this.chirp = Math.max(this.chirp, k);
        this.wheelPuff(i, k);
      }
      this.contact[i] = w.contact;
    }
  }

  private wheelPuff(i: number, k: number): void {
    const ac = this.aircraft;
    const w = ac.wheels[i]!;
    _v.set(w.def.pos[0], w.def.pos[1] - w.length - w.def.radius, w.def.pos[2]).applyQuaternion(ac.currQuat).add(ac.currPos);
    const lv = ac.body.linvel();
    for (let n = 0; n < 3; n++) {
      this.smoke.spawn(_v.x, _v.y + 0.1, _v.z, lv.x * 0.3 + (Math.random() - 0.5), 0.4, lv.z * 0.3 + (Math.random() - 0.5), 1.2 + Math.random(), 0.4, 2.2 + k * 2, 0.35 * k, 1);
    }
  }

  /** A contact force on one of the aircraft's colliders after a physics step (N, for `dt` s). */
  contactForce(handle: number, force: number, dt: number): void {
    this.aircraft.contactForce(handle, force, dt);
    const j = force * dt;
    if (j > 150) this.impact += j * Math.max(3, this.aircraft.state.airspeed) * 0.5;
  }

  /** Broken-off parts back on the model, their bodies gone. */
  private refit(): void {
    for (const d of this.debris) {
      this.physics.world.removeRigidBody(d.body);
      this.scene.remove(d.holder);
    }
    this.debris.length = 0;
    for (const [name, g] of this.model.parts) {
      const r = this.rest.get(name)!;
      if (g.parent !== r.parent) r.parent.add(g);
      g.position.copy(r.pos);
      g.quaternion.copy(r.quat);
    }
  }

  /** Back to a spot, every part on, at rest. */
  placeAt(x: number, y: number, z: number, yaw: number): void {
    this.refit();
    this.aircraft.placeAt(x, y, z, yaw);
    this.contact.fill(true);
    this.smoke.clear();
    this.updateVisuals(1, 0);
  }

  respawn(): void {
    const s = this.spawn;
    this.placeAt(s.x, s.y, s.z, s.yaw);
  }

  /** Repair where it is, keeping position and speed: lost parts come back. */
  repair(): void {
    const ac = this.aircraft;
    const t = ac.body.translation();
    const r = ac.body.rotation();
    const lv = ac.body.linvel();
    const av = ac.body.angvel();
    this.refit();
    ac.repair();
    ac.body.setTranslation(t, true);
    ac.body.setRotation(r, true);
    ac.body.setLinvel(lv, true);
    ac.body.setAngvel(av, true);
  }

  /** Level of detail for a camera at `cam`: the cabin's insides only from close by (cockpit, chase). */
  detail(cam: THREE.Vector3): void {
    const near = cam.distanceToSquared(this.view.pos) < 35 * 35;
    const list = this.model.interior;
    if (list.length && list[0]!.visible !== near) for (const m of list) m.visible = near;
  }

  /** Per rendered frame: interpolated pose, controls, propeller, struts, lights, debris, smoke. */
  updateVisuals(alpha: number, dt: number): void {
    const ac = this.aircraft;
    this.time += dt;
    const v = this.view;
    v.pos.lerpVectors(ac.prevPos, ac.currPos, alpha);
    v.quat.slerpQuaternions(ac.prevQuat, ac.currQuat, alpha);
    const root = this.model.root;
    root.position.copy(v.pos);
    root.quaternion.copy(v.quat);
    const c = ac.controls;
    const parts = this.model.parts;
    const axes = this.model.axes;
    const turn = (name: string, angle: number): void => {
      const g = parts.get(name);
      const axis = axes.get(name);
      if (!g || !axis) return;
      g.quaternion.setFromAxisAngle(axis, angle).premultiply(this.rest.get(name)!.quat);
    };
    const flapMax = ac.cfg.surfaces.find((s) => s.control === 'flap')?.controlMax ?? 0.56;
    turn('aileronL', -c.aileron);
    turn('aileronR', c.aileron);
    turn('flapL', -c.flaps * flapMax);
    turn('flapR', -c.flaps * flapMax);
    turn('elevator', c.elevator + c.trim);
    // A fighter's whole tailplane moves (a stabilator), leading edge down for the nose up.
    if (!parts.has('elevator')) turn('tailH', c.elevator + c.trim);
    turn('rudder', -c.rudder);
    const prop = parts.get('prop');
    const pa = axes.get('prop');
    if (prop && pa && !ac.propBroken) prop.quaternion.setFromAxisAngle(pa, ac.prop);
    // Struts: each wheel (with its fairing) rides up and down the leg; the nose wheel turns.
    for (const w of ac.wheels) {
      const g = parts.get(w.def.part.replace('gear', 'wheel'));
      const r = this.wheelRest.get(w.def.part);
      if (!g || !r || !w.on) continue;
      g.position.y = r.y + r.length - w.length;
      if (w.def.steer) g.quaternion.setFromAxisAngle(_w.set(0, 1, 0), w.steer);
    }
    // Strobes: a double flash every 1.2 s.
    const ph = this.time % 1.2;
    const on = ph < 0.05 || (ph > 0.15 && ph < 0.2);
    for (const s of this.strobes) s.visible = on;
    // Afterburner: a short blue core at full dry power, a long flickering plume once it lights.
    const fl = this.flame;
    if (fl) {
      const st = ac.state;
      const e = ac.cfg.engine;
      const spool = Math.max(0, (st.rpm - e.idleRpm) / (e.maxRpm - e.idleRpm));
      const ab = st.afterburner ? Math.min(1, (c.throttle - 0.85) / 0.15) : 0;
      const flicker = 1 + 0.08 * Math.sin(this.time * 57) + 0.05 * Math.sin(this.time * 131);
      fl.group.visible = ac.engineHealth > 0 && spool > 0.6;
      fl.core.scale.set(1, 1, (0.4 + spool * 0.5 + ab * 1.3) * flicker);
      (fl.core.material as THREE.MeshBasicMaterial).opacity = 0.15 + 0.35 * Math.max(ab, spool - 0.6);
      fl.outer.visible = ab > 0;
      fl.outer.scale.set(1, 1, (1.2 + ab * 2.6) * flicker);
    }
    // Engine smoke as it gets hurt: grey wisps, then thick black smoke when it has stopped.
    if (dt > 0) {
      const hurt = 1 - ac.engineHealth;
      if (hurt > 0.3) {
        this.smokeCarry += dt * (6 + hurt * 30);
        const lv = ac.body.linvel();
        if (ac.cfg.engine.kind === 'jet') _v.set(...ac.cfg.engine.pos);
        else _v.set(0, 0.25, 1.4);
        _v.applyQuaternion(ac.currQuat).add(ac.currPos);
        while (this.smokeCarry >= 1) {
          this.smokeCarry -= 1;
          const dark = ac.engineHealth <= 0 ? 0.25 : 0.6;
          this.smoke.spawn(_v.x, _v.y, _v.z, lv.x * 0.6 + (Math.random() - 0.5), lv.y * 0.6 + 0.8, lv.z * 0.6 + (Math.random() - 0.5), 2.5 + Math.random() * 2, 0.6, 3 + hurt * 4, 0.5, dark);
        }
      }
      this.smoke.update(dt);
    }
    this.syncDebris();
  }

  dispose(): void {
    this.refit();
    this.physics.world.removeRigidBody(this.aircraft.body);
    this.scene.remove(this.model.root, this.smoke.mesh);
    if (this.flame) for (const m of [this.flame.outer, this.flame.core]) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.model.dispose();
    this.smoke.dispose();
  }
}

/**
 * Aircraft parked on the apron for show: the same model, merged into one mesh per material and
 * lightly tinted, on a fixed body made of the flight model's boxes (cars bump into them).
 */
export function buildParkedAircraft(physics: Physics, scene: THREE.Scene, stands: { x: number; z: number; yaw: number }[], groundAt: (x: number, z: number) => number, rest: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'parked-aircraft';
  const tints = [0xfff1d6, 0xdfe9ff, 0xf3f3f3];
  const { RAPIER, world } = physics;
  stands.forEach((st, i) => {
    const model = buildAircraftModel('plane');
    model.root.updateMatrixWorld(true);
    const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
    model.root.traverse((o) => {
      // No instruments behind the glass of a parked aircraft; the seats stay.
      if (!(o instanceof THREE.Mesh) || !o.visible || isInstrument((o.material as THREE.Material).name)) return;
      const g = (o.geometry as THREE.BufferGeometry).clone().applyMatrix4(o.matrixWorld);
      for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
      const list = byMat.get(o.material as THREE.Material) ?? [];
      list.push(g);
      byMat.set(o.material as THREE.Material, list);
    });
    const plane = new THREE.Group();
    for (const [mat, list] of byMat) {
      const merged = mergeGeometries(list);
      for (const g of list) g.dispose();
      if (!merged) continue;
      let m = mat;
      if (mat.name === 'paint') {
        m = mat.clone();
        (m as THREE.MeshStandardMaterial).color.setHex(tints[i % tints.length]!);
      }
      const mesh = new THREE.Mesh(merged, m);
      mesh.castShadow = mat.name === 'paint' || mat.name === 'prop' || mat.name === 'spinner';
      mesh.receiveShadow = mat.name !== 'glass';
      plane.add(mesh);
    }
    model.dispose();
    const y = groundAt(st.x, st.z) + rest;
    plane.position.set(st.x, y, st.z);
    plane.rotation.y = st.yaw;
    plane.updateMatrixWorld(true);
    plane.matrixAutoUpdate = false;
    group.add(plane);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), st.yaw);
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(st.x, y, st.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }));
    for (const c of SR22.colliders) {
      world.createCollider(RAPIER.ColliderDesc.cuboid(...c.half).setTranslation(...c.center).setCollisionGroups(groups(GROUP.WORLD, 0xffff)), body);
    }
    // The gear legs, so the parked aircraft stands on something solid.
    for (const g of SR22.gear) {
      const bottom = -rest;
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.12, (g.pos[1] - bottom) / 2, 0.25).setTranslation(g.pos[0], (g.pos[1] + bottom) / 2, g.pos[2]).setCollisionGroups(groups(GROUP.WORLD, 0xffff)),
        body,
      );
    }
  });
  scene.add(group);
  return group;
}
