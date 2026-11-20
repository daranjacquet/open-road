// Fit a car's physics geometry to its imported model.
// Usage: node scripts/fit-car-config.mjs <id>     (after art/import_car.py wrote art/build/<id>.measure.json)
//
// Rewrites, in src/vehicle/cars/<id>.json, only what depends on the body: wheel mounts, wheel size,
// the outline boxes (what other cars' rays hit), the hard core (colliders) and the crumple-ray grids
// of the lower body. Handling, engine and every tuning value are kept. Grid forces are kept in order.
// The cabin boxes only bound the passenger cell: the game fits it to the model at runtime, with its
// own crumple rays (src/damage/cabin.ts).
import { readFileSync, writeFileSync } from 'node:fs';

const id = process.argv[2];
if (!id) throw new Error('usage: node scripts/fit-car-config.mjs <id>');
const m = JSON.parse(readFileSync(`art/build/${id}.measure.json`, 'utf8'));
const path = `src/vehicle/cars/${id}.json`;
const cfg = JSON.parse(readFileSync(path, 'utf8'));
const r3 = (v) => Math.round(v * 1000) / 1000;
const vec = (...a) => a.map(r3);

// Crumple depth: how far inside the visible shell the hard core starts.
const DEPTH = { front: 0.72, rear: 0.62, side: 0.15, roof: 0.12 };

const L = m.lower;
const C = m.cabin;
// Outline: the visible shell, lower body and cabin.
const out0 = { cx: 0, cy: (L.y0 + L.y1 + 0.03) / 2, cz: (L.z0 + L.z1) / 2, hx: L.halfX + 0.03, hy: (L.y1 + 0.03 - L.y0) / 2, hz: (L.z1 - L.z0) / 2 };
const out1 = { cx: 0, cy: (C.y0 + C.y1) / 2, cz: (C.z0 + C.z1) / 2, hx: C.halfX, hy: (C.y1 - C.y0) / 2, hz: (C.z1 - C.z0) / 2 };
// Hard core: the outline shrunk by the crumple depths.
const coreLow = {
  // Behind the door skins (between the axles), not the wheel-arch flares.
  x: Math.min(out0.hx, L.halfXMid ?? out0.hx) - DEPTH.side,
  y0: L.y0 + 0.03,
  y1: L.y1 - 0.12,
  z0: L.z0 + DEPTH.rear,
  z1: L.z1 - DEPTH.front,
};
const cl = { cy: (coreLow.y0 + coreLow.y1) / 2, hy: (coreLow.y1 - coreLow.y0) / 2, cz: (coreLow.z0 + coreLow.z1) / 2, hz: (coreLow.z1 - coreLow.z0) / 2 };
const coreCab = { x: out1.hx - 0.1, y0: coreLow.y1 - 0.02, y1: C.y1 - DEPTH.roof, cz: out1.cz, hz: Math.max(out1.hz - 0.15, 0.4) };
const cc = { cy: (coreCab.y0 + coreCab.y1) / 2, hy: (coreCab.y1 - coreCab.y0) / 2 };

const w = m.wheels;
// Symmetric per axle (models are rarely exactly symmetric).
const tf = (Math.abs(w.FL[0]) + Math.abs(w.FR[0])) / 2;
const tr = (Math.abs(w.RL[0]) + Math.abs(w.RR[0])) / 2;
const zf = (w.FL[2] + w.FR[2]) / 2;
const zr = (w.RL[2] + w.RR[2]) / 2;
cfg.wheels = { FL: vec(tf, 0, zf), FR: vec(-tf, 0, zf), RL: vec(tr, 0, zr), RR: vec(-tr, 0, zr) };
const r0 = cfg.wheel.radius;
cfg.wheel.inertia = r3(cfg.wheel.inertia * (m.wheelRadius / r0) ** 2 * (m.wheelWidth / cfg.wheel.width));
// Same road speed per rpm and the same braking force with a different wheel size.
const k = m.wheelRadius / r0;
cfg.gearbox.finalDrive = r3(cfg.gearbox.finalDrive * k);
cfg.brakes.torque = Math.round(cfg.brakes.torque * k);
cfg.brakes.handbrakeTorque = Math.round(cfg.brakes.handbrakeTorque * k);
cfg.wheel.radius = r3(m.wheelRadius);
cfg.wheel.width = r3(m.wheelWidth);
delete cfg.tireWidth;

