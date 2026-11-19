import { GameAudio } from './audio/audio';
import { Input } from './core/input';
import { createPhysics } from './core/physics';
import { DebugOverlay } from './debug/overlay';
import { CARS } from './game/catalog';
import { Game } from './game/Game';
import { CameraRig } from './render/camera';
import { loadCarTemplates } from './render/car/glb';
import { AdaptiveResolution } from './render/quality';
import { createScene } from './render/scene';
import { Garage } from './ui/garage';
import { Hud } from './ui/hud';
import { createGround } from './world/ground';
import { createMap } from './world/map';
import { createWorldProps } from './world/props';

/** Build every system, then hand them to the Game, which owns the frame loop. */
async function boot(): Promise<void> {
  const loading = document.getElementById('loading');
  const status = (s: string): void => {
    if (loading) loading.textContent = s;
  };
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const debug = new DebugOverlay(document.getElementById('debug')!);
  const hud = new Hud(document.getElementById('hud')!);
  const physics = await createPhysics();

  status('Loading cars…');
  await loadCarTemplates(CARS.map((c) => c.id), import.meta.env.BASE_URL, (n) => status(`Loading cars… ${n}/${CARS.length}`));

  const gs = createScene(canvas);
  const resolution = new AdaptiveResolution(gs.renderer);
  gs.scene.add(createGround(physics).group);
  const props = createWorldProps(physics);
  gs.scene.add(props.group);
  status('Building the city…');
  await new Promise((r) => setTimeout(r, 0));
  const map = createMap(physics);
  gs.scene.add(map.group);

  const rig = new CameraRig(gs.camera);
  rig.attachMouse(canvas);
  const audio = new GameAudio();
  audio.muted = false;

  const game = new Game({ physics, gs, map, props, input: new Input(), rig, hud, audio, debug, resolution });

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

  (window as unknown as { game: unknown }).game = game.debugApi();
  loading?.remove();
  gs.renderer.setAnimationLoop((now: number) => game.frame(now));
}

boot().catch((err) => {
  console.error(err);
  const el = document.getElementById('loading');
  if (el) el.textContent = `Failed to start: ${String(err)}`;
});
