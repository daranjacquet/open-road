import type { CarModel } from '../carModel';
import { getCarTemplate, modelFromTemplate } from './glb';

/** Build a car instance from its loaded Blender template (see `loadCarTemplates`). */
export function buildCarModel(id: string, paint?: number): CarModel {
  const template = getCarTemplate(id);
  if (!template) throw new Error(`Car model "${id}" is not loaded`);
  return modelFromTemplate(template, { paint });
}
