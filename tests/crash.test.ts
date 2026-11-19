import { beforeAll, describe, expect, it } from 'vitest';
import { loadModels } from './helpers/models';
import { crash } from './helpers/crash';

beforeAll(loadModels);

describe('crumple zones and crash pulses', () => {
  it('a 50 km/h wall hit crushes the nose over tens of ms and absorbs most of the energy', async () => {
    const r = await crash('sedan', 50);
    console.log('sedan 50:', r.frontCrush.toFixed(2), 'm crush,', r.energyKJ.toFixed(0), 'kJ,', r.peakG.toFixed(0), 'g');
    expect(r.frontCrush).toBeGreaterThan(0.15);
    expect(r.frontCrush).toBeLessThan(0.55);
    expect(r.energyKJ).toBeGreaterThan(100);
    expect(r.peakG).toBeLessThan(120);
  });

  it('a 100 km/h wall hit crushes the front deeply', async () => {
    const r = await crash('sedan', 100);
    console.log('sedan 100:', r.frontCrush.toFixed(2), 'm crush,', r.energyKJ.toFixed(0), 'kJ,', r.peakG.toFixed(0), 'g');
    expect(r.frontCrush).toBeGreaterThan(0.45);
    expect(r.energyKJ).toBeGreaterThan(350);
  });

  it('a 20 km/h tap leaves only light damage', async () => {
    const r = await crash('sedan', 20);
    console.log('sedan 20:', r.frontCrush.toFixed(3), 'm crush,', r.energyKJ.toFixed(0), 'kJ');
    expect(r.frontCrush).toBeLessThan(0.1);
  });
});
