// Compress the Blender exports (art/build/*.glb) into public/models/ with meshopt.
// Usage: node scripts/optimize-models.mjs   (run `npm run models` first)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const src = 'art/build';
const out = 'public/models';
mkdirSync(out, { recursive: true });
for (const f of readdirSync(src).filter((f) => f.endsWith('.glb'))) {
  const input = join(src, f);
  const output = join(out, f);
  execFileSync('npx', ['gltf-transform', 'meshopt', input, output, '--level', 'medium'], { stdio: 'inherit' });
  const kb = (p) => Math.round(statSync(p).size / 1024);
  console.log(`${f}: ${kb(input)} kB -> ${kb(output)} kB`);
}
if (!existsSync(out)) process.exit(1);
