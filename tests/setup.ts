// Browser globals some three.js loaders expect (meshopt decoder, GLTF texture loading).
const g = globalThis as unknown as Record<string, unknown>;
g['self'] ??= globalThis;
