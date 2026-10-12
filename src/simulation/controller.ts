// The 50 Hz control tick, ported line for line from the upstream viewer's main.js main_loop()
// (menloresearch/humanoid-policy-viewer@0c21078) so a given physics state and command produce
// the same torques and the same next state. All controller memory lives in `ControllerState`
// so it can be captured and restored with the physics (freeze / inspect / resume).
import { buildObservation, type Command, type PolicyState } from './observation.ts';
import type { PolicyContract } from './contract.ts';
import type { PolicyEngine } from './policy-engine.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface MjHandle {
  mujoco: any;
  model: any;
  data: any;
}

export interface ActivePush {
  id: number;
  body: string;
  bodyId: number;
  force: [number, number, number];
  torque: [number, number, number];
  point: [number, number, number];
  substepsLeft: number;
}

export interface ControllerState {
  /** Latched once projected gravity z exceeds the fall threshold (about 80 degrees of tilt). */
  tumbling: boolean;
  actionTarget: Float32Array | null;
  filteredActionTarget: Float32Array | null;
  delayBuffer: Float32Array[];
  lastActions: Float32Array;
  command: Command;
  pushes: ActivePush[];
  tick: number;
  /** Raw (clipped) policy outputs of the last policy tick, for inspection. */
  lastRaw: Float32Array;
  lastObs: Float32Array;
}

export interface JointMap {
  ctrl: number[];
  qpos: number[];
  qvel: number[];
}

export function mapJoints(h: MjHandle, joints: string[]): JointMap {
  const { model } = h;
  const names = new TextDecoder().decode(model.names);
  const nameAt = (adr: number) => names.slice(adr, names.indexOf('\0', adr));
  const jointNames = Array.from({ length: model.njnt as number }, (_, j) => nameAt(model.name_jntadr[j]));
  const transmissionJoint = h.mujoco.mjtTrn.mjTRN_JOINT.value;
  const actuator2joint: number[] = [];
  for (let i = 0; i < model.nu; i++) {
    if (model.actuator_trntype[i] !== transmissionJoint) throw new Error(`actuator ${i} is not a joint actuator`);
    actuator2joint.push(model.actuator_trnid[2 * i]);
  }
  const map: JointMap = { ctrl: [], qpos: [], qvel: [] };
  for (const name of joints) {
    const j = jointNames.indexOf(name);
    if (j < 0) throw new Error(`joint ${name} not found in the model`);
    const a = actuator2joint.findIndex((x) => x === j);
    if (a < 0) throw new Error(`no actuator for joint ${name}`);
    map.ctrl.push(a);
    map.qpos.push(model.jnt_qposadr[j]);
    map.qvel.push(model.jnt_dofadr[j]);
  }
  if (new Set(map.ctrl).size !== joints.length) throw new Error('two policy joints map to the same actuator');
  return map;
}

export class Controller {
  readonly c: PolicyContract;
  readonly h: MjHandle;
  readonly map: JointMap;
  engine: PolicyEngine;
  readonly n: number;
  readonly defaultPose: Float32Array;
  readonly actionScale: Float32Array;
  readonly kp: Float32Array;
  readonly kd: Float32Array;
  readonly kdFf: Float32Array | null;
  readonly lag: number;
  readonly alpha: number;
  readonly decimation: number;
  s: ControllerState;
  private readonly obs: Float32Array;
  private nextPushId = 1;

