import type { VehicleConfig } from '../../vehicle/types';
import type { CarModel } from '../carModel';
import { generateCar, type CarBodySpec } from './generator';
import { sportSpec } from './sportSpec';

export type { CarBodySpec } from './generator';

/** Build a car model from its config and body spec (defaults to the sport coupe). Optional paint override. */
export function buildCarModel(cfg: VehicleConfig, spec: CarBodySpec = sportSpec, paint?: number): CarModel {
  return generateCar(cfg, paint === undefined ? spec : { ...spec, paint });
}
