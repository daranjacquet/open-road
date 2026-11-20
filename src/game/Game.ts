import type { GameAudio } from '../audio/audio';
import { FixedStepper, type StepResult } from '../core/loop';
import type { Input } from '../core/input';
import { FIXED_DT, type Physics } from '../core/physics';
import type { DebugOverlay } from '../debug/overlay';
import type { CameraRig } from '../render/camera';
import { ensureCarTemplate, getCarTemplate } from '../render/car/glb';
import type { AdaptiveResolution } from '../render/quality';
import type { GameScene } from '../render/scene';
import type { Garage } from '../ui/garage';
import type { Hud } from '../ui/hud';
import type { DriveInput } from '../vehicle/Vehicle';
import type { GameMap, Location } from '../world/map';
import { SPAWN } from '../world/map';
import type { WorldProps } from '../world/props';
import { CARS, carById } from './catalog';
import { GameCar, IDLE } from './GameCar';
import { RaceSystem } from './race';

export interface GameDeps {
  physics: Physics;
  gs: GameScene;
  map: GameMap;
  props: WorldProps;
  input: Input;
  rig: CameraRig;
  hud: Hud;
  audio: GameAudio;
  debug: DebugOverlay;
  resolution: AdaptiveResolution;
  /** Unrecoverable error (the game is paused): show it to the player. */
  onFatal?: (message: string) => void;
}

const CAR_KEY = 'open-road:car';

/**
 * The running game: cars, fixed-step simulation, per-frame systems and rendering. `main.ts` builds
 * the pieces and hands them over; everything that happens each frame lives here.
 */
export class Game {
  player: GameCar;
  /** Parked cars to crash into. */
  readonly dummies: GameCar[];
  /** Player first, then the dummies. Kept as one array: the hot loops must not allocate. */
  readonly cars: GameCar[];
  readonly race: RaceSystem;
  garage!: Garage;
  paused = false;

  private readonly stepper = new FixedStepper(FIXED_DT);
  private readonly res: StepResult = { steps: 0, alpha: 0 };
  /** Simulated seconds (lap times use physics time, not the wall clock). */
  private simTime = 0;
  private physMs = 0;
  private last = performance.now();
  private locIndex = 0;
  private readonly d: GameDeps;
  private warned = false;
  /** CPU time (ms) of each part of the last frame, smoothed (debug overlay, profiling). */
  readonly frameStats = { physics: 0, race: 0, visuals: 0, camera: 0, render: 0, hud: 0, total: 0 };
  private tick = 0;
  private lap(key: keyof Game['frameStats']): void {
    const now = performance.now();
    this.frameStats[key] += (now - this.tick - this.frameStats[key]) * 0.1;
    this.tick = now;
  }

  /** Last place the player's car stood on its wheels on dry ground (respawn point). */
  private safe = { ...SPAWN };
  private safeAt = 0;

  /** Every half second of driving, remember where the car stands upright on its four wheels. */
  private rememberSafe(): void {
    if (this.simTime - this.safeAt < 0.5) return;
    const v = this.player.vehicle;
    const q = v.body.rotation();
    const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
    if (upY < 0.85 || !v.wheels.every((w) => w.hit) || v.speedKmh > 160) return;
    const t = v.body.translation();
    const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
    this.safe = { x: t.x, y: t.y - 0.6, z: t.z, yaw };
    this.safeAt = this.simTime;
  }

  private backToSafety(message: string): void {
    const s = this.safe;
    this.player.repair();
    this.player.vehicle.placeAt(s.x, s.y + 1.0, s.z, s.yaw);
    this.race.reset();
    this.d.hud.toast(message);
  }

  /** A car swap is waiting for its model: ignore further swaps until it is done. */
  private swapping = false;

  constructor(deps: GameDeps) {
    this.d = deps;
    const { physics, gs } = deps;
    this.player = new GameCar(physics, gs.scene, carById(Game.savedCarId()), SPAWN.x, SPAWN.z, SPAWN.yaw);
    this.dummies = [
      new GameCar(physics, gs.scene, CARS[0]!, 0, 22, Math.PI, 0x8a8f96),
      new GameCar(physics, gs.scene, CARS[1]!, -15, -85, Math.PI / 2, 0xe0b020),
    ];
    this.cars = [this.player, ...this.dummies];
    for (const c of this.dummies) this.hookTowers(c);
    this.race = new RaceSystem(deps.map.tracks, deps.hud, deps.map.stages);
    this.race.setCar(this.player.def.id);
    this.hookPlayer();
    deps.hud.onRepair = () => this.repair();
  }

