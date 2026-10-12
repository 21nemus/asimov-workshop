// Reference harness: runs the pinned upstream viewer's OWN policy modules headless in Node
// (PolicyRunner, observation helpers, env.yaml parser and actuator overlay from
// menloresearch/humanoid-policy-viewer@0c21078, with its locked onnxruntime-web 1.29.0) on
// mujoco-js 0.0.7 (MuJoCo 3.3.8) and the viewer's submodule MJCF. The 50 Hz tick of
// main.js main_loop() is transcribed line for line (minus rendering, metrics and UI), with
// the command and push schedule keyed to tick indices so the run is deterministic.
//
// Usage: node tools/baseline/upstream-harness.mjs <scenario.json> <out.json>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const VIEWER = resolve('.reference-cache/viewer');
const SIM = join(VIEWER, 'src/simulation');
const up = (f) => import(pathToFileURL(join(SIM, f)).href);

// The upstream modules fetch() their model and config files; serve them from disk.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (/^https?:/.test(u)) return realFetch(url, init);
  const path = u.startsWith('./') ? join(VIEWER, 'public', u.slice(2)) : u.startsWith('/') && !u.startsWith(VIEWER) ? join(VIEWER, 'public', u) : u;
  const bytes = readFileSync(path);
  return new Response(bytes, { status: 200, headers: { 'content-type': path.endsWith('.json') ? 'application/json' : 'application/octet-stream' } });
};

// Same module instance upstream imports as 'onnxruntime-web/wasm' (package exports -> this file).
// In Node its loader must be given a plain directory path for the .mjs/.wasm files.
const ort = await import(pathToFileURL(join(VIEWER, 'node_modules/onnxruntime-web/dist/ort.wasm.bundle.min.mjs')).href);
ort.env.wasm.wasmPaths = join(VIEWER, 'node_modules/onnxruntime-web/dist') + '/';
ort.env.wasm.numThreads = 1;
const { PolicyRunner } = await up('policyRunner.js');
const { asimovCommandState } = await up('observationHelpers.js');
const { parseEnvPolicySettings } = await up('envPolicyConfig.js');
const { withActuatorOverlay, applyTorqueLimits } = await up('sceneOverlay.js');
const { toFloatArray } = await up('utils/math.js');
const loadMujoco = (await import(pathToFileURL(join(VIEWER, 'node_modules/mujoco-js/dist/mujoco_wasm.js')).href)).default;

const [scenarioPath, outPath] = process.argv.slice(2);
const scenario = JSON.parse(readFileSync(scenarioPath, 'utf8'));

// ---- scene: the viewer's own loading path (MEMFS + actuator overlay) ----
const mujoco = await loadMujoco();
mujoco.FS.mkdir('/working');
mujoco.FS.mount(mujoco.MEMFS, { root: '.' }, '/working');
const simModel = join(VIEWER, 'public/examples/scenes/asimov-1/sim-model');
for (const d of ['asimov-1', 'asimov-1/sim-model', 'asimov-1/sim-model/xmls', 'asimov-1/sim-model/assets', 'asimov-1/sim-model/assets/meshes']) mujoco.FS.mkdir(`/working/${d}`);
mujoco.FS.writeFile('/working/asimov-1/sim-model/xmls/asimov_1.xml', readFileSync(join(simModel, 'xmls/asimov_1.xml'), 'utf8'));
for (const f of ['ANKLE_B_NEW.STL', 'IMU_ORIGIN.STL', 'LEFT_ANKLE_A.STL', 'LEFT_ELBOW.STL', 'LEFT_HIP_PITCH.STL', 'LEFT_HIP_ROLL.STL', 'LEFT_HIP_YAW.STL', 'LEFT_KNEE.STL', 'LEFT_SHOULDER_PITCH.STL', 'LEFT_SHOULDER_ROLL.STL', 'LEFT_SHOULDER_YAW.STL', 'LEFT_WRIST_YAW.STL', 'NECK_PITCH.STL', 'NECK_YAW.STL', 'RIGHT_ANKLE_A.STL', 'RIGHT_ELBOW.STL', 'RIGHT_HIP_PITCH.STL', 'RIGHT_HIP_ROLL.STL', 'RIGHT_HIP_YAW.STL', 'RIGHT_KNEE.STL', 'RIGHT_SHOULDER_PITCH.STL', 'RIGHT_SHOULDER_ROLL.STL', 'RIGHT_SHOULDER_YAW.STL', 'RIGHT_WRIST_YAW.STL', 'WAIST_YAW.STL']) {
  mujoco.FS.writeFile(`/working/asimov-1/sim-model/assets/meshes/${f}`, new Uint8Array(readFileSync(join(simModel, 'assets/meshes', f))));
}
const model = mujoco.MjModel.loadFromXML('/working/' + withActuatorOverlay(mujoco, 'asimov-1/sim-model/xmls/asimov_1.xml'));
const data = new mujoco.MjData(model);
const names = new TextDecoder().decode(model.names);
const nameAt = (adr) => names.slice(adr, names.indexOf('\0', adr));
const jointNamesMJC = Array.from({ length: model.njnt }, (_, j) => nameAt(model.name_jntadr[j]));
const bodyId = (n) => Array.from({ length: model.nbody }, (_, b) => nameAt(model.name_bodyadr[b])).indexOf(n);
const timestep = model.opt.timestep;
const decimation = Math.max(1, Math.round(0.02 / timestep));

