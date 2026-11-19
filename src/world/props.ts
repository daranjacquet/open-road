import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { GROUP, groups, type Physics } from '../core/physics';

interface DynProp {
  body: RAPIER.RigidBody;
  mesh: THREE.InstancedMesh;
  index: number;
  /** Visual offset applied after the body transform (e.g. cone pivot). */
  yOffset: number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const PROP_GROUPS = (): number => groups(GROUP.PROP, 0xffff);
const STATIC_GROUPS = (): number => groups(GROUP.WORLD, 0xffff);

export interface WorldProps {
  group: THREE.Group;
  /** Sync instanced meshes with their rigid bodies. Call once per rendered frame. */
  update(): void;
  dynamicCount: number;
}

/**
 * Test-world props. Static: crash wall, jersey barriers, pillars, ramps, speed bumps.
 * Dynamic: crates, barrels, cones, tyres (instanced; sleeping bodies cost almost nothing).
 */
export function createWorldProps(physics: Physics): WorldProps {
  const { RAPIER, world } = physics;
  const group = new THREE.Group();
  group.name = 'props';
  const dyn: DynProp[] = [];

  const concrete = new THREE.MeshStandardMaterial({ color: 0x9a9a94, roughness: 0.95 });
  const stripe = new THREE.MeshStandardMaterial({ color: 0xd9381e, roughness: 0.8 });

  const staticBox = (cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, mat: THREE.Material, rotX = 0, rotY = 0): THREE.Mesh => {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, rotY, 0, 'YXZ'));
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(cx, cy, cz).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }));
    world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setFriction(0.9).setCollisionGroups(STATIC_GROUPS()), body);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2), mat);
    mesh.position.set(cx, cy, cz);
    mesh.quaternion.copy(q);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  // --- crash-test wall: thick, tall, wide ------------------------------------------------------------
  staticBox(0, 1.8, 62, 14, 1.8, 1.0, concrete);
  const band = new THREE.Mesh(new THREE.BoxGeometry(28.02, 0.35, 2.02), stripe);
  band.position.set(0, 1.0, 62);
  group.add(band);

  // --- jersey barriers lining the straight, slightly angled --------------------------------------------
  for (let i = 0; i < 12; i++) {
    for (const side of [-1, 1]) {
      staticBox(side * 17 + side * i * 0.25, 0.4, 8 + i * 4.2, 0.35, 0.4, 1.9, concrete, 0, side * 0.04);
    }
  }

  // --- pillars ---------------------------------------------------------------------------------------------
  for (const [x, z] of [[-9, 24], [9, 24], [-9, 40], [9, 40]] as const) {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, 2, z));
    world.createCollider(RAPIER.ColliderDesc.cylinder(2, 0.4).setCollisionGroups(STATIC_GROUPS()), body);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 4, 20), concrete);
    m.position.set(x, 2, z);
    m.castShadow = true;
    group.add(m);
  }

  // --- ramps (tilted slabs) --------------------------------------------------------------------------------
  const rampMat = new THREE.MeshStandardMaterial({ color: 0x6b7078, roughness: 0.9 });
  staticBox(40, 0.55, -40, 4, 0.2, 5.2, rampMat, -0.22, 0); // kicker, climbs towards +z
  staticBox(-40, 0.55, -40, 4, 0.2, 5.2, rampMat, -0.22, 0);
  // Speed bumps
  for (let i = 0; i < 4; i++) staticBox(0, 0.06, -70 + i * 6, 3.6, 0.12, 0.35, stripe);

  // --- dynamic props -----------------------------------------------------------------------------------------
  const addDyn = (mesh: THREE.InstancedMesh, desc: RAPIER.RigidBodyDesc, col: RAPIER.ColliderDesc, yOffset = 0): void => {
    const body = world.createRigidBody(desc);
    world.createCollider(col.setCollisionGroups(PROP_GROUPS()).setFriction(0.7).setRestitution(0.12), body);
    dyn.push({ body, mesh, index: dyn.filter((d) => d.mesh === mesh).length, yOffset });
  };

  // Crates: pyramid
  const crateGeo = new THREE.BoxGeometry(1, 1, 1);
  const crateMat = new THREE.MeshStandardMaterial({ color: 0xb98a4e, roughness: 0.85 });
  const crateCount = 15 + 10;
  const crates = new THREE.InstancedMesh(crateGeo, crateMat, crateCount);
  let ci = 0;
  for (let row = 0; row < 5; row++) {
    for (let k = 0; k < 5 - row; k++) {
      if (ci >= 15) break;
      addDyn(crates, RAPIER.RigidBodyDesc.dynamic().setTranslation(-36 + (k - (4 - row) / 2) * 1.02, 0.5 + row * 1.0, 10), RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5).setMass(40));
      ci++;
    }
  }
  // A wall of crates on the right.
  for (let r = 0; r < 2; r++) {
    for (let k = 0; k < 5; k++) {
      addDyn(crates, RAPIER.RigidBodyDesc.dynamic().setTranslation(36 + k * 1.02, 0.5 + r * 1.0, 14), RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5).setMass(40));
    }
  }
  crates.castShadow = true;
  crates.receiveShadow = true;
  group.add(crates);

  // Barrels
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x2f6db5, roughness: 0.5, metalness: 0.4 });
  const barrels = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 18), barrelMat, 16);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    addDyn(barrels, RAPIER.RigidBodyDesc.dynamic().setTranslation(30 + Math.cos(a) * 3, 0.45, 40 + Math.sin(a) * 3), RAPIER.ColliderDesc.cylinder(0.45, 0.3).setMass(28));
  }
  barrels.castShadow = true;
  group.add(barrels);

  // Cones: slalom + gate
  const coneMat = new THREE.MeshStandardMaterial({ color: 0xff6a1a, roughness: 0.6 });
  const cones = new THREE.InstancedMesh(new THREE.ConeGeometry(0.2, 0.7, 14), coneMat, 36);
  for (let i = 0; i < 12; i++) addDyn(cones, RAPIER.RigidBodyDesc.dynamic().setTranslation(i % 2 ? 4.5 : -4.5, 0.35, -105 + i * 5.5), RAPIER.ColliderDesc.cone(0.35, 0.2).setMass(2.5));
  for (let i = 0; i < 12; i++) addDyn(cones, RAPIER.RigidBodyDesc.dynamic().setTranslation(-8 + (i % 6) * 1.2, 0.35, -20 - Math.floor(i / 6) * 1.2), RAPIER.ColliderDesc.cone(0.35, 0.2).setMass(2.5));
  cones.castShadow = true;
  group.add(cones);

  // Tyre ring
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.95 });
  const tires = new THREE.InstancedMesh(new THREE.TorusGeometry(0.28, 0.12, 12, 22).rotateX(Math.PI / 2), tireMat, 18);
  for (let i = 0; i < 18; i++) {
    const a = (i / 12) * Math.PI * 2;
    const ring = i < 12 ? 0 : 1;
    addDyn(tires, RAPIER.RigidBodyDesc.dynamic().setTranslation(-24 + Math.cos(a) * 4, 0.14 + ring * 0.26, -40 + Math.sin(a) * 4), RAPIER.ColliderDesc.cylinder(0.13, 0.4).setMass(14));
  }
  tires.castShadow = true;
  group.add(tires);

  const meshes = [...new Set(dyn.map((d) => d.mesh))];
  for (const m of meshes) {
    m.count = dyn.filter((d) => d.mesh === m).length;
    m.frustumCulled = false;
  }

  const update = (): void => {
    for (const d of dyn) {
      const t = d.body.translation();
      const r = d.body.rotation();
      _p.set(t.x, t.y + d.yOffset, t.z);
      _q.set(r.x, r.y, r.z, r.w);
      _m.compose(_p, _q, _s);
      d.mesh.setMatrixAt(d.index, _m);
    }
    for (const mesh of meshes) mesh.instanceMatrix.needsUpdate = true;
  };
  update();
  return { group, update, dynamicCount: dyn.length };
}
