import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

export interface GameScene {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  /** Keep the shadow frustum tight around a world position. */
  followSun(target: THREE.Vector3): void;
  resize(): void;
}

const SUN_DIR = new THREE.Vector3(0.45, 0.62, 0.3).normalize();

export function createScene(canvas: HTMLCanvasElement): GameScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const fogColor = new THREE.Color(0xb9cde0);
  scene.fog = new THREE.Fog(fogColor, 150, 1100);

  const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 3000);
  camera.position.set(0, 4, -9);

  // Procedural sky (no texture download).
  const sky = new Sky();
  sky.scale.setScalar(2500);
  const u = sky.material.uniforms;
  u['turbidity']!.value = 4;
  u['rayleigh']!.value = 1.6;
  u['mieCoefficient']!.value = 0.004;
  u['mieDirectionalG']!.value = 0.8;
  u['sunPosition']!.value.copy(SUN_DIR).multiplyScalar(1000);
  scene.add(sky);

  const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x6b6a58, 1.1);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff1dc, 3.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  const S = 45;
  sc.left = -S;
  sc.right = S;
  sc.top = S;
  sc.bottom = -S;
  sc.near = 1;
  sc.far = 220;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);
  scene.add(sun.target);

  const snap = 2 * S / 2048; // texel size: snap the light to avoid shadow shimmer
  const followSun = (target: THREE.Vector3): void => {
    const x = Math.round(target.x / snap) * snap;
    const z = Math.round(target.z / snap) * snap;
    sun.target.position.set(x, 0, z);
    sun.position.set(x + SUN_DIR.x * 120, SUN_DIR.y * 120, z + SUN_DIR.z * 120);
    sun.target.updateMatrixWorld();
  };
  followSun(new THREE.Vector3());

  const resize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();

  return { renderer, scene, camera, sun, followSun, resize };
}
