/**
 * Everything about the world that is pure computation: terrain, roads, ground cover, tree
 * positions and the overview picture. Built in a Web Worker during boot (in parallel with the
 * physics engine and the car downloads), on the main thread if workers are unavailable.
 */
import { Heightmap } from './heightmap';
import { CELL, CELLS } from './layout';
import { overviewPixels } from './overview';
import { paintGround } from './paint';
import { RoadLine, type RoadLineData } from './roadline';
import { scatterTrees } from './vegetation-scatter';
import { generateWorld } from './worldgen';

export interface WorldData {
  heights: Float32Array;
  roads: RoadLineData[];
  /** Ground cover per terrain vertex (see `GroundCover.splat`). */
  splat: Uint8Array;
  trees: Float32Array;
  overview: Uint8ClampedArray;
  /** Time spent on each step (ms). */
  times: Record<string, number>;
}

export function buildWorldData(): WorldData {
  const times: Record<string, number> = {};
  let t = performance.now();
  const lap = (name: string): void => {
    const now = performance.now();
    times[name] = Math.round(now - t);
    t = now;
  };
  const world = generateWorld(times);
  lap('terrain');
  const cover = paintGround(world.hm, world.roadEdge);
  lap('cover');
  const trees = scatterTrees(world.hm, cover, world.roadEdge);
  lap('trees');
  const overview = overviewPixels(world.hm, cover.splat);
  lap('overview');
  return { heights: world.hm.heights, roads: world.roads.map((r) => r.toData()), splat: cover.splat, trees, overview, times };
}

/** The buffers to move (not copy) out of the worker. */
export function transferList(d: WorldData): ArrayBuffer[] {
  const list = [d.heights, d.splat, d.trees, d.overview].map((a) => a.buffer as ArrayBuffer);
  for (const r of d.roads) list.push(...[r.x, r.z, r.y, r.tx, r.tz, r.ground, r.bridge].map((a) => a.buffer as ArrayBuffer));
  return list;
}

/** The world, rebuilt on the main thread from the worker's buffers. */
export function worldFromData(d: WorldData): { hm: Heightmap; roads: RoadLine[] } {
  return { hm: new Heightmap(CELLS, CELL, d.heights), roads: d.roads.map((r) => RoadLine.fromData(r)) };
}

/** Start building the world in a worker; falls back to the main thread if that fails. */
export function loadWorldData(): Promise<WorldData> {
  return new Promise((resolve) => {
    let worker: Worker;
    const fallback = (why: unknown): void => {
      console.warn('[world] Worker unavailable, building on the main thread.', why);
      worker?.terminate();
      resolve(buildWorldData());
    };
    try {
      worker = new Worker(new URL('./worldgen.worker.ts', import.meta.url), { type: 'module' });
    } catch (err) {
      fallback(err);
      return;
    }
    worker.onmessage = (e: MessageEvent<WorldData | { error: string }>) => {
      worker.terminate();
      if ('error' in e.data) fallback(e.data.error);
      else resolve(e.data);
    };
    worker.onerror = (e) => fallback(e.message);
  });
}
