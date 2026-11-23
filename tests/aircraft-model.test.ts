import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { parseCarGLB } from '../src/render/car/glb';
import { buildAircraftModel, setAircraftTemplate } from '../src/render/aircraft/model';
import type { AircraftConfig } from '../src/vehicle/aircraft/types';
import cfgJson from '../src/vehicle/aircraft/sr22.json';
import { glbBytes } from './helpers/models';

const cfg = cfgJson as unknown as AircraftConfig;

beforeAll(async () => {
  setAircraftTemplate(await parseCarGLB(glbBytes('plane')));
});

/** Box of a part's own meshes (not its children), in the body frame. */
function partBox(g: THREE.Group): THREE.Box3 {
  g.updateWorldMatrix(true, true);
  const box = new THREE.Box3();
  for (const m of g.children) {
    if (!(m instanceof THREE.Mesh)) continue;
    m.geometry.computeBoundingBox();
    box.union(m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld));
  }
  return box;
}

const PARTS = ['body', 'prop', 'glass', 'wingL', 'wingR', 'aileronL', 'aileronR', 'flapL', 'flapR', 'tailH', 'elevator', 'tailV', 'rudder', 'gearN', 'gearL', 'gearR', 'wheelN', 'wheelL', 'wheelR'];

describe('aircraft model (GLB)', () => {
  it('has every part the flight model and the damage need, with hinge axes on the controls', () => {
    const m = buildAircraftModel();
    for (const n of PARTS) expect(m.parts.has(n), `missing ${n}`).toBe(true);
    for (const n of ['aileronL', 'aileronR', 'flapL', 'flapR', 'elevator', 'rudder']) expect(m.axes.has(n), `${n} hinge`).toBe(true);
    // Controls hang under the surface they belong to, wheels under their leg.
    expect(m.parts.get('aileronL')!.parent).toBe(m.parts.get('wingL'));
    expect(m.parts.get('elevator')!.parent).toBe(m.parts.get('tailH'));
    expect(m.parts.get('wheelN')!.parent).toBe(m.parts.get('gearN'));
    m.dispose();
  });

  it('matches the physics: span, length, wheels on the struts, surfaces on the wings', () => {
    const m = buildAircraftModel();
    const all = new THREE.Box3();
    const boxes = new Map<string, THREE.Box3>();
    let tris = 0;
    for (const [name, g] of m.parts) {
      const b = partBox(g);
      boxes.set(name, b);
      if (!b.isEmpty()) all.union(b);
      for (const c of g.children) if (c instanceof THREE.Mesh) tris += (c.geometry.getIndex()?.count ?? 0) / 3;
      const f = (v: THREE.Vector3) => v.toArray().map((x) => x.toFixed(2)).join(' ');
      if (!b.isEmpty()) console.log(name.padEnd(9), f(b.min), '..', f(b.max));
    }
    const size = all.getSize(new THREE.Vector3());
    console.log('size', size.toArray().map((v) => v.toFixed(2)).join(' x '), 'tris', tris);
    // SR22: 11.68 m span, 7.92 m long, 2.7 m tall.
    expect(size.x).toBeGreaterThan(11.4);
    expect(size.x).toBeLessThan(12.0);
    expect(size.z).toBeGreaterThan(7.7);
    expect(size.z).toBeLessThan(8.1);
    expect(tris).toBeGreaterThan(20000);
    expect(tris).toBeLessThan(120000);
    // Each wheel sits under its strut at rest (strut top minus the static compression).
    for (const g of cfg.gear) {
      const wheel = boxes.get(g.part.replace('gear', 'wheel'))!;
      const c = wheel.getCenter(new THREE.Vector3());
      const r = wheel.getSize(new THREE.Vector3()).y / 2;
      expect(Math.abs(c.x - g.pos[0]), g.name).toBeLessThan(0.05);
      expect(Math.abs(c.z - g.pos[2]), g.name).toBeLessThan(0.05);
      expect(Math.abs(r - g.radius), g.name).toBeLessThan(0.03);
      expect(g.pos[1] - c.y, g.name).toBeGreaterThan(0.05);
      expect(g.pos[1] - c.y, g.name).toBeLessThan(g.travel);
    }
    // Lifting surfaces sit inside their part's mesh.
    for (const s of cfg.surfaces) {
      const b = boxes.get(s.part)!.clone().expandByScalar(0.25);
      expect(b.containsPoint(new THREE.Vector3(...s.pos)), s.name).toBe(true);
    }
    // The propeller turns about its hub (on the shaft, not at the centre of its box: three blades
    // reach higher than they reach down), which is the thrust point; its blades reach the radius.
    const hub = m.parts.get('prop')!.position;
    expect(hub.distanceTo(new THREE.Vector3(...cfg.engine.pos))).toBeLessThan(0.02);
    const g = m.parts.get('prop')!;
    let sx = 0;
    let sy = 0;
    let n = 0;
    let tip = 0;
    for (const c of g.children) {
      if (!(c instanceof THREE.Mesh)) continue;
      const p = c.geometry.getAttribute('position');
      for (let i = 0; i < p.count; i++) {
        sx += p.getX(i);
        sy += p.getY(i);
        n++;
        tip = Math.max(tip, Math.hypot(p.getX(i), p.getY(i)));
      }
    }
    // Balanced about the axis (within 2 cm), so it spins without wobbling.
    expect(Math.hypot(sx / n, sy / n)).toBeLessThan(0.02);
    expect(Math.abs(tip - cfg.engine.radius)).toBeLessThan(0.03);
    m.dispose();
  });
});

