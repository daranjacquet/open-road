import * as THREE from 'three';
import type { Physics } from '../core/physics';
import { createCity, type City } from './city';
import { noiseFill, surfaceLookup, tileTexture } from './ground';
import { DRIFT, LIMIT, RACE, WORLD_SIZE } from './layout';
import { drawOverview, type Overview } from './overview';
import { buildPlaces, placeMaterials } from './places';
import type { RoadLine } from './roadline';
import { buildRoads, roadMaterials } from './roads';
import { buildSigns } from './signs';
import { SurfaceMap } from './surface';
import { createTerrainCollider, createTerrainView, splatTexture } from './terrain';
import { buildTrack, trackMaterials, type BuiltTrack } from './track';
import { createVegetation } from './vegetation';
import { createWater } from './water';
import { worldFromData, type WorldData } from './worlddata';

export { DRIFT, LIMIT, RACE } from './layout';

export const SPAWN = { x: 0, y: 0, z: -120, yaw: 0 };

export interface Location {
  name: string;
  x: number;
  /** Ground height at the spot (the car is dropped a little above it). */
  y: number;
  z: number;
  yaw: number;
}

export interface GameMap {
  group: THREE.Group;
  tracks: BuiltTrack[];
  city: City;
  roads: RoadLine[];
  locations: Location[];
  overview: Overview;
  /** Time spent building each part (ms), for the boot report. */
  buildTimes: Record<string, number>;
  /** Ground height (terrain only, not bridges or buildings). */
  heightAt(x: number, z: number): number;
  /** Per frame: terrain detail and culling, trees, traffic lights, knocked-over furniture, water. */
  update(seconds: number, camera: THREE.Camera, player: THREE.Vector3): void;
  isOutside(x: number, y: number, z: number): boolean;
  /** Under the lake surface. */
  inWater(x: number, y: number, z: number): boolean;
}

/**
 * Terrain, roads, city, circuits, places, forests and the lake, on top of the test area, from the
 * world data computed by the worker (`loadWorldData`).
 */
export function createMap(physics: Physics, data: WorldData): GameMap {
  const times: Record<string, number> = {};
  for (const [k, v] of Object.entries(data.times)) times[`worker.${k}`] = v;
  let t = performance.now();
  const lap = (name: string): void => {
    const now = performance.now();
    times[name] = Math.round(now - t);
    t = now;
  };
  const group = new THREE.Group();
  group.name = 'map';

  const world = worldFromData(data);
  const { hm } = world;
  createTerrainCollider(physics, hm);
  const terrain = createTerrainView(hm, splatTexture(hm, data.splat));
  group.add(terrain.group);
  lap('terrain');

  const surface = new SurfaceMap(WORLD_SIZE, 2);
  const asphalt = tileTexture((g, s) => {
    noiseFill(g, s, [96, 98, 104], 24);
    g.strokeStyle = 'rgba(0,0,0,0.1)';
    for (let i = 0; i < 6; i++) {
      g.beginPath();
      g.moveTo(Math.random() * s, 0);
      g.lineTo(Math.random() * s, s);
      g.stroke();
    }
  });
  const mats = trackMaterials(asphalt);
  const tracks = [RACE, DRIFT].map((def) => {
    const tr = buildTrack(physics, def, surface, mats);
    group.add(tr.group);
    return tr;
  });
  const city = createCity(physics, surface, asphalt);
  group.add(city.group);
  lap('city');

  const roads = buildRoads(physics, world.roads, hm, surface, roadMaterials());
  group.add(roads.group);
  const places = buildPlaces(physics, hm, world.roads, surface, placeMaterials(asphalt));
  group.add(places.group);
  buildSigns(physics, hm, places.group);
  lap('roads+places');

  const vegetation = createVegetation(physics, data.trees);
  group.add(vegetation.group);
  const water = createWater();
  group.add(water.mesh);
  lap('trees');
  physics.surfaceAt = surfaceLookup(surface);
  const overview = drawOverview(hm, world.roads, data.overview, tracks);
  lap('overview');

  const road = (id: string): RoadLine => world.roads.find((r) => r.def.id === id)!;
  const onRoad = (name: string, id: string, s: number): Location => {
    const p = road(id).at(s);
    return { name, ...p };
  };
  /** The spot of a road nearest to (x, z), heading along it. */
  const nearRoad = (name: string, id: string, x: number, z: number): Location => {
    const r = road(id);
    return { name, ...r.at(r.nearest(x, z).i * r.ds) };
  };
  const spot = (name: string): Location => places.spots.find((p) => p.name === name)!;
  const locations: Location[] = [
    { name: 'Test area', ...SPAWN },
    { name: 'City', x: 516.5, y: 0, z: -560, yaw: 0 },
    { name: 'Grand Prix circuit', y: 0, ...tracks[0]!.line.at(-30) },
    { name: 'Drift circuit', y: 0, ...tracks[1]!.line.at(-24) },
    onRoad('Mountain pass', 'pass', 60),
    spot('Summit viewpoint'),
    spot('Lake village'),
    spot('Harbour'),
    spot('Petrol station'),
    spot('Airfield runway'),
    spot('Farm'),
    nearRoad('Forest road', 'ring', -1180, 880),
    spot('Quarry'),
  ];

  // Small things only worth drawing from nearby (their instanced meshes span the whole city, so the
  // frustum alone never culls them, not even in the shadow map).
  const cullers: { obj: THREE.Object3D; rect: [number, number, number, number]; max: number }[] = [
    { obj: city.details, rect: [293, -847, 857, 247], max: 700 },
  ];
  const camPos = new THREE.Vector3();
  return {
    group,
    tracks,
    city,
    roads: world.roads,
    locations,
    overview,
    buildTimes: times,
    heightAt: (x, z) => hm.heightAt(x, z),
    update(seconds, camera, player) {
      camera.getWorldPosition(camPos);
      for (const c of cullers) {
        const dx = Math.max(c.rect[0] - camPos.x, 0, camPos.x - c.rect[2]);
        const dz = Math.max(c.rect[1] - camPos.z, 0, camPos.z - c.rect[3]);
        c.obj.visible = dx * dx + dz * dz < c.max * c.max;
      }
      terrain.update(camera);
      vegetation.update(camPos, player);
      water.update(seconds);
      city.update(seconds);
      city.furniture.update();
    },
    isOutside(x, y, z) {
      return Math.abs(x) > LIMIT || Math.abs(z) > LIMIT || y < -40;
    },
    inWater: (x, y, z) => water.isUnder(x, y, z),
  };
}
