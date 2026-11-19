import GUI from 'lil-gui';

import { FixedStepper, type StepResult } from './core/loop';
import { Input } from './core/input';
import { createPhysics, FIXED_DT } from './core/physics';
import { DebugOverlay } from './debug/overlay';
import { CameraRig } from './render/camera';
import { buildCarModel } from './render/car';
import { buildCrushRays } from './damage/rays';
import { DamageModel } from './damage/DamageModel';
import { Deformer } from './damage/Deformer';
import { Effects } from './render/effects';
import { PartsManager } from './damage/PartsManager';
import { createWorldProps } from './world/props';
import { createScene } from './render/scene';
import { VehicleView } from './render/VehicleView';
import { Hud } from './ui/hud';
import { Vehicle } from './vehicle/Vehicle';
import sportCfg from './vehicle/cars/sport.json';
import type { VehicleConfig } from './vehicle/types';
import { createGround } from './world/ground';

const SPAWN = { x: 0, z: -120, yaw: 0 };

async function boot(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const debug = new DebugOverlay(document.getElementById('debug')!);
  const hud = new Hud(document.getElementById('hud')!);
  const physics = await createPhysics();
  const gs = createScene(canvas);
  gs.scene.add(createGround(physics).group);
  const props = createWorldProps(physics);
  gs.scene.add(props.group);

  const cfg = sportCfg as unknown as VehicleConfig;
  const car = new Vehicle(physics, cfg, SPAWN.x, SPAWN.z, SPAWN.yaw);
  const model = buildCarModel(cfg);
  gs.scene.add(model.root);
  const view = new VehicleView(car, model);
  const crush = car.attachCrush(buildCrushRays(cfg, model));
  const deformer = new Deformer(crush, model.parts);
  const damage = new DamageModel(car, crush);
  const effects = new Effects(car, damage);
  gs.scene.add(effects.group);
  const parts = new PartsManager(physics, gs.scene, car, model, crush, deformer, damage);
  parts.onGlassBreak = (p) => effects.glassBurst(p);
  const repair = (): void => {
    parts.repair();
    crush.reset();
    deformer.reset();
    damage.reset();
  };
  const rig = new CameraRig(gs.camera);
  const input = new Input();

  // Small assists menu.
  const gui = new GUI({ title: 'Driving aids' });
  gui.add(car.assists, 'tc').name('Traction control');
  gui.add(car.assists, 'abs').name('ABS');
  gui.add(car.assists, 'esp').name('ESP');
  gui.close();

  const stepper = new FixedStepper(FIXED_DT);
  const res: StepResult = { steps: 0, alpha: 0 };
  let physMs = 0;
  let last = performance.now();

  document.getElementById('loading')?.remove();

  /** Run the simulation for `seconds` of game time without waiting for frames (automated checks). */
  const advance = (seconds: number, drive?: () => { throttle: number; brake: number; steer: number; handbrake: number }): void => {
    const n = Math.round(seconds / FIXED_DT);
    for (let i = 0; i < n; i++) {
      car.fixedUpdate(FIXED_DT, drive ? drive() : input.out);
      physics.step();
      car.afterPhysicsStep();
      if (i % 4 === 0) {
        damage.update();
        deformer.update(performance.now() + i);
        parts.update();
        effects.update(FIXED_DT * 4, gs.renderer.domElement.clientHeight);
      }
    }
    damage.update();
    deformer.update(performance.now() + 1e6);
    parts.update();
    props.update();
    view.update(1);
  };

  /** Force one camera update + render now (automated screenshots). */
  const renderNow = (): void => {
    view.update(1);
    rig.update(0.05, car, view.pos, view.quat);
    effects.update(0.016, gs.renderer.domElement.clientHeight);
    gs.followSun(view.pos);
    gs.renderer.render(gs.scene, gs.camera);
  };

  // Expose for automated checks / debugging.
  (window as unknown as { game: unknown }).game = { car, physics, input, rig, crush, damage, deformer, repair, effects, parts, advance, renderNow };

  gs.renderer.setAnimationLoop((now: number) => {
    const frameDt = Math.min((now - last) / 1000, 0.1);
    last = now;

    const cmd = input.sample(frameDt);
    if (input.pressed('Shift+KeyR')) {
      repair();
      car.placeAt(SPAWN.x, 1.0, SPAWN.z, SPAWN.yaw);
    }
    else if (input.pressed('KeyR')) car.recover();
    if (input.pressed('KeyC')) rig.cycle();

    stepper.advance(frameDt, res);
    const p0 = performance.now();
    for (let i = 0; i < res.steps; i++) {
      car.fixedUpdate(FIXED_DT, cmd);
      physics.step();
      car.afterPhysicsStep();
    }
    if (res.steps > 0) physMs = (performance.now() - p0) / res.steps;

    damage.update();
    deformer.update(now);
    parts.update();
    props.update();
    effects.update(frameDt, gs.renderer.domElement.clientHeight);
    rig.shake = Math.max(rig.shake, effects.shake);
    effects.shake = 0;
    view.update(res.alpha);
    rig.update(frameDt, car, view.pos, view.quat);
    gs.followSun(view.pos);
    gs.renderer.render(gs.scene, gs.camera);

    hud.update(car, now);
    if (debug.isVisible) {
      debug.set('physics', `${physMs.toFixed(2)} ms/step @ ${(1 / FIXED_DT).toFixed(0)} Hz, ${res.steps} steps/frame`);
      debug.set('draw calls', `${gs.renderer.info.render.calls}, tris ${gs.renderer.info.render.triangles}`);
      debug.set('car', `${car.speedKmh.toFixed(0)} km/h, gear ${car.gear}, ${car.rpm.toFixed(0)} rpm, steer ${(car.steerAngle * 57.3).toFixed(1)} deg`);
      debug.set('yaw rate', `${car.yawRate.toFixed(2)} rad/s, tc ${car.tcActive ? 'ON' : '-'} abs ${car.absActive ? 'ON' : '-'} esp ${car.espActivity.toFixed(2)}`);
      const names = ['FL', 'FR', 'RL', 'RR'];
      car.wheels.forEach((w, i) => {
        debug.set(names[i]!, `Fz ${w.fz.toFixed(0)} N  slip k ${w.slipRatio.toFixed(2)} a ${(w.slipAngle * 57.3).toFixed(1)} deg  ${w.surface}${w.hit ? '' : ' (air)'}`);
      });
    }
    debug.frame(frameDt, now);
  });
}

boot().catch((err) => {
  console.error(err);
  const el = document.getElementById('loading');
  if (el) el.textContent = `Failed to start: ${String(err)}`;
});
