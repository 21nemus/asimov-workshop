// SimulationAdapter: the narrow boundary between ASIMOV WORKSHOP and the physics + policy.
// The rest of the app never touches MuJoCo or the policy directly. Physics advances in fixed
// 20 ms policy ticks (4 x 5 ms substeps) regardless of display rate; when the browser cannot
// keep up, simulated time slows down and the real-time factor reports it. Work is never
// dropped and no state is ever edited to look better.
import { Controller, type ActivePush, type ControllerState, type MjHandle } from './controller.ts';
import { contractErrors, type PolicyContract } from './contract.ts';
import { MlpEngine, type PolicyEngine } from './policy-engine.ts';
import type { Command } from './observation.ts';
import { motorJointNames, withActuatorOverlay } from './model-overlay.ts';

export type SimStatus = 'UNINITIALIZED' | 'LOADING' | 'READY' | 'RUNNING' | 'PAUSED' | 'INSPECTION_FROZEN' | 'RESETTING' | 'ERROR';
/** What is actually driving the joints right now. */
export type ControllerMode = 'POLICY_ACTIVE' | 'FALL_DAMP' | 'IDLE';

export interface PerturbationSpec {
  body: string;
  /** Direction in the MuJoCo world frame (x forward at reset, y left, z up); normalised internally. */
  dirWorld: [number, number, number];
  forceN: number;
  durationS: number;
  label?: string;
}

export interface PerturbationRecord extends PerturbationSpec {
  id: number;
  frame: 'world';
  /** World point the force acts through: the body's centre of mass when the push started. */
  pointWorld: [number, number, number];
  startTime: number;
  endTime: number;
  startTick: number;
  substeps: number;
}

export interface SimEvent {
  t: number;
  tick: number;
  kind: 'initialized' | 'reset' | 'command' | 'push' | 'fall-detected' | 'paused' | 'resumed' | 'frozen' | 'unfrozen' | 'error' | 'speed';
  detail: string;
}

export interface SimSnapshot {
  time: number;
  arrays: Record<string, Float64Array>;
  controller: ControllerState;
  pushes: ActivePush[];
  tick: number;
}

export interface JointReading {
  name: string;
  q: number;
  qd: number;
  torque: number;
  torqueLimit: number;
  target: number | null;
}

export interface FootContact {
  foot: 'left' | 'right';
  points: number;
  normalForceN: number;
}

export interface SimStats {
  simTime: number;
  tick: number;
  realtimeFactor: number;
  lastTickMs: number;
  speed: number;
  engine: string;
  physics: string;
}

// Integration state (what mj_getState(mjSTATE_INTEGRATION) would hold for this model) plus the
// derived kinematics read before the next mj_step recomputes them: xipos (push anchor point),
// cdof and subtree_com (mj_applyFT's Jacobian, one substep old exactly as upstream uses it),
// xpos/xquat (rendering). Capturing these makes a restored run continue bit for bit.
const STATE_FIELDS = ['qpos', 'qvel', 'act', 'qacc_warmstart', 'ctrl', 'qfrc_applied', 'xfrc_applied', 'xpos', 'xquat', 'xipos', 'cdof', 'subtree_com', 'xanchor', 'xaxis'] as const;

function cloneController(s: ControllerState): ControllerState {
  return {
    tumbling: s.tumbling,
    actionTarget: s.actionTarget ? new Float32Array(s.actionTarget) : null,
    filteredActionTarget: s.filteredActionTarget ? new Float32Array(s.filteredActionTarget) : null,
    delayBuffer: s.delayBuffer.map((b) => new Float32Array(b)),
    lastActions: new Float32Array(s.lastActions),
    command: { ...s.command },
    pushes: s.pushes.map((p) => ({ ...p, force: [...p.force] as [number, number, number], torque: [...p.torque] as [number, number, number], point: [...p.point] as [number, number, number] })),
    tick: s.tick,
    lastRaw: new Float32Array(s.lastRaw),
    lastObs: new Float32Array(s.lastObs),
  };
}

