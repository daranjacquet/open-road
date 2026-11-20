// ESLint (flat config): TypeScript rules plus the layering of src/.
//
//   core  <-  vehicle, damage (simulation)  <-  render, world, audio, debug  <-  game  <-  ui  <-  main
//
// A folder may only import from the layers below it. Type-only imports are allowed in two places:
// damage may name render's model types (the meshes it deforms), and game may name ui's types (the
// HUD and garage it drives); neither pulls code from the layer above.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const upper = (...dirs) => dirs.map((d) => ({ group: [`**/${d}/*`, `../${d}/*`, `./${d}/*`], message: `Layering: this folder must not import from src/${d}.` }));

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'art/**', 'public/**', '.claude/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Non-null assertions are used deliberately on typed-array and fixed-size index reads.
      '@typescript-eslint/no-non-null-assertion': 'off',
      eqeqeq: ['error', 'smart'],
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
    },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: { '@typescript-eslint/no-restricted-imports': ['error', { patterns: upper('vehicle', 'damage', 'render', 'world', 'audio', 'debug', 'ui', 'game') }] },
  },
  {
    files: ['src/vehicle/**/*.ts'],
    rules: { '@typescript-eslint/no-restricted-imports': ['error', { patterns: upper('render', 'world', 'audio', 'debug', 'ui', 'game') }] },
  },
  {
    files: ['src/damage/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            ...upper('world', 'audio', 'debug', 'ui', 'game'),
            { group: ['**/render/*', '../render/*'], allowTypeImports: true, message: 'Layering: damage may only import types from render.' },
          ],
        },
      ],
    },
  },
  {
    files: ['src/render/**/*.ts', 'src/world/**/*.ts', 'src/audio/**/*.ts', 'src/debug/**/*.ts'],
    rules: { '@typescript-eslint/no-restricted-imports': ['error', { patterns: upper('game', 'ui') }] },
  },
  {
    files: ['src/game/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        { patterns: [{ group: ['**/ui/*', '../ui/*'], allowTypeImports: true, message: 'Layering: game may only import types from ui.' }] },
      ],
    },
  },
  {
    // Tests print their measurements.
    files: ['tests/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['scripts/**/*.mjs', 'eslint.config.js'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly' } },
  },
);
