import { defineConfig } from 'vite';

// Relative base so the build works on GitHub Pages under /<repo>/ and locally.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    // Rapier ships its WASM inlined (base64), so its chunk is large by design.
    chunkSizeWarningLimit: 4600,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'rapier', test: /rapier3d-compat/ },
            { name: 'three', test: /node_modules[\\/]three[\\/]/ },
          ],
        },
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    environment: 'node',
    // Physics simulations run in parallel files; under load a few take more than 5 s.
    testTimeout: 30_000,
  },
});
