import * as THREE from 'three';

/**
 * Upload every texture used by the materials under `root` (otherwise done on the first draw):
 * their texture properties, plus any listed in `material.userData.textures` (shader uniforms).
 */
export function uploadTextures(renderer: THREE.WebGLRenderer, root: THREE.Object3D): void {
  const textures = new Set<THREE.Texture>();
  root.traverse((o) => {
    const mats = (o as THREE.Mesh).material;
    for (const m of Array.isArray(mats) ? mats : mats ? [mats] : []) {
      for (const v of Object.values(m)) if (v instanceof THREE.Texture) textures.add(v);
      const extra = (m.userData as { textures?: THREE.Texture[] }).textures;
      if (extra) for (const t of extra) textures.add(t);
    }
  });
  for (const t of textures) renderer.initTexture(t);
}

/**
 * Do the GPU work of showing `root` for the first time ahead of time: compile its shaders (with the
 * lights and environment of `lightsFrom`, so the programs match the game scene) and upload its
 * textures. A failure only means that work happens on the first frame instead. Returns the time
 * spent on each (ms).
 */
export async function warmUp(renderer: THREE.WebGLRenderer, root: THREE.Object3D, camera: THREE.Camera, lightsFrom: THREE.Scene): Promise<{ compile: number; upload: number }> {
  const t0 = performance.now();
  try {
    await renderer.compileAsync(root, camera, lightsFrom);
  } catch (err) {
    console.warn('[warmup] Shader compilation failed; it will happen on first render.', err);
  }
  const t1 = performance.now();
  uploadTextures(renderer, root);
  return { compile: Math.round(t1 - t0), upload: Math.round(performance.now() - t1) };
}
