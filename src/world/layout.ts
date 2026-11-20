/**
 * The world plan: size, relief, lake, flat areas, country roads and places. Pure data and height
 * functions; `worldgen.ts` turns it into a heightmap, the builders into meshes and colliders.
 *
 * Seen on the in-game map (x to the right, -z up):
 *            -z              farm, airfield (bottom of the 3D world's z axis)
 *   -x forest, quarry    test area, city, circuits    +x lake, village, petrol station
 *            +z              mountains, pass road, viewpoint
 */
import { fbm, ridged, smoothstep } from './noise';
import type { RoadDef } from './roadline';
import type { TrackDef } from './track';

/** World square side (m), terrain cell (m) and cells per side. */
export const WORLD_SIZE = 4096;
export const CELL = 4;
export const CELLS = WORLD_SIZE / CELL;
/** Cars that get past this distance from the centre (on x or z) go back to their last road. */
export const LIMIT = 1990;

export const WATER_LEVEL = 0;
/** The lake east of the city: a rounded blob with a ragged shore. */
export const LAKE = { x: 1440, z: 240, r: 285 };

export function lakeRadius(x: number, z: number): number {
  const a = Math.atan2(z - LAKE.z, x - LAKE.x);
  return LAKE.r * (1 + 0.16 * Math.sin(a * 3 + 1.3) + 0.08 * Math.sin(a * 7 + 0.4));
}

/** A flat area at a fixed height, blending into the hills over `falloff` m. */
export interface Pad {
  name: string;
  /** Height of the flat area: a number, or the natural ground height at its centre plus `y`. */
  y: number;
  natural?: boolean;
  falloff: number;
  /** Axis-aligned rectangle, or a disc. */
  rect?: [number, number, number, number];
  disc?: [number, number, number];
}

/** The test area, the city with its link road, the airfield, the village... */
export const PADS: Pad[] = [
  { name: 'test area', y: 0, falloff: 140, rect: [-380, -200, 190, 890] },
  { name: 'city', y: 0, falloff: 140, rect: [150, -880, 890, 280] },
  { name: 'airfield', y: 0, falloff: 160, rect: [120, -1490, 1560, -1230] },
  { name: 'village', y: 2.5, falloff: 110, disc: [1135, -170, 165] },
  { name: 'petrol station', y: 0, falloff: 60, rect: [960, -400, 1030, -365] },
  { name: 'farm', y: 0, natural: true, falloff: 120, disc: [-720, -1400, 95] },
  { name: 'quarry', y: -17, natural: true, falloff: 34, disc: [-1460, -170, 115] },
  { name: 'viewpoint', y: 0, natural: true, falloff: 45, disc: [395, 1610, 40] },
];

/** Distance from (x, z) to a pad's shape (0 inside). */
export function padDistance(p: Pad, x: number, z: number): number {
  if (p.rect) {
    const [x0, z0, x1, z1] = p.rect;
    const dx = Math.max(x0 - x, 0, x - x1);
    const dz = Math.max(z0 - z, 0, z - z1);
    return Math.hypot(dx, dz);
  }
  const [cx, cz, r] = p.disc!;
  return Math.max(0, Math.hypot(x - cx, z - cz) - r);
}

/** How far (x, z) lies inside a pad's shape (m; 0 or less outside). */
export function padInset(p: Pad, x: number, z: number): number {
  if (p.rect) {
    const [x0, z0, x1, z1] = p.rect;
    return Math.min(x - x0, x1 - x, z - z0, z1 - z);
  }
  const [cx, cz, r] = p.disc!;
  return r - Math.hypot(x - cx, z - cz);
}

/**
 * Rolling hills, the mountain range (+z), the forest hills (-x) (before flattening). `valley` (0..1)
 * calms the relief near the roads: they follow valleys and saddles, as real roads do.
 */
export function baseHeight(x: number, z: number, valley = 1): number {
  return baseLow(x, z, valley) + baseDetail(x, z);
}

/** Small bumps (tens of metres across): evaluated at every terrain vertex. */
export function baseDetail(x: number, z: number): number {
  const r = Math.max(Math.abs(x), Math.abs(z));
  return 2.2 * fbm(x / 85, z / 85, 2, 9) * (0.3 + 0.7 * smoothstep(850, 1350, r));
}

