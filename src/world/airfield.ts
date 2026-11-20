import * as THREE from 'three';
import { canvasTexture, StaticBatch, tiledBox } from './batch';
import { PLACES } from './layout';
import type { PlaceMaterials } from './places';
import { ASPHALT, type SurfaceMap } from './surface';
import type { Physics } from '../core/physics';

/** Runway width (m) and its half. */
const WIDTH = 45;
const HALF = WIDTH / 2;
/** Where the PAPI sits past each threshold (m), abeam the aiming point, and its unit angles (deg, runway side first). */
const PAPI_AT = 300;
const PAPI_DEG = [3.5, 3.17, 2.83, 2.5];

export interface Airfield {
  group: THREE.Group;
  /** Teleport spots: the runway threshold for cars, the aircraft's spot lined up on runway 27. */
  spots: { name: string; x: number; y: number; z: number; yaw: number }[];
  /** Parking stands on the apron (ground position, nose heading) for parked aircraft. */
  stands: { x: number; z: number; yaw: number }[];
  /** Per frame: the PAPI lights show white or red for the camera's angle above the approach. */
  update(camera: THREE.Vector3): void;
}

/** A flat decal on the ground at height y, UVs in metres (tiled textures). */
function decal(b: StaticBatch, mat: THREE.Material, x: number, y: number, z: number, w: number, d: number, yaw = 0): void {
  const g = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * d);
  b.add(g, mat, x, y, z, yaw, 0, 0, false);
}

/** White runway numbers on a transparent ground, the bottom of the digits towards the threshold. */
function designatorTexture(text: string): THREE.CanvasTexture {
  const t = canvasTexture(
    192,
    256,
    (g) => {
      g.clearRect(0, 0, 192, 256);
      g.fillStyle = '#f2f2ee';
      g.font = 'bold 250px "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      // Tall, narrow runway digits: squeeze the font horizontally.
      g.save();
      g.translate(96, 136);
      g.scale(0.62, 1);
      g.fillText(text, 0, 0);
      g.restore();
    },
    false,
  );
  return t;
}

/** A sign face: white text on red (mandatory: runway holding point) or black on yellow. */
function signTexture(text: string, bg: string, fg: string): THREE.CanvasTexture {
  return canvasTexture(
    256,
    96,
    (g) => {
      g.fillStyle = bg;
      g.fillRect(0, 0, 256, 96);
      g.fillStyle = fg;
      g.font = 'bold 64px "Arial Narrow", Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, 128, 52);
    },
    false,
  );
}

/**
 * The airfield: a 1320 m x 45 m asphalt runway (09/27) marked as on a real one (threshold
 * stripes, designators, aiming points, touchdown zone, centre line, edges), blast pads with
 * chevrons, edge, threshold and approach lights, a PAPI at each end that really shows the glide
 * path, windsocks, a parallel taxiway with its centre line, blue edge lights, holding points and
 * signs, an apron with parking stands, hangars and a control tower.
 */
