import hatchCfg from '../vehicle/cars/hatch.json';
import pickupCfg from '../vehicle/cars/pickup.json';
import sportCfg from '../vehicle/cars/sport.json';
import { hatchSpec } from '../render/car/hatchSpec';
import { pickupSpec } from '../render/car/pickupSpec';
import { sportSpec } from '../render/car/sportSpec';
import type { VehicleConfig } from '../vehicle/types';
import type { CarDef } from './GameCar';

export const CARS: CarDef[] = [
  { id: 'sport', name: 'Sport Coupe (RWD)', cfg: sportCfg as unknown as VehicleConfig, body: sportSpec },
  { id: 'hatch', name: 'City Hatch (FWD)', cfg: hatchCfg as unknown as VehicleConfig, body: hatchSpec },
  { id: 'pickup', name: 'Pickup (AWD, heavy)', cfg: pickupCfg as unknown as VehicleConfig, body: pickupSpec },
];

export function carById(id: string): CarDef {
  return CARS.find((c) => c.id === id) ?? CARS[0]!;
}