describe('aircraft in the game', () => {
  it('animates, throws broken parts clear as bodies, and puts them back on respawn', async () => {
    const { createPhysics, GROUP, groups, FIXED_DT } = await import('../src/core/physics');
    const { GameAircraft, PARKED, buildParkedAircraft } = await import('../src/game/GameAircraft');
    const physics = await createPhysics();
    const { RAPIER, world } = physics;
    world.createCollider(RAPIER.ColliderDesc.cuboid(500, 1, 500).setTranslation(0, -1, 0).setCollisionGroups(groups(GROUP.WORLD, 0xffff)));
    const scene = new THREE.Scene();
    const plane = new GameAircraft(physics, scene, 0, 1.18, 0, 0);
    const step = (): void => {
      plane.fixedUpdate(FIXED_DT, PARKED);
      physics.step();
      plane.aircraft.afterPhysicsStep();
    };
    for (let i = 0; i < 120; i++) step();
    plane.updateVisuals(1, 1 / 60);
    const wing = plane.model.parts.get('wingL')!;
    const wheel = plane.model.parts.get('wheelL')!;
    // The wheels sit where the model has them when the struts are at rest.
    const restY = wheel.position.y;
    expect(plane.aircraft.wheels[1]!.contact).toBe(true);
    // Breaking a wing: its group (with aileron, flap and lights) leaves the aircraft for a debris body.
    const bodies = world.bodies.len();
    plane.aircraft.detach('wingL', 'impact');
    expect(world.bodies.len()).toBe(bodies + 1);
    expect(wing.parent?.name).toBe('debris-wingL');
    expect(plane.model.parts.get('aileronL')!.parent).toBe(wing);
    // The left main gear leg, mounted in that wing, leaves with it: off the aircraft, under the same holder.
    expect(plane.aircraft.parts.get('gearL')!.on).toBe(false);
    expect(plane.aircraft.wheels.find((w) => w.def.part === 'gearL')!.on).toBe(false);
    expect(plane.model.parts.get('gearL')!.parent).toBe(wing.parent);
    expect(plane.aircraft.parts.get('gearR')!.on).toBe(true);
    expect(plane.events).toContain('Left wing torn off');
    // A gear leg has no body of its own in the flight model: the view makes one.
    plane.aircraft.detach('gearN', 'landing');
    expect(world.bodies.len()).toBe(bodies + 2);
    for (let i = 0; i < 60; i++) step();
    plane.updateVisuals(1, 1 / 60);
    plane.respawn();
    expect(world.bodies.len()).toBe(bodies);
    expect(wing.parent).toBe(plane.model.root);
    expect(plane.model.parts.get('gearN')!.parent).toBe(plane.model.root);
    for (let i = 0; i < 120; i++) step();
    plane.updateVisuals(1, 1 / 60);
    expect(wheel.position.y).toBeCloseTo(restY, 2);
    // Parked aircraft: one mesh per material each, on fixed bodies.
    const parked = buildParkedAircraft(physics, scene, [{ x: 30, z: 0, yaw: 0 }, { x: 60, z: 0, yaw: Math.PI }], () => 0, 1.15);
    expect(parked.children.length).toBe(2);
    const meshes = (parked.children[0] as THREE.Group).children.length;
    expect(meshes).toBeGreaterThan(2);
    expect(meshes).toBeLessThan(20);
    plane.dispose();
  });
});