export interface InitOptions {
  /** URL prefix of the app's public files (import.meta.env.BASE_URL). */
  base: string;
  engine?: 'mlp' | 'ort';
  onProgress?: (label: string, fraction: number) => void;
  /** Injected loaders keep this module usable in Node tests. */
  loadMujoco?: () => Promise<any>;
  fetchBytes?: (url: string) => Promise<ArrayBuffer>;
  fetchText?: (url: string) => Promise<string>;
  /**
   * ONNX Runtime engine factory (the cross-check path). Injected rather than imported so the
   * production bundle does not carry ONNX Runtime's 14 MB WebAssembly; the shipped engine is the
   * TypeScript forward pass, verified against ONNX Runtime in the test suite.
   */
  createOrt?: (onnx: ArrayBuffer) => Promise<PolicyEngine>;
}

export class SimulationAdapter {
  status: SimStatus = 'UNINITIALIZED';
  error: string | null = null;
  ctrl: Controller | null = null;
  contract: PolicyContract | null = null;
  readonly events: SimEvent[] = [];
  readonly perturbations: PerturbationRecord[] = [];
  /** Simulated-time scale (slow motion below 1). Physics work per tick never changes. */
  speed = 1;
  private h: MjHandle | null = null;
  private accumulator = 0;
  private realtime = 1;
  private lastTickMs = 0;
  private wallAccum = 0;
  private simAccum = 0;
  private frozen: SimSnapshot | null = null;
  private statusBeforeFreeze: SimStatus = 'PAUSED';
  private busy = false;
  private listeners = new Set<() => void>();
  private engineLabel = '';
  private physicsLabel = '';

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(): void {
    for (const fn of this.listeners) fn();
  }
  private log(kind: SimEvent['kind'], detail: string): void {
    const t = this.h?.data.time ?? 0;
    this.events.push({ t, tick: this.ctrl?.s.tick ?? 0, kind, detail });
    if (this.events.length > 400) this.events.shift();
  }
  private fail(e: unknown): never {
    this.status = 'ERROR';
    this.error = e instanceof Error ? e.message : String(e);
    this.log('error', this.error);
    this.emit();
    throw e;
  }

  get handle(): MjHandle | null {
    return this.h;
  }

