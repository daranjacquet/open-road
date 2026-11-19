import { FixedStepper, type StepResult } from './core/loop';
import { Input } from './core/input';
import { createPhysics, FIXED_DT } from './core/physics';
import { DebugOverlay } from './debug/overlay';
import { CameraRig } from './render/camera';
import { createScene } from './render/scene';
import { loadCarTemplates } from './render/car/glb';
import { CARS, carById } from './game/catalog';
import { GameCar, IDLE } from './game/GameCar';
import { GameAudio } from './audio/audio';
import { Hud } from './ui/hud';
import { Garage } from './ui/garage';
import { createGround } from './world/ground';
import { createWorldProps } from './world/props';
import { createMap, SPAWN, type Location } from './world/map';
import { LapTimer } from './game/laps';
import type { DriveInput } from './vehicle/Vehicle';


async function boot(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const debug = new DebugOverlay(document.getElementById('debug')!);
  const hud = new Hud(document.getElementById('hud')!);
  const physics = await createPhysics();
  // Blender-built cars (public/models/*.glb); missing files fall back to the procedural generator.
  const loading = document.getElementById('loading');
  if (loading) loading.textContent = 'Loading cars…';
  await loadCarTemplates(CARS.map((c) => c.id), import.meta.env.BASE_URL, (n) => {
    if (loading) loading.textContent = `Loading cars… ${n}/${CARS.length}`;
  });
  const gs = createScene(canvas);
  gs.scene.add(createGround(physics).group);
  const props = createWorldProps(physics);
  gs.scene.add(props.group);
  if (loading) loading.textContent = 'Building the city…';
  await new Promise((r) => setTimeout(r, 0));
  const map = createMap(physics);
  gs.scene.add(map.group);

  const saved = (() => {
    try {
      return localStorage.getItem('open-road:car') ?? 'sedan';
    } catch {
      return 'sedan';
    }
  })();

  let player = new GameCar(physics, gs.scene, carById(saved), SPAWN.x, SPAWN.z, SPAWN.yaw);
  // Parked cars to crash into.
  const dummies: GameCar[] = [
    new GameCar(physics, gs.scene, CARS[0]!, 0, 22, Math.PI, 0x8a8f96),
    new GameCar(physics, gs.scene, CARS[1]!, -15, -85, Math.PI / 2, 0xe0b020),
  ];
  const all = (): GameCar[] => [player, ...dummies];

  const rig = new CameraRig(gs.camera);
  rig.attachMouse(canvas);
  const input = new Input();
  const audio = new GameAudio();
  audio.muted = false;
  const hookAudio = (): void => player.damage.addImpactListener((i) => audio.impact(i));
  hookAudio();

  // Garage: setups and every setting, saved per car.
  const garage = new Garage(() => player, (id) => swapCar(id));

  // Lap timers, one per circuit, best laps saved per car.
  let timers: LapTimer[] = [];
  const makeTimers = (): void => {
    timers = map.tracks.map((t) => new LapTimer(t.line, `open-road:best:${t.line.def.id}:${player.def.id}`));
  };
  makeTimers();

  let locIndex = 0;
  /** Simulated seconds (lap times use physics time, not the wall clock). */
  let simTime = 0;
  const teleport = (loc: Location): void => {
    player.vehicle.placeAt(loc.x, 1.0, loc.z, loc.yaw);
    timers.forEach((t) => t.reset());
    hud.toast(loc.name);
  };
  /** Repair in place: body, glass, parts, engine and wheels, keeping position and speed. */
  const repairCar = (): void => {
    player.repair();
    hud.toast('Repaired', 1200);
  };
  hud.onRepair = repairCar;
  garage.gui.add({ repair: repairCar }, 'repair').name('Repair (F)');
  const go = garage.gui.addFolder('Go to (T)');
  for (const loc of map.locations) go.add({ [loc.name]: () => teleport(loc) }, loc.name);
  go.close();

  function swapCar(id: string): void {
    const t = player.vehicle.body.translation();
    const q = player.vehicle.currQuat;
    const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
    player.dispose();
    player = new GameCar(physics, gs.scene, carById(id), t.x, t.z, yaw);
    player.vehicle.placeAt(t.x, 1.0, t.z, yaw);
    garage.attach();
    hookAudio();
    makeTimers();
    rig.mode = rig.mode; // keep the current camera
    try {
      localStorage.setItem('open-road:car', id);
    } catch {
      /* storage unavailable: fine */
    }
  }

  const stepper = new FixedStepper(FIXED_DT);
  const res: StepResult = { steps: 0, alpha: 0 };
  let physMs = 0;
  let last = performance.now();

  document.getElementById('loading')?.remove();

  const driveInputFor = (c: GameCar, cmd: DriveInput): DriveInput => (c === player ? cmd : IDLE);

  /** Run the simulation for `seconds` of game time without waiting for frames (automated checks). */
  const advance = (seconds: number, drive?: () => DriveInput): void => {
    const n = Math.round(seconds / FIXED_DT);
    for (let i = 0; i < n; i++) {
      const cmd = drive ? drive() : input.out;
      for (const c of all()) c.fixedUpdate(FIXED_DT, driveInputFor(c, cmd));
      physics.step();
      for (const c of all()) c.vehicle.afterPhysicsStep();
      if (i % 4 === 0) for (const c of all()) c.updateVisuals(performance.now() + i, 1, FIXED_DT * 4, gs.renderer.domElement.clientHeight);
    }
    for (const c of all()) c.updateVisuals(performance.now() + 1e6, 1, 0.016, gs.renderer.domElement.clientHeight);
    props.update();
  };

  /** Force one camera update + render now (automated screenshots). */
  const renderNow = (): void => {
    for (const c of all()) c.view.update(1);
    rig.update(0.05, player.vehicle, player.view.pos, player.view.quat);
    gs.followSun(player.view.pos);
    gs.renderer.render(gs.scene, gs.camera);
  };

  /** Render once from a world-space camera position (automated screenshots of any car). */
  const renderFrom = (pos: [number, number, number], target: [number, number, number]): void => {
    for (const c of all()) c.view.update(1);
    gs.camera.position.set(...pos);
    gs.camera.lookAt(...target);
    gs.renderer.render(gs.scene, gs.camera);
  };

  // Expose for automated checks / debugging.
  const api = {
    /** Freeze the live loop (automated screenshots). */
    paused: false,
    get player() {
      return player;
    },
    dummies,
    physics,
    input,
    rig,
    advance,
    renderNow,
    renderFrom,
    swapCar,
    garage,
    map,
    teleport,
    repairCar,
  };
  (window as unknown as { game: unknown }).game = api;

  gs.renderer.setAnimationLoop((now: number) => {
    if (api.paused) {
      last = now;
      return;
    }
    const frameDt = Math.min(Math.max((now - last) / 1000, 0), 0.1);
    last = now;

    const cmd = input.sample(frameDt);
    if (input.pressed('Shift+KeyR')) player.respawn();
    else if (input.pressed('KeyR')) player.vehicle.recover();
    if (input.pressed('KeyC')) rig.cycle();
    if (input.pressed('KeyV')) {
      const i = CARS.findIndex((c) => c.id === player.def.id);
      swapCar(CARS[(i + 1) % CARS.length]!.id);
    }
    if (input.pressed('KeyB')) dummies.forEach((d) => d.respawn());
    if (input.pressed('KeyG')) garage.toggle();
    if (input.pressed('KeyF')) repairCar();
    if (input.pressed('KeyT')) {
      locIndex = (locIndex + 1) % map.locations.length;
      teleport(map.locations[locIndex]!);
    }
    if (input.pressed('KeyE')) player.vehicle.manual && player.vehicle.shiftUp();
    if (input.pressed('KeyQ')) player.vehicle.manual && player.vehicle.shiftDown();

    stepper.advance(frameDt, res);
    const p0 = performance.now();
    for (let i = 0; i < res.steps; i++) {
      for (const c of all()) c.fixedUpdate(FIXED_DT, driveInputFor(c, cmd));
      physics.step();
      for (const c of all()) c.vehicle.afterPhysicsStep();
    }
    if (res.steps > 0) physMs = (performance.now() - p0) / res.steps;
    simTime += res.steps * FIXED_DT;

    // Off the edge of the world: back to the start, repaired.
    const pt = player.vehicle.body.translation();
    if (map.isOutside(pt.x, pt.y, pt.z)) {
      player.repair();
      player.vehicle.placeAt(SPAWN.x, 1.0, SPAWN.z, SPAWN.yaw);
      timers.forEach((t) => t.reset());
      hud.toast('Out of the map - back to the start');
    }
    let lapShown = false;
    for (const t of timers) {
      const st = t.update(pt.x, pt.z, simTime);
      if (st.completed !== null) hud.toast(st.newBest ? `New best lap  ${(st.completed).toFixed(3)} s` : `Lap  ${st.completed.toFixed(3)} s`);
      if (st.onTrack && !lapShown) {
        hud.laps(t.line.def.name, st);
        lapShown = true;
      }
    }
    if (!lapShown) hud.laps(null, null);
    map.update(now / 1000);

    const vh = gs.renderer.domElement.clientHeight;
    for (const c of all()) c.updateVisuals(now, res.alpha, frameDt, vh);
    props.update();
    rig.shake = Math.max(rig.shake, player.effects.shake);
    player.effects.shake = 0;
    const car = player.vehicle;
    rig.update(frameDt, car, player.view.pos, player.view.quat);
    gs.followSun(player.view.pos);
    gs.renderer.render(gs.scene, gs.camera);

    hud.update(player, now);
    audio.update(car, now);
    if (debug.isVisible) {
      debug.set('physics', `${physMs.toFixed(2)} ms/step @ ${(1 / FIXED_DT).toFixed(0)} Hz, ${res.steps} steps/frame, ${all().length} cars`);
      debug.set('draw calls', `${gs.renderer.info.render.calls}, tris ${gs.renderer.info.render.triangles}`);
      debug.set('car', `${car.speedKmh.toFixed(0)} km/h, gear ${car.gear}, ${car.rpm.toFixed(0)} rpm, steer ${(car.steerAngle * 57.3).toFixed(1)} deg`);
      debug.set('yaw rate', `${car.yawRate.toFixed(2)} rad/s, tc ${car.tcActive ? 'ON' : '-'} abs ${car.absActive ? 'ON' : '-'} esp ${car.espActivity.toFixed(2)}`);
      const names = ['FL', 'FR', 'RL', 'RR'];
      car.wheels.forEach((w, i) => {
        debug.set(names[i]!, `Fz ${w.fz.toFixed(0)} N  slip k ${w.slipRatio.toFixed(2)} a ${(w.slipAngle * 57.3).toFixed(1)} deg  ${w.surface}${w.hit ? '' : ' (air)'}  dmg ${player.damage.wheel[i]!.toFixed(2)}`);
      });
      const dm = player.damage;
      debug.set('damage', `engine ${dm.engine.toFixed(2)} front ${dm.zone.front.toFixed(2)} rear ${dm.zone.rear.toFixed(2)} L ${dm.zone.left.toFixed(2)} R ${dm.zone.right.toFixed(2)} roof ${dm.zone.roof.toFixed(2)}`);
      debug.set('crush', `energy ${(player.crush.energy / 1000).toFixed(0)} kJ, rays active ${player.crush.active}, parts off ${player.parts.detached}`);
    }
    debug.frame(frameDt, now);
  });
}

boot().catch((err) => {
  console.error(err);
  const el = document.getElementById('loading');
  if (el) el.textContent = `Failed to start: ${String(err)}`;
});
