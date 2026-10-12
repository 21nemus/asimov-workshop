// Builds the operative policy contract for the bundled checkpoint, using the pinned upstream
// viewer's OWN env.yaml parser and its reloadPolicy() merge order, so ASIMOV WORKSHOP runs the
// policy exactly as the upstream viewer configures it. Every field records where its value came
// from (env.yaml, the reference config fallback, or a viewer constant).
//   public/policy/model_aug_18_1/contract.json
//   public/policy/model_aug_18_1/policy.onnx     (byte copy, BSD-3-Clause)
//   public/policy/model_aug_18_1/mlp.bin          (float32 weights for the verified TS forward pass)
// Usage: node tools/build-policy.mjs
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseModel } from './onnx-proto.mjs';

const VIEWER = resolve('.reference-cache/viewer');
const CK = join(VIEWER, 'public/examples/checkpoints/asimov');
const { parseEnvPolicySettings } = await import(pathToFileURL(join(VIEWER, 'src/simulation/envPolicyConfig.js')).href);
const pins = JSON.parse(readFileSync('references/pins.json', 'utf8'));
const viewerPin = pins.sources.find((s) => s.id === 'humanoid-policy-viewer');
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

const refPath = join(CK, 'reference_policy_config.json');
const envPath = join(CK, 'model_aug_18_1/env.yaml');
const onnxPath = join(CK, 'model_aug_18_1/policy_isaaclab_new.onnx');
for (const [p, key] of [[refPath, 'public/examples/checkpoints/asimov/reference_policy_config.json'], [envPath, 'public/examples/checkpoints/asimov/model_aug_18_1/env.yaml'], [onnxPath, 'public/examples/checkpoints/asimov/model_aug_18_1/policy_isaaclab_new.onnx']]) {
  if (sha(p) !== viewerPin.files[key].sha256) throw new Error(`${key} does not match the pin`);
}
const reference = JSON.parse(readFileSync(refPath, 'utf8'));
const joints = reference.policy_joint_names;
const env = parseEnvPolicySettings(readFileSync(envPath, 'utf8'), joints);

// reloadPolicy(): Object.assign(config, envSettings) -> env.yaml wins where it records a value.
const merged = { ...reference, ...env };
const from = (k) => (k in env ? 'env.yaml' : 'reference_policy_config.json (fallback)');
const provenance = {};
for (const k of Object.keys(merged)) provenance[k] = from(k);
provenance.decimation = 'viewer constant: round(0.02 / model timestep)';
provenance.policy_period_s = 'viewer constant (POLICY_PERIOD_S); env.yaml sim.dt 0.005 x decimation 4 = 0.02 checked by the upstream parser';
provenance.action_delay_lag = 'viewer rule: midpoint of [delay_min_lag, delay_max_lag] (resetActionDelay)';
provenance.action_lpf_alpha = 'viewer rule from reference action_lpf_hz and policy_hz';
provenance.action_clip = 'viewer default (PolicyRunner.actionClip)';
provenance.fall_rule = 'viewer main.js main_loop';
provenance.reset = 'viewer main.js resetSimulation';

