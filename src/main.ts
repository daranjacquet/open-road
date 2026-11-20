import * as THREE from 'three';
import { GameAudio } from './audio/audio';
import { Input } from './core/input';
import { createPhysics } from './core/physics';
import { DebugOverlay } from './debug/overlay';
import { CARS, carById } from './game/catalog';
import { Game } from './game/Game';
import { CameraRig } from './render/camera';
import { buildCarModel } from './render/car';
import { loadCarTemplates } from './render/car/glb';
import { AdaptiveResolution } from './render/quality';
import { createScene } from './render/scene';
import { Garage } from './ui/garage';
import { Hud } from './ui/hud';
import { createGround } from './world/ground';
import { createMap } from './world/map';
import { createWorldProps } from './world/props';

/** Boot phases and their duration (ms), logged once and exposed as `window.game.boot`. */
const bootTimes: Record<string, number> = {};
let lastMark = performance.now();
function mark(phase: string): void {
  const now = performance.now();
  bootTimes[phase] = Math.round(now - lastMark);
  lastMark = now;
}

function showFatal(message: string): void {
  const fatal = document.getElementById('fatal');
  if (!fatal) return;
  const text = fatal.querySelector<HTMLElement>('[data-fatal-message]');
  if (text) text.textContent = message;
  fatal.style.display = 'grid';
}

/** Build every system, then hand them to the Game, which owns the frame loop. */
async function boot(): Promise<void> {
  const loading = document.getElementById('loading');
  const status = (s: string): void => {
    if (loading) loading.textContent = s;
  };
  mark('scripts');
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const debug = new DebugOverlay(document.getElementById('debug')!);
  const hud = new Hud(document.getElementById('hud')!);
  status('Loading cars…');
  // Only the cars on screen at start: the saved car and the two parked ones. The rest loads later.
  const needed = [...new Set([carById(Game.savedCarId()).id, CARS[0]!.id, CARS[1]!.id])];
  let shownPct = 0;
  const [physics] = await Promise.all([
    createPhysics(),
    loadCarTemplates(needed, import.meta.env.BASE_URL, (loadedBytes, totalBytes) => {
      // Never above 99 % (compressed sizes) and never backwards (sizes arrive one by one).
      const pct = totalBytes > 0 ? Math.min(99, Math.floor((loadedBytes / totalBytes) * 100)) : 0;
      shownPct = Math.max(shownPct, pct);
      status(totalBytes > 0 ? `Loading… ${shownPct} %` : 'Loading cars…');
    }),
  ]);
  mark('physics+cars');

  const gs = createScene(canvas);
  const resolution = new AdaptiveResolution(gs.renderer);
  gs.scene.add(createGround(physics).group);
  const props = createWorldProps(physics);
  gs.scene.add(props.group);
  mark('scene');
  status('Building the city…');
  await new Promise((r) => setTimeout(r, 0));
  const map = createMap(physics);
  gs.scene.add(map.group);
  mark('map');

  const rig = new CameraRig(gs.camera);
  rig.attachMouse(canvas);
  const audio = new GameAudio();
  audio.muted = false;

  const game = new Game({ physics, gs, map, props, input: new Input(), rig, hud, audio, debug, resolution });
  mark('cars-built');

  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    game.paused = true;
    showFatal('The graphics context was lost (GPU reset or driver update).');
  });

  // Garage panel: car choice, setups, settings, repair, teleports, graphics.
  const garage = new Garage(() => game.player, (id) => game.swapCar(id));
  game.garage = garage;
  garage.gui.add({ repair: () => game.repair() }, 'repair').name('Repair (F)');
  const go = garage.gui.addFolder('Go to (T)');
  for (const loc of map.locations) go.add({ [loc.name]: () => game.teleport(loc) }, loc.name);
  go.close();
  const gfx = garage.gui.addFolder('Graphics');
  const gfxState = { resolution: 'auto' };
  gfx
    .add(gfxState, 'resolution', ['auto', '0.6', '0.8', '1', '1.25', '1.5', '2'])
    .name('Resolution scale')
    .onChange((v: string) => (resolution.fixed = v === 'auto' ? null : Number(v)));
  gfx.close();

  status('Preparing graphics…');
  try {
    await gs.renderer.compileAsync(gs.scene, gs.camera);
  } catch (err) {
    console.warn('[boot] Shader compilation failed; it will happen on first render.', err);
  }
  mark('shaders');
  // Upload every texture now rather than on the first frame.
  const textures = new Set<THREE.Texture>();
  gs.scene.traverse((o) => {
    const mats = (o as THREE.Mesh).material;
    for (const m of Array.isArray(mats) ? mats : mats ? [mats] : []) {
      for (const v of Object.values(m)) if (v instanceof THREE.Texture) textures.add(v);
    }
  });
  for (const t of textures) gs.renderer.initTexture(t);
  mark('textures');

  // Keep the API object as is (its getters stay live) and add the boot timings to it.
  (window as unknown as { game: unknown }).game = Object.assign(game.debugApi(), { boot: bootTimes });
  loading?.remove();
  let first = true;
  gs.renderer.setAnimationLoop((now: number) => {
    game.frame(now);
    if (first) {
      first = false;
      mark('first-frame');
      console.info('[boot]', JSON.stringify(bootTimes));
      const deferred = CARS.map((car) => car.id).filter((id) => !needed.includes(id));
      void (async () => {
        try {
          await loadCarTemplates(deferred, import.meta.env.BASE_URL);
          const tmp = new THREE.Scene();
          const models = deferred.map((id) => buildCarModel(id));
          for (const model of models) tmp.add(model.root);
          // Compile with the game scene's lights and environment so the programs match.
          await gs.renderer.compileAsync(tmp, gs.camera, gs.scene);
          for (const model of models) model.dispose();
        } catch (err) {
          console.warn('[boot] Deferred car loading or shader compilation failed.', err);
        }
      })();
    }
  });
}

boot().catch((err) => {
  console.error(err);
  showFatal(`Failed to start: ${String(err)}`);
});
