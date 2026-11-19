import * as THREE from 'three';
import { FixedStepper, type StepResult } from './core/loop';
import { createPhysics, FIXED_DT } from './core/physics';
import { DebugOverlay } from './debug/overlay';
import { createScene } from './render/scene';
import { createGround } from './world/ground';

async function boot(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const debug = new DebugOverlay(document.getElementById('debug')!);
  const physics = await createPhysics();
  const gs = createScene(canvas);
  gs.scene.add(createGround(physics).group);

  // Milestone-1 smoke test: a box dropped on the ground proves physics + render sync.
  const { RAPIER, world } = physics;
  const cubeBody = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 6, 6).setRotation({ x: 0.2, y: 0.1, z: 0.3, w: 0.93 }));
  world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5).setRestitution(0.35).setFriction(0.8), cubeBody);
  const cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xd9381e, roughness: 0.45 }));
  cube.castShadow = true;
  gs.scene.add(cube);
  const prevP = new THREE.Vector3(0, 6, 6);
  const currP = prevP.clone();
  const prevQ = new THREE.Quaternion();
  const currQ = new THREE.Quaternion();

  const stepper = new FixedStepper(FIXED_DT);
  const res: StepResult = { steps: 0, alpha: 0 };
  let physMs = 0;
  let last = performance.now();
  let t = 0;

  document.getElementById('loading')?.remove();

  gs.renderer.setAnimationLoop((now: number) => {
    const frameDt = Math.min((now - last) / 1000, 0.1);
    last = now;
    t += frameDt;
    stepper.advance(frameDt, res);
    const p0 = performance.now();
    for (let i = 0; i < res.steps; i++) {
      prevP.copy(currP);
      prevQ.copy(currQ);
      physics.step();
      const tr = cubeBody.translation();
      const ro = cubeBody.rotation();
      currP.set(tr.x, tr.y, tr.z);
      currQ.set(ro.x, ro.y, ro.z, ro.w);
    }
    physMs = res.steps > 0 ? (performance.now() - p0) / res.steps : physMs;

    cube.position.lerpVectors(prevP, currP, res.alpha);
    cube.quaternion.slerpQuaternions(prevQ, currQ, res.alpha);

    // Slow orbit camera for the skeleton milestone.
    gs.camera.position.set(Math.sin(t * 0.15) * 14, 5, 6 + Math.cos(t * 0.15) * 14);
    gs.camera.lookAt(0, 0.5, 6);
    gs.followSun(cube.position);

    gs.renderer.render(gs.scene, gs.camera);

    debug.set('physics', `${physMs.toFixed(2)} ms/step @ ${(1 / FIXED_DT).toFixed(0)} Hz`);
    debug.set('draw calls', String(gs.renderer.info.render.calls));
    debug.set('triangles', String(gs.renderer.info.render.triangles));
    debug.frame(frameDt, now);
  });
}

boot().catch((err) => {
  console.error(err);
  const el = document.getElementById('loading');
  if (el) el.textContent = `Failed to start: ${String(err)}`;
});
