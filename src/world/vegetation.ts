import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type RAPIER from '@dimforge/rapier3d-compat';
import { GROUP, groups, type Physics } from '../core/physics';
import { TREE_STRIDE } from './vegetation-scatter';

/** Vertex colours, no UVs, indexed (shared vertices: the flat-shaded material needs no normals). */
function painted(g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const ng = mergeVertices(g.deleteAttribute('uv').deleteAttribute('normal'));
  const col = new THREE.Color(hex);
  const n = ng.getAttribute('position').count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set([col.r, col.g, col.b], i * 3);
  ng.setAttribute('color', new THREE.BufferAttribute(c, 3));
  ng.computeVertexNormals();
  return ng;
}

/** Tree models: [kind][near, far]. Origin at the foot, about 10 m tall at scale 1. */
function treeGeometries(): THREE.BufferGeometry[][] {
  const bark = 0x4b3826;
  const pine = 0x24412a;
  const leaf = 0x3f6a2b;
  const conifer = mergeGeometries([
    painted(new THREE.CylinderGeometry(0.17, 0.26, 2.6, 5, 1, true).translate(0, 1.3, 0), bark),
    painted(new THREE.ConeGeometry(2.5, 4.4, 7).translate(0, 3.9, 0), pine),
    painted(new THREE.ConeGeometry(1.95, 3.9, 7).translate(0, 6.2, 0), pine),
    painted(new THREE.ConeGeometry(1.25, 3.4, 7).translate(0, 8.4, 0), pine),
  ])!;
  const coniferFar = painted(new THREE.ConeGeometry(2.4, 9.2, 5, 1, true).translate(0, 5.6, 0), pine);
  const broad = mergeGeometries([
    painted(new THREE.CylinderGeometry(0.2, 0.32, 3.4, 5, 1, true).translate(0, 1.7, 0), bark),
    painted(new THREE.IcosahedronGeometry(2.9, 1).scale(1, 0.9, 1).translate(0, 5.2, 0), leaf),
  ])!;
  const broadFar = painted(new THREE.OctahedronGeometry(3.0, 0).scale(1, 0.95, 1).translate(0, 4.9, 0), leaf);
  return [
    [conifer, coniferFar],
    [broad, broadFar],
  ];
}

/** Draw only the instances whose distance to the camera is within [uRange.x, uRange.y). */
function rangedMaterial(range: THREE.Vector2): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
  m.onBeforeCompile = (shader) => {
    shader.uniforms['uRange'] = { value: range };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec2 uRange;')
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
#ifdef USE_INSTANCING
{
  vec3 tp = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float td = distance(tp.xz, cameraPosition.xz);
  if (td < uRange.x || td >= uRange.y) transformed = vec3(0.0);
}
#endif`,
      );
  };
  m.customProgramCacheKey = () => 'ranged-tree';
  return m;
}

/** Trees nearer than this are drawn with the detailed model. */
const NEAR = 170;
/** Detailed trees nearer than this cast shadows (the shadow map only covers the car's surroundings). */
const SHADOW = 70;
/** Trees further than this are not drawn. */
const FAR = 1900;
/** Side of the blocks the far trees are grouped in (each block is culled on its own). */
const BLOCK = 512;
/** Collider pool around the player. */
const POOL = 320;
const COLLIDE_RADIUS = 70;

export interface Vegetation {
  group: THREE.Group;
  count: number;
  /** Per frame: near/far split around the camera, block culling, colliders around the player. */
  update(camera: THREE.Vector3, player: THREE.Vector3): void;
}

/**
 * All the scattered trees. Far models sit in static instanced meshes, one per 512 m block and kind,
 * culled against the camera like any mesh (the shader drops those near the camera); the detailed
 * models of the trees around the camera are refilled as it moves, the nearest ones casting shadows.
 * Colliders come from a small pool that follows the player.
 */