export function buildAirfield(physics: Physics, surface: SurfaceMap, m: PlaceMaterials): Airfield {
  const group = new THREE.Group();
  group.name = 'airfield';
  const b = new StaticBatch(physics);
  const a = PLACES.airfield;
  const y = 0;
  const len = a.x1 - a.x0;
  const cx = (a.x0 + a.x1) / 2;
  const zc = a.z;
  const spots: Airfield['spots'] = [];
  const paint = m.paint;
  const yellow = new THREE.MeshStandardMaterial({ color: 0xe8b80c, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -4 });
  const lit = (color: number): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({ color });
  const white = lit(0xfff6dc);
  const green = lit(0x3dff6a);
  const red = lit(0xff3020);
  const blue = lit(0x3a6bff);
  const fixture = new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.6 });

  // ---- runway pavement, blast pads, taxiway, apron ----
  decal(b, m.asphalt, cx, y + 0.02, zc, len, WIDTH);
  surface.fillRect(a.x0, zc - HALF - 1, a.x1, zc + HALF + 1, ASPHALT);
  // Blast pads before each threshold, yellow chevrons pointing at the runway.
  for (const dir of [1, -1]) {
    const xT = dir > 0 ? a.x0 : a.x1;
    decal(b, m.asphalt, xT - dir * 30, y + 0.019, zc, 60, WIDTH);
    surface.fillRect(Math.min(xT, xT - dir * 60), zc - HALF, Math.max(xT, xT - dir * 60), zc + HALF, ASPHALT);
    for (let k = 0; k < 3; k++) {
      const s = 5 + k * 14;
      const reach = HALF - 1.5;
      for (const side of [-1, 1]) {
        // Each half chevron: a stripe from the centre line back to the edge, the point at the runway.
        const l = reach / Math.cos(0.785);
        const ang = side * dir * 0.785;
        decal(b, yellow, xT - dir * (s + reach / 2), y + 0.03, zc + side * reach / 2, 1.2, l, Math.PI / 2 + ang);
      }
    }
  }

  // ---- runway markings, for each end ----
  const along = (xT: number, dir: number, s: number): number => xT + dir * s;
  const digits = new Map<string, THREE.MeshStandardMaterial>();
  for (const [dir, num] of [[1, '09'], [-1, '27']] as const) {
    const xT = dir > 0 ? a.x0 : a.x1;
    // Threshold line and the twelve threshold stripes.
    decal(b, paint, along(xT, dir, 1.2), y + 0.03, zc, 1.8, WIDTH - 1);
    for (const side of [-1, 1]) for (let k = 0; k < 6; k++) decal(b, paint, along(xT, dir, 6 + 15), y + 0.03, zc + side * (2.7 + k * 3.6), 30, 1.8);
    // Designator, read from the approach.
    let mat = digits.get(num);
    if (!mat) {
      mat = new THREE.MeshStandardMaterial({ map: designatorTexture(num), transparent: true, alphaTest: 0.4, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -4 });
      digits.set(num, mat);
    }
    b.add(new THREE.PlaneGeometry(10, 13.5).rotateX(-Math.PI / 2), mat, along(xT, dir, 54), y + 0.03, zc, -dir * Math.PI / 2, 0, 0, false);
    // Touchdown zone: three, then (past the aiming point) two and one stripes each side.
    for (const [s, n] of [[150, 3], [450, 2], [600, 1]] as const) {
      for (const side of [-1, 1]) for (let k = 0; k < n; k++) decal(b, paint, along(xT, dir, s + 11.25), y + 0.03, zc + side * (9.9 + k * 3.3), 22.5, 1.8);
    }
    // Aiming point markings.
    for (const side of [-1, 1]) decal(b, paint, along(xT, dir, 250 + 22.5), y + 0.03, zc + side * 12, 45, 6);
  }
  // Centre line: 30 m stripes, 20 m gaps, between the designators.
  for (let s = 66; s + 30 <= len - 66; s += 50) decal(b, paint, a.x0 + s + 15, y + 0.03, zc, 30, 0.9);
  // Edge lines.
  for (const side of [-1, 1]) decal(b, paint, cx, y + 0.03, zc + side * (HALF - 0.6), len, 0.9);

  // ---- lights ----
  const light = (x: number, z: number, mat: THREE.Material, h = 0.3): void => {
    b.add(new THREE.CylinderGeometry(0.09, 0.12, h, 6), fixture, x, y + h / 2, z, 0, 0, 0, false);
    b.add(new THREE.SphereGeometry(0.13, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), mat, x, y + h, z, 0, 0, 0, false);
  };
  // Edge lights every 60 m, a metre outside the edge.
  for (let s = 0; s <= len + 0.1; s += 60) for (const side of [-1, 1]) light(a.x0 + s, zc + side * (HALF + 1), white);
  for (const dir of [1, -1]) {
    const xT = dir > 0 ? a.x0 : a.x1;
    // Threshold lights (green, facing the approach) and runway end lights (red, facing the runway).
    for (let k = -HALF + 1.5; k <= HALF - 1.4; k += 3) {
      light(xT - dir * 0.8, zc + k, green, 0.25);
      light(xT + dir * 0.6, zc + k + 1.5, red, 0.2);
    }
    // Approach lights on the blast pad: a centre row of bars and a crossbar.
    for (let s = 15; s <= 60; s += 15) for (let k = -2; k <= 2; k++) light(xT - dir * s, zc + k * 1.1, white, 0.35);
    for (let k = -10; k <= 10; k += 1.5) if (Math.abs(k) > 3) light(xT - dir * 30, zc + k, white, 0.35);
  }
  // Taxiway edge lights (blue) and holding points.
  const tz = zc + 66;
  const links = [a.x0 + 70, cx, a.x1 - 70];
  const apron = { x0: 690 - 130, x1: 690 + 130 };
  for (let x = a.x0 + 60; x <= a.x1 - 60; x += 30) {
    for (const side of [-1, 1]) {
      // Not across the openings to the links (runway side) or to the apron.
      if (side < 0 && links.some((lx) => Math.abs(x - lx) < 11)) continue;
      if (side > 0 && x > apron.x0 - 3 && x < apron.x1 + 3) continue;
      light(x, tz + side * 9, blue, 0.3);
    }
  }

  // ---- PAPI: four units left of each runway, abeam the aiming point ----
  const papi: { x: number; y: number; z: number; dir: number; deg: number; mat: THREE.MeshBasicMaterial }[] = [];
  const papiGroup = new THREE.Group();
  for (const dir of [1, -1]) {
    const xT = dir > 0 ? a.x0 : a.x1;
    // Left of the landing direction: -z landing east (09), +z landing west (27).
    const left = dir > 0 ? -1 : 1;
    for (let i = 0; i < 4; i++) {
      const x = along(xT, dir, PAPI_AT);
      const z = zc + left * (HALF + 15 + i * 6);
      b.add(new THREE.BoxGeometry(0.7, 0.55, 1.3), m.white, x, y + 0.6, z, 0, 0, 0);
      b.add(new THREE.BoxGeometry(0.12, 0.35, 0.12), m.metal, x, y + 0.17, z - 0.45);
      b.add(new THREE.BoxGeometry(0.12, 0.35, 0.12), m.metal, x, y + 0.17, z + 0.45);
      b.collideBox(x, y + 0.45, z, 0.35, 0.45, 0.65);
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const face = new THREE.Mesh(new THREE.CircleGeometry(0.22, 12), mat);
      face.position.set(x - dir * 0.36, y + 0.62, z);
      face.rotation.y = -dir * Math.PI / 2;
      papiGroup.add(face);
      papi.push({ x, y: y + 0.62, z, dir, deg: PAPI_DEG[i]!, mat });
    }
  }
  group.add(papiGroup);

  // ---- windsocks, near each threshold: calm air, the sock hangs down, leaning west ----
  const orange = new THREE.MeshStandardMaterial({ color: 0xff6a10, roughness: 0.8, side: THREE.DoubleSide });
  const sockWhite = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.8, side: THREE.DoubleSide });
  for (const [wx, wz] of [[a.x0 + 120, zc - 52], [a.x1 - 120, zc + 46]] as const) {
    b.box(wx, y + 3.2, wz, 0.14, 6.4, 0.14, m.metal, 0, 0, true);
    b.add(new THREE.TorusGeometry(0.46, 0.04, 6, 16).rotateY(Math.PI / 2), m.metal, wx - 0.3, y + 6.2, wz);
    // Five tapering bands, hanging from the ring.
    const droop = 1.05;
    for (let k = 0; k < 5; k++) {
      const r0 = 0.45 - k * 0.055;
      const r1 = r0 - 0.055;
      const l = 0.72;
      const d = 0.3 + l * (k + 0.5);
      const seg = new THREE.CylinderGeometry(r1, r0, l, 12, 1, true).rotateZ(Math.PI / 2 + droop);
      b.add(seg, k % 2 === 0 ? orange : sockWhite, wx - Math.cos(droop) * d, y + 6.2 - Math.sin(droop) * d, wz, 0, 0, 0, false);
    }
  }

  // ---- taxiway, links, holding points, signs ----
  decal(b, m.asphalt, cx, y + 0.02, tz, len - 120, 16);
  surface.fillRect(a.x0 + 60, tz - 8, a.x1 - 60, tz + 8, ASPHALT);
  decal(b, yellow, cx, y + 0.031, tz, len - 120, 0.3);
  const holdSign = new THREE.MeshStandardMaterial({ map: signTexture('09-27', '#c8102e', '#ffffff'), roughness: 0.6 });
  const locSign = new THREE.MeshStandardMaterial({ map: signTexture('A', '#111111', '#ffd200'), roughness: 0.6 });
  for (const x of links) {
    decal(b, m.asphalt, x, y + 0.021, (zc + tz) / 2, 16, tz - zc - 30);
    surface.fillRect(x - 8, zc, x + 8, tz, ASPHALT);
    // Yellow centre line from the taxiway onto the runway centre line.
    decal(b, yellow, x, y + 0.031, (zc + HALF + tz) / 2, 0.3, tz - zc - HALF);
    for (const side of [-1, 1]) light(x + side * 9, (zc + tz) / 2 + 8, blue, 0.3);
    // Holding position 33 m from the runway centre line: two solid lines on the taxiway side, two dashed.
    const hz = zc + 33;
    for (let k = 0; k < 2; k++) decal(b, yellow, x, y + 0.032, hz + 1.2 + k * 0.6, 15, 0.3);
    for (let k = 0; k < 2; k++) for (let dx = -6.75; dx <= 6.8; dx += 2.25) decal(b, yellow, x + dx, y + 0.032, hz - k * 0.6, 1.2, 0.3);
    // Signs on the left of a pilot coming from the taxiway (facing -z): the runway sign and the taxiway name.
    const sx = x - 11;
    const sz = hz + 2;
    b.box(sx, y + 0.45, sz, 0.08, 0.9, 0.08, m.metal, 0, 0, false);
    b.box(sx + 1.6, y + 0.45, sz, 0.08, 0.9, 0.08, m.metal, 0, 0, false);
    b.add(new THREE.BoxGeometry(3.4, 0.95, 0.22), m.concrete, sx + 0.8, y + 1.25, sz);
    b.collideBox(sx + 0.8, y + 0.85, sz, 1.7, 0.85, 0.15);
    b.add(new THREE.PlaneGeometry(2.0, 0.85), holdSign, sx + 0.25, y + 1.25, sz + 0.115, 0, 0, 0, false);
    b.add(new THREE.PlaneGeometry(1.2, 0.85), locSign, sx + 1.85, y + 1.25, sz + 0.115, 0, 0, 0, false);
  }

  // ---- apron: parking stands with yellow lead-in lines, hangars, tower ----
  const ax = 690;
  decal(b, m.asphalt, ax, y + 0.022, tz + 40, 260, 64);
  surface.fillRect(ax - 130, tz, ax + 130, tz + 72, ASPHALT);
  decal(b, yellow, ax, y + 0.031, tz + 9.5, 250, 0.3);
  const stands: Airfield['stands'] = [];
  for (let k = 0; k < 4; k++) {
    const x = ax - 75 + k * 30;
    const z = tz + 36;
    // Lead-in line from the apron edge line to the stand, the stop bar across it.
    decal(b, yellow, x, y + 0.031, (tz + 9.5 + z) / 2, 0.3, z - tz - 9.5);
    decal(b, yellow, x, y + 0.032, z - 2.3, 3, 0.4);
    // Tie-down rings either side of the wings.
    for (const side of [-1, 1]) b.add(new THREE.TorusGeometry(0.15, 0.03, 4, 8).rotateX(Math.PI / 2), m.metal, x + side * 4.5, y + 0.04, z + 0.6, 0, 0, 0, false);
    // Nose to the north (towards the runway), parked aircraft face the taxiway.
    if (k === 0 || k === 2) stands.push({ x, z, yaw: Math.PI });
  }
  // Hangars with arched roofs on the apron's west and east ends.
  for (const hx of [ax - 160, ax + 160]) {
    const hz = tz + 46;
    b.add(tiledBox(36, 7, 30, 3, 2), m.metal, hx, y + 3.5, hz);
    b.collideBox(hx, y + 6, hz, 18, 6, 15);
    const arch = new THREE.CylinderGeometry(18, 18, 30, 20, 1, true, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2).scale(1, 0.38, 1);
    b.add(arch, m.metal, hx, y + 7, hz);
    b.add(new THREE.BoxGeometry(30, 6.2, 0.2), m.concrete, hx, y + 3.2, hz - 15.05, 0, 0, 0, false);
  }
  // Control tower.
  const tx = ax + 150;
  const tzz = tz + 14;
  b.add(new THREE.CylinderGeometry(2.4, 2.8, 18, 12), m.concrete, tx, y + 9, tzz);
  b.collideCylinder(tx, y + 9, tzz, 9, 2.8);
  b.add(new THREE.CylinderGeometry(4.4, 3.6, 3.6, 8), m.glass, tx, y + 19.8, tzz);
  b.add(new THREE.CylinderGeometry(4.8, 4.8, 0.6, 8), m.white, tx, y + 21.9, tzz);
  // Rotating-beacon mast and antenna on the cab roof.
  b.add(new THREE.CylinderGeometry(0.06, 0.06, 4, 6), m.metal, tx + 1.5, y + 24.2, tzz);
  b.add(new THREE.SphereGeometry(0.3, 10, 8), green, tx - 1.2, y + 22.5, tzz);

  b.build(group);
  spots.push({ name: 'Airfield runway', x: a.x0 + 40, y, z: zc, yaw: Math.PI / 2 });
  // The aircraft waits on the centre line past the threshold stripes, lined up for runway 27: it
  // takes off to the west, over the farmland (east of the airfield the hills rise to 180 m).
  spots.push({ name: 'SR22', x: a.x1 - 62, y, z: zc, yaw: -Math.PI / 2 });

  const off = new THREE.Color(0x222222);
  const whiteC = new THREE.Color(0xffffff);
  const redC = new THREE.Color(0xff2a1a);
  return {
    group,
    spots,
    stands,
    update(cam) {
      for (const p of papi) {
        // Seen from the approach side only; white above the unit's angle, red below.
        const ahead = (p.x - cam.x) * p.dir;
        if (ahead <= 1) {
          p.mat.color.copy(off);
          continue;
        }
        const angle = (Math.atan2(cam.y - p.y, Math.hypot(ahead, cam.z - p.z)) * 180) / Math.PI;
        p.mat.color.copy(angle > p.deg ? whiteC : redC);
      }
    },
  };
}