  async initialize(opts: InitOptions): Promise<void> {
    if (this.status !== 'UNINITIALIZED' && this.status !== 'ERROR') return;
    this.status = 'LOADING';
    this.error = null;
    this.emit();
    const fetchBytes = opts.fetchBytes ?? (async (u: string) => { const r = await fetch(u); if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`); return r.arrayBuffer(); });
    const fetchText = opts.fetchText ?? (async (u: string) => { const r = await fetch(u); if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`); return r.text(); });
    try {
      opts.onProgress?.('Physics engine (MuJoCo 3.3.8, WebAssembly)', 0.05);
      const load = opts.loadMujoco ?? (async () => (await import('mujoco-js')).default());
      const [mujoco, xml, contractText] = await Promise.all([
        load(),
        fetchText(`${opts.base}sim/asimov_1.physics.xml`),
        fetchText(`${opts.base}policy/model_aug_18_1/contract.json`),
      ]);
      opts.onProgress?.('Robot model and policy contract', 0.6);
      const contract = JSON.parse(contractText) as PolicyContract;
      const errors = contractErrors(contract, motorJointNames(xml));
      if (errors.length) throw new Error(`policy contract rejected: ${errors.join('; ')}`);
      if (!mujoco.FS.analyzePath('/aw').exists) {
        mujoco.FS.mkdir('/aw');
        mujoco.FS.mount(mujoco.MEMFS, { root: '.' }, '/aw');
      }
      mujoco.FS.writeFile('/aw/asimov_1.xml', withActuatorOverlay(xml));
      const model = mujoco.MjModel.loadFromXML('/aw/asimov_1.xml');
      const data = new mujoco.MjData(model);
      this.h = { mujoco, model, data };
      this.physicsLabel = `MuJoCo ${mujoco.mj_versionString()} (mujoco-js 0.0.7)`;
      opts.onProgress?.('Policy network', 0.75);
      let engine: PolicyEngine;
      if (opts.engine === 'ort') {
        if (!opts.createOrt) throw new Error('the ONNX Runtime engine is not included in this build');
        engine = await opts.createOrt(await fetchBytes(`${opts.base}policy/model_aug_18_1/policy.onnx`));
      }
      else engine = new MlpEngine(contract, await fetchBytes(`${opts.base}policy/model_aug_18_1/mlp.bin`));
      this.engineLabel = engine.label;
      this.contract = contract;
      this.ctrl = new Controller(this.h, contract, engine);
      this.ctrl.reset();
      this.status = 'READY';
      this.log('initialized', `${this.physicsLabel}; ${engine.label}; checkpoint ${contract.checkpoint.id}`);
      opts.onProgress?.('Ready', 1);
      this.emit();
    } catch (e) {
      this.fail(e);
    }
  }

  private need(): Controller {
    if (!this.ctrl || !this.h) throw new Error('simulation not initialised');
    return this.ctrl;
  }

  /** Back to the verified starting state (upstream resetSimulation), paused. */
  reset(command: Command = { vx: 0, vy: 0, wz: 0 }): void {
    const c = this.need();
    this.status = 'RESETTING';
    this.frozen = null;
    c.reset(command);
    this.accumulator = 0;
    this.perturbations.length = 0;
    this.status = 'PAUSED';
    this.log('reset', `root z ${c.c.reset.rootZ} m, trained default pose, at rest; command vx ${command.vx} vy ${command.vy} wz ${command.wz}`);
    this.emit();
  }

  start(): void {
    this.need();
    if (this.status === 'INSPECTION_FROZEN') return;
    this.status = 'RUNNING';
    this.accumulator = 0;
    this.log('resumed', 'running');
    this.emit();
  }

  pause(): void {
    if (this.status !== 'RUNNING') return;
    this.status = 'PAUSED';
    this.log('paused', 'stepping stopped');
    this.emit();
  }

  resume(): void {
    if (this.status === 'PAUSED' || this.status === 'READY') this.start();
  }

  setSpeed(speed: number): void {
    this.speed = Math.min(1, Math.max(0.05, speed));
    this.log('speed', `simulated time scale ${this.speed.toFixed(2)}x`);
    this.emit();
  }

  /** Clamped to the command ranges the checkpoint was trained on (env.yaml). */
  setVelocityCommand(cmd: Command): Command {
    const c = this.need();
    const L = c.c.commandLimits;
    const clamp = (v: number, [lo, hi]: [number, number]) => Math.min(hi, Math.max(lo, v));
    const next = { vx: clamp(cmd.vx, L.vx), vy: clamp(cmd.vy, L.vy), wz: clamp(cmd.wz, L.wz) };
    const prev = c.s.command;
    if (prev.vx !== next.vx || prev.vy !== next.vy || prev.wz !== next.wz) {
      c.s.command = next;
      this.log('command', `vx ${next.vx.toFixed(2)} m/s, vy ${next.vy.toFixed(2)} m/s, yaw rate ${next.wz.toFixed(2)} rad/s`);
      this.emit();
    }
    return next;
  }

  applyExternalForce(spec: PerturbationSpec): PerturbationRecord {
    const c = this.need();
    const p = c.queuePush(spec.body, spec.dirWorld, spec.forceN, spec.durationS);
    const t = this.h!.data.time as number;
    const dt = this.h!.model.opt.timestep as number;
    const rec: PerturbationRecord = { ...spec, id: p.id, frame: 'world', pointWorld: [...p.point], startTime: t, endTime: t + p.substepsLeft * dt, startTick: c.s.tick, substeps: p.substepsLeft };
    this.perturbations.push(rec);
    const n = Math.hypot(...spec.dirWorld);
    this.log('push', `${spec.forceN} N for ${spec.durationS} s on ${spec.body} through its centre of mass, direction (${spec.dirWorld.map((v) => (v / n).toFixed(2)).join(', ')}) world, t ${t.toFixed(3)}-${rec.endTime.toFixed(3)} s`);
    this.emit();
    return rec;
  }

  /** Runs exactly n policy ticks now (deterministic; used by WATCH and tests). */
  async stepTicks(n: number): Promise<void> {
    const c = this.need();
    for (let i = 0; i < n; i++) {
      const wasTumbling = c.s.tumbling;
      const t0 = performance.now();
      try {
        await c.tick();
      } catch (e) {
        this.fail(e);
      }
      this.lastTickMs = performance.now() - t0;
      if (!wasTumbling && c.s.tumbling) {
        this.log('fall-detected', `tilt past ${c.c.fallRule.tiltDeg} deg: policy stopped, low-gain DAMP mode (kp ${c.c.fallRule.dampKp}, kd ${c.c.fallRule.dampKd}) until reset`);
        this.emit();
      }
    }
  }

  /**
   * Real-time scheduler, called once per animation frame with the wall-clock delta. Runs whole
   * policy ticks while there is simulated time owed and the frame budget allows; if the budget
   * runs out, the owed time is dropped (the simulation slows down) rather than skipping work.
   */
  async advance(wallDt: number, budgetMs = 10): Promise<number> {
    if (this.status !== 'RUNNING' || this.busy) return 0;
    const c = this.need();
    this.busy = true;
    const period = 1 / c.c.timing.policyHz;
    this.accumulator += Math.min(wallDt, 0.1) * this.speed;
    const start = performance.now();
    let ticks = 0;
    try {
      while (this.accumulator >= period && this.status === 'RUNNING') {
        await this.stepTicks(1);
        this.accumulator -= period;
        ticks++;
        if (performance.now() - start > budgetMs) {
          this.accumulator = Math.min(this.accumulator, period);
          break;
        }
      }
    } finally {
      this.busy = false;
    }
    this.wallAccum += wallDt;
    this.simAccum += ticks * period;
    if (this.wallAccum > 0.5) {
      this.realtime = this.simAccum / this.wallAccum;
      this.wallAccum = 0;
      this.simAccum = 0;
    }
    return ticks;
  }

  /** Complete physics + controller state (bit-exact continuation after restoreState). */
  captureState(): SimSnapshot {
    const c = this.need();
    const d = this.h!.data;
    const arrays: Record<string, Float64Array> = {};
    for (const f of STATE_FIELDS) arrays[f] = Float64Array.from(d[f] as Float64Array);
    return { time: d.time, arrays, controller: cloneController(c.s), pushes: c.s.pushes.map((p) => ({ ...p })), tick: c.s.tick };
  }

  restoreState(s: SimSnapshot): void {
    const c = this.need();
    const d = this.h!.data;
    d.time = s.time;
    for (const f of STATE_FIELDS) (d[f] as Float64Array).set(s.arrays[f]);
    c.s = cloneController(s.controller);
    this.emit();
  }

  /** Stops stepping and keeps a full snapshot; the physical state is never touched while frozen. */
  freeze(): SimSnapshot {
    this.need();
    if (this.status === 'INSPECTION_FROZEN') return this.frozen!;
    this.statusBeforeFreeze = this.status === 'RUNNING' ? 'RUNNING' : 'PAUSED';
    this.frozen = this.captureState();
    this.status = 'INSPECTION_FROZEN';
    this.log('frozen', `inspection at t ${this.frozen.time.toFixed(3)} s (tick ${this.frozen.tick})`);
    this.emit();
    return this.frozen;
  }

  /** Restores the frozen snapshot (in case anything touched MjData) and continues. */
  unfreeze(): void {
    if (this.status !== 'INSPECTION_FROZEN' || !this.frozen) return;
    this.restoreState(this.frozen);
    this.frozen = null;
    this.status = this.statusBeforeFreeze;
    this.accumulator = 0;
    this.log('unfrozen', `continuing from t ${this.h!.data.time.toFixed(3)} s`);
    this.emit();
  }

  getControllerMode(): ControllerMode {
    if (!this.ctrl || this.status === 'UNINITIALIZED' || this.status === 'LOADING' || this.status === 'ERROR') return 'IDLE';
    return this.ctrl.s.tumbling ? 'FALL_DAMP' : 'POLICY_ACTIVE';
  }

  getJointState(): JointReading[] {
    const c = this.need();
    const { data, model } = this.h!;
    const target = c.s.filteredActionTarget ?? c.s.actionTarget;
    return c.c.joints.map((name, i) => ({
      name, q: data.qpos[c.map.qpos[i]], qd: data.qvel[c.map.qvel[i]], torque: data.ctrl[c.map.ctrl[i]],
      torqueLimit: model.actuator_ctrlrange[2 * c.map.ctrl[i] + 1], target: target ? target[i] : null,
    }));
  }

  getContactState(): FootContact[] {
    const { data, model } = this.h!;
    const out: Record<'left' | 'right', FootContact> = { left: { foot: 'left', points: 0, normalForceN: 0 }, right: { foot: 'right', points: 0, normalForceN: 0 } };
    const names = new TextDecoder().decode(model.names);
    const bodyName = (b: number) => { const adr = model.name_bodyadr[b]; return names.slice(adr, names.indexOf('\0', adr)); };
    const efc = data.efc_force as Float64Array;
    for (let i = 0; i < data.ncon; i++) {
      const con = data.contact.get(i);
      if (!con) continue;
      const b1 = bodyName(model.geom_bodyid[con.geom1]), b2 = bodyName(model.geom_bodyid[con.geom2]);
      const foot = [b1, b2].includes('left_ankle_roll_link') ? 'left' : [b1, b2].includes('right_ankle_roll_link') ? 'right' : null;
      if (foot && con.efc_address >= 0) {
        out[foot].points++;
        out[foot].normalForceN += Math.abs(efc[con.efc_address]);
      }
      con.delete();
    }
    return [out.left, out.right];
  }

  getSimulationStats(): SimStats {
    return { simTime: this.h?.data.time ?? 0, tick: this.ctrl?.s.tick ?? 0, realtimeFactor: this.realtime, lastTickMs: this.lastTickMs, speed: this.speed, engine: this.engineLabel, physics: this.physicsLabel };
  }

  /**
   * Ground grip: sets the sliding friction of the foot contact spheres (they carry priority 1,
   * so their friction alone governs foot-floor contact). Port of upstream setFootFriction().
   * The model default is 0.6; upstream's low-friction benchmark uses 0.3.
   */
  setFootFriction(slide: number): void {
    if (!Number.isFinite(slide) || slide <= 0) throw new Error('foot friction must be a positive number');
    const { model } = this.h!;
    const names = new TextDecoder().decode(model.names);
    let n = 0;
    for (let g = 0; g < model.ngeom; g++) {
      const adr = model.name_geomadr[g];
      if (!/foot\d*_collision$/.test(names.slice(adr, names.indexOf('\0', adr)))) continue;
      model.geom_friction[3 * g] = slide;
      n++;
    }
    if (n !== 8) throw new Error(`expected 8 foot contact geoms, found ${n}`);
    this.footFriction = slide;
    this.log('command', `foot sliding friction set to ${slide}`);
    this.emit();
  }

  footFriction = 0.6;

  /** A body's current centre of mass in the world frame (MjData xipos), or null if unknown. */
  bodyCom(body: string): [number, number, number] | null {
    if (!this.h) return null;
    const { model, data } = this.h;
    const names = new TextDecoder().decode(model.names);
    for (let b = 0; b < model.nbody; b++) {
      const adr = model.name_bodyadr[b];
      if (names.slice(adr, names.indexOf('\0', adr)) !== body) continue;
      const x = data.xipos as Float64Array;
      return [x[3 * b], x[3 * b + 1], x[3 * b + 2]];
    }
    return null;
  }

  /** Root pose (x, y, z, qw, qx, qy, qz) and all hinge positions, for the render rig. */
  qpos(): Float64Array {
    return this.h!.data.qpos as Float64Array;
  }
}
