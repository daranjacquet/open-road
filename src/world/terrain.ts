import * as THREE from 'three';
import { GROUP, groups, type Physics } from '../core/physics';
import type { Heightmap } from './heightmap';

/** Cells per chunk side (512 m chunks over a 1024-cell grid: 8 x 8 chunks). */
const CHUNK = 128;
/** Per level of detail: distance it is used up to (m), how far it sinks, how deep its skirt hangs. */
const LODS = [
  { upTo: 380, sink: 0, skirt: 3 },
  { upTo: 950, sink: 0.25, skirt: 8 },
  { upTo: 1750, sink: 0.9, skirt: 20 },
  { upTo: Infinity, sink: 2.5, skirt: 50 },
];
/** Chunks further than this (m) are not drawn (the fog is opaque well before). */
const DRAW_DISTANCE = 2400;

export interface TerrainView {
  group: THREE.Group;
  material: THREE.MeshStandardMaterial;
  /** Pick each chunk's level of detail and cull it against the camera. */
  update(camera: THREE.Camera): void;
  dispose(): void;
}

/** The heightfield collider: the open ground everywhere (its grip comes from the surface map). */
export function createTerrainCollider(physics: Physics, hm: Heightmap): void {
  const { RAPIER, world } = physics;
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const collider = world.createCollider(
    RAPIER.ColliderDesc.heightfield(hm.n, hm.n, hm.heights, { x: hm.size, y: 1, z: hm.size }, RAPIER.HeightFieldFlags.FIX_INTERNAL_EDGES)
      .setFriction(1.0)
      .setRestitution(0)
      .setCollisionGroups(groups(GROUP.WORLD, 0xffff)),
    body,
  );
  physics.groundColliders.add(collider.handle);
}

/**
 * One chunk grid per level of detail, shared by every chunk: flat in x/z, the vertex shader reads
 * the height from a texture. Same triangle split as the physics heightfield. A skirt hangs from
 * the border so neighbours at another level of detail never show a crack.
 */