export function createVegetation(physics: Physics, trees: Float32Array): Vegetation {
  const { RAPIER, world } = physics;
  const group = new THREE.Group();
  group.name = 'vegetation';
  const count = trees.length / TREE_STRIDE;
  const geos = treeGeometries();
  const shadowMat = rangedMaterial(new THREE.Vector2(0, SHADOW));
  const nearMat = rangedMaterial(new THREE.Vector2(SHADOW, NEAR));
  const farMat = rangedMaterial(new THREE.Vector2(NEAR, FAR));

  // Spatial grid (64 m cells) for near queries.
  const G = 64;
  const half = 2048;
  const gn = Math.ceil((2 * half) / G);
  const cellOf = (x: number, z: number): number => Math.min(gn - 1, Math.max(0, Math.floor((x + half) / G))) * gn + Math.min(gn - 1, Math.max(0, Math.floor((z + half) / G)));
  const start = new Int32Array(gn * gn + 1);
  for (let t = 0; t < count; t++) start[cellOf(trees[t * TREE_STRIDE]!, trees[t * TREE_STRIDE + 2]!) + 1]++;
  for (let i = 0; i < gn * gn; i++) start[i + 1] += start[i]!;
  const order = new Int32Array(count);
  const fill = start.slice(0, gn * gn);
  for (let t = 0; t < count; t++) order[fill[cellOf(trees[t * TREE_STRIDE]!, trees[t * TREE_STRIDE + 2]!)]++] = t;

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color();
  const treeMatrix = (t: number): THREE.Matrix4 => {
    const o = t * TREE_STRIDE;
    const sc = trees[o + 3]!;
    q.setFromAxisAngle(up, trees[o + 4]!);
    // Sunk a little so the trunk meets sloping ground.
    return m.compose(p.set(trees[o]!, trees[o + 1]! - 0.3, trees[o + 2]!), q, s.set(sc, sc * (0.9 + 0.25 * ((t * 0.618) % 1)), sc));
  };
  const tint = (t: number): THREE.Color => {
    const k = 0.78 + 0.4 * ((t * 0.7548) % 1);
    return col.setRGB(k, k * (0.95 + 0.1 * ((t * 0.5698) % 1)), k * 0.92);
  };

  // Far: every tree, static, in blocks.
  const per = Math.ceil((2 * half) / BLOCK);
  const blocks: { mesh: THREE.InstancedMesh; cx: number; cz: number }[] = [];
  const lists: number[][] = Array.from({ length: per * per * 2 }, () => []);
  for (let t = 0; t < count; t++) {
    const o = t * TREE_STRIDE;
    const bx = Math.min(per - 1, Math.max(0, Math.floor((trees[o]! + half) / BLOCK)));
    const bz = Math.min(per - 1, Math.max(0, Math.floor((trees[o + 2]! + half) / BLOCK)));
    lists[(bx * per + bz) * 2 + trees[o + 5]!]!.push(t);
  }
  lists.forEach((list, k) => {
    if (!list.length) return;
    const kind = k % 2;
    const b = Math.floor(k / 2);
    const mesh = new THREE.InstancedMesh(geos[kind]![1]!, farMat, list.length);
    list.forEach((t, i) => {
      mesh.setMatrixAt(i, treeMatrix(t));
      mesh.setColorAt(i, tint(t));
    });
    mesh.computeBoundingSphere();
    mesh.matrixAutoUpdate = false;
    mesh.name = `trees-far-${kind}`;
    group.add(mesh);
    blocks.push({ mesh, cx: (Math.floor(b / per) + 0.5) * BLOCK - half, cz: ((b % per) + 0.5) * BLOCK - half });
  });

  // Near: refilled around the camera; the nearest ones cast shadows.
  const CAP = 2200;
  const near = [shadowMat, nearMat].flatMap((mat, ring) =>
    [0, 1].map((kind) => {
      const mesh = new THREE.InstancedMesh(geos[kind]![0]!, mat, CAP);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = ring === 0;
      mesh.receiveShadow = true;
      mesh.name = `trees-near-${ring}-${kind}`;
      mesh.setColorAt(0, col.setRGB(1, 1, 1));
      group.add(mesh);
      return mesh;
    }),
  );
  const lastNear = new THREE.Vector3(1e9, 0, 0);
  const fillNear = (cx: number, cz: number): void => {
    const r = NEAR + 30;
    const rs = SHADOW + 30;
    for (const mesh of near) mesh.count = 0;
    const c0 = Math.max(0, Math.floor((cx - r + half) / G));
    const c1 = Math.min(gn - 1, Math.floor((cx + r + half) / G));
    const d0 = Math.max(0, Math.floor((cz - r + half) / G));
    const d1 = Math.min(gn - 1, Math.floor((cz + r + half) / G));
    for (let a = c0; a <= c1; a++) {
      for (let b = d0; b <= d1; b++) {
        const cell = a * gn + b;
        for (let k = start[cell]!; k < start[cell + 1]!; k++) {
          const t = order[k]!;
          const o = t * TREE_STRIDE;
          const d2 = (trees[o]! - cx) ** 2 + (trees[o + 2]! - cz) ** 2;
          if (d2 > r * r) continue;
          // Ring 0 (shadows) covers [0, 70) m, ring 1 [70, 170) m, each with 30 m of slack for
          // the camera moving until the next refill; the shader trims each ring exactly.
          const kind = trees[o + 5]!;
          for (let ring = 0; ring < 2; ring++) {
            if (ring === 0 && d2 > rs * rs) continue;
            if (ring === 1 && d2 < (SHADOW - 30) ** 2) continue;
            const mesh = near[ring * 2 + kind]!;
            if (mesh.count >= CAP) continue;
            mesh.setMatrixAt(mesh.count, treeMatrix(t));
            mesh.setColorAt(mesh.count, tint(t));
            mesh.count++;
          }
        }
      }
    }
    for (const mesh of near) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.needsUpdate = true;
    }
  };

  // Collider pool following the player.
  const pool: RAPIER.RigidBody[] = [];
  for (let i = 0; i < POOL; i++) {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -1000 - i * 4, 0));
    world.createCollider(RAPIER.ColliderDesc.cylinder(1.6, 0.3).setTranslation(0, 1.6, 0).setFriction(0.8).setCollisionGroups(groups(GROUP.WORLD, 0xffff)), body);
    pool.push(body);
  }
  const lastCol = new THREE.Vector3(1e9, 0, 0);
  const fillColliders = (cx: number, cz: number): void => {
    let used = 0;
    const r = COLLIDE_RADIUS;
    const c0 = Math.max(0, Math.floor((cx - r + half) / G));
    const c1 = Math.min(gn - 1, Math.floor((cx + r + half) / G));
    const d0 = Math.max(0, Math.floor((cz - r + half) / G));
    const d1 = Math.min(gn - 1, Math.floor((cz + r + half) / G));
    for (let a = c0; a <= c1 && used < POOL; a++) {
      for (let b = d0; b <= d1 && used < POOL; b++) {
        const cell = a * gn + b;
        for (let k = start[cell]!; k < start[cell + 1]! && used < POOL; k++) {
          const o = order[k]! * TREE_STRIDE;
          if ((trees[o]! - cx) ** 2 + (trees[o + 2]! - cz) ** 2 > r * r) continue;
          pool[used++]!.setTranslation({ x: trees[o]!, y: trees[o + 1]! - 0.3, z: trees[o + 2]! }, false);
        }
      }
    }
    for (let i = used; i < POOL; i++) pool[i]!.setTranslation({ x: 0, y: -1000 - i * 4, z: 0 }, false);
  };

  return {
    group,
    count,
    update(camera, player) {
      for (const b of blocks) {
        const dx = Math.max(Math.abs(camera.x - b.cx) - BLOCK / 2, 0);
        const dz = Math.max(Math.abs(camera.z - b.cz) - BLOCK / 2, 0);
        b.mesh.visible = dx * dx + dz * dz < FAR * FAR;
      }
      if ((camera.x - lastNear.x) ** 2 + (camera.z - lastNear.z) ** 2 > 20 * 20) {
        lastNear.copy(camera);
        fillNear(camera.x, camera.z);
      }
      if ((player.x - lastCol.x) ** 2 + (player.z - lastCol.z) ** 2 > 12 * 12) {
        lastCol.copy(player);
        fillColliders(player.x, player.z);
      }
    },
  };
}
