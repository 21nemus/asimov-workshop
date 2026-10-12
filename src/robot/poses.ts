// Named robot poses with their provenance.
import { HINGES } from './kinematics.ts';
import type { RobotRig } from './rig.ts';
import { Matrix4, Vector3 } from 'three';

/**
 * The policy's trained standing pose: env.yaml scene.robot.init_state.joint_pos of
 * checkpoint model_aug_18_1 (SIM VALUE). Also what the upstream viewer resets to.
 */
export const TRAINED_DEFAULT_POSE: Record<string, number> = {
  left_hip_pitch_joint: -0.15, right_hip_pitch_joint: 0.15,
  left_hip_roll_joint: 0, right_hip_roll_joint: 0,
  left_hip_yaw_joint: 0, right_hip_yaw_joint: 0,
  left_knee_joint: 0.45, right_knee_joint: -0.45,
  left_ankle_pitch_joint: -0.3, right_ankle_pitch_joint: 0.3,
  left_ankle_roll_joint: 0, right_ankle_roll_joint: 0,
  waist_yaw_joint: 0,
  left_shoulder_pitch_joint: -0.25, right_shoulder_pitch_joint: 0.25,
  left_shoulder_roll_joint: -0.05, right_shoulder_roll_joint: 0.05,
  left_shoulder_yaw_joint: 0, right_shoulder_yaw_joint: 0,
  left_elbow_joint: 0.4, right_elbow_joint: -0.4,
  left_wrist_yaw_joint: 0, right_wrist_yaw_joint: 0,
};

/** The MJCF reference configuration (qpos0): the pose the CAD and link meshes were drawn in. */
export function referencePose(): Record<string, number> {
  return Object.fromEntries(HINGES.map((h) => [h.name, h.qpos0]));
}

const FOOT_SPHERES: [number, number, number][] = [[-0.045, 0.02, -0.029], [-0.045, -0.02, -0.029], [0.122, 0.028, -0.029], [0.122, -0.028, -0.029]];
const FOOT_RADIUS = 0.005;

/**
 * Poses the rig and lowers the floating base until the lowest foot contact sphere (MJCF
 * foot collision geoms, radius 5 mm) touches z = 0. Display only: physics decides height in TEST.
 */
export function standOnFloor(rig: RobotRig, joints: Record<string, number>, x = 0, y = 0): number {
  rig.setJoints(joints);
  rig.setRootPose([x, y, 0.65, 1, 0, 0, 0]);
  rig.root.updateWorldMatrix(true, true);
  // Measure in the rig root's frame (MuJoCo coordinates), whatever the rig is parented to.
  const toRoot = new Matrix4().copy(rig.root.matrixWorld).invert();
  let minZ = Infinity;
  for (const foot of ['left_ankle_roll_link', 'right_ankle_roll_link']) {
    const m = new Matrix4().multiplyMatrices(toRoot, rig.body(foot).content.matrixWorld);
    for (const s of FOOT_SPHERES) minZ = Math.min(minZ, new Vector3(...s).applyMatrix4(m).z - FOOT_RADIUS);
  }
  const z = 0.65 - minZ;
  rig.setRootPose([x, y, z, 1, 0, 0, 0]);
  rig.root.updateWorldMatrix(true, true);
  return z;
}
