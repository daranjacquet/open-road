import { readFileSync } from 'node:fs';
import { getCarTemplate, parseCarGLB, registerCarTemplate } from '../../src/render/car/glb';

export const CAR_IDS = ['sedan', 'offroad', 'supercar'] as const;

export function glbBytes(id: string): ArrayBuffer {
  const b = readFileSync(new URL(`../../public/models/${id}.glb`, import.meta.url));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

/** Parse the exported cars from public/models (once per test file). */
export async function loadModels(): Promise<void> {
  for (const id of CAR_IDS) {
    if (!getCarTemplate(id)) registerCarTemplate(id, await parseCarGLB(glbBytes(id)));
  }
}
