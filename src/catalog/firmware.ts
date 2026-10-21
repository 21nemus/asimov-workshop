// Facts about Menlo's robot firmware, quoted from the Menlo SDK (Apache-2.0) at a pinned commit.
// The firmware source is not public; the SDK names the firmware file each fact comes from.
// Read-only: nothing here talks to a robot. Details in docs/SDK_REVIEW.md.
import specs from '../data/joint-specs.json' with { type: 'json' };

export const SDK = {
  repo: 'https://github.com/menloresearch/menlo-sdk',
  commit: '7683801135a39c5881701646119e83397274c3db',
  short: '7683801',
};

/** The firmware motor table in table order, which is actuator ID order (ID = index + 1).
 *  SDK `robots.py`, citing asimov-firmware `source/robot/asimov_1_biped.c` at 4925000b407.
 *  tests/firmware.test.ts checks every name against the docs' ID and role table. */
export const FIRMWARE_ACTUATORS = [
  'L_Hip_Pitch', 'L_Hip_Roll', 'L_Hip_Yaw', 'L_Knee', 'L_Ankle_A', 'L_Ankle_B',
  'R_Hip_Pitch', 'R_Hip_Roll', 'R_Hip_Yaw', 'R_Knee', 'R_Ankle_A', 'R_Ankle_B',
  'L_Shoulder_Pitch', 'L_Shoulder_Roll', 'L_Shoulder_Yaw', 'L_Elbow', 'L_Wrist_Yaw',
  'R_Shoulder_Pitch', 'R_Shoulder_Roll', 'R_Shoulder_Yaw', 'R_Elbow', 'R_Wrist_Yaw',
  'Waist_Yaw', 'Neck_Yaw', 'Neck_Pitch',
] as const;

/** Ankle coupling: A = kPitch·pitch − kRoll·roll, B = −kPitch·pitch − kRoll·roll.
 *  SDK `robots.py`, citing the firmware's `policy_thread.c` (`apply_ankle_coupling`). */
export const FIRMWARE_ANKLE = { kPitch: 2.02, kRoll: 0.8 };

/** The firmware clamps every walking command to these magnitudes (SDK `_command.py`; also
 *  stated in the docs). The policy itself was trained on a wider range. */
export const FIRMWARE_MAX_VX = 0.4;

/** The firmware actuators behind a simulation joint: one for most joints, motors A and B for
 *  either ankle joint (each moves both pitch and roll through the linkage). */
export function firmwareActuators(joint: string): { id: number; name: string }[] {
  const ankle = joint.match(/^(left|right)_ankle_(pitch|roll)_joint$/);
  const roles = ankle ? [`${ankle[1]}_ankle_A`, `${ankle[1]}_ankle_B`] : [joint];
  return roles.flatMap((role) => {
    const spec = specs.actuators.find((a) => a.role === role);
    return spec ? [{ id: spec.id, name: FIRMWARE_ACTUATORS[spec.id - 1] }] : [];
  });
}