/** The large shapes (hills, ranges): smooth enough to sample on a coarse grid. */
export function baseLow(x: number, z: number, valley = 1): number {
  const r = Math.max(Math.abs(x), Math.abs(z));
  const amp = 0.3 + 0.7 * smoothstep(850, 1350, r);
  let h = 17 * fbm(x / 640, z / 640, 4, 3) * amp;
  // Mountains on the +z side: ridges rising behind the circuits.
  const north = smoothstep(940, 1760, z);
  if (north > 0) h += north * (70 + 200 * valley * ridged((x + 4100) / 560, (z + 900) / 560, 5, 21));
  // Forest hills on the -x side.
  const west = smoothstep(-960, -1420, x);
  if (west > 0) h += west * (28 + 42 * valley * fbm(x / 330, z / 330, 4, 41));
  // Rally country: hills between the city, the test straight and the mountains.
  const rally = smoothstep(0, 140, Math.min(x - 230, 1080 - x, z - 330, 1200 - z));
  if (rally > 0) h += rally * (14 + 20 * valley * fbm(x / 240, z / 240, 3, 91));
  // Steep little hills along the west edge, for the forest trail.
  const trail = smoothstep(-1470, -1560, x) * smoothstep(-520, -440, z) * (1 - smoothstep(620, 700, z));
  if (trail > 0) h += trail * 16 * fbm(x / 95, z / 95, 3, 113);
  // The lake country sits a little higher, so the lake is the lowest ground around.
  h += 9 * smoothstep(900, 1250, x);
  // Gentle farmland swell on the -z side.
  const south = smoothstep(-1000, -1500, z) * (1 - west);
  if (south > 0) h += south * 9 * fbm(x / 260, z / 260, 3, 57);
  return h;
}

/** The ring of mountains at the world edge (added last: nothing flattens it). */
export function rimHeight(x: number, z: number): number {
  const r = Math.max(Math.abs(x), Math.abs(z));
  const w = smoothstep(1790, 2040, r);
  return w > 0 ? w * (170 + 90 * fbm(x / 300, z / 300, 4, 77)) : 0;
}

/** The lake: a bowl below the water, a shore rising gently out of it. Returns [target, weight]. */
export function lakeShape(x: number, z: number): [number, number] {
  const r = lakeRadius(x, z);
  const d = Math.hypot(x - LAKE.x, z - LAKE.z);
  if (d < r) return [WATER_LEVEL - 0.8 - 6 * Math.sqrt(1 - d / r), 1];
  return [WATER_LEVEL - 0.8 + (d - r) * 0.06, 1 - smoothstep(r + 15, r + 150, d)];
}

// ---- circuits ----------------------------------------------------------------------------------------

/** Grand-prix style circuit (-x, +z): 2.9 km, long main straight, hairpin, esses. */
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

/** Drift circuit (-x, -z): wide and twisty. */
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
};

// ---- roads ------------------------------------------------------------------------------------------

/**
 * Country roads. The loop: the pass over the mountains, down to the lake, the village, on to the
 * airfield, past the farm, through the forest and the quarry, back to the pass. Spurs
 * join it to the city, the test area and the airfield.
 */
