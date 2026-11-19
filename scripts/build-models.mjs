// Build the game cars from the third-party models in art/sources (see art/README.md).
// Usage: node scripts/build-models.mjs [id ...]      (all cars with a mapping in art/imports/)
// For each car: Blender import (parts, pivots, wheels, materials) -> meshopt compression -> fit the
// physics geometry in src/vehicle/cars/<id>.json to the model.
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const ids = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync('art/imports').filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
for (const id of ids) {
  execFileSync('blender', ['-b', '--factory-startup', '-P', 'art/import_car.py', '--', id], { stdio: 'inherit' });
}
execFileSync('node', ['scripts/optimize-models.mjs', ...ids], { stdio: 'inherit' });
for (const id of ids) execFileSync('node', ['scripts/fit-car-config.mjs', id], { stdio: 'inherit' });
