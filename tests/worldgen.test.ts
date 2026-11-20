import { beforeAll, describe, expect, it } from 'vitest';
import { createPhysics, FIXED_DT } from '../src/core/physics';
import { CARS } from '../src/game/catalog';
import { Vehicle } from '../src/vehicle/Vehicle';
import { DRIFT, LAKE, lakeRadius, LIMIT, PLACES, RACE, WATER_LEVEL } from '../src/world/layout';
import { roadSurfaces } from '../src/world/roadline';
import { createTerrainCollider } from '../src/world/terrain';
import { TrackLine } from '../src/world/track';
import { generateWorld, type World } from '../src/world/worldgen';

let world: World;
beforeAll(() => {
  const t0 = performance.now();
  world = generateWorld();
  console.log('world generated in', (performance.now() - t0).toFixed(0), 'ms');
});

describe('world generation', () => {
  it('is deterministic', () => {
    const again = generateWorld();
    let diff = 0;
    for (let i = 0; i < again.hm.heights.length; i += 97) diff = Math.max(diff, Math.abs(again.hm.heights[i]! - world.hm.heights[i]!));
    expect(diff).toBe(0);
  });

  it('keeps every road within its grade, inside the world and out of the lake', () => {
    for (const r of world.roads) {
      expect(r.maxGradeOver(10), r.def.id).toBeLessThan((r.def.maxGrade ?? 0.09) + 0.012);
      for (let i = 0; i < r.n; i += 5) {
        expect(Math.abs(r.x[i]!), r.def.id).toBeLessThan(LIMIT - 60);
        expect(Math.abs(r.z[i]!), r.def.id).toBeLessThan(LIMIT - 60);
        const inLake = Math.hypot(r.x[i]! - LAKE.x, r.z[i]! - LAKE.z) < lakeRadius(r.x[i]!, r.z[i]!) + 10;
        if (inLake) expect(r.y[i]!, `${r.def.id} over the lake`).toBeGreaterThan(WATER_LEVEL + 1);
      }
    }
  });

  it('joins the roads end to end (no step where one meets another)', () => {
    for (const r of world.roads) {
      if (r.closed) continue;
      for (const end of [0, r.n - 1]) {
        for (const o of world.roads) {
          if (o === r) continue;
          const near = o.nearest(r.x[end]!, r.z[end]!);
          if (near.dist < 8) expect(Math.abs(o.y[near.i]! - r.y[end]!), `${r.def.id} meets ${o.def.id}`).toBeLessThan(0.3);
        }
      }
    }
  });

  it('keeps the ground flat under the test area, the city, the circuits and the airfield', () => {
    const { hm } = world;
    const points: [number, number][] = [
      [-150, -150], [150, 150], [0, 840], [-300, 100],
      [300, -840], [850, 240], [575, -300],
      [PLACES.airfield.x0, PLACES.airfield.z], [PLACES.airfield.x1, PLACES.airfield.z],
    ];
    for (const def of [RACE, DRIFT]) {
      const line = new TrackLine(def);
      for (let i = 0; i < line.n; i += 25) {
        for (const off of [0, def.width / 2 + def.runoff]) points.push([line.x[i]! + line.leftX(i) * off, line.z[i]! + line.leftZ(i) * off]);
      }
    }
    for (const [x, z] of points) expect(Math.abs(hm.heightAt(x, z)), `${x}, ${z}`).toBeLessThan(0.05);
  });

  it('never lets the ground poke through the asphalt, junctions included', () => {
    const { hm } = world;
    const surfaces = roadSurfaces(world.roads);
    let worst = -Infinity;
    let where = '';
    world.roads.forEach((r, ri) => {
      const hw = r.def.width / 2;
      for (let i = 0; i < r.n; i++) {
        for (const f of [-1, -0.5, 0, 0.5, 1]) {
          const off = f * hw;
          const d = hm.heightAt(r.x[i]! + r.leftX(i) * off, r.z[i]! + r.leftZ(i) * off) - surfaces[ri]!(i, off);
          if (d > worst) {
            worst = d;
            where = `${r.def.id} sample ${i}/${r.n} offset ${off}`;
          }
        }
      }
    });
    console.log('highest ground relative to the asphalt', worst.toFixed(3), 'm at', where);
    expect(worst).toBeLessThan(0);
  });

  it('matches the physics heightfield exactly', async () => {
    const physics = await createPhysics();
    createTerrainCollider(physics, world.hm);
    physics.world.step();
    const { RAPIER } = physics;
    let worst = 0;
    for (let k = 0; k < 400; k++) {
      const x = ((k * 7919) % 3800) - 1900 + 0.37;
      const z = ((k * 104729) % 3800) - 1900 + 0.61;
      const hit = physics.world.castRay(new RAPIER.Ray({ x, y: 1000, z }, { x: 0, y: -1, z: 0 }), 2000, true);
      expect(hit).not.toBeNull();
      worst = Math.max(worst, Math.abs(1000 - hit!.timeOfImpact - world.hm.heightAt(x, z)));
    }
    expect(worst).toBeLessThan(0.01);
  });
});

