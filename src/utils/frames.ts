// The one place where MuJoCo's frame meets three.js.
//
// MuJoCo (and the Asimov MJCF): metres, Z up, robot faces +X, +Y to the robot's left.
// three.js scene: metres, Y up. Everything robot-related is built in MuJoCo coordinates
// under a single group rotated -90 degrees about X, which maps (x, y, z) -> (x, z, -y).
// That is the same swizzle the upstream viewer applies per vertex (mujocoUtils.js).
import { Group, Quaternion, Vector3 } from 'three';

export type Vec3 = [number, number, number];
/** MuJoCo quaternion order: w, x, y, z. */
export type MjQuat = [number, number, number, number];

/** Rotation applied to the MuJoCo-frame root group. */
export const MJ_ROOT_ROTATION_X = -Math.PI / 2;

export function createMujocoFrameRoot(name = 'mujoco-frame'): Group {
  const g = new Group();
  g.name = name;
  g.rotation.x = MJ_ROOT_ROTATION_X;
  return g;
}

/** A MuJoCo world point expressed in three.js world coordinates (no group needed). */
export function mjToThree(v: Readonly<Vec3> | ArrayLike<number>, out = new Vector3()): Vector3 {
  return out.set(v[0], v[2], -v[1]);
}

/** A three.js world point expressed in MuJoCo world coordinates. */
export function threeToMj(v: Vector3): Vec3 {
  return [v.x, -v.z, v.y];
}

/** MuJoCo (w, x, y, z) quaternion -> three.js Quaternion, same frame (no axis change). */
export function mjQuat(q: Readonly<MjQuat> | ArrayLike<number>, out = new Quaternion()): Quaternion {
  return out.set(q[1], q[2], q[3], q[0]);
}

/** Direction of MuJoCo world +Z (up) in three.js world: +Y. Used by tests. */
export const MJ_UP_IN_THREE: Vec3 = [0, 1, 0];