cfg.outline = [
  { center: vec(0, out0.cy, out0.cz), half: vec(out0.hx, out0.hy, out0.hz) },
  { center: vec(0, out1.cy, out1.cz), half: vec(out1.hx, out1.hy, out1.hz) },
];
cfg.colliders = [
  { center: vec(0, cl.cy, cl.cz), half: vec(coreLow.x, cl.hy, cl.hz) },
  { center: vec(0, cc.cy, coreCab.cz), half: vec(coreCab.x, cc.hy, coreCab.hz) },
];

const forces = cfg.crush.map((g) => g.force);
const elastics = cfg.crush.map((g) => g.elastic);
const vLow = cl.hy * 0.83;
const grid = (kind, origin, u, v, nu, nv, dir) => ({ kind, origin: vec(...origin), u: vec(...u), v: vec(...v), nu, nv, dir: vec(...dir) });
cfg.crush = [
  grid('front', [0, cl.cy, coreLow.z1], [coreLow.x - 0.03, 0, 0], [0, vLow, 0], 7, 4, [0, 0, 1]),
  grid('rear', [0, cl.cy, coreLow.z0], [coreLow.x - 0.03, 0, 0], [0, vLow, 0], 7, 4, [0, 0, -1]),
  grid('left', [coreLow.x, cl.cy, cl.cz], [0, 0, cl.hz - 0.12], [0, vLow, 0], 11, 3, [1, 0, 0]),
  grid('right', [-coreLow.x, cl.cy, cl.cz], [0, 0, cl.hz - 0.12], [0, vLow, 0], 11, 3, [-1, 0, 0]),
  grid('roof', [0, coreLow.y1, coreLow.z1 - 0.35], [coreLow.x * 0.6, 0, 0], [0, 0, 0.3], 3, 3, [0, 1, 0]),
  grid('roof', [0, coreLow.y1, coreLow.z0 + 0.3], [coreLow.x * 0.6, 0, 0], [0, 0, 0.25], 3, 2, [0, 1, 0]),
  grid('corner', [coreLow.x - 0.1, cl.cy, coreLow.z1 - 0.08], [0, 0, 0], [0, vLow, 0], 1, 3, [0.7, 0, 0.7]),
  grid('corner', [coreLow.x - 0.1, cl.cy, coreLow.z0 + 0.08], [0, 0, 0], [0, vLow, 0], 1, 3, [0.7, 0, -0.7]),
  grid('corner', [-(coreLow.x - 0.1), cl.cy, coreLow.z1 - 0.08], [0, 0, 0], [0, vLow, 0], 1, 3, [-0.7, 0, 0.7]),
  grid('corner', [-(coreLow.x - 0.1), cl.cy, coreLow.z0 + 0.08], [0, 0, 0], [0, vLow, 0], 1, 3, [-0.7, 0, -0.7]),
  // Fans over the overhangs, from the top edges of the core: bonnet front, grille, boot lid.
  ...[1, -1].flatMap((s) =>
    [20, 45, 70].map((a) => {
      const t = (a * Math.PI) / 180;
      return grid('roof', [0, coreLow.y1, s > 0 ? coreLow.z1 : coreLow.z0], [coreLow.x - 0.1, 0, 0], [0, 0, 0], 5, 1, [0, Math.cos(t), s * Math.sin(t)]);
    }),
  ),
];
cfg.crush.forEach((g, i) => {
  g.force = forces[i] ?? forces[forces.length - 1];
  if (elastics[i] !== undefined) g.elastic = elastics[i];
});
// inertiaBox is a handling value (mass distribution), not geometry: kept.

writeFileSync(path, JSON.stringify(cfg, null, 2) + '\n');
console.log(`${id}: wheelbase ${r3(cfg.wheels.FL[2] - cfg.wheels.RL[2])} m, track ${r3(cfg.wheels.FL[0] * 2)} m, wheel r ${cfg.wheel.radius} m, length ${r3(out0.hz * 2)} m, core ${JSON.stringify(cfg.colliders)}`);