  static savedCarId(): string {
    try {
      return localStorage.getItem(CAR_KEY) ?? 'sedan';
    } catch {
      return 'sedan';
    }
  }

  private hookPlayer(): void {
    this.player.damage.addImpactListener((i) => this.d.audio.impact(i));
    this.hookTowers(this.player);
  }

  /** A car crashing into a skyscraper's ground floor hits it with its kinetic energy. */
  private hookTowers(car: GameCar): void {
    const towers = this.d.map.city.skyscrapers;
    car.damage.addImpactListener((i) => {
      if (i.collider >= 0) towers.hit(i.collider, 0.5 * car.vehicle.mass * i.speed * i.speed, i.normal.x, i.normal.z);
    });
  }

  // ---- actions (keys, garage menu, HUD button, debug API) ---------------------------------------

  /** Switch the player's car, loading its model first if it is not loaded yet. */
  async swapCar(id: string): Promise<void> {
    if (this.swapping) {
      this.garage.syncCar();
      return;
    }
    this.swapping = true;
    try {
      if (!getCarTemplate(id)) {
        this.d.hud.toast('Loading car…', 1500);
        try {
          await ensureCarTemplate(id, import.meta.env.BASE_URL);
        } catch {
          this.d.hud.toast('Could not load this car', 1500);
          this.garage.syncCar();
          return;
        }
      }
      const old = this.player;
      const t = old.vehicle.body.translation();
      const q = old.vehicle.currQuat;
      const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
      old.dispose();
      this.player = new GameCar(this.d.physics, this.d.gs.scene, carById(id), t.x, t.z, yaw);
      this.player.vehicle.placeAt(t.x, t.y + 0.6, t.z, yaw);
      this.cars[0] = this.player;
      this.garage.attach();
      this.hookPlayer();
      this.race.setCar(id);
      try {
        localStorage.setItem(CAR_KEY, id);
      } catch {
        /* storage unavailable: fine */
      }
    } finally {
      this.swapping = false;
    }
  }

  nextCar(): void {
    const i = CARS.findIndex((c) => c.id === this.player.def.id);
    this.swapCar(CARS[(i + 1) % CARS.length]!.id).catch((err) => console.error('[swapCar]', err));
  }

  teleport(loc: Location): void {
    // Fallen towers stand again (and their rubble goes) whenever you go somewhere.
    this.d.map.city.skyscrapers.rebuild();
    this.player.vehicle.placeAt(loc.x, loc.y + 1.0, loc.z, loc.yaw);
    this.safe = { x: loc.x, y: loc.y, z: loc.z, yaw: loc.yaw };
    this.race.reset();
    this.d.hud.toast(loc.name);
  }

  nextLocation(): void {
    const locs = this.d.map.locations;
    this.locIndex = (this.locIndex + 1) % locs.length;
    this.teleport(locs[this.locIndex]!);
  }

  /** Repair in place: body, glass, parts, engine and wheels, keeping position and speed. */
  repair(): void {
    this.player.repair();
    this.d.hud.toast('Repaired', 1200);
  }

  // ---- simulation -----------------------------------------------------------------------------------

  private inputFor(c: GameCar, cmd: DriveInput): DriveInput {
    return c === this.player ? cmd : IDLE;
  }

  /** One fixed physics step for every car. */
  step(cmd: DriveInput): void {
    const cars = this.cars;
    for (let i = 0; i < cars.length; i++) cars[i]!.fixedUpdate(FIXED_DT, this.inputFor(cars[i]!, cmd));
    this.d.physics.step();
    for (let i = 0; i < cars.length; i++) cars[i]!.vehicle.afterPhysicsStep();
    // Breaks and collapses from this step's crashes, now that no car holds a collider of it.
    this.d.map.city.skyscrapers.flush();
    this.simTime += FIXED_DT;
  }

  /** Run `seconds` of game time immediately (automated checks, screenshots). */
  advance(seconds: number, drive?: () => DriveInput): void {
    const n = Math.round(seconds / FIXED_DT);
    const vh = this.d.gs.renderer.domElement.clientHeight;
    for (let i = 0; i < n; i++) {
      this.step(drive ? drive() : this.d.input.out);
      if (i % 4 === 0) for (const c of this.cars) c.updateVisuals(performance.now() + i, 1, FIXED_DT * 4, vh);
    }
    for (const c of this.cars) c.updateVisuals(performance.now() + 1e6, 1, 0.016, vh);
    this.d.props.update();
  }

