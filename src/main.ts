import GUI from 'lil-gui';

import { FixedStepper, type StepResult } from './core/loop';
import { Input } from './core/input';
import { createPhysics, FIXED_DT } from './core/physics';
import { DebugOverlay } from './debug/overlay';
import { CameraRig } from './render/camera';
import { buildPlaceholderCar } from './render/placeholderCar';
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

  const cfg = sportCfg as unknown as VehicleConfig;
  const car = new Vehicle(physics, cfg, SPAWN.x, SPAWN.z, SPAWN.yaw);
  const model = buildPlaceholderCar(cfg);
  gs.scene.add(model.root);
  const view = new VehicleView(car, model);
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

  // Expose for automated checks / debugging.
  (window as unknown as { game: unknown }).game = { car, physics, input, rig };

  gs.renderer.setAnimationLoop((now: number) => {
    const frameDt = Math.min((now - last) / 1000, 0.1);
    last = now;

    const cmd = input.sample(frameDt);
    if (input.pressed('Shift+KeyR')) car.placeAt(SPAWN.x, 1.0, SPAWN.z, SPAWN.yaw);
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
