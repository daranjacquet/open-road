import * as THREE from 'three';
import { buildCrushRays } from '../damage/rays';
import { DamageModel } from '../damage/DamageModel';
import { Deformer } from '../damage/Deformer';
import { PartsManager } from '../damage/PartsManager';
import type { Physics } from '../core/physics';
import { buildCarModel, type CarBodySpec } from '../render/car';
import type { CarModel } from '../render/carModel';
import { Effects } from '../render/effects';
import { VehicleView } from '../render/VehicleView';
import { Vehicle, type DriveInput } from '../vehicle/Vehicle';
import type { VehicleConfig } from '../vehicle/types';

export interface CarDef {
  id: string;
  name: string;
  cfg: VehicleConfig;
  body: CarBodySpec;
}

export const IDLE: DriveInput = { throttle: 0, brake: 0, steer: 0, handbrake: 1 };

/** A complete car: physics, model, crumple zones, dents, mechanical damage, detachable parts and effects. */
export class GameCar {
  readonly vehicle: Vehicle;
  readonly model: CarModel;
  readonly view: VehicleView;
  readonly crush;
  readonly deformer: Deformer;
  readonly damage: DamageModel;
  readonly parts: PartsManager;
  readonly effects: Effects;
  private readonly spawn: { x: number; z: number; yaw: number };

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
    this.vehicle = new Vehicle(physics, def.cfg, x, z, yaw);
    this.model = buildCarModel(def.cfg, def.body, paint, def.id);
    scene.add(this.model.root);
    this.view = new VehicleView(this.vehicle, this.model);
    this.crush = this.vehicle.attachCrush(buildCrushRays(def.cfg, this.model));
    this.deformer = new Deformer(this.crush, this.model.parts);
    this.damage = new DamageModel(this.vehicle, this.crush);
    this.parts = new PartsManager(physics, scene, this.vehicle, this.model, this.crush, this.deformer, this.damage);
    this.effects = new Effects(this.vehicle, this.damage);
    scene.add(this.effects.group);
    this.parts.onGlassBreak = (p) => this.effects.glassBurst(p);
    this.view.update(1);
  }

  /** Per rendered frame: dents, mechanical state, detached panels, visuals. */
  updateVisuals(now: number, alpha: number, frameDt: number, viewportHeight: number): void {
    this.damage.update();
    this.deformer.update(now);
    this.parts.update();
    this.effects.update(frameDt, viewportHeight);
    this.view.update(alpha);
  }

  repair(): void {
    this.parts.repair();
    this.crush.reset();
    this.deformer.reset();
    this.damage.reset();
  }

  /** Repair and put the car back where it started. */
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
