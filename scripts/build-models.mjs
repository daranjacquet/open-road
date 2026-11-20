// Build the game models from the third-party models in art/sources (see art/README.md).
// Usage: node scripts/build-models.mjs [id ...]      (every model with a mapping in art/imports/)
// For each car: Blender import (parts, pivots, wheels, materials) -> meshopt compression -> fit the
// physics geometry in src/vehicle/cars/<id>.json to the model. The aircraft (`plane`) has its own
// import (parts, control-surface hinges); its flight model in src/vehicle/aircraft/sr22.json is
// fitted by hand and checked against the model by tests/aircraft-model.test.ts.
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const AIRCRAFT = new Set(['plane']);
const ids = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync('art/imports').filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
for (const id of ids) {
  const script = AIRCRAFT.has(id) ? 'art/import_plane.py' : 'art/import_car.py';
  execFileSync('blender', ['-b', '--factory-startup', '-P', script, '--', id], { stdio: 'inherit' });
}
execFileSync('node', ['scripts/optimize-models.mjs', ...ids], { stdio: 'inherit' });
for (const id of ids) if (!AIRCRAFT.has(id)) execFileSync('node', ['scripts/fit-car-config.mjs', id], { stdio: 'inherit' });