  private handleKeys(): void {
    const input = this.d.input;
    const v = this.player.vehicle;
    if (input.pressed('Shift+KeyR')) this.player.respawn();
    else if (input.pressed('KeyR')) v.recover();
    if (input.pressed('KeyC')) this.d.rig.cycle();
    if (input.pressed('KeyV')) this.nextCar();
    if (input.pressed('KeyB')) for (const d of this.dummies) d.respawn();
    if (input.pressed('KeyG')) this.garage.toggle();
    if (input.pressed('KeyF')) this.repair();
    if (input.pressed('KeyT')) this.nextLocation();
    if (input.pressed('KeyN')) this.d.hud.toggleMap();
    if (input.pressed('KeyE') && v.manual) v.shiftUp();
    if (input.pressed('KeyQ') && v.manual) v.shiftDown();
  }

  /** Reset any car whose state went non-finite (a physics blow-up must never freeze the game). */
  private watchdog(): void {
    for (const c of this.cars) {
      const pos = c.vehicle.body.translation();
      const vel = c.vehicle.body.linvel();
      const rpm = c.vehicle.rpm;
      if (
        Number.isFinite(pos.x) && Number.isFinite(pos.y) && Number.isFinite(pos.z) &&
        Number.isFinite(vel.x) && Number.isFinite(vel.y) && Number.isFinite(vel.z) &&
        Number.isFinite(rpm)
      ) continue;

      if (c === this.player) {
        this.backToSafety('Physics glitch - car reset');
      } else {
        c.respawn();
      }
      if (!this.warned) {
        this.warned = true;
        console.warn('[watchdog] Non-finite vehicle state; car reset', { id: c.def.id, pos, vel, rpm });
      }
    }
  }

  /** One rendered frame. */
  frame(now: number): void {
    if (this.paused) {
      this.last = now;
      return;
    }
    const { gs, map, hud, rig, audio, debug, props, resolution } = this.d;
    const frameDt = Math.min(Math.max((now - this.last) / 1000, 0), 0.1);
    this.last = now;
    resolution.sample(frameDt);

    const start = performance.now();
    this.tick = start;
    const cmd = this.d.input.sample(frameDt);
    this.handleKeys();

    this.stepper.advance(frameDt, this.res);
    const p0 = performance.now();
    try {
      for (let i = 0; i < this.res.steps; i++) this.step(cmd);
    } catch (err) {
      // A panic inside the physics engine leaves its state unusable: stop and offer a reload
      // rather than throwing every frame.
      console.error('[physics]', err);
      this.paused = true;
      this.d.onFatal?.('The physics engine stopped working.');
      return;
    }
    if (this.res.steps > 0) this.physMs = (performance.now() - p0) / this.res.steps;
    this.lap('physics');

    this.watchdog();

    // Off the edge of the world or into the lake: back to the last spot on the ground, repaired.
    const pt = this.player.vehicle.body.translation();
    if (map.isOutside(pt.x, pt.y, pt.z)) this.backToSafety('Out of the map - back on the road');
    else if (map.inWater(pt.x, pt.y + 0.4, pt.z)) this.backToSafety('Splash! Back on dry land');
    else this.rememberSafe();
    this.race.update(pt.x, pt.z, this.simTime);
    this.lap('race');

    const vh = gs.renderer.domElement.clientHeight;
    for (const c of this.cars) c.updateVisuals(now, this.res.alpha, frameDt, vh);
    props.update();
    this.lap('visuals');
    const player = this.player;
    rig.shake = Math.max(rig.shake, player.effects.shake);
    player.effects.shake = 0;
    rig.update(frameDt, player.vehicle, player.view.pos, player.view.quat);
    gs.followSun(player.view.pos);
    map.update(now / 1000, gs.camera, player.view.pos);
    this.lap('camera');
    gs.renderer.render(gs.scene, gs.camera);
    this.lap('render');

    hud.update(player, now);
    audio.update(player.vehicle, now);
    this.lap('hud');
    this.frameStats.total += (performance.now() - start - this.frameStats.total) * 0.1;
    if (debug.isVisible) this.debugPanel();
    debug.frame(frameDt, now);
  }

