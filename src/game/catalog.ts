import offroadCfg from '../vehicle/cars/offroad.json';
import sedanCfg from '../vehicle/cars/sedan.json';
import supercarCfg from '../vehicle/cars/supercar.json';
import type { VehicleConfig } from '../vehicle/types';
import type { CarDef } from './GameCar';

export const CARS: CarDef[] = [
  { id: 'sedan', name: "Thunderbolt '96 rally saloon (AWD)", cfg: sedanCfg as unknown as VehicleConfig },
  { id: 'offroad', name: "Bokaroo '67 off-roader (4x4)", cfg: offroadCfg as unknown as VehicleConfig },
  { id: 'supercar', name: 'V12 Goblin supercar (AWD)', cfg: supercarCfg as unknown as VehicleConfig },
];

export function carById(id: string): CarDef {
  return CARS.find((c) => c.id === id) ?? CARS[0]!;
}
