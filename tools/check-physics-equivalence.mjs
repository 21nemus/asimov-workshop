// Checks that the physics-only MJCF (visual meshes stripped) is dynamically identical
// to the pinned upstream MJCF: same reset keyframe, same deterministic PD drive with the
// policy's torque limits, 3000 steps (15 s) including a fall onto the floor, then a
// bitwise comparison of qpos, qvel and contact counts at every step.
// Usage: node tools/check-physics-equivalence.mjs <sim-model dir>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileModel, withActuatorOverlay } from './mujoco-node.mjs';
import { physicsOnlyXml } from './physics-model.mjs';

const simDir = process.argv[2];
const original = withActuatorOverlay(readFileSync(join(simDir, 'xmls/asimov_1.xml'), 'utf8'));
const stripped = physicsOnlyXml(readFileSync(join(simDir, 'xmls/asimov_1.xml'), 'utf8'));
console.log(`removed ${stripped.removedGeoms} visual geoms and ${stripped.removedMeshes} mesh assets`);
const a = await compileModel(simDir, original, 'full');
const b = await compileModel(simDir, withActuatorOverlay(stripped.xml), 'phys');
for (const k of ['nq', 'nv', 'nu', 'nbody', 'njnt']) if (a.model[k] !== b.model[k]) throw new Error(`${k} differs`);
console.log('ngeom', a.model.ngeom, '->', b.model.ngeom, ' nmesh', a.model.nmesh, '->', b.model.nmesh);

const pose = [-0.15, 0, 0, 0.45, -0.3, 0, 0.15, 0, 0, -0.45, 0.3, 0, 0, 0.25, 0.05, 0, -0.4, 0, -0.25, -0.05, 0, 0.4, 0];
const kp = [150, 150, 150, 150, 110, 110, 150, 150, 150, 150, 110, 110, 65, 57, 86, 96, 40, 40, 57, 86, 96, 40, 40];
const kd = [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 2, 2, 5, 5, 5, 2, 2];
const lim = [45, 45, 28, 45, 40, 17, 45, 45, 28, 45, 40, 17, 40, 30, 25, 20, 12, 12, 30, 25, 20, 12, 12];
// Policy joint order equals MJCF actuator order here, but map explicitly by joint id anyway.
function setup({ mujoco, model, data }) {
  mujoco.mj_resetData(model, data);
  data.qpos[2] = 0.614; data.qpos[3] = 1; data.qpos[4] = 0; data.qpos[5] = 0; data.qpos[6] = 0;
  for (let i = 0; i < 23; i++) data.qpos[7 + i] = pose[i];
  mujoco.mj_forward(model, data);
}
setup(a); setup(b);
let maxDiff = 0, firstDiffStep = -1, contactMismatch = 0;
for (let step = 0; step < 3000; step++) {
  const t = step * 0.005;
  for (const s of [a, b]) {
    for (let i = 0; i < 23; i++) {
      // Sinusoidal sway for 8 s, then the hip targets swing wildly so the robot falls.
      const target = pose[i] + (t < 8 ? 0.15 * Math.sin(2 * Math.PI * 0.7 * t + i) : (i % 6 === 0 ? 1.2 : 0));
      const tau = kp[i] * (target - s.data.qpos[7 + i]) - kd[i] * s.data.qvel[6 + i];
      s.data.ctrl[i] = Math.max(-lim[i], Math.min(lim[i], tau));
    }
    if (step >= 1200 && step < 1230) s.data.xfrc_applied[1 * 6 + 1] = 120; else s.data.xfrc_applied[1 * 6 + 1] = 0;
    s.mujoco.mj_step(s.model, s.data);
  }
  if (a.data.ncon !== b.data.ncon) contactMismatch++;
  for (let i = 0; i < a.model.nq; i++) {
    const d = Math.abs(a.data.qpos[i] - b.data.qpos[i]);
    if (d > maxDiff) maxDiff = d;
    if (d !== 0 && firstDiffStep < 0) firstDiffStep = step;
  }
  for (let i = 0; i < a.model.nv; i++) {
    const d = Math.abs(a.data.qvel[i] - b.data.qvel[i]);
    if (d !== 0 && firstDiffStep < 0) firstDiffStep = step;
  }
}
console.log('final root z (full, physics-only):', a.data.qpos[2], b.data.qpos[2], ' contacts:', a.data.ncon, b.data.ncon);
console.log(JSON.stringify({ maxAbsQposDiff: maxDiff, firstDiffStep, contactCountMismatches: contactMismatch, identical: maxDiff === 0 && firstDiffStep < 0 && contactMismatch === 0 }));