  private debugPanel(): void {
    const { debug, gs } = this.d;
    const car = this.player.vehicle;
    const dm = this.player.damage;
    const f = this.frameStats;
    debug.set('frame (CPU ms)', `total ${f.total.toFixed(2)}: physics ${f.physics.toFixed(2)}, race+map ${f.race.toFixed(2)}, visuals ${f.visuals.toFixed(2)}, camera ${f.camera.toFixed(2)}, render ${f.render.toFixed(2)}, hud+audio ${f.hud.toFixed(2)}`);
    debug.set('physics', `${this.physMs.toFixed(2)} ms/step @ ${(1 / FIXED_DT).toFixed(0)} Hz, ${this.res.steps} steps/frame, ${this.cars.length} cars`);
    debug.set('render', `${gs.renderer.info.render.calls} draw calls, ${gs.renderer.info.render.triangles} tris, pixel ratio ${this.d.resolution.ratio}`);
    debug.set('car', `${car.speedKmh.toFixed(0)} km/h, gear ${car.gear}, ${car.rpm.toFixed(0)} rpm, steer ${(car.steerAngle * 57.3).toFixed(1)} deg`);
    debug.set('yaw rate', `${car.yawRate.toFixed(2)} rad/s, tc ${car.tcActive ? 'ON' : '-'} abs ${car.absActive ? 'ON' : '-'} esp ${car.espActivity.toFixed(2)}`);
    const names = ['FL', 'FR', 'RL', 'RR'];
    car.wheels.forEach((w, i) => {
      debug.set(names[i]!, `Fz ${w.fz.toFixed(0)} N  slip k ${w.slipRatio.toFixed(2)} a ${(w.slipAngle * 57.3).toFixed(1)} deg  ${w.surface}${w.hit ? '' : ' (air)'}  dmg ${dm.wheel[i]!.toFixed(2)}`);
    });
    debug.set('damage', `engine ${dm.engine.toFixed(2)} front ${dm.zone.front.toFixed(2)} rear ${dm.zone.rear.toFixed(2)} L ${dm.zone.left.toFixed(2)} R ${dm.zone.right.toFixed(2)} roof ${dm.zone.roof.toFixed(2)}`);
    debug.set('crush', `energy ${(this.player.crush.energy / 1000).toFixed(0)} kJ, rays active ${this.player.crush.active}, parts off ${this.player.parts.detached}`);
  }

  // ---- automated checks -----------------------------------------------------------------------------

  /** Force one camera update + render now. */
  renderNow(): void {
    const { gs, rig } = this.d;
    for (const c of this.cars) c.view.update(1);
    rig.update(0.05, this.player.vehicle, this.player.view.pos, this.player.view.quat);
    gs.followSun(this.player.view.pos);
    this.d.map.update(this.simTime, gs.camera, this.player.view.pos);
    gs.renderer.render(gs.scene, gs.camera);
  }

  /** Render once from a world-space camera position. */
  renderFrom(pos: [number, number, number], target: [number, number, number]): void {
    const { gs } = this.d;
    for (const c of this.cars) c.view.update(1);
    gs.camera.position.set(...pos);
    gs.camera.lookAt(...target);
    this.d.map.update(this.simTime, gs.camera, this.player.view.pos);
    gs.renderer.render(gs.scene, gs.camera);
  }

  /** `window.game`: the handle the automated browser checks drive the game with. */
  debugApi(): Record<string, unknown> {
    const d = this.d;
    const api: Record<string, unknown> = {
      dummies: this.dummies,
      physics: d.physics,
      input: d.input,
      rig: d.rig,
      map: d.map,
      resolution: d.resolution,
      renderer: d.gs.renderer,
      frameStats: this.frameStats,
      frame: (now: number) => this.frame(now),
      advance: (s: number, drive?: () => DriveInput) => this.advance(s, drive),
      renderNow: () => this.renderNow(),
      renderFrom: (p: [number, number, number], t: [number, number, number]) => this.renderFrom(p, t),
      swapCar: (id: string) => this.swapCar(id),
      teleport: (l: Location) => this.teleport(l),
      repairCar: () => this.repair(),
    };
    // Live views of state that changes (the player car is replaced on a swap).
    Object.defineProperties(api, {
      paused: { get: () => this.paused, set: (v: boolean) => (this.paused = v), enumerable: true },
      player: { get: () => this.player, enumerable: true },
      garage: { get: () => this.garage, enumerable: true },
    });
    return api;
  }
}