function chunkGeometry(level: number, cell: number): THREE.BufferGeometry {
  const step = 1 << level;
  const q = CHUNK / step;
  const s = step * cell;
  const { sink, skirt } = LODS[level]!;
  const pos: number[] = [];
  const idx: number[] = [];
  const v = q + 1;
  for (let i = 0; i <= q; i++) for (let j = 0; j <= q; j++) pos.push(i * s, -sink, j * s);
  const at = (i: number, j: number): number => i * v + j;
  for (let i = 0; i < q; i++) {
    for (let j = 0; j < q; j++) {
      const a = at(i, j);
      const b = at(i + 1, j);
      const c = at(i, j + 1);
      const d = at(i + 1, j + 1);
      idx.push(a, c, b, b, c, d);
    }
  }
  // Skirt: a copy of the border pushed down, stitched to it, drawn from both sides.
  const border: number[] = [];
  for (let j = 0; j < q; j++) border.push(at(0, j));
  for (let i = 0; i < q; i++) border.push(at(i, q));
  for (let j = q; j > 0; j--) border.push(at(q, j));
  for (let i = q; i > 0; i--) border.push(at(i, 0));
  const base = pos.length / 3;
  for (const b of border) pos.push(pos[b * 3]!, -sink - skirt, pos[b * 3 + 2]!);
  for (let k = 0; k < border.length; k++) {
    const a = border[k]!;
    const b = border[(k + 1) % border.length]!;
    const a2 = base + k;
    const b2 = base + ((k + 1) % border.length);
    idx.push(a, b, a2, b, b2, a2, a, a2, b, b, a2, b2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aStep', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3).fill(step), 1));
  g.setIndex(idx);
  return g;
}

/**
 * Tiling noise, two octaves in one texture: R at the texture's scale, G the same noise `k` times
 * finer (one texture read gives both).
 */
function noiseTexture(size: number, seed: number, smooth: boolean, k: number): THREE.DataTexture {
  const data = new Uint8Array(size * size);
  let a = seed >>> 0;
  const rnd = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  if (!smooth) {
    for (let i = 0; i < data.length; i++) data[i] = 70 + rnd() * 130;
  } else {
    // Smooth tiling value noise: a few octaves of a wrapped lattice.
    const acc = new Float32Array(size * size);
    let amp = 1;
    let norm = 0;
    for (let cells = 4; cells <= 32; cells *= 2) {
      const lat = new Float32Array(cells * cells).map(() => rnd());
      const k = size / cells;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const gx = x / k;
          const gy = y / k;
          const x0 = Math.floor(gx);
          const y0 = Math.floor(gy);
          const fx = gx - x0;
          const fy = gy - y0;
          const ux = fx * fx * (3 - 2 * fx);
          const uy = fy * fy * (3 - 2 * fy);
          const l = (i: number, j: number): number => lat[(j % cells) * cells + (i % cells)]!;
          const v = l(x0, y0) * (1 - ux) * (1 - uy) + l(x0 + 1, y0) * ux * (1 - uy) + l(x0, y0 + 1) * (1 - ux) * uy + l(x0 + 1, y0 + 1) * ux * uy;
          acc[y * size + x] += v * amp;
        }
      }
      norm += amp;
      amp *= 0.5;
    }
    for (let i = 0; i < data.length; i++) data[i] = Math.round((acc[i]! / norm) * 255);
  }
  const rg = new Uint8Array(size * size * 2);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      rg[(y * size + x) * 2] = data[y * size + x]!;
      rg[(y * size + x) * 2 + 1] = data[((y * k) % size) * size + ((x * k) % size)]!;
    }
  }
  const t = new THREE.DataTexture(rg, size, size, THREE.RGFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/**
 * Terrain material: a standard (lit, shadowed, fogged) material whose vertex shader displaces the
 * flat chunk grids from the height texture, and whose colour mixes grass, forest floor, fields,
 * dirt, sand, rock on steep slopes and snow on the peaks.
 */
function terrainMaterial(hm: Heightmap, splat: THREE.DataTexture): THREE.MeshStandardMaterial {
  const heightTex = new THREE.DataTexture(hm.heights, hm.verts, hm.verts, THREE.RedFormat, THREE.FloatType);
  heightTex.magFilter = heightTex.minFilter = THREE.NearestFilter;
  heightTex.generateMipmaps = false;
  heightTex.needsUpdate = true;
  const uniforms = {
    uHeight: { value: heightTex },
    uSplat: { value: splat },
    uDetail: { value: noiseTexture(256, 11, false, 3) },
    uNoise: { value: noiseTexture(256, 23, true, 5) },
    uCell: { value: hm.cell },
    uHalf: { value: hm.half },
    uVerts: { value: hm.verts },
    uLast: { value: hm.verts - 1 },
  };
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
  mat.name = 'terrain';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
uniform highp sampler2D uHeight;
uniform float uCell;
uniform float uHalf;
uniform int uLast;
attribute float aStep;
varying vec3 vTWorld;
varying vec3 vTNormal;
float tH(int ix, int iz) { return texelFetch(uHeight, ivec2(clamp(iz, 0, uLast), clamp(ix, 0, uLast)), 0).r; }`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        /* glsl */ `vec4 tBase = modelMatrix * vec4(position.x, 0.0, position.z, 1.0);
int tix = int(floor((tBase.x + uHalf) / uCell + 0.5));
int tiz = int(floor((tBase.z + uHalf) / uCell + 0.5));
int tk = int(aStep);
float tY = tH(tix, tiz);
vec3 objectNormal = normalize(vec3(tH(tix - tk, tiz) - tH(tix + tk, tiz), 2.0 * float(tk) * uCell, tH(tix, tiz - tk) - tH(tix, tiz + tk)));
vTNormal = objectNormal;`,
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `vec3 transformed = vec3(position.x, tY + position.y, position.z);
vTWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
uniform sampler2D uSplat;
uniform sampler2D uDetail;
uniform sampler2D uNoise;
uniform float uCell;
uniform float uHalf;
uniform float uVerts;
varying vec3 vTWorld;
varying vec3 vTNormal;`,
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `{
  vec3 tN = normalize(vTNormal);
  vec2 tW = vTWorld.xz;
  vec4 sp = texture2D(uSplat, vec2((tW.y + uHalf) / uCell + 0.5, (tW.x + uHalf) / uCell + 0.5) / uVerts);
  vec2 macroS = texture2D(uNoise, tW / 310.0).rg;
  float macro = macroS.r;
  float macro2 = macroS.g;
  vec2 detS = texture2D(uDetail, tW / 6.0).rg;
  float det = detS.r;
  float det2 = detS.g;
  float fine = 0.82 + 0.22 * det + 0.14 * det2;
  vec3 grass = mix(vec3(0.115, 0.2, 0.06), vec3(0.24, 0.29, 0.09), macro) * (0.85 + 0.3 * macro2) * fine;
  vec3 forest = vec3(0.085, 0.12, 0.05) * fine;
  float rows = 0.86 + 0.14 * sin(tW.x * 1.9 + macro2 * 3.0);
  vec3 crops = mix(vec3(0.5, 0.41, 0.16), vec3(0.2, 0.3, 0.08), smoothstep(0.35, 0.75, sp.b)) * rows * fine;
  vec3 dirt = vec3(0.24, 0.18, 0.12) * (0.7 + 0.5 * det) * (0.9 + 0.2 * macro2);
  vec3 sand = vec3(0.42, 0.36, 0.25) * (0.86 + 0.24 * det);
  float rockW = smoothstep(0.8, 0.64, tN.y);
  float rockDet = rockW > 0.0 ? texture2D(uDetail, vec2(tW.x + tW.y, vTWorld.y * 1.6) / 5.0).r : 0.5;
  vec3 rock = vec3(0.15, 0.142, 0.128) * (0.65 + 0.7 * rockDet) * (0.85 + 0.3 * macro);
  vec3 tc = grass;
  tc = mix(tc, forest, sp.a);
  tc = mix(tc, crops, smoothstep(0.02, 0.1, sp.b));
  tc = mix(tc, dirt, sp.r);
  tc = mix(tc, sand, sp.g);
  tc = mix(tc, rock, rockW);
  float snow = smoothstep(265.0, 305.0, vTWorld.y + macro * 40.0) * smoothstep(0.55, 0.75, tN.y);
  tc = mix(tc, vec3(0.86, 0.88, 0.9), snow);
  diffuseColor.rgb *= tc;
}`,
      );
  };
  mat.customProgramCacheKey = () => 'terrain-v3';
  mat.userData.textures = [heightTex, splat, uniforms.uDetail.value, uniforms.uNoise.value];
  return mat;
}

/** Ground colours painted per terrain vertex: R dirt, G sand, B field crop (hue), A forest floor. */
export function splatTexture(hm: Heightmap, data: Uint8Array): THREE.DataTexture {
  const t = new THREE.DataTexture(data, hm.verts, hm.verts, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** The visible terrain: 8 x 8 chunks, each drawn at the level of detail its distance calls for. */
export function createTerrainView(hm: Heightmap, splat: THREE.DataTexture): TerrainView {
  const group = new THREE.Group();
  group.name = 'terrain';
  const material = terrainMaterial(hm, splat);
  const geos = LODS.map((_, l) => chunkGeometry(l, hm.cell));
  const per = hm.n / CHUNK;
  const span = CHUNK * hm.cell;
  const chunks: { mesh: THREE.Mesh; box: THREE.Box3; level: number }[] = [];
  for (let cx = 0; cx < per; cx++) {
    for (let cz = 0; cz < per; cz++) {
      const [lo, hi] = hm.range(cx * CHUNK, cz * CHUNK, (cx + 1) * CHUNK, (cz + 1) * CHUNK);
      const x0 = hm.coord(cx * CHUNK);
      const z0 = hm.coord(cz * CHUNK);
      const mesh = new THREE.Mesh(geos[3]!, material);
      mesh.position.set(x0, 0, z0);
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.name = `terrain-${cx}-${cz}`;
      group.add(mesh);
      chunks.push({ mesh, box: new THREE.Box3(new THREE.Vector3(x0, lo - 60, z0), new THREE.Vector3(x0 + span, hi + 1, z0 + span)), level: 3 });
    }
  }
  const frustum = new THREE.Frustum();
  const m = new THREE.Matrix4();
  const update = (camera: THREE.Camera): void => {
    camera.updateMatrixWorld();
    m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(m);
    const cp = camera.position;
    for (const c of chunks) {
      const dx = Math.max(c.box.min.x - cp.x, 0, cp.x - c.box.max.x);
      const dz = Math.max(c.box.min.z - cp.z, 0, cp.z - c.box.max.z);
      const d = Math.hypot(dx, dz);
      const visible = d < DRAW_DISTANCE && frustum.intersectsBox(c.box);
      c.mesh.visible = visible;
      if (!visible) continue;
      let level = 0;
      while (d > LODS[level]!.upTo) level++;
      if (level !== c.level) {
        c.level = level;
        c.mesh.geometry = geos[level]!;
      }
    }
  };
  return {
    group,
    material,
    update,
    dispose() {
      for (const g of geos) g.dispose();
      material.dispose();
    },
  };
}