  constructor(h: MjHandle, contract: PolicyContract, engine: PolicyEngine) {
    this.h = h;
    this.c = contract;
    this.engine = engine;
    this.n = contract.joints.length;
    this.map = mapJoints(h, contract.joints);
    this.defaultPose = new Float32Array(contract.action.defaultPose);
    this.actionScale = new Float32Array(contract.action.scale);
    this.kp = new Float32Array(contract.pd.stiffness);
    this.kd = new Float32Array(contract.pd.damping);
    this.kdFf = contract.pd.kdFeedForward ? new Float32Array(contract.pd.kdFeedForward) : null;
    this.lag = contract.timing.actionDelayLagSubsteps;
    this.alpha = contract.timing.actionLpfAlpha;
    this.decimation = Math.max(1, Math.round(1 / contract.timing.policyHz / h.model.opt.timestep));
    if (this.decimation !== contract.timing.decimation) throw new Error(`model timestep gives decimation ${this.decimation}, contract says ${contract.timing.decimation}`);
    this.obs = new Float32Array(contract.observation.size);
    // Torque caps from the policy's training config: applied to the model, never left at 0/0.
    contract.pd.torqueLimit.forEach((limit, i) => {
      const a = this.map.ctrl[i];
      h.model.actuator_ctrlrange[2 * a] = -limit;
      h.model.actuator_ctrlrange[2 * a + 1] = limit;
    });
    for (let i = 0; i < this.n; i++) {
      const a = this.map.ctrl[i];
      if (!(h.model.actuator_ctrlrange[2 * a + 1] > 0)) throw new Error(`actuator for ${contract.joints[i]} has no torque limit`);
    }
    this.s = this.freshState();
  }

  private freshState(): ControllerState {
    return { tumbling: false, actionTarget: null, filteredActionTarget: null, delayBuffer: [], lastActions: new Float32Array(this.n), command: { vx: 0, vy: 0, wz: 0 }, pushes: [], tick: 0, lastRaw: new Float32Array(this.n), lastObs: new Float32Array(this.c.observation.size) };
  }

  /** Upstream resetSimulation(): default pose (as float32) at z 0.614, upright, at rest. */
  reset(command: Command = { vx: 0, vy: 0, wz: 0 }): void {
    const { mujoco, model, data } = this.h;
    mujoco.mj_resetData(model, data);
    const q = data.qpos;
    q[2] = this.c.reset.rootZ; q[3] = 1; q[4] = 0; q[5] = 0; q[6] = 0;
    for (let i = 0; i < this.n; i++) q[this.map.qpos[i]] = this.defaultPose[i];
    mujoco.mj_forward(model, data);
    this.s = this.freshState();
    this.s.command = { ...command };
  }

  readPolicyState(): PolicyState {
    const { data } = this.h;
    const qpos = data.qpos, qvel = data.qvel;
    const jointPos = new Float32Array(this.n), jointVel = new Float32Array(this.n);
    for (let i = 0; i < this.n; i++) { jointPos[i] = qpos[this.map.qpos[i]]; jointVel[i] = qvel[this.map.qvel[i]]; }
    return { jointPos, jointVel, rootQuat: new Float32Array([qpos[3], qpos[4], qpos[5], qpos[6]]), rootAngVel: new Float32Array([qvel[3], qvel[4], qvel[5]]) };
  }

  /** Queues a force through a body's centre of mass (world frame, fixed point at the start). */
  queuePush(body: string, dirWorld: [number, number, number], forceN: number, durationS: number): ActivePush {
    const { model, data } = this.h;
    const names = new TextDecoder().decode(model.names);
    let bodyId = -1;
    for (let b = 0; b < model.nbody; b++) {
      const adr = model.name_bodyadr[b];
      if (names.slice(adr, names.indexOf('\0', adr)) === body) bodyId = b;
    }
    if (bodyId < 0) throw new Error(`no body ${body}`);
    const len = Math.hypot(...dirWorld);
    if (!(len > 0)) throw new Error('push direction is zero');
    const mag = Math.abs(forceN);
    const push: ActivePush = {
      id: this.nextPushId++, body, bodyId,
      force: [(dirWorld[0] / len) * mag, (dirWorld[1] / len) * mag, (dirWorld[2] / len) * mag],
      torque: [0, 0, 0],
      point: [data.xipos[bodyId * 3], data.xipos[bodyId * 3 + 1], data.xipos[bodyId * 3 + 2]],
      substepsLeft: Math.max(1, Math.round(durationS / model.opt.timestep)),
    };
    this.s.pushes.push(push);
    return push;
  }

  private delayed(source: Float32Array | null): Float32Array | null {
    if (!source || this.lag <= 0) return source;
    this.s.delayBuffer.push(new Float32Array(source));
    while (this.s.delayBuffer.length > this.lag + 1) this.s.delayBuffer.shift();
    return this.s.delayBuffer[0] ?? source;
  }

