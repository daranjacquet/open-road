import type * as THREE from 'three';

/**
 * What the game needs from a car model.
 *
 * Built from the Blender exports in public/models (see art/README.md). Frame: +Y up, +Z forward,
 * +X left, metres. Every named part is a Group whose origin is its hinge / bolt point.
 */
export interface WheelNodes {
  /** Positioned at the hub, yaws with steering. Holds the caliper (does not spin). */
  pivot: THREE.Group;
  /** Child of pivot; rotates about X with wheel spin (tyre, rim, disc, nuts). */
  spin: THREE.Group;
}

/** Result of casting a ray from inside the car out through its visible shell. */
export interface ProbeHit {
  dist: number;
  /** Name of the part the ray exits through. */
  part: string;
}

export interface CarModel {
  root: THREE.Group;
  /** FL, FR, RL, RR */
  wheels: [WheelNodes, WheelNodes, WheelNodes, WheelNodes];
  /** Named parts: body, hood, trunk, door_XX, bumper_F/R, glass_*, light_XX, mirror_L/R... */
  parts: Map<string, THREE.Object3D>;
  /** Every mesh that follows the crash deformation field (everything but the wheels). */
  meshes: THREE.Mesh[];
  /** Crack overlay uniforms per glass part. */
  cracks: Map<string, { uCrack: { value: number }; uCrackCenter: { value: THREE.Vector3 } }>;
  /** Distance from `origin` along `dir` to the visible shell (undeformed), and which part it is. */
  probe(origin: [number, number, number], dir: [number, number, number], maxDist: number): ProbeHit | null;
  dispose(): void;
}

/** userData keys set on every deformable mesh by the loader. */
export interface DeformableMeshData {
  /** Undeformed positions in the mesh's local space. */
  rest: Float32Array;
  /** Undeformed normals in the mesh's local space. */
  restNormal: Float32Array;
  /** Mesh-local -> chassis transform at rest (column-major 4x4). */
  restMatrix: number[];
  /** Name of the part the mesh belongs to. */
  part: string;
}
