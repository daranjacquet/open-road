import * as THREE from 'three';
import type { Physics } from '../core/physics';
import { createCity, type City } from './city';
import { noiseFill, setSurfaceMap, tileTexture, WORLD_SIZE } from './ground';
import { SurfaceMap } from './surface';
import { buildTrack, trackMaterials, type BuiltTrack, type TrackDef } from './track';

export const SPAWN = { x: 0, z: -120, yaw: 0 };
/** Leaving this square (or falling below the world) sends the car back to the start. */
export const LIMIT = WORLD_SIZE / 2 - 2;

/** Grand-prix style circuit, north-west: 2.9 km, long main straight, hairpin, esses. */
export const RACE: TrackDef = {
  id: 'race',
  name: 'Grand Prix circuit',
  width: 14,
  runoff: 14,
  wall: 'armco',
  points: (
    [
      [-180, 300], [-180, 600], [-185, 860], [-230, 930], [-320, 950], [-450, 915], [-560, 945], [-680, 940],
      [-750, 895], [-735, 835], [-650, 800], [-580, 745], [-620, 680], [-740, 650], [-860, 580], [-905, 450],
      [-860, 330], [-760, 275], [-640, 300], [-560, 370], [-480, 345], [-420, 280], [-330, 245], [-230, 250],
    ] as [number, number][]
  ).map(([x, z]) => [x - 40, z] as [number, number]),
};

/** Drift circuit, south-west: wide and twisty, with a skid pad next to it. */
export const DRIFT: TrackDef = {
  id: 'drift',
  name: 'Drift circuit',
  width: 16,
  runoff: 7,
  wall: 'blocks',
  points: [
    [-300, -420], [-300, -600], [-340, -700], [-430, -720], [-480, -660], [-560, -640], [-620, -700], [-600, -800],
    [-680, -880], [-800, -870], [-860, -780], [-800, -700], [-840, -600], [-820, -470], [-720, -420], [-640, -480],
    [-560, -440], [-470, -380], [-380, -360],
  ],
  pads: [[-520, -230, 55]],
};

export interface Location {
  name: string;
  x: number;
  z: number;
  yaw: number;
}

export interface GameMap {
  group: THREE.Group;
  tracks: BuiltTrack[];
  city: City;
  locations: Location[];
  /** Per frame: traffic lights, knocked-over furniture. */
  update(seconds: number): void;
  isOutside(x: number, y: number, z: number): boolean;
}

/** City, circuits and world edge, on top of the test area from `createGround`. */
export function createMap(physics: Physics): GameMap {
  const group = new THREE.Group();
  group.name = 'map';
  const surface = new SurfaceMap(WORLD_SIZE);
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
    const t = buildTrack(physics, def, surface, mats);
    group.add(t.group);
    return t;
  });
  const city = createCity(physics, surface, asphalt);
  group.add(city.group);
  setSurfaceMap(surface);

  // World edge: red and white posts, and grass beyond so the horizon is not a cliff.
  const posts: THREE.Matrix4[] = [];
  for (let s = -LIMIT; s <= LIMIT; s += 25) {
    for (const [x, z] of [
      [s, -LIMIT],
      [s, LIMIT],
      [-LIMIT, s],
      [LIMIT, s],
    ] as const) {
      posts.push(new THREE.Matrix4().makeTranslation(x, 0.7, z));
    }
  }
  const postMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.12, 1.4, 8), new THREE.MeshStandardMaterial({ color: 0xd8261c }), posts.length);
  posts.forEach((m, i) => postMesh.setMatrixAt(i, m));
  group.add(postMesh);
  const outerMat = new THREE.MeshStandardMaterial({ color: 0x55703f, roughness: 1 });
  const H = WORLD_SIZE / 2;
  const F = 5000;
  for (const [cx, cz, w, d] of [
    [0, H + F / 2, 2 * (H + F), F],
    [0, -H - F / 2, 2 * (H + F), F],
    [H + F / 2, 0, F, 2 * H],
    [-H - F / 2, 0, F, 2 * H],
  ] as const) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), outerMat);
    m.position.set(cx, -0.02, cz);
    group.add(m);
  }

  const race = tracks[0]!.line.at(-30);
  const drift = tracks[1]!.line.at(-24);
  const locations: Location[] = [
    { name: 'Test area', ...SPAWN },
    { name: 'City', x: 516.5, z: -560, yaw: 0 },
    { name: 'Grand Prix circuit', ...race },
    { name: 'Drift circuit', ...drift },
    { name: 'Drift skid pad', x: -520, z: -282, yaw: Math.PI / 2 },
  ];

  return {
    group,
    tracks,
    city,
    locations,
    update(seconds: number) {
      city.update(seconds);
      city.furniture.update();
    },
    isOutside(x, y, z) {
      return Math.abs(x) > LIMIT + 1 || Math.abs(z) > LIMIT + 1 || y < -15;
    },
  };
}