  /** One policy tick: observation, inference (unless in DAMP), then `decimation` physics substeps. */
  async tick(): Promise<void> {
    const { mujoco, model, data } = this.h;
    const s = this.s;
    const qx = data.qpos[4], qy = data.qpos[5];
    const gravZ = -(1.0 - 2.0 * (qx * qx + qy * qy));
    if (gravZ > this.c.fallRule.projectedGravityZAbove) s.tumbling = true;
    if (s.tumbling) {
      if (!s.actionTarget) s.actionTarget = new Float32Array(this.n);
      for (let i = 0; i < this.n; i++) s.actionTarget[i] = data.qpos[this.map.qpos[i]];
      if (s.filteredActionTarget) s.filteredActionTarget.set(s.actionTarget);
      else s.filteredActionTarget = new Float32Array(s.actionTarget);
    } else {
      const state = this.readPolicyState();
      buildObservation(this.c, this.defaultPose, state, s.command, s.lastActions, this.obs);
      s.lastObs.set(this.obs);
      const action = await this.engine.run(this.obs);
      if (!action || action.length !== this.n) throw new Error('the policy returned an invalid action');
      const clip = this.c.action.clip;
      for (let i = 0; i < this.n; i++) s.lastActions[i] = Math.max(-clip, Math.min(clip, action[i]));
      s.lastRaw.set(s.lastActions);
      const target = new Float32Array(this.n);
      for (let i = 0; i < this.n; i++) target[i] = this.defaultPose[i] + this.actionScale[i] * s.lastActions[i];
      s.actionTarget = target;
      let maxAbs = 0;
      for (let i = 0; i < this.n; i++) maxAbs = Math.max(maxAbs, Math.abs(target[i]));
      if (maxAbs > 100.0) s.tumbling = true;
      if (!s.filteredActionTarget) s.filteredActionTarget = new Float32Array(target);
      else for (let i = 0; i < this.n; i++) s.filteredActionTarget[i] = this.alpha * target[i] + (1 - this.alpha) * s.filteredActionTarget[i];
    }
    const hasFf = this.kdFf !== null;
    for (let sub = 0; sub < this.decimation; sub++) {
      const source = s.filteredActionTarget ?? s.actionTarget;
      const delayed = s.tumbling ? source : this.delayed(source);
      for (let i = 0; i < this.n; i++) {
        const qa = this.map.qpos[i], va = this.map.qvel[i], ca = this.map.ctrl[i];
        const target = delayed ? delayed[i] : 0.0;
        const kp = s.tumbling ? this.c.fallRule.dampKp : this.kp[i];
        const vel = data.qvel[va];
        const kd = s.tumbling ? this.c.fallRule.dampKd : this.kd[i];
        const kdHw = s.tumbling ? this.c.fallRule.dampKd : hasFf ? Math.min(kd, 5.0) : kd;
        let torque = kp * (target - data.qpos[qa]) + kdHw * (0 - vel);
        if (hasFf && !s.tumbling) {
          const ff = this.kdFf![i] ?? 0.0;
          if (ff > 0) torque += Math.max(-30, Math.min(30, -ff * vel));
        }
        const lo = model.actuator_ctrlrange[ca * 2], hi = model.actuator_ctrlrange[ca * 2 + 1];
        data.ctrl[ca] = Number.isFinite(lo) && Number.isFinite(hi) && lo < hi ? Math.min(Math.max(torque, lo), hi) : torque;
      }
      const applied = data.qfrc_applied;
      for (let i = 0; i < applied.length; i++) applied[i] = 0.0;
      for (let i = s.pushes.length - 1; i >= 0; i--) {
        const p = s.pushes[i];
        mujoco.mj_applyFT(model, data, p.force, p.torque, p.point, p.bodyId, data.qfrc_applied);
        p.substepsLeft--;
        if (p.substepsLeft <= 0) s.pushes.splice(i, 1);
      }
      mujoco.mj_step(model, data);
    }
    s.tick++;
  }
}
