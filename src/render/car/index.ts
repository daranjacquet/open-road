import type { VehicleConfig } from '../../vehicle/types';
import type { CarModel } from '../carModel';
import { generateCar } from './generator';
import { sportSpec } from './sportSpec';

export function buildCarModel(cfg: VehicleConfig): CarModel {
  // Further cars (hatchback, pickup) plug in their own CarBodySpec here.
  return generateCar(cfg, sportSpec);
}