// ---- policy: reloadPolicy() merge order ----
let config = JSON.parse(readFileSync(join(VIEWER, 'public/examples/checkpoints/asimov/reference_policy_config.json'), 'utf8'));
const policyJointNames = config.policy_joint_names;
const envSettings = parseEnvPolicySettings(readFileSync(join(VIEWER, 'public/examples/checkpoints/asimov/model_aug_18_1/env.yaml'), 'utf8'), policyJointNames);
Object.assign(config, envSettings);
config.onnx.path = join(VIEWER, 'public/examples/checkpoints/asimov/model_aug_18_1/policy_isaaclab_new.onnx');

const actuator2joint = Array.from({ length: model.nu }, (_, i) => model.actuator_trnid[2 * i]);
const ctrl_adr_policy = [], qpos_adr_policy = [], qvel_adr_policy = [];
for (const name of policyJointNames) {
  const j = jointNamesMJC.indexOf(name);
  ctrl_adr_policy.push(actuator2joint.findIndex((x) => x === j));
  qpos_adr_policy.push(model.jnt_qposadr[j]);
  qvel_adr_policy.push(model.jnt_dofadr[j]);
}
const numActions = policyJointNames.length;
const defaultJposPolicy = new Float32Array(config.default_joint_pos);
const kpPolicy = toFloatArray(config.stiffness, numActions, 0.0);
const kdPolicy = toFloatArray(config.damping, numActions, 0.0);
const kdFfPolicy = Array.isArray(config.kd_ff) ? toFloatArray(config.kd_ff, numActions, 0.0) : null;
applyTorqueLimits(model, ctrl_adr_policy, config.torque_limit);
const delayMin = config.delay_min_lag ?? 0, delayMax = config.delay_max_lag ?? delayMin;
const actionDelayLag = delayMin + Math.floor((delayMax - delayMin + 1 - 1) / 2);
const lpfHz = config.action_lpf_hz, policyHz = config.policy_hz ?? 50;
const actionLpfAlpha = lpfHz > 0 ? (1 / policyHz) / (1 / (2 * Math.PI * lpfHz) + 1 / policyHz) : 1;

mujoco.mj_resetData(model, data);
mujoco.mj_forward(model, data);
const runner = new PolicyRunner({ ...config, policy_joint_names: policyJointNames, action_scale: config.action_scale, default_joint_pos: defaultJposPolicy }, { policyJointNames, actionScale: config.action_scale, defaultJointPos: defaultJposPolicy });
await runner.init();

function readPolicyState() {
  const jointPos = new Float32Array(numActions), jointVel = new Float32Array(numActions);
  for (let i = 0; i < numActions; i++) { jointPos[i] = data.qpos[qpos_adr_policy[i]]; jointVel[i] = data.qvel[qvel_adr_policy[i]]; }
  return {
    jointPos, jointVel,
    rootPos: new Float32Array([data.qpos[0], data.qpos[1], data.qpos[2]]),
    rootQuat: new Float32Array([data.qpos[3], data.qpos[4], data.qpos[5], data.qpos[6]]),
    rootAngVel: new Float32Array([data.qvel[3], data.qvel[4], data.qvel[5]]),
    complianceEnabled: false, complianceThreshold: 10.0,
  };
}

// ---- resetSimulation() ----
mujoco.mj_resetData(model, data);
let tumbling = false;
data.qpos[2] = 0.614; data.qpos[3] = 1.0; data.qpos[4] = 0; data.qpos[5] = 0; data.qpos[6] = 0;
for (let i = 0; i < numActions; i++) data.qpos[qpos_adr_policy[i]] = defaultJposPolicy[i];
mujoco.mj_forward(model, data);
let actionTarget = null, filteredActionTarget = null;
let actionDelayBuffer = [];
runner.reset(readPolicyState());
const activePushes = [];

function getDelayedActionTarget(sourceTarget) {
  if (!sourceTarget || actionDelayLag <= 0) return sourceTarget;
  actionDelayBuffer.push(new Float32Array(sourceTarget));
  while (actionDelayBuffer.length > actionDelayLag + 1) actionDelayBuffer.shift();
  return actionDelayBuffer[0] ?? sourceTarget;
}