const lag = merged.delay_min_lag + Math.floor((merged.delay_max_lag - merged.delay_min_lag) / 2);
const dt = 1 / merged.policy_hz, rc = 1 / (2 * Math.PI * merged.action_lpf_hz);
const contract = {
  checkpoint: {
    id: 'asimov/model_aug_18_1',
    onnx: 'policy.onnx', onnxSha256: sha(onnxPath), envYamlSha256: sha(envPath), referenceConfigSha256: sha(refPath),
    source: `${viewerPin.repository}@${viewerPin.commit} public/examples/checkpoints/asimov/model_aug_18_1/`,
    licence: 'BSD-3-Clause (humanoid-policy-viewer THIRD_PARTY_NOTICES.md: trained by Menlo Research Pte. Ltd.)',
    trainedIn: 'Isaac Lab (PhysX), per env.yaml; this app runs it in MuJoCo (sim-to-sim)',
  },
  joints,
  observation: { size: 78, recipe: merged.obs_config.policy, angVelScale: merged.obs_config.policy.find((o) => o.name === 'AsimovAngVel')?.scale ?? 0.25 },
  action: { size: joints.length, scale: merged.action_scale, defaultPose: merged.default_joint_pos, clip: 10.0 },
  pd: { stiffness: merged.stiffness, damping: merged.damping, kdFeedForward: merged.kd_ff ?? null, torqueLimit: merged.torque_limit },
  timing: { policyHz: merged.policy_hz, physicsDt: 0.005, decimation: 4, actionDelayLagSubsteps: lag, actionLpfHz: merged.action_lpf_hz, actionLpfAlpha: dt / (rc + dt) },
  commandLimits: merged.command_limits,
  fallRule: { projectedGravityZAbove: -0.166, tiltDeg: +(Math.acos(0.166) * 180 / Math.PI).toFixed(1), commentInSourceSays: '30 deg', dampKp: 10.0, dampKd: 3.0, latched: 'until reset' },
  reset: { rootZ: 0.614, rootQuat: [1, 0, 0, 0], jointPos: 'defaultPose (stored as float32)', qvel: 0 },
  provenance,
  fallbacksNotUsed: Object.fromEntries(['stiffness', 'damping', 'action_scale', 'default_joint_pos'].map((k) => [k, reference[k]])),
};
// Validate before writing: a missing or non-finite control value must fail the build.
const n = joints.length;
for (const [k, arr] of Object.entries({ scale: contract.action.scale, defaultPose: contract.action.defaultPose, stiffness: contract.pd.stiffness, damping: contract.pd.damping, torqueLimit: contract.pd.torqueLimit })) {
  if (!Array.isArray(arr) || arr.length !== n || arr.some((v) => !Number.isFinite(v))) throw new Error(`contract ${k} is incomplete`);
}
if (contract.pd.torqueLimit.some((v) => v <= 0)) throw new Error('torque limit must be positive');

// MLP weights for the TS forward pass, in graph order.
const model = parseModel(new Uint8Array(readFileSync(onnxPath)));
const layers = [];
const blobs = [];
let offset = 0;
for (const node of model.graph.nodes.filter((x) => x.op === 'Gemm')) {
  const [, wName, bName] = node.inputs;
  const W = model.graph.initializers.find((t) => t.name === wName);
  const B = model.graph.initializers.find((t) => t.name === bName);
  const transB = node.attrs.find((a) => a.name === 'transB')?.i ?? 0;
  if (transB !== 1) throw new Error('expected transB = 1');
  layers.push({ name: node.name || wName, out: W.dims[0], in: W.dims[1], weights: offset, bias: offset + W.data.length * 4, activation: null });
  blobs.push(Buffer.from(new Float32Array(W.data).buffer), Buffer.from(new Float32Array(B.data).buffer));
  offset += (W.data.length + B.data.length) * 4;
}
const elus = model.graph.nodes.filter((x) => x.op === 'Elu');
for (let i = 0; i < layers.length - 1; i++) layers[i].activation = { type: 'elu', alpha: elus[i]?.attrs.find((a) => a.name === 'alpha')?.f ?? 1 };
contract.mlp = { file: 'mlp.bin', layers, opset: model.opsets[0]?.version, producer: `${model.producerName} ${model.producerVersion}`, input: 'obs', output: 'actions' };

const out = 'public/policy/model_aug_18_1';
mkdirSync(out, { recursive: true });
copyFileSync(onnxPath, join(out, 'policy.onnx'));
writeFileSync(join(out, 'mlp.bin'), Buffer.concat(blobs));
writeFileSync(join(out, 'contract.json'), JSON.stringify(contract, null, 1));
console.log(`contract: ${n} joints, obs ${contract.observation.size}, lag ${lag} substeps, alpha ${contract.timing.actionLpfAlpha.toFixed(6)}; mlp ${layers.map((l) => `${l.in}->${l.out}`).join(', ')}`);
console.log('operative stiffness from', provenance.stiffness, '; default pose from', provenance.default_joint_pos);
