// SimulationAdapter behaviour: configuration validation, freeze/inspect/resume continuity,
// honest fall handling and complete perturbation records.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SimulationAdapter } from '../src/simulation/adapter.ts';
import { contractErrors, type PolicyContract } from '../src/simulation/contract.ts';
import { motorJointNames } from '../src/simulation/model-overlay.ts';
import { loadMujocoNode } from './helpers/mujoco.ts';

const PUBLIC = new URL('../public/', import.meta.url);
const read = (u: string) => readFileSync(new URL(u.replace(/^\.\//, ''), PUBLIC));

async function makeAdapter(): Promise<SimulationAdapter> {
  const a = new SimulationAdapter();
  await a.initialize({
    base: './',
    loadMujoco: loadMujocoNode,
    fetchText: async (u) => read(u).toString('utf8'),
    fetchBytes: async (u) => { const b = read(u); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); },
  });
  return a;
}

const contract = (): PolicyContract => JSON.parse(read('policy/model_aug_18_1/contract.json').toString('utf8'));
const motors = motorJointNames(read('sim/asimov_1.physics.xml').toString('utf8'));

test('the shipped contract is complete and maps every action to a distinct motor', () => {
  assert.deepEqual(contractErrors(contract(), motors), []);
  const c = contract();
  assert.equal(c.joints.length, 23);
  assert.equal(new Set(c.joints).size, 23);
  assert.ok(c.pd.torqueLimit.every((v) => Number.isFinite(v) && v > 0));
  assert.equal(c.observation.size, 78);
  assert.equal(c.provenance.stiffness, 'env.yaml');
  assert.equal(c.provenance.default_joint_pos, 'env.yaml');
  // The older reference fallbacks are kept for the record but are not the operative values.
  assert.equal((c as unknown as { fallbacksNotUsed: { stiffness: number[] } }).fallbacksNotUsed.stiffness[0], 200);
  assert.equal(c.pd.stiffness[0], 150);
  // Observation slots read joints in a different order than the action order.
  const slot01 = c.observation.recipe.find((t) => t.slot_name === 'slot01')!;
  assert.deepEqual(slot01.indices, [0, 1, 6, 7, 12, 13, 14, 18, 19]);
});

test('invalid configurations fail with a clear message', () => {
  const missingLimit = contract();
  missingLimit.pd.torqueLimit = missingLimit.pd.torqueLimit.slice(0, 22);
  assert.match(contractErrors(missingLimit, motors).join(';'), /torque limit: expected 23/);
  const zeroLimit = contract();
  zeroLimit.pd.torqueLimit[5] = 0;
  assert.match(contractErrors(zeroLimit, motors).join(';'), /positive limit/);
  const nanGain = contract();
  nanGain.pd.stiffness[3] = Number.NaN;
  assert.match(contractErrors(nanGain, motors).join(';'), /stiffness: non-finite/);
  const dup = contract();
  dup.joints[1] = dup.joints[0];
  assert.match(contractErrors(dup, motors).join(';'), /duplicate/);
  const obs = contract();
  obs.observation.recipe = obs.observation.recipe.slice(1);
  assert.match(contractErrors(obs, motors).join(';'), /observation recipe builds 75/);
});

test('freeze -> inspect -> resume continues bit-exactly (frozen mid-push)', async () => {
  const a = await makeAdapter();
  a.reset({ vx: 0.5, vy: 0, wz: 0 });
  a.start();
  await a.stepTicks(150);
  a.applyExternalForce({ body: 'pelvis_link', dirWorld: [0, 1, 0], forceN: 150, durationS: 0.15 });
  await a.stepTicks(3); // freeze while the push is still being applied
  const snap = a.freeze();
  assert.equal(a.status, 'INSPECTION_FROZEN');
  // Something touches MjData during inspection (it must not matter).
  a.handle!.data.qpos[0] += 0.5;
  a.handle!.data.qvel[2] = 3;
  a.unfreeze();
  await a.stepTicks(120);
  const resumed = Float64Array.from(a.qpos());
  // Same snapshot, restored again: identical continuation.
  a.restoreState(snap);
  await a.stepTicks(120);
  assert.deepEqual(Array.from(a.qpos()), Array.from(resumed));
  // And identical to a run that was never frozen.
  const b = await makeAdapter();
  b.reset({ vx: 0.5, vy: 0, wz: 0 });
  b.start();
  await b.stepTicks(150);
  b.applyExternalForce({ body: 'pelvis_link', dirWorld: [0, 1, 0], forceN: 150, durationS: 0.15 });
  await b.stepTicks(123);
  assert.deepEqual(Array.from(b.qpos()), Array.from(resumed));
  assert.equal(b.getControllerMode(), a.getControllerMode());
});

test('a fall is reported as DAMP mode (not recovery), and reset restores the verified start', async () => {
  const a = await makeAdapter();
  a.reset();
  a.start();
  await a.stepTicks(100);
  a.applyExternalForce({ body: 'waist_yaw_link', dirWorld: [1, 0, 0], forceN: 900, durationS: 0.3 });
  let fellAt = -1;
  for (let i = 0; i < 250 && fellAt < 0; i++) {
    await a.stepTicks(1);
    if (a.getControllerMode() === 'FALL_DAMP') fellAt = a.ctrl!.s.tick;
  }
  assert.ok(fellAt > 0, 'a 900 N, 0.3 s chest push should topple the robot');
  assert.ok(a.events.some((e) => e.kind === 'fall-detected' && /DAMP/.test(e.detail)));
  await a.stepTicks(50);
  assert.equal(a.getControllerMode(), 'FALL_DAMP', 'DAMP is latched until reset');
  a.reset();
  assert.equal(a.getControllerMode(), 'POLICY_ACTIVE');
  const q = a.qpos();
  assert.equal(q[2], 0.614);
  assert.deepEqual([q[3], q[4], q[5], q[6]], [1, 0, 0, 0]);
  assert.ok(Math.abs(q[7] - -0.15) < 1e-6);
});

test('perturbation records carry body, point, frame, direction, magnitude and timing', async () => {
  const a = await makeAdapter();
  a.reset();
  a.start();
  await a.stepTicks(25);
  const before = a.handle!.data.time;
  const r = a.applyExternalForce({ body: 'pelvis_link', dirWorld: [0, 2, 0], forceN: 150, durationS: 0.15 });
  assert.equal(r.frame, 'world');
  assert.equal(r.startTime, before);
  assert.equal(r.substeps, 30);
  assert.ok(Math.abs(r.endTime - (before + 0.15)) < 1e-9);
  const pelvis = 1;
  assert.deepEqual(r.pointWorld, [a.handle!.data.xipos[3 * pelvis], a.handle!.data.xipos[3 * pelvis + 1], a.handle!.data.xipos[3 * pelvis + 2]]);
  const pushes = a.ctrl!.s.pushes;
  assert.equal(pushes.length, 1);
  assert.deepEqual(pushes[0].force, [0, 150, 0]);
  await a.stepTicks(8); // 32 substeps > 30
  assert.equal(a.ctrl!.s.pushes.length, 0);
});

test('velocity commands are clamped to the trained ranges from env.yaml', async () => {
  const a = await makeAdapter();
  const c = a.setVelocityCommand({ vx: 3, vy: -2, wz: 5 });
  assert.deepEqual(c, { vx: 0.8, vy: -0.5, wz: 0.8 });
});

test('contacts: both feet report four contact points with normal force supporting the robot', async () => {
  const a = await makeAdapter();
  a.reset();
  a.start();
  await a.stepTicks(100);
  const [l, r] = a.getContactState();
  assert.equal(l.points + r.points, 8);
  const weight = 32.2249 * 9.81;
  assert.ok(Math.abs(l.normalForceN + r.normalForceN - weight) / weight < 0.1, `support ${l.normalForceN + r.normalForceN} N vs weight ${weight} N`);
});
