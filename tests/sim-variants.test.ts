// Menlo's newer simulation models, used for display only: the neck joints of the 25-DOF model on our
// rig, and the gripper of the 27-DOF model on its bench. The walking model and TEST use neither.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion } from 'three';
import neck from '../src/data/neck.json' with { type: 'json' };
import { DISPLAY_HINGES, HINGES, KINEMATICS, NECK_HINGES } from '../src/robot/kinematics.ts';
import { RobotRig } from '../src/robot/rig.ts';
import { COUPLED, DRIVER_RANGE, GRIPPER, gripperRig, jawGapMm, poseGripper } from '../src/understand/gripper-bench.ts';

test('neck: two display-only joints, on bodies that match the walking model', () => {
  assert.equal(NECK_HINGES.length, 2);
  assert.equal(DISPLAY_HINGES.length, HINGES.length + 2);
  assert.ok(NECK_HINGES.every((j) => j.qposadr === -1), 'no place in the physics state');
  for (const j of neck.joints) {
    assert.ok(KINEMATICS.bodies.some((b) => b.name === j.body && b.joints.length === 0), `${j.body} is welded in the walking model`);
    assert.ok(j.frameOffsetMm < 0.05, `${j.body} frame offset ${j.frameOffsetMm} mm`);
  }
  assert.deepEqual(neck.joints.map((j) => j.axis), [[0, 0, 1], [0, -1, 0]]);
});

test('rig: the neck turns the head, and a physics qpos never moves it', () => {
  const rig = new RobotRig();
  const head = rig.body('neck_pitch_link').content;
  rig.root.updateWorldMatrix(true, true);
  const before = head.getWorldQuaternion(new Quaternion());
  rig.setJoint('neck_yaw_joint', 0.8);
  rig.root.updateWorldMatrix(true, true);
  assert.ok(Math.abs(before.angleTo(head.getWorldQuaternion(new Quaternion())) - 0.8) < 1e-9);
  const qpos = new Float64Array(KINEMATICS.nq);
  qpos[2] = 0.6;
  qpos[3] = 1;
  rig.setQpos(qpos);
  assert.equal(rig.q.get('neck_yaw_joint'), 0.8);
});

test('gripper: one motor, five joints tied to it at ±1, as in the MJCF', () => {
  assert.equal(GRIPPER.bodies.length, 7);
  assert.equal(GRIPPER.bodies.filter((b) => b.parent === null).length, 1);
  assert.equal(GRIPPER.motor.joint, GRIPPER.driver);
  assert.equal(COUPLED.length, 5);
  for (const j of COUPLED) assert.equal(Math.abs(j.factor), 1, j.name);
  assert.deepEqual(DRIVER_RANGE.map((v) => +v.toFixed(4)), [0, 0.8863]);
});

test('gripper: both jaws keep their angle over the whole range (runtime rig)', () => {
  const rig = gripperRig();
  const world = (body: string) => rig.contents.get(`right_gripper_${body}_link`)!.getWorldQuaternion(new Quaternion());
  poseGripper(rig, 0);
  rig.root.updateWorldMatrix(true, true);
  const jawA = world('finger'), jawB = world('finger_follower'), driver = world('driver');
  for (let k = 1; k <= 10; k++) {
    poseGripper(rig, (DRIVER_RANGE[1] * k) / 10);
    rig.root.updateWorldMatrix(true, true);
    assert.ok(jawA.angleTo(world('finger')) < 1e-9, `jaw A tilts at step ${k}`);
    assert.ok(jawB.angleTo(world('finger_follower')) < 1e-9, `jaw B tilts at step ${k}`);
  }
  assert.ok(Math.abs(driver.angleTo(world('driver')) - DRIVER_RANGE[1]) < 1e-9, 'the driver turns through its range');
});

test('gripper: the jaw gap opens steadily from 0 mm', () => {
  const s = GRIPPER.jawGapMm.samples;
  assert.equal(s[0][1], 0);
  for (let i = 1; i < s.length; i++) assert.ok(s[i][1] > s[i - 1][1], `sample ${i}`);
  assert.ok(s[s.length - 1][1] > 50 && s[s.length - 1][1] < 80);
  assert.equal(jawGapMm(-1), 0);
  assert.equal(jawGapMm(DRIVER_RANGE[1] + 1), s[s.length - 1][1]);
  const mid = (s[5][0] + s[6][0]) / 2;
  assert.ok(Math.abs(jawGapMm(mid) - (s[5][1] + s[6][1]) / 2) < 1e-9);
});
