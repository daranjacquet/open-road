import type { VehicleConfig } from '../../vehicle/types';
import type { CarModel } from '../carModel';
import { generateCar, type CarBodySpec } from './generator';
import { getCarTemplate, modelFromTemplate } from './glb';
import { sportSpec } from './sportSpec';

export type { CarBodySpec } from './generator';

/**
 * Build a car model. Uses the Blender-exported GLB when it has been loaded (`loadCarTemplates`),
 * otherwise the procedural TypeScript generator, which produces the same part names.
 */
export function buildCarModel(cfg: VehicleConfig, spec: CarBodySpec = sportSpec, paint?: number, id?: string): CarModel {
  const template = id ? getCarTemplate(id) : undefined;
  if (template) return modelFromTemplate(template, cfg, paint);
  return generateCar(cfg, paint === undefined ? spec : { ...spec, paint });
}
