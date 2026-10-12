// TEST: Menlo's published walking policy in a live MuJoCo simulation of the Asimov model.
// Flat floor, one verified starting state, a supported velocity command, one controlled push,
// and the real outcome, including a fall. Controller state is always visible.
import { Vector3 } from 'three';
import { ForceArrow } from '../../scene/force-arrow.ts';
import { h, clear } from '../../ui/dom.ts';
import { button, icon, kv, sectionTitle, segmented, slider, stamp } from '../../ui/components.ts';
import type { AppContext, Mode, ModeId } from '../context.ts';
import type { JointReading, PerturbationRecord, SimulationAdapter } from '../../simulation/adapter.ts';
import type { PartHit } from '../../robot/robot-model.ts';
import { mjToThree } from '../../utils/frames.ts';
import { HOME, TEST_LANE } from '../../scene/layout.ts';

/** The one perturbation TEST offers: upstream's benchmark push magnitude, through the pelvis CoM. */
export const TEST_PUSH = { body: 'pelvis_link', dirWorld: [0, 1, 0] as [number, number, number], forceN: 150, durationS: 0.15, label: 'Lateral push through the pelvis centre of mass' };
/** Foot sliding friction: the model's value, and upstream's low-friction benchmark value. */
export const SURFACES = { baseline: 0.6, reduced: 0.3 } as const;
type Surface = keyof typeof SURFACES;

export const TEST_SHOT = { position: [HOME.x + 2.3, 1.25, 2.05] as [number, number, number], target: [HOME.x + 0.25, 0.58, 0] as [number, number, number] };

