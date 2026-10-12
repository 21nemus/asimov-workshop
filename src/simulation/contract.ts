// The operative policy contract (built by tools/build-policy.mjs with the upstream viewer's own
// env.yaml parser). Validated again at runtime: a missing gain or torque limit must stop the
// simulation with a visible error, never leave an actuator unclamped.

export interface ObsTerm {
  name: string;
  scale?: number;
  slot_name?: string;
  indices?: number[];
}

export interface MlpLayer {
  name: string;
  in: number;
  out: number;
  weights: number;
  bias: number;
  activation: { type: 'elu'; alpha: number } | null;
}

export interface PolicyContract {
  checkpoint: { id: string; onnx: string; onnxSha256: string; envYamlSha256: string; referenceConfigSha256: string; source: string; licence: string; trainedIn: string };
  joints: string[];
  observation: { size: number; recipe: ObsTerm[]; angVelScale: number };
  action: { size: number; scale: number[]; defaultPose: number[]; clip: number };
  pd: { stiffness: number[]; damping: number[]; kdFeedForward: number[] | null; torqueLimit: number[] };
  timing: { policyHz: number; physicsDt: number; decimation: number; actionDelayLagSubsteps: number; actionLpfHz: number; actionLpfAlpha: number };
  commandLimits: { vx: [number, number]; vy: [number, number]; wz: [number, number] };
  fallRule: { projectedGravityZAbove: number; tiltDeg: number; commentInSourceSays: string; dampKp: number; dampKd: number; latched: string };
  reset: { rootZ: number; rootQuat: [number, number, number, number] };
  provenance: Record<string, string>;
  mlp: { file: string; layers: MlpLayer[]; opset: number; producer: string; input: string; output: string };
}

export const SUPPORTED_TERMS = new Set(['AsimovAngVel', 'AsimovProjectedGravity', 'AsimovCommand', 'AsimovJointPosSlot', 'AsimovJointVelSlot', 'AsimovPrevActions']);

/** Every problem with a contract; empty when it can drive the simulation. */
export function contractErrors(c: PolicyContract, motorJoints: string[]): string[] {
  const errors: string[] = [];
  const n = c.joints?.length ?? 0;
  if (n === 0) errors.push('no policy joints');
  if (new Set(c.joints).size !== n) errors.push('duplicate policy joints');
  for (const j of c.joints ?? []) if (!motorJoints.includes(j)) errors.push(`policy joint ${j} has no motor in the model`);
  const arrays: [string, number[] | undefined][] = [['action scale', c.action?.scale], ['default pose', c.action?.defaultPose], ['stiffness', c.pd?.stiffness], ['damping', c.pd?.damping], ['torque limit', c.pd?.torqueLimit]];
  for (const [label, arr] of arrays) {
    if (!Array.isArray(arr) || arr.length !== n) errors.push(`${label}: expected ${n} values`);
    else if (arr.some((v) => typeof v !== 'number' || !Number.isFinite(v))) errors.push(`${label}: non-finite value`);
  }
  if (c.pd?.torqueLimit?.some((v) => !(v > 0))) errors.push('torque limit: every joint needs a positive limit');
  if (c.pd?.kdFeedForward && c.pd.kdFeedForward.length !== n) errors.push('kd feed-forward length');
  let obsSize = 0;
  for (const t of c.observation?.recipe ?? []) {
    if (!SUPPORTED_TERMS.has(t.name)) errors.push(`unsupported observation term ${t.name}`);
    obsSize += t.name === 'AsimovPrevActions' ? n : t.indices ? t.indices.length : 3;
    for (const i of t.indices ?? []) if (i < 0 || i >= n) errors.push(`${t.name} index ${i} out of range`);
  }
  if (obsSize !== c.observation?.size) errors.push(`observation recipe builds ${obsSize} values, contract says ${c.observation?.size}`);
  if (Math.abs(c.timing.physicsDt * c.timing.decimation - 1 / c.timing.policyHz) > 1e-9) errors.push('policy period does not equal physics dt x decimation');
  const mlpIn = c.mlp?.layers?.[0]?.in, mlpOut = c.mlp?.layers?.at(-1)?.out;
  if (mlpIn !== c.observation.size) errors.push(`policy network takes ${mlpIn} inputs, observation has ${c.observation.size}`);
  if (mlpOut !== n) errors.push(`policy network outputs ${mlpOut} actions for ${n} joints`);
  return errors;
}

export async function loadContract(base: string): Promise<PolicyContract> {
  const r = await fetch(`${base}contract.json`);
  if (!r.ok) throw new Error(`policy contract: HTTP ${r.status}`);
  return (await r.json()) as PolicyContract;
}
