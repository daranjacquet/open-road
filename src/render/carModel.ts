import * as THREE from 'three';

/**
 * What the rest of the game needs from a car model, whatever produced it
 * (procedural generator, Blender GLB, placeholder).
 *
 * Naming convention (also used by the Blender scripts in /art):
 *   body, hood, trunk, door_FL/FR/RL/RR, bumper_F/R, glass_*, light_*, mirror_L/R,
 *   wheel_FL/FR/RL/RR, interior
 * Every part's origin is its pivot / fixation point, expressed in the chassis frame
 * (+Y up, +Z forward, +X left, 1 unit = 1 m).
 */
export interface WheelNodes {
  /** Positioned at the hub, yaws with steering. */
  pivot: THREE.Group;
  /** Child of pivot; rotates about X with wheel spin. */
  spin: THREE.Group;
}

export interface CarModel {
  root: THREE.Group;
  /** FL, FR, RL, RR */
  wheels: [WheelNodes, WheelNodes, WheelNodes, WheelNodes];
  /** Named parts for damage (dents, detachment). */
  parts: Map<string, THREE.Mesh>;
  dispose(): void;
}
