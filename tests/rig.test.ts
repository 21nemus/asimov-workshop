// The render rig must reproduce MuJoCo's forward kinematics, and the frame layer must map
// MuJoCo's Z-up world onto three.js's Y-up world without mirroring.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { RobotRig } from '../src/robot/rig.ts';
import { HINGES, KINEMATICS } from '../src/robot/kinematics.ts';
import { createMujocoFrameRoot, mjToThree, threeToMj } from '../src/utils/frames.ts';
import { compileShipped } from './helpers/mujoco.ts';

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

test('kinematics: 23 hinges, neck has no joints, expected names exist', () => {
  assert.equal(HINGES.length, 23);
  for (const n of ['left_hip_pitch_joint', 'right_ankle_roll_joint', 'waist_yaw_joint', 'left_wrist_yaw_joint']) assert.ok(HINGES.some((h) => h.name === n), n);
  const neck = KINEMATICS.bodies.filter((b) => b.name.startsWith('neck_'));
  assert.equal(neck.length, 2);
  assert.ok(neck.every((b) => b.joints.length === 0), 'neck bodies are welded in the simulation model');
  assert.ok(Math.abs(KINEMATICS.totalMass - 32.2249) < 1e-3, `mass ${KINEMATICS.totalMass}`);
});

test('kinematics: representative axes and left/right mirroring', () => {
  const axis = (n: string) => HINGES.find((h) => h.name === n)!.axis.map((v) => Math.round(v * 1e3) / 1e3);
  assert.deepEqual(axis('left_hip_pitch_joint'), [0, 1, 0]);
  assert.deepEqual(axis('right_hip_pitch_joint'), [0, -1, 0]);
  assert.deepEqual(axis('left_ankle_roll_joint'), [-1, 0, 0]);
  assert.deepEqual(axis('right_ankle_roll_joint'), [-1, 0, 0]);
  assert.deepEqual(axis('waist_yaw_joint'), [0, 0, 1]);
  // Left bodies are on +Y (robot's left), right bodies on -Y.
  const y = (n: string) => KINEMATICS.bodies.find((b) => b.name === n)!.xpos0[1];
  assert.ok(y('left_ankle_roll_link') > 0.05 && y('right_ankle_roll_link') < -0.05);
  assert.ok(y('left_wrist_yaw_link') > 0.1 && y('right_wrist_yaw_link') < -0.1);
});

test('frames: MuJoCo up is three up, handedness preserved, round trip exact', () => {
  const up = mjToThree([0, 0, 1]);
  assert.deepEqual([up.x, up.y, up.z], [0, 1, -0]);
  const root = createMujocoFrameRoot();
  root.updateMatrixWorld(true);
  for (const v of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.3, -0.2, 0.9]] as [number, number, number][]) {
    const viaGroup = new Vector3(...v).applyMatrix4(root.matrixWorld);
    const viaSwizzle = mjToThree(v);
    assert.ok(viaGroup.distanceTo(viaSwizzle) < 1e-12, `group and swizzle agree for ${v}`);
    const back = threeToMj(viaSwizzle);
    assert.deepEqual(back.map((x) => +x.toFixed(12)), v.map((x) => +x.toFixed(12)));
  }
  assert.ok(root.matrixWorld.determinant() > 0.999, 'no mirroring');
});

test('rig forward kinematics matches MuJoCo xpos/xquat at random poses', async () => {
  const { mujoco, model, data } = await compileShipped(false);
  const rig = new RobotRig();
  const rand = lcg(7);
  for (let trial = 0; trial < 25; trial++) {
    mujoco.mj_resetData(model, data);
    data.qpos[0] = (rand() - 0.5) * 2; data.qpos[1] = (rand() - 0.5) * 2; data.qpos[2] = 0.5 + rand() * 0.3;
    const q = new Quaternion().setFromAxisAngle(new Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize(), rand() * 3);
    data.qpos[3] = q.w; data.qpos[4] = q.x; data.qpos[5] = q.y; data.qpos[6] = q.z;
    for (const h of HINGES) {
      const [lo, hi] = h.range!;
      data.qpos[h.qposadr] = lo + (hi - lo) * rand();
    }
    mujoco.mj_kinematics(model, data);
    rig.setQpos(data.qpos);
    rig.root.updateMatrixWorld(true);
    for (const b of rig.bodies) {
      const p = new Vector3(), r = new Quaternion(), s = new Vector3();
      new Matrix4().copy(b.content.matrixWorld).decompose(p, r, s);
      const id = b.def.id;
      const dp = Math.hypot(p.x - data.xpos[3 * id], p.y - data.xpos[3 * id + 1], p.z - data.xpos[3 * id + 2]);
      const mq = new Quaternion(data.xquat[4 * id + 1], data.xquat[4 * id + 2], data.xquat[4 * id + 3], data.xquat[4 * id]);
      const dq = 1 - Math.abs(r.dot(mq));
      assert.ok(dp < 1e-9, `${b.def.name} position error ${dp}`);
      assert.ok(dq < 1e-12, `${b.def.name} orientation error ${dq}`);
    }
  }
});

test('rig reference pose equals compiled qpos0 world poses (elbow ref offsets handled)', () => {
  const rig = new RobotRig();
  rig.resetToReference();
  rig.root.updateMatrixWorld(true);
  for (const b of rig.bodies) {
    const p = new Vector3().setFromMatrixPosition(b.content.matrixWorld);
    const d = Math.hypot(p.x - b.def.xpos0[0], p.y - b.def.xpos0[1], p.z - b.def.xpos0[2]);
    assert.ok(d < 1e-9, `${b.def.name} ${d}`);
  }
  assert.equal(rig.q.get('left_elbow_joint'), HINGES.find((h) => h.name === 'left_elbow_joint')!.qpos0);
  assert.ok(Math.abs(rig.q.get('left_elbow_joint')! - 0.785398) < 1e-6);
});
