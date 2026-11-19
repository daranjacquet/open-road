import * as THREE from 'three';
import { buildCrushRays } from '../damage/rays';
import { DamageModel } from '../damage/DamageModel';
import { Deformer } from '../damage/Deformer';
import { PartsManager } from '../damage/PartsManager';
import type { CrushSystem } from '../damage/CrushSystem';
import type { Physics } from '../core/physics';
import { buildCarModel } from '../render/car';
import type { CarModel } from '../render/carModel';
import { Effects } from '../render/effects';
import { VehicleView } from '../render/VehicleView';
import { Vehicle, type DriveInput } from '../vehicle/Vehicle';
import type { VehicleConfig } from '../vehicle/types';
import { applyTune, stockTune, type Tune } from '../vehicle/tuning';

export interface CarDef {
  id: string;
  name: string;
  cfg: VehicleConfig;
}

export const IDLE: DriveInput = { throttle: 0, brake: 0, steer: 0, handbrake: 1 };

/** A complete car: physics, Blender model, crumple zones, deformation field, damage, parts, effects. */
export class GameCar {
  readonly vehicle: Vehicle;
  readonly model: CarModel;
  readonly view: VehicleView;
  readonly crush: CrushSystem;
  readonly deformer: Deformer;
  readonly damage: DamageModel;
  readonly parts: PartsManager;
  readonly effects: Effects;
  /** Current garage setup (stock until `applyTune`). */
  tune: Tune;
  private readonly spawn: { x: number; z: number; yaw: number };
  private readonly crushNear = (x: number, y: number, z: number): number => this.crush.crushNear(x, y, z);

  constructor(
    private readonly physics: Physics,
    private readonly scene: THREE.Scene,
    readonly def: CarDef,
    x: number,
    z: number,
    yaw: number,
    paint?: number,
  ) {
    this.spawn = { x, z, yaw };
    this.tune = stockTune(def.cfg);
    this.vehicle = new Vehicle(physics, def.cfg, x, z, yaw);
    this.model = buildCarModel(def.id, paint);
    scene.add(this.model.root);
    this.view = new VehicleView(this.vehicle, this.model);
    this.crush = this.vehicle.attachCrush(buildCrushRays(def.cfg, this.model));
    this.deformer = new Deformer(physics.RAPIER, this.model, def.cfg);
    this.damage = new DamageModel(this.vehicle, this.crush);
    this.parts = new PartsManager(physics, scene, this.vehicle, this.model, this.crush, this.deformer, this.damage);
    this.effects = new Effects(this.vehicle, this.damage);
    scene.add(this.effects.group);
    this.parts.onGlassBreak = (p) => this.effects.glassBurst(p);
    this.view.update(1);
  }

  /** One physics step for this car (before `physics.step()`): driving forces, crumple zones, imprints. */
  fixedUpdate(dt: number, input: DriveInput): void {
    this.vehicle.fixedUpdate(dt, input);
    this.deformer.imprint(this.vehicle.currPos, this.vehicle.currQuat, this.crush.contacts, this.crushNear);
  }

  /** Per rendered frame: deformation, mechanical state, detached panels, visuals. */
  updateVisuals(now: number, alpha: number, frameDt: number, viewportHeight: number): void {
    this.damage.update();
    this.deformer.update(now);
    this.parts.update();
    this.effects.update(frameDt, viewportHeight);
    this.view.update(alpha);
  }

  /** Apply a garage setup live: physics, gearbox mode, driving aids, wheel stance. */
  applyTune(tune: Tune): void {
    this.tune = { ...tune };
    this.vehicle.applyConfig(applyTune(this.def.cfg, tune));
    this.vehicle.manual = tune.gearbox === 'manual';
    if (!this.vehicle.manual && this.vehicle.gear === 0) this.vehicle.gearState.gear = 1;
    Object.assign(this.vehicle.assists, { tc: tune.tc, abs: tune.abs, esp: tune.esp });
  }

  repair(): void {
    this.parts.repair();
    this.crush.reset();
    this.deformer.reset();
    this.damage.reset();
    // Half a second for the restored body to push itself clear of whatever it was touching.
    this.crush.grace = 60;
  }

  respawn(): void {
    this.repair();
    this.vehicle.placeAt(this.spawn.x, 1.0, this.spawn.z, this.spawn.yaw);
  }

  dispose(): void {
    this.repair();
    this.physics.world.removeRigidBody(this.vehicle.body);
    this.physics.crushBodies.delete(this.vehicle.body.handle);
    this.scene.remove(this.model.root);
    this.scene.remove(this.effects.group);
    this.model.dispose();
    this.effects.dispose();
  }
}