const record = { scenario: scenario.name, engine: `MuJoCo ${mujoco.mj_versionString()}`, decimation, timestep, actionDelayLag, actionLpfAlpha, ticks: [] };
for (let tick = 0; tick < scenario.ticks; tick++) {
  for (const c of scenario.commands) if (c.tick === tick) { asimovCommandState.vx = c.vx; asimovCommandState.vy = c.vy; asimovCommandState.wz = c.wz; }
  for (const p of scenario.pushes ?? []) if (p.tick === tick) {
    const b = bodyId(p.body);
    const len = Math.hypot(...p.dir);
    activePushes.push({ bodyID: b, force: { x: (p.dir[0] / len) * p.force, y: (p.dir[1] / len) * p.force, z: (p.dir[2] / len) * p.force }, torque: { x: 0, y: 0, z: 0 }, point: { x: data.xipos[b * 3], y: data.xipos[b * 3 + 1], z: data.xipos[b * 3 + 2] }, stepsLeft: Math.max(1, Math.round(p.duration / timestep)) });
  }
  // ---- main_loop body ----
  const qx = data.qpos[4], qy = data.qpos[5];
  const gravZ = -(1.0 - 2.0 * (qx * qx + qy * qy));
  if (gravZ > -0.166) tumbling = true;
  if (tumbling) {
    if (!actionTarget) actionTarget = new Float32Array(numActions);
    for (let i = 0; i < numActions; i++) actionTarget[i] = data.qpos[qpos_adr_policy[i]];
    if (filteredActionTarget) filteredActionTarget.set(actionTarget); else filteredActionTarget = new Float32Array(actionTarget);
  } else {
    actionTarget = await runner.step(readPolicyState());
    if (actionTarget) {
      let maxAbs = 0;
      for (let i = 0; i < actionTarget.length; i++) maxAbs = Math.max(maxAbs, Math.abs(actionTarget[i]));
      if (maxAbs > 100.0) tumbling = true;
    }
    if (actionTarget) {
      if (!filteredActionTarget) filteredActionTarget = new Float32Array(actionTarget);
      else for (let i = 0; i < numActions; i++) filteredActionTarget[i] = actionLpfAlpha * actionTarget[i] + (1 - actionLpfAlpha) * filteredActionTarget[i];
    }
  }
  for (let substep = 0; substep < decimation; substep++) {
    const sourceTarget = filteredActionTarget ?? actionTarget;
    const delayed = tumbling ? sourceTarget : getDelayedActionTarget(sourceTarget);
    for (let i = 0; i < numActions; i++) {
      const qa = qpos_adr_policy[i], va = qvel_adr_policy[i], ca = ctrl_adr_policy[i];
      const targetJpos = delayed ? delayed[i] : 0.0;
      const kp = tumbling ? 10.0 : kpPolicy[i];
      const vel = data.qvel[va];
      const hasFf = kdFfPolicy !== null && kdFfPolicy !== undefined;
      const kd = tumbling ? 3.0 : kdPolicy[i];
      const kd_hw = tumbling ? 3.0 : (hasFf ? Math.min(kd, 5.0) : kd);
      let torque = kp * (targetJpos - data.qpos[qa]) + kd_hw * (0 - vel);
      if (hasFf && !tumbling) {
        const kd_ff = kdFfPolicy[i] ?? 0.0;
        if (kd_ff > 0) torque += Math.max(-30, Math.min(30, -kd_ff * vel));
      }
      let ctrlValue = torque;
      const min = model.actuator_ctrlrange[ca * 2], max = model.actuator_ctrlrange[ca * 2 + 1];
      if (Number.isFinite(min) && Number.isFinite(max) && min < max) ctrlValue = Math.min(Math.max(ctrlValue, min), max);
      data.ctrl[ca] = ctrlValue;
    }
    const applied = data.qfrc_applied;
    for (let i = 0; i < applied.length; i++) applied[i] = 0.0;
    for (let i = activePushes.length - 1; i >= 0; i--) {
      const p = activePushes[i];
      mujoco.mj_applyFT(model, data, [p.force.x, p.force.y, p.force.z], [p.torque.x, p.torque.y, p.torque.z], [p.point.x, p.point.y, p.point.z], p.bodyID, data.qfrc_applied);
      p.stepsLeft--;
      if (p.stepsLeft <= 0) activePushes.splice(i, 1);
    }
    mujoco.mj_step(model, data);
  }
  record.ticks.push({ t: +data.time.toFixed(6), tumbling, qpos: Array.from(data.qpos), qvel: Array.from(data.qvel), action: Array.from(runner.lastActions) });
}
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(record));
const last = record.ticks.at(-1);
console.log(`${scenario.name}: ${scenario.ticks} ticks, sim t=${last.t}s, root=(${last.qpos.slice(0, 3).map((v) => v.toFixed(4)).join(', ')}), DAMP=${last.tumbling}`);