describe('driving the new roads', () => {
  it('a sedan climbs the steepest stretch of the ring road from a standstill', async () => {
    const pass = world.roads.find((r) => r.def.id === 'ring')!;
    // Steepest 40 m uphill, away from bridges (the heightfield is carved to the road there).
    let best = 0;
    let at = 0;
    const k = 20;
    for (let i = 0; i + k < pass.n; i++) {
      if (pass.bridge[i] || pass.bridge[i + k]) continue;
      const g = (pass.y[i + k]! - pass.y[i]!) / (k * pass.ds);
      if (g > best) {
        best = g;
        at = i;
      }
    }
    const physics = await createPhysics();
    createTerrainCollider(physics, world.hm);
    const def = CARS.find((c) => c.id === 'sedan')!;
    const start = Math.max(0, at - 5);
    const yaw = Math.atan2(pass.tx[start]!, pass.tz[start]!);
    const car = new Vehicle(physics, def.cfg, pass.x[start]!, pass.z[start]!, yaw);
    car.placeAt(pass.x[start]!, pass.y[start]! + 0.9, pass.z[start]!, yaw);
    for (let i = 0; i < 120 * 6; i++) {
      car.fixedUpdate(FIXED_DT, { throttle: 0.7, brake: 0, steer: 0, handbrake: 0 });
      physics.step();
      car.afterPhysicsStep();
    }
    const p = car.body.translation();
    console.log('pass grade', (best * 100).toFixed(1), '% climbed', (p.y - pass.y[start]!).toFixed(1), 'm at', car.speedKmh.toFixed(0), 'km/h');
    expect(best).toBeGreaterThan(0.07);
    expect(p.y - pass.y[start]!).toBeGreaterThan(4);
    expect(car.speedKmh).toBeGreaterThan(25);
  }, 60_000);
});

describe('rally stages', () => {
  it('times a run from the start gantry to the finish, and ignores a shortcut', async () => {
    const { StageTimer } = await import('../src/game/stage');
    for (const road of world.roads.filter((r) => r.def.stage)) {
      const st = road.def.stage!;
      const stage = { id: road.def.id, name: st.name, line: road, startI: Math.round(st.start * (road.n - 1)), finishI: Math.round(st.finish * (road.n - 1)) };
      expect(road.length, road.def.id).toBeGreaterThan(1200);
      const timer = new StageTimer(stage, 'test');
      const v = 25; // m/s
      let t = 0;
      const drive = (from: number, to: number): void => {
        for (let s = from; s <= to; s += v / 60) {
          const p = road.at(s);
          t += 1 / 60;
          timer.update(p.x, p.z, t);
        }
      };
      const sStart = stage.startI * road.ds;
      const sFinish = stage.finishI * road.ds;
      drive(sStart - 50, sFinish + 20);
      expect(timer.state.last, road.def.id).not.toBeNull();
      expect(timer.state.last!).toBeCloseTo((sFinish - sStart) / v, 0);
      // Start again, then jump straight to the finish: no time.
      const before = timer.state.lap;
      drive(sStart - 30, sStart + 30);
      drive(sFinish - 20, sFinish + 20);
      expect(timer.state.lap).toBe(before);
    }
  });

  it('has hills and both asphalt and gravel on the rally stage', async () => {
    const { surfaceOf } = await import('../src/world/roadline');
    const stage = world.roads.find((r) => r.def.id === 'stage')!;
    const kinds = new Set<string>();
    let climb = 0;
    for (let i = 1; i < stage.n; i++) {
      kinds.add(surfaceOf(stage, i));
      climb += Math.max(0, stage.y[i]! - stage.y[i - 1]!);
    }
    expect([...kinds].sort()).toEqual(['asphalt', 'gravel']);
    expect(climb).toBeGreaterThan(40);
    expect(stage.length).toBeGreaterThan(2400);
  });
});