export const ROADS: RoadDef[] = [
  {
    // One loop, so it flows without a seam: up the mountain pass, down to the lake, through the
    // village, past the airfield and the farm, through the forest and past the quarry.
    id: 'ring',
    name: 'Ring road',
    width: 8,
    maxGrade: 0.1,
    closed: true,
    dryAbove: { x: LAKE.x, z: LAKE.z, r: LAKE.r * 1.4 + 120, y: WATER_LEVEL + 1.2 },
    points: [
      [12, 1060], [70, 1140], [170, 1190], [280, 1220], [350, 1280], [345, 1350], [270, 1385], [160, 1405],
      [80, 1450], [75, 1520], [150, 1565], [270, 1585], [395, 1610], [520, 1590], [640, 1520], [760, 1420],
      [880, 1300], [1010, 1170], [1140, 1040], [1250, 900], [1240, 760], [1170, 640], [1105, 500], [1080, 340],
      [1085, 180], [1110, 40], [1135, -90], [1140, -230], [1120, -360], [1110, -520], [1140, -700], [1200, -880],
      [1230, -1060], [1180, -1200], [1060, -1250], [900, -1215], [700, -1205], [500, -1205], [300, -1215],
      [130, -1230], [-60, -1300], [-280, -1360], [-500, -1380], [-650, -1345], [-800, -1300], [-980, -1280],
      [-1150, -1180], [-1300, -1000], [-1400, -800], [-1440, -600], [-1420, -420], [-1360, -290], [-1300, -120],
      [-1350, 60], [-1450, 220], [-1480, 400], [-1400, 580], [-1270, 720], [-1180, 880], [-1080, 1040],
      [-930, 1130], [-760, 1160], [-560, 1150], [-380, 1110], [-220, 1070], [-100, 1050],
    ],
  },
  {
    // Rally stage: from the city's north edge to the loop under the mountains, through the hills,
    // asphalt and gravel in turn. Timed between the start and finish gantries.
    id: 'stage',
    name: 'Rally stage',
    width: 7,
    maxGrade: 0.14,
    smoothing: 22,
    startY: 0.03,
    sections: [
      [0, 'asphalt'],
      [0.13, 'gravel'],
      [0.44, 'asphalt'],
      [0.6, 'gravel'],
      [0.9, 'asphalt'],
    ],
    stage: { name: 'Rally stage', start: 0.05, finish: 0.95 },
    points: [
      [520, 247], [522, 330], [470, 405], [380, 440], [300, 500], [255, 580], [270, 670], [340, 720], [430, 690],
      [500, 620], [590, 575], [690, 590], [770, 640], [850, 610], [930, 660], [920, 750], [840, 790], [740, 760],
      [650, 800], [570, 860], [600, 950], [710, 985], [800, 935], [880, 870], [970, 860], [1030, 940], [1095, 975],
      [1165, 1012],
    ],
  },
  {
    // A dirt trail through the forest hills along the world's west edge: narrow, steep, for the
    // 4x4 and rally setups. Timed end to end.
    id: 'trail',
    name: 'Forest trail',
    width: 5.5,
    maxGrade: 0.2,
    smoothing: 12,
    surface: 'gravel',
    lines: false,
    stage: { name: 'Forest trail', start: 0.03, finish: 0.97 },
    points: [
      [-1420, -420], [-1510, -400], [-1600, -340], [-1665, -250], [-1690, -140], [-1650, -40], [-1600, 50],
      [-1640, 150], [-1600, 240], [-1660, 330], [-1700, 420], [-1650, 500], [-1560, 520], [-1500, 600], [-1400, 580],
    ],
  },
  // Spurs: each starts at the edge of a flat asphalt area (or on the loop) and ends on the loop.
  { id: 'pass', name: 'Pass road', width: 8, maxGrade: 0.1, startY: 0.03, points: [[0, 860], [0, 960], [12, 1060]] },
  { id: 'east', name: 'East road', width: 8, startY: 0.03, points: [[857, -360], [930, -362], [1000, -355], [1060, -345], [1120, -335]] },
  // From the loop into the airfield apron.
  { id: 'apron', name: 'Apron access', width: 10, lines: false, points: [[630, -1205], [630, -1224], [630, -1244]] },
  { id: 'airport', name: 'Airfield road', width: 8, startY: 0.03, points: [[630, -847], [632, -950], [628, -1060], [630, -1205]] },
  {
    id: 'west',
    name: 'West road',
    width: 8,
    startY: 0.03,
    points: [[-160, -110], [-300, -115], [-450, -120], [-600, -130], [-760, -140], [-920, -150], [-1080, -150], [-1220, -135], [-1300, -120]],
  },
  {
    id: 'farm',
    name: 'Farm track',
    width: 4.5,
    surface: 'gravel',
    lines: false,
    maxGrade: 0.12,
    points: [[-650, -1345], [-668, -1372], [-698, -1392], [-720, -1402]],
  },
  {
    id: 'quarry',
    name: 'Quarry track',
    width: 6,
    surface: 'gravel',
    lines: false,
    maxGrade: 0.15,
    linear: true,
    // Down the pit wall in a quarter turn, to the floor.
    points: [[-1300, -120], [-1349, -93], [-1392, -53], [-1448, -35], [-1506, -43], [-1527, -103], [-1500, -140]],
  },
];

// ---- places -------------------------------------------------------------------------------------------

export const PLACES = {
  village: { x: 1135, z: -170 },
  harbour: { x: 1250, z: -60 },
  petrol: { x: 995, z: -383 },
  airfield: { x0: 180, x1: 1500, z: -1360 },
  farm: { x: -720, z: -1400 },
  quarry: { x: -1460, z: -170 },
  viewpoint: { x: 395, z: 1610 },
};
