import * as THREE from 'three';
import type { GameAudio } from '../audio/audio';
import { FixedStepper, type StepResult } from '../core/loop';
import type { FlightInput, Input } from '../core/input';
import { FIXED_DT, type Physics } from '../core/physics';
import type { DebugOverlay } from '../debug/overlay';
import type { CameraRig } from '../render/camera';
import { aircraftLoaded, loadAircraft } from '../render/aircraft/model';
import { ensureCarTemplate, getCarTemplate } from '../render/car/glb';
import type { AdaptiveResolution } from '../render/quality';
import type { GameScene } from '../render/scene';
import type { Garage } from '../ui/garage';
import type { Hud } from '../ui/hud';
import type { DriveInput } from '../vehicle/Vehicle';
import type { GameMap, Location } from '../world/map';
import { LIMIT, SPAWN } from '../world/map';
import type { WorldProps } from '../world/props';
import { CARS, carById } from './catalog';
import { buildParkedAircraft, GameAircraft, PARKED } from './GameAircraft';
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
/** Body origin above the ground with the aircraft standing on its wheels (m). */
const PLANE_REST = 1.18;
/** How close (m) and how slow (m/s) the car must be to get into the aircraft. */
const BOARD_RANGE = 16;
/** Past this distance from the centre the aircraft is turned back towards the map (m). */
const PLANE_LIMIT = LIMIT + 150;

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

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
  /** Driving the car, or flying the aircraft (the car waits where it was left). */
  mode: 'car' | 'plane' = 'car';
  /** The aircraft, once its model has loaded. */
  plane: GameAircraft | null = null;
  /** The pilot's commands this frame (in the aircraft). */
  private flightCmd: FlightInput = { ...PARKED };
  private planeLoading: Promise<GameAircraft | null> | null = null;

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
    if (loc.aircraft) {
      this.flyFrom(loc).catch((err) => console.error('[aircraft]', err));
      return;
    }
    if (this.mode === 'plane') this.leavePlane(false);
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
    if (this.mode === 'plane' && this.plane) this.plane.repair();
    else this.player.repair();
    this.d.hud.toast('Repaired', 1200);
  }

  // ---- aircraft -------------------------------------------------------------------------------------

  /** Load the aircraft model and park the aircraft on its spot (once). */
  loadPlane(): Promise<GameAircraft | null> {
    this.planeLoading ??= (async () => {
      try {
        if (!aircraftLoaded()) await loadAircraft(import.meta.env.BASE_URL);
        const s = this.d.map.planeSpot;
        this.plane = new GameAircraft(this.d.physics, this.d.gs.scene, s.x, s.y + PLANE_REST, s.z, s.yaw);
        buildParkedAircraft(this.d.physics, this.d.gs.scene, this.d.map.stands, this.d.map.heightAt, 1.15);
        return this.plane;
      } catch (err) {
        console.warn('[aircraft] Could not load the aircraft.', err);
        this.planeLoading = null;
        return null;
      }
    })();
    return this.planeLoading;
  }

  /** Put the aircraft on a spot, repaired, and the player in its seat. */
  async flyFrom(loc: Location): Promise<void> {
    if (!this.plane) this.d.hud.toast('Loading the aircraft…', 1500);
    const plane = await this.loadPlane();
    if (!plane) {
      this.d.hud.toast('Could not load the aircraft', 1500);
      return;
    }
    this.d.map.city.skyscrapers.rebuild();
    plane.placeAt(loc.x, loc.y + PLANE_REST, loc.z, loc.yaw);
    this.boardPlane();
    this.d.hud.toast(loc.name);
  }

  private boardPlane(): void {
    const plane = this.plane;
    if (!plane) return;
    this.mode = 'plane';
    this.d.input.clearEdges();
    this.d.input.resetFlight(plane.aircraft.controls.throttle, plane.aircraft.controls.flaps);
    this.flightCmd = this.d.input.flight;
    // Keys are all-or-nothing: they get the stall protection; an analogue stick flies raw.
    plane.aircraft.assists.protect = !this.d.input.usingPad;
    this.d.hud.setMode('plane');
    this.d.hud.hint(null);
    this.d.rig.reset();
  }

  /** Back in the car, which waits beside the aircraft (beyond the left wing tip). */
  private leavePlane(bringCar = true): void {
    const plane = this.plane;
    this.mode = 'car';
    this.d.input.clearEdges();
    this.d.hud.setMode('car');
    this.d.audio.leaveAircraft();
    this.d.rig.reset();
    this.flightCmd = { ...PARKED };
    if (!plane || !bringCar) return;
    const ac = plane.aircraft;
    _v.set(8.5, 0, -1.5).applyQuaternion(ac.currQuat).add(ac.currPos);
    const yaw = ac.state.heading;
    this.player.repair();
    this.player.vehicle.placeAt(_v.x, this.d.map.heightAt(_v.x, _v.z) + 1.0, _v.z, yaw);
    this.safe = { x: _v.x, y: this.d.map.heightAt(_v.x, _v.z), z: _v.z, yaw };
  }

  /** The car is close to the aircraft and both stand still: it can be boarded. */
  private canBoard(): boolean {
    const plane = this.plane;
    if (!plane || this.mode !== 'car') return false;
    const p = this.player.vehicle.body.translation();
    const a = plane.aircraft.currPos;
    return Math.hypot(p.x - a.x, p.z - a.z) < BOARD_RANGE && this.player.vehicle.speed < 3 && plane.aircraft.state.airspeed < 2 && plane.aircraft.state.onGround;
  }

  private planeKeys(): void {
    const input = this.d.input;
    const plane = this.plane!;
    if (input.pressed('Enter')) {
      if (plane.aircraft.state.onGround && plane.aircraft.state.airspeed < 2) this.leavePlane();
      else this.d.hud.toast('Stop on the ground to get out', 1400);
    }
    if (input.pressed('Shift+KeyR') || input.pressed('KeyR')) {
      this.d.map.city.skyscrapers.rebuild();
      plane.respawn();
      input.resetFlight();
      this.d.hud.toast('Runway 27', 1400);
    }
    if (input.pressed('KeyC')) this.d.rig.cycleAir();
    if (input.pressed('KeyP')) {
      const a = plane.aircraft.assists;
      a.protect = !a.protect;
      this.d.hud.toast(a.protect ? 'Stall protection on' : 'Stall protection off', 1400);
    }
    if (input.pressed('KeyF')) this.repair();
    if (input.pressed('KeyT')) this.nextLocation();
    if (input.pressed('KeyN')) this.d.hud.toggleMap();
  }

  /** The aircraft blew up numerically, fell out of the world, flew off the map or ditched. */
  private planeBounds(): void {
    const plane = this.plane;
    if (!plane) return;
    const ac = plane.aircraft;
    const t = ac.body.translation();
    const lv = ac.body.linvel();
    const flying = this.mode === 'plane';
    if (!(Number.isFinite(t.x) && Number.isFinite(t.y) && Number.isFinite(t.z) && Number.isFinite(lv.x) && Number.isFinite(lv.y) && Number.isFinite(lv.z))) {
      plane.respawn();
      if (flying) this.d.hud.toast('Physics glitch - aircraft reset');
      return;
    }
    if (t.y < -40 || this.d.map.inWater(t.x, t.y, t.z)) {
      plane.respawn();
      if (flying) this.d.hud.toast(t.y < -40 ? 'Out of the world - back to the runway' : 'Ditched in the lake! Back to the runway');
      return;
    }
    // At the edge of the map: turned round on the spot, same height and speed, heading back in.
    if (Math.abs(t.x) > PLANE_LIMIT || Math.abs(t.z) > PLANE_LIMIT) {
      const r = ac.body.rotation();
      _q.set(r.x, r.y, r.z, r.w).premultiply(new THREE.Quaternion().setFromAxisAngle(_v.set(0, 1, 0), Math.PI));
      const x = THREE.MathUtils.clamp(t.x, -PLANE_LIMIT + 20, PLANE_LIMIT - 20);
      const z = THREE.MathUtils.clamp(t.z, -PLANE_LIMIT + 20, PLANE_LIMIT - 20);
      ac.body.setTranslation({ x, y: t.y, z }, true);
      ac.body.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }, true);
      ac.body.setLinvel({ x: -lv.x, y: lv.y, z: -lv.z }, true);
      ac.afterPhysicsStep();
      ac.afterPhysicsStep();
      this.d.rig.reset();
      if (flying) this.d.hud.toast('Edge of the map - turned back', 1800);
    }
  }

  // ---- simulation -----------------------------------------------------------------------------------

  private inputFor(c: GameCar, cmd: DriveInput): DriveInput {
    return c === this.player ? cmd : IDLE;
  }

  /** One fixed physics step for every car and the aircraft. */
  step(cmd: DriveInput): void {
    const cars = this.cars;
    const driving = this.mode === 'car';
    for (let i = 0; i < cars.length; i++) cars[i]!.fixedUpdate(FIXED_DT, driving ? this.inputFor(cars[i]!, cmd) : IDLE);
    const plane = this.plane;
    plane?.fixedUpdate(FIXED_DT, driving ? PARKED : this.flightCmd);
    // The aircraft's velocity going into the step: a crash stops it within the step.
    const lv = plane ? plane.aircraft.body.linvel() : null;
    this.d.physics.step();
    for (let i = 0; i < cars.length; i++) cars[i]!.vehicle.afterPhysicsStep();
    if (plane) {
      plane.aircraft.afterPhysicsStep();
      // Impacts on the airframe (only its colliders report contact forces), after the step: a part
      // that breaks off now takes its colliders out of a world that is not stepping.
      const towers = this.d.map.city.skyscrapers;
      this.d.physics.events.drainContactForceEvents((e) => {
        const f = e.totalForceMagnitude();
        const a = e.collider1();
        const b = e.collider2();
        plane.contactForce(a, f, FIXED_DT);
        plane.contactForce(b, f, FIXED_DT);
        // A skyscraper takes the aircraft's kinetic energy (they hold their own cooldown).
        if (!lv) return;
        const v2 = lv.x * lv.x + lv.y * lv.y + lv.z * lv.z;
        if (v2 < 25) return;
        const h = Math.hypot(lv.x, lv.z) || 1;
        const energy = 0.5 * plane.aircraft.mass * v2;
        const y = plane.aircraft.currPos.y;
        towers.strike(a, energy, lv.x / h, lv.z / h, y);
        towers.strike(b, energy, lv.x / h, lv.z / h, y);
      });
    }
    // Breaks and collapses from this step's crashes, now that no car holds a collider of it.
    this.d.map.city.skyscrapers.flush();
    this.simTime += FIXED_DT;
  }

  /** Run `seconds` of game time immediately (automated checks, screenshots). */
  advance(seconds: number, drive?: () => DriveInput, fly?: () => FlightInput): void {
    const n = Math.round(seconds / FIXED_DT);
    const vh = this.d.gs.renderer.domElement.clientHeight;
    for (let i = 0; i < n; i++) {
      if (fly) this.flightCmd = fly();
      this.step(drive ? drive() : this.d.input.out);
      if (i % 4 === 0) {
        for (const c of this.cars) c.updateVisuals(performance.now() + i, 1, FIXED_DT * 4, vh);
        this.plane?.updateVisuals(1, FIXED_DT * 4);
      }
      if (i % 12 === 0) this.planeBounds();
    }
    for (const c of this.cars) c.updateVisuals(performance.now() + 1e6, 1, 0.016, vh);
    this.plane?.updateVisuals(1, 0.016);
    this.d.props.update();
  }

  private handleKeys(): void {
    const input = this.d.input;
    if (this.mode === 'plane' && this.plane) {
      this.planeKeys();
      return;
    }
    if (input.pressed('Enter') && this.canBoard()) this.boardPlane();
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
    const flying = this.mode === 'plane' && this.plane !== null;
    const cmd = flying ? IDLE : this.d.input.sample(frameDt);
    if (flying) this.flightCmd = this.d.input.sampleFlight(frameDt);
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
    this.planeBounds();

    // Off the edge of the world or into the lake: back to the last spot on the ground, repaired.
    const pt = this.player.vehicle.body.translation();
    if (map.isOutside(pt.x, pt.y, pt.z)) this.backToSafety('Out of the map - back on the road');
    else if (map.inWater(pt.x, pt.y + 0.4, pt.z)) this.backToSafety('Splash! Back on dry land');
    else this.rememberSafe();
    if (!flying) this.race.update(pt.x, pt.z, this.simTime);
    this.lap('race');

    const vh = gs.renderer.domElement.clientHeight;
    for (const c of this.cars) c.updateVisuals(now, this.res.alpha, frameDt, vh);
    const plane = this.plane;
    plane?.updateVisuals(this.res.alpha, frameDt);
    props.update();
    this.lap('visuals');
    const player = this.player;
    if (flying && plane) {
      rig.shake = Math.max(rig.shake, Math.min(0.5, Math.sqrt(plane.impact) / 2500));
      rig.updateAircraft(frameDt, plane.view.pos, plane.view.quat, plane.aircraft.state.airspeed);
      gs.followSun(plane.view.pos);
      map.update(now / 1000, gs.camera, plane.view.pos);
    } else {
      rig.shake = Math.max(rig.shake, player.effects.shake);
      rig.update(frameDt, player.vehicle, player.view.pos, player.view.quat);
      gs.followSun(player.view.pos);
      map.update(now / 1000, gs.camera, player.view.pos);
    }
    player.effects.shake = 0;
    plane?.detail(gs.camera.position);
    this.lap('camera');
    gs.renderer.render(gs.scene, gs.camera);
    this.lap('render');

    if (plane) {
      // Parts coming off, touchdowns and impacts of this frame.
      if (plane.events.length) {
        if (flying) hud.toast(plane.events[plane.events.length - 1]!, 1800);
        plane.events.length = 0;
      }
      if (plane.chirp > 0) {
        if (flying) audio.chirp(plane.chirp);
        plane.chirp = 0;
      }
      if (plane.impact > 0) {
        if (flying) audio.impactEnergy(plane.impact);
        plane.impact = 0;
      }
    }
    if (flying && plane) {
      hud.updateFlight(plane, this.flightCmd.brake, now);
      audio.updateAircraft(plane.aircraft, now, hud.flight.stallWarning);
    } else {
      hud.update(player, now);
      if (this.canBoard()) hud.hint('Enter', 'Fly the SR22');
      else hud.hint(null);
      audio.update(player.vehicle, now);
    }
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
    const plane = this.plane;
    plane?.updateVisuals(1, 0);
    if (this.mode === 'plane' && plane) {
      rig.updateAircraft(0.05, plane.view.pos, plane.view.quat, plane.aircraft.state.airspeed);
      gs.followSun(plane.view.pos);
      this.d.map.update(this.simTime, gs.camera, plane.view.pos);
    } else {
      rig.update(0.05, this.player.vehicle, this.player.view.pos, this.player.view.quat);
      gs.followSun(this.player.view.pos);
      this.d.map.update(this.simTime, gs.camera, this.player.view.pos);
    }
    plane?.detail(gs.camera.position);
    gs.renderer.render(gs.scene, gs.camera);
  }

  /** Render once from a world-space camera position. */
  renderFrom(pos: [number, number, number], target: [number, number, number]): void {
    const { gs } = this.d;
    for (const c of this.cars) c.view.update(1);
    this.plane?.updateVisuals(1, 0);
    gs.camera.position.set(...pos);
    gs.camera.up.set(0, 1, 0);
    gs.camera.lookAt(...target);
    this.plane?.detail(gs.camera.position);
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
      advance: (s: number, drive?: () => DriveInput, fly?: () => FlightInput) => this.advance(s, drive, fly),
      loadPlane: () => this.loadPlane(),
      flyFrom: (l: Location) => this.flyFrom(l),
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
      plane: { get: () => this.plane, enumerable: true },
      mode: { get: () => this.mode, enumerable: true },
      garage: { get: () => this.garage, enumerable: true },
    });
    return api;
  }
}