const jointLabel = (name: string) => {
  const s = name.replace(/_joint$/, '').replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const deg = (r: number) => `${((r * 180) / Math.PI).toFixed(1)}°`;

export class TestMode implements Mode {
  readonly id = 'test' as const;
  private ctx: AppContext;
  private sim: SimulationAdapter | null = null;
  private refresh = 0;
  private follow = true;
  private arrow = new ForceArrow();
  private els: Record<string, HTMLElement> = {};
  private vx = 0;
  private surface: Surface = 'baseline';
  private unsubscribe: (() => void) | null = null;
  private active = false;
  private inspectJoint: string | null = null;
  private lastStatusKey = '';

  constructor(ctx: AppContext) {
    this.ctx = ctx;
    ctx.stage.scene.add(this.arrow.group);
  }

  async enter(from: ModeId | null): Promise<void> {
    this.active = true;
    const { ui, camera } = this.ctx;
    ui.panel.show('Test', 'Live policy simulation');
    ui.hint('Space start or pause · F freeze · R reset · P push');
    const move = camera.goTo(TEST_SHOT, from ? 1.4 : 0);
    this.renderLoading('Starting the physics engine', 0.02);
    try {
      this.sim = await this.ctx.sim((label, f) => { if (this.active) this.renderLoading(label, f); });
    } catch (e) {
      if (this.active) this.renderError(e);
      return;
    }
    if (!this.active) return;
    const sim = this.sim;
    this.unsubscribe = sim.onChange(() => this.updateStatus());
    if (sim.status === 'READY') {
      sim.setFootFriction(SURFACES[this.surface]);
      sim.reset({ vx: this.vx, vy: 0, wz: 0 });
    }
    this.ctx.pose.followSim(() => this.sim?.qpos() ?? null);
    this.ctx.robot.rig.setQpos(sim.qpos());
    this.renderPanel();
    void move.then(() => { if (this.active && this.follow) this.ctx.camera.follow(() => this.rootThree()); });
  }

  exit(): void {
    this.active = false;
    const sim = this.sim;
    if (sim?.status === 'INSPECTION_FROZEN') sim.unfreeze();
    sim?.pause();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.ctx.camera.follow(null);
    this.arrow.visible = false;
    this.ctx.highlights.clear('test');
    this.inspectJoint = null;
    this.ctx.pose.display();
    this.ctx.lighting.follow(HOME.x, HOME.z);
  }

  update(dt: number): void {
    const sim = this.sim;
    if (!sim || !sim.ctrl || sim.status === 'ERROR') return;
    void sim.advance(dt);
    const root = this.rootThree();
    this.ctx.lighting.follow(root.x, root.z);
    if (sim.status === 'RUNNING' && (root.x > TEST_LANE.endX || Math.abs(root.z) > TEST_LANE.halfWidth)) {
      sim.pause();
      this.ctx.ui.toast('End of the test lane. The run is paused: reset to run again.');
    }
    this.updateArrow(sim);
    this.refresh += dt;
    if (this.refresh > 0.2) { this.refresh = 0; this.updateTelemetry(); }
  }

  key(e: KeyboardEvent): boolean {
    const sim = this.sim;
    if (!sim || !sim.ctrl) return false;
    if (e.key === ' ') { this.toggleRun(); return true; }
    if (e.key === 'f' || e.key === 'F') { this.toggleFreeze(); return true; }
    if (e.key === 'r' || e.key === 'R') { this.reset(); return true; }
    if (e.key === 'p' || e.key === 'P') { this.push(); return true; }
    return false;
  }

  pick(hit: PartHit | null): void {
    const sim = this.sim;
    if (!sim || sim.status !== 'INSPECTION_FROZEN') return;
    const body = hit ? this.ctx.robot.rig.body(hit.part.body) : null;
    this.inspectJoint = body?.joint?.name ?? null;
    if (hit && !this.inspectJoint) this.ctx.ui.toast(`${hit.part.body} has no actuated joint (the pelvis floats; the neck is fixed in the model).`);
    this.renderInspection();
  }

  // ---------- actions ----------
  private rootThree(): Vector3 {
    const q = this.sim!.qpos();
    return mjToThree([q[0], q[1], q[2]]).add(this.ctx.mjFrame.position);
  }

  private toggleRun(): void {
    const sim = this.sim!;
    if (sim.status === 'INSPECTION_FROZEN') return;
    if (sim.status === 'RUNNING') sim.pause();
    else sim.start();
  }

  private toggleFreeze(): void {
    const sim = this.sim!;
    if (sim.status === 'INSPECTION_FROZEN') sim.unfreeze();
    else sim.freeze();
  }

  private reset(): void {
    this.sim!.reset({ vx: this.vx, vy: 0, wz: 0 });
    this.arrow.visible = false;
    this.inspectJoint = null;
    this.updateTelemetry();
    this.renderLastPush();
  }

  private push(): void {
    const sim = this.sim!;
    if ((sim.status !== 'RUNNING' && sim.status !== 'PAUSED') || sim.getControllerMode() === 'FALL_DAMP') return;
    sim.applyExternalForce(TEST_PUSH);
    if (sim.status === 'PAUSED') sim.start();
    this.renderLastPush();
  }

  private setVx(v: number): void {
    this.vx = v;
    this.sim?.setVelocityCommand({ vx: v, vy: 0, wz: 0 });
  }

  // ---------- rendering ----------
  private renderLoading(label: string, f: number): void {
    const body = this.ctx.ui.panel.body;
    clear(body);
    body.append(
      h('p', { class: 'status status--loading' }, 'Loading physics'),
      h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(f * 100)), 'aria-label': 'Simulation loading' }, h('span', { style: `width:${Math.round(f * 100)}%` })),
      h('p', { class: 'mono', style: 'color:var(--ink-3)' }, label),
      h('p', { class: 'lede' }, 'Starting MuJoCo in your browser and loading Menlo’s published walking policy. Nothing on this screen is a recording: every frame is computed live, on this device.'),
    );
  }

  private renderError(e: unknown): void {
    const body = this.ctx.ui.panel.body;
    clear(body);
    const msg = e instanceof Error ? e.message : String(e);
    body.append(
      h('p', { class: 'status status--error' }, 'Simulation unavailable'),
      h('p', { class: 'lede' }, /WebAssembly|wasm|memory/i.test(msg) ? 'The physics engine could not start on this device. Everything else in the workshop still works.' : 'The simulation could not start. Everything else in the workshop still works.'),
      h('p', { class: 'note note--warn mono' }, msg),
      button('Try again', { icon: 'reset', onClick: () => { void this.ctx.go('explore').then(() => this.ctx.go('test')); } }),
    );
  }

  private renderPanel(): void {
    const body = this.ctx.ui.panel.body;
    clear(body);
    const sim = this.sim!;
    const limits = sim.contract!.commandLimits;
    this.els.status = h('p', { class: 'status', id: 'sim-status', role: 'status', 'aria-live': 'polite' });
    this.els.mode = h('p', { class: 'lede', style: 'margin-top:8px' });
    this.els.telemetry = h('div', { class: 'telemetry', 'aria-label': 'Live readings' });
    this.els.run = button('Start', { icon: 'play', kind: 'primary', onClick: () => this.toggleRun(), key: 'Space' });
    this.els.freeze = button('Freeze', { icon: 'freeze', onClick: () => this.toggleFreeze(), key: 'F' });
    const resetBtn = button('Reset', { icon: 'reset', onClick: () => this.reset(), key: 'R' });
    const followBtn = button('Follow the robot', { icon: 'camera', ariaPressed: this.follow, onClick: () => {
      this.follow = !this.follow;
      followBtn.setAttribute('aria-pressed', String(this.follow));
      this.ctx.camera.follow(this.follow ? () => this.rootThree() : null);
    } });
    const frontBtn = button('Front view', { kind: 'quiet', onClick: () => {
      const r = this.rootThree();
      void this.ctx.camera.goTo({ position: [r.x + TEST_SHOT.position[0] - HOME.x, TEST_SHOT.position[1], r.z + TEST_SHOT.position[2]], target: [r.x + 0.25, TEST_SHOT.target[1], r.z] }, 0.9).then(() => { if (this.follow && this.active) this.ctx.camera.follow(() => this.rootThree()); });
    } });
    const vx = slider('Forward speed command', { min: limits.vx[0], max: limits.vx[1], step: 0.05, value: this.vx, format: (v) => `${v.toFixed(2)} m/s`, onInput: (v) => this.setVx(v) });
    const presets = h('div', { class: 'row' },
      button('Stand still', { kind: 'quiet', onClick: () => { vx.set(0); this.setVx(0); } }),
      button('Walk 0.5 m/s', { kind: 'quiet', onClick: () => { vx.set(0.5); this.setVx(0.5); } }),
    );
    const surface = segmented<Surface>('Surface', [{ value: 'baseline', label: 'Baseline surface' }, { value: 'reduced', label: 'Reduced-friction surface' }], this.surface, (v) => {
      this.surface = v;
      sim.setFootFriction(SURFACES[v]);
      this.reset();
      this.els.surfaceNote.textContent = this.surfaceNote();
    });
    this.els.surfaceNote = h('p', { class: 'note' }, this.surfaceNote());
    this.els.push = button('Apply push', { icon: 'push', onClick: () => this.push(), key: 'P' });
    this.els.lastPush = h('div');
    this.els.inspect = h('div', { class: 'inspect' });
    this.els.feet = h('div', { class: 'feet' });
    this.els.log = h('ul', { class: 'log', 'aria-label': 'Simulation event log' });
    const stats = sim.getSimulationStats();
    body.append(
      h('div', { class: 'row row--spread' }, this.els.status, h('span', { class: 'mono', style: 'color:var(--ink-3)' }, `checkpoint ${sim.contract!.checkpoint.id}`)),
      this.els.mode,
      h('div', { class: 'row' }, this.els.run, this.els.freeze, resetBtn),
      this.els.telemetry,
      this.els.inspect,
      sectionTitle('Command', stamp('SIM VALUE')),
      vx.el, presets,
      h('p', { class: 'note note--sim' }, `Limited to the range the policy was trained on (env.yaml): ${limits.vx[0]} to ${limits.vx[1]} m/s forward.`),
      sectionTitle('Perturbation', stamp('SIM VALUE')),
      kv([
        ['Body', h('span', { class: 'mono' }, `${TEST_PUSH.body}, through its centre of mass`)],
        ['Direction', h('span', { class: 'mono' }, '+Y world: the robot’s left at reset')],
        ['Force', h('span', { class: 'mono' }, `${TEST_PUSH.forceN} N for ${TEST_PUSH.durationS} s`)],
      ]),
      h('p', { class: 'note' }, 'A defined test load: the push the upstream viewer’s own low-friction benchmark uses. It is not calibrated to a human shove.'),
      h('div', { class: 'row' }, this.els.push),
      this.els.lastPush,
      sectionTitle('Surface', stamp('SIM VALUE')),
      surface.el, this.els.surfaceNote,
      sectionTitle('Feet', 'contact points and normal force'),
      this.els.feet,
      sectionTitle('Camera'),
      h('div', { class: 'row' }, followBtn, frontBtn),
      sectionTitle('Event log'),
      this.els.log,
      h('p', { class: 'note' }, `Physics: ${stats.physics}. Policy: ${stats.engine}. The policy was trained in Isaac Lab (PhysX), so this is a sim-to-sim run, not a hardware result. The robot is drawn from the hardware CAD and posed by the simulation’s joints; where CAD and simulation geometry differ (the knee sits 24 mm higher in the CAD), the motion follows the simulation.`),
    );
    this.lastStatusKey = '';
    this.updateStatus();
    this.updateTelemetry();
    this.renderLastPush();
  }

  private surfaceNote(): string {
    return this.surface === 'baseline'
      ? 'BASELINE SURFACE: foot sliding friction 0.6, the simulation model’s value (the foot contact spheres set it).'
      : 'REDUCED-FRICTION SURFACE: foot sliding friction 0.3, the value of the upstream viewer’s low-friction benchmark. Not calibrated to a real floor.';
  }

  private renderLastPush(): void {
    const sim = this.sim;
    if (!sim || !this.els.lastPush) return;
    const p: PerturbationRecord | undefined = sim.perturbations.at(-1);
    clear(this.els.lastPush);
    if (!p) return;
    this.els.lastPush.append(h('p', { class: 'note note--sim mono' }, `Push #${p.id}: t ${p.startTime.toFixed(3)} to ${p.endTime.toFixed(3)} s (${p.substeps} physics steps of 5 ms), ${p.forceN} N along (${p.dirWorld.join(', ')}) in the world frame, through (${p.pointWorld.map((v) => v.toFixed(3)).join(', ')}) m.`));
  }

  private updateStatus(): void {
    const sim = this.sim;
    if (!sim || !this.els.status) return;
    const mode = sim.getControllerMode();
    const s = sim.status;
    const key = `${s}|${mode}`;
    this.renderLog();
    if (key === this.lastStatusKey) return;
    this.lastStatusKey = key;
    const [cls, text] = s === 'INSPECTION_FROZEN' ? ['frozen', 'Frozen for inspection']
      : s === 'ERROR' ? ['error', 'Error']
      : mode === 'FALL_DAMP' ? ['damp', 'Fall · damp mode']
      : s === 'RUNNING' ? ['active', 'Policy active']
      : ['paused', 'Paused'];
    this.els.status.className = `status status--${cls}`;
    this.els.status.textContent = text;
    this.els.mode.textContent = s === 'ERROR'
      ? `The simulation stopped with an error: ${sim.error}`
      : mode === 'FALL_DAMP'
        ? 'The robot tilted past about 80°. As in the upstream viewer, the policy is switched off and every joint holds softly (kp 10, kd 3) until reset. This is a safety hold, not a learned recovery.'
        : s === 'INSPECTION_FROZEN'
          ? 'Stepping is stopped and the complete physics and controller state is held. Resume continues from exactly this state.'
          : s === 'RUNNING'
            ? 'Every 20 ms the policy reads 78 observations and sets 23 joint targets; PD control turns them into torques every 5 ms.'
            : 'Ready at the verified starting state: trained default pose, at rest, 0.614 m pelvis height.';
    const run = this.els.run as HTMLButtonElement;
    run.disabled = s === 'INSPECTION_FROZEN' || s === 'ERROR';
    run.replaceChildren(icon(s === 'RUNNING' ? 'pause' : 'play'), h('span', { class: 'btn__label' }, s === 'RUNNING' ? 'Pause' : 'Start'));
    run.setAttribute('aria-label', s === 'RUNNING' ? 'Pause' : 'Start');
    const fr = this.els.freeze as HTMLButtonElement;
    fr.setAttribute('aria-pressed', String(s === 'INSPECTION_FROZEN'));
    fr.replaceChildren(icon(s === 'INSPECTION_FROZEN' ? 'play' : 'freeze'), h('span', { class: 'btn__label' }, s === 'INSPECTION_FROZEN' ? 'Resume' : 'Freeze'));
    fr.setAttribute('aria-label', s === 'INSPECTION_FROZEN' ? 'Resume' : 'Freeze');
    (this.els.push as HTMLButtonElement).disabled = s === 'INSPECTION_FROZEN' || mode === 'FALL_DAMP' || s === 'ERROR';
    if (s !== 'INSPECTION_FROZEN') this.inspectJoint = null;
    this.renderInspection();
  }

  /** Frozen state: the controller's own numbers for every joint, and which ones are at their limit. */
  private renderInspection(): void {
    const sim = this.sim;
    const el = this.els.inspect;
    if (!sim || !el) return;
    clear(el);
    if (sim.status !== 'INSPECTION_FROZEN') { this.ctx.highlights.clear('test'); return; }
    const joints = sim.getJointState();
    const saturated = joints.filter((j) => Math.abs(j.torque) >= 0.98 * j.torqueLimit);
    const parts: number[] = [];
    for (const j of saturated) {
      const body = this.ctx.robot.rig.bodies.find((b) => b.joint?.name === j.name);
      for (const p of (body && this.ctx.robot.byBody.get(body.def.name)) || []) parts.push(p.i);
    }
    const focus = this.inspectJoint ? this.ctx.robot.rig.bodies.find((b) => b.joint?.name === this.inspectJoint) : null;
    const focusParts = focus ? (this.ctx.robot.byBody.get(focus.def.name) ?? []).map((p) => p.i) : [];
    this.ctx.highlights.set('test', [...parts, ...focusParts], 0.75);
    const sel = this.inspectJoint ? joints.find((j) => j.name === this.inspectJoint) : null;
    el.append(
      sectionTitle('Inspection', stamp('SIM VALUE')),
      h('p', { class: 'note' }, saturated.length
        ? `${saturated.length} of 23 joints are at their torque limit right now (marked blue on the robot). Click any body to read its joint.`
        : 'No joint is at its torque limit right now. Click any body to read its joint.'),
      ...(sel ? [this.jointCard(sel)] : []),
      h('div', { class: 'jtable', role: 'table', 'aria-label': 'Joint torques at this instant' },
        h('div', { class: 'jtable__head', role: 'row' }, h('span', { role: 'columnheader' }, 'Joint'), h('span', { role: 'columnheader' }, 'Angle'), h('span', { role: 'columnheader' }, 'Torque / limit')),
        ...joints.map((j) => this.jointRow(j))),
    );
  }

  private jointRow(j: JointReading): HTMLElement {
    const frac = Math.min(1, Math.abs(j.torque) / j.torqueLimit);
    const row = h('button', { type: 'button', role: 'row', class: `jrow${frac >= 0.98 ? ' jrow--sat' : ''}${j.name === this.inspectJoint ? ' jrow--sel' : ''}` },
      h('span', { role: 'cell' }, jointLabel(j.name)),
      h('span', { role: 'cell', class: 'mono' }, deg(j.q)),
      h('span', { role: 'cell', class: 'jbar', title: `${j.torque.toFixed(1)} of ${j.torqueLimit} N·m` }, h('i', { style: `width:${(frac * 100).toFixed(0)}%` }), h('b', { class: 'mono' }, `${Math.abs(j.torque).toFixed(1)}/${j.torqueLimit}`)),
    );
    row.addEventListener('click', () => { this.inspectJoint = j.name === this.inspectJoint ? null : j.name; this.renderInspection(); });
    return row;
  }

  private jointCard(j: JointReading): HTMLElement {
    return h('div', { class: 'tag' },
      h('p', { class: 'tag__pn' }, jointLabel(j.name)),
      kv([
        ['Angle', h('span', { class: 'mono' }, `${j.q.toFixed(3)} rad (${deg(j.q)})`)],
        ['Velocity', h('span', { class: 'mono' }, `${j.qd.toFixed(2)} rad/s`)],
        ['Target', h('span', { class: 'mono' }, j.target === null ? 'none yet' : `${j.target.toFixed(3)} rad (${deg(j.target)})`)],
        ['Torque', h('span', { class: 'mono' }, `${j.torque.toFixed(2)} N·m commanded`)],
        ['Limit', h('span', { class: 'mono' }, `±${j.torqueLimit} N·m (env.yaml)`)],
      ]),
    );
  }

  private renderLog(): void {
    const sim = this.sim;
    if (!sim || !this.els.log) return;
    const rows = sim.events.slice(-10).reverse().map((e) => h('li', null, h('b', null, `${e.t.toFixed(2)} s `), e.detail));
    this.els.log.replaceChildren(...rows);
  }

  private updateTelemetry(): void {
    const sim = this.sim;
    if (!sim || !sim.ctrl || !this.els.telemetry) return;
    const st = sim.getSimulationStats();
    const q = sim.qpos();
    const qv = sim.handle!.data.qvel as Float64Array;
    const tilt = Math.acos(Math.max(-1, Math.min(1, 1 - 2 * (q[4] * q[4] + q[5] * q[5])))) * 180 / Math.PI;
    const running = sim.status === 'RUNNING';
    const cells: [string, string][] = [
      [`${st.simTime.toFixed(2)} s`, 'simulated time'],
      [running ? `${Math.round(st.realtimeFactor * 100)}%` : '·', 'of real time'],
      [`${q[2].toFixed(3)} m`, 'pelvis height'],
      [`${Math.hypot(qv[0], qv[1]).toFixed(2)} m/s`, 'pelvis speed'],
      [`${tilt.toFixed(1)}°`, 'pelvis tilt'],
      [`${st.tick}`, 'policy steps'],
    ];
    this.els.telemetry.replaceChildren(...cells.map(([b, s]) => h('div', null, h('b', null, b), h('span', null, s))));
    const feet = sim.getContactState();
    this.els.feet.replaceChildren(...feet.map((f) => h('div', { class: `foot${f.points ? ' foot--on' : ''}` }, h('b', null, `${f.foot === 'left' ? 'Left' : 'Right'} foot`), h('div', { class: 'mono' }, f.points ? `${f.points} of 4 points · ${f.normalForceN.toFixed(0)} N` : 'in the air'))));
  }

  private updateArrow(sim: SimulationAdapter): void {
    const t = sim.handle?.data.time ?? 0;
    const p = sim.perturbations.find((r) => t >= r.startTime - 1e-9 && t <= r.endTime + 0.35);
    if (!p) { this.arrow.visible = false; return; }
    const n = Math.hypot(...p.dirWorld);
    const d = mjToThree([p.dirWorld[0] / n, p.dirWorld[1] / n, p.dirWorld[2] / n]);
    // Drawn through the body's current centre of mass, where the force acts.
    const ipos = sim.bodyCom(p.body);
    this.arrow.place(mjToThree(ipos ?? p.pointWorld).add(this.ctx.mjFrame.position), d, 0.1);
    this.arrow.opacity = t <= p.endTime ? 1 : 0.3;
    this.arrow.visible = true;
  }

}
