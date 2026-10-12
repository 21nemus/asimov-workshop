// WATCH: a guided tour of about 70 seconds through the real workshop: the robot, its parts, the
// left leg assembling in Menlo's documented steps, the ankle linkage solving live, and the
// published policy walking and taking a push in live physics. Nothing is pre-recorded: every
// beat drives the same objects the other areas use, and the TEST beat replays the verified
// baseline scenario tick for tick. Its outcome caption is read from the simulation, not assumed.
import { h } from '../../ui/dom.ts';
import { supportReady } from '../../config/support.ts';
import { button } from '../../ui/components.ts';
import { lesson } from '../../catalog/catalog.ts';
import { applyBuildState, applyFlights, planFlights, planModule, stepShot, type Flight, type ModulePlan } from '../../build/build-plan.ts';
import { applyExplode, explodeVectors } from '../../robot/explode.ts';
import { benchLegPose, type AnkleMicroscope } from '../../understand/ankle-microscope.ts';
import { ForceArrow } from '../../scene/force-arrow.ts';
import { mjToThree } from '../../utils/frames.ts';
import { HOME } from '../../scene/layout.ts';
import { TRAINED_DEFAULT_POSE } from '../../robot/poses.ts';
import { HERO_SHOT } from './explore-mode.ts';
import { TEST_PUSH, TEST_SHOT, SURFACES } from './test-mode.ts';
import scenario from '../../simulation/scenarios/baseline-flat-01.json' with { type: 'json' };
import type { AppContext, Mode, ModeId } from '../context.ts';
import type { SimSnapshot, SimulationAdapter } from '../../simulation/adapter.ts';

interface Beat {
  id: string;
  title: string;
  /** Planned length in seconds (the TEST beat runs until its scenario ends). */
  duration: number;
  enter(): void | Promise<void>;
  /** Returns true when a variable-length beat is finished. */
  update(t: number, dt: number): boolean | void;
  exit(): void;
}

const smooth = (a: number, b: number, t: number) => { const x = Math.min(1, Math.max(0, (t - a) / (b - a))); return x * x * (3 - 2 * x); };
const deg = (r: number) => `${((r * 180) / Math.PI).toFixed(0)}°`;

export class WatchMode implements Mode {
  readonly id = 'watch' as const;
  private ctx: AppContext;
  private beats: Beat[];
  private index = 0;
  private t = 0;
  private paused = false;
  private active = false;
  private bar: HTMLElement | null = null;
  private endCard: HTMLElement | null = null;
  private simPromise: Promise<SimulationAdapter> | null = null;
  private arrow = new ForceArrow();
  private reduce = false;

  constructor(ctx: AppContext) {
    this.ctx = ctx;
    ctx.stage.scene.add(this.arrow.group);
    this.beats = [this.introBeat(), this.partsBeat(), this.buildBeat(), this.ankleBeat(), this.testBeat()];
  }

  enter(): void {
    this.active = true;
    this.reduce = this.ctx.reducedMotion();
    this.index = 0;
    this.t = 0;
    this.paused = false;
    const ui = this.ctx.ui;
    ui.panel.hide();
    ui.hint(null);
    ui.setChromeHidden(true);
    // Start the physics engine early so the TEST beat never waits for it.
    this.simPromise = this.ctx.sim();
    this.simPromise.catch(() => undefined);
    this.renderBar();
    void this.beats[0].enter();
  }

  exit(): void {
    if (this.active && this.index < this.beats.length) this.beats[this.index].exit();
    this.active = false;
    this.bar?.remove();
    this.bar = null;
    this.endCard?.remove();
    this.endCard = null;
    this.ctx.ui.caption(null);
    this.ctx.ui.setChromeHidden(false);
    this.ctx.pose.display();
    this.ctx.camera.follow(null);
  }

  update(dt: number): void {
    if (!this.active || this.paused || this.index >= this.beats.length) return;
    this.t += dt;
    const beat = this.beats[this.index];
    const done = beat.update(this.t, dt);
    if (done === true || (done === undefined && this.t >= beat.duration)) this.next();
    this.updateBar();
  }

  key(e: KeyboardEvent): boolean {
    if (e.key === ' ') { this.togglePause(); return true; }
    if (e.key === 'ArrowRight') { this.next(); return true; }
    return false;
  }

  // ---------- timeline ----------
  private next(): void {
    if (this.index >= this.beats.length) return;
    this.beats[this.index].exit();
    this.index++;
    this.t = 0;
    if (this.index < this.beats.length) void this.beats[this.index].enter();
    else this.finish();
    this.renderBar();
  }

  private togglePause(): void {
    if (this.index >= this.beats.length) return;
    this.paused = !this.paused;
    this.renderBar();
  }

  private finish(): void {
    this.ctx.ui.caption(null);
    this.ctx.pose.display();
    void this.ctx.camera.goTo(HERO_SHOT, this.reduce ? 0 : 1.6);
    const go = (m: ModeId, step?: string) => () => void this.ctx.go(m, step ? { step } : undefined);
    this.endCard = h('section', { class: 'endcard', 'aria-label': 'Tour finished' },
      h('p', { class: 'endcard__title' }, 'Build it. Bring it up. Test it.'),
      h('p', { class: 'endcard__text' }, 'Everything in the tour is in the workshop, ready to take apart.'),
      h('div', { class: 'row' },
        button('Explore the workshop', { icon: 'understand', kind: 'primary', onClick: go('explore') }),
        button('Start building', { icon: 'build', onClick: go('build', 'left-leg/01') }),
        button('Ankle microscope', { icon: 'ankle', onClick: go('understand', 'ankle') }),
        button('Run TEST yourself', { icon: 'test', onClick: go('test') }),
      ),
      h('div', { class: 'row', style: 'margin-top:6px' },
        button('Sources', { icon: 'sources', kind: 'quiet', onClick: () => this.ctx.ui.openSources() }),
        // Shown only when the maintainer has configured verified support links (off by default).
        supportReady() ? button('Support', { icon: 'heart', kind: 'quiet', onClick: () => this.ctx.ui.openSources() }) : null,
        button('Watch again', { icon: 'replay', kind: 'quiet', onClick: () => { this.endCard?.remove(); this.endCard = null; this.enter(); } }),
      ),
    );
    this.ctx.ui.root.append(this.endCard);
    (this.endCard.querySelector('.btn') as HTMLElement | null)?.focus();
  }

  private renderBar(): void {
    this.bar?.remove();
    if (this.index >= this.beats.length) { this.bar = null; return; }
    const total = this.beats.reduce((a, b) => a + b.duration, 0);
    this.bar = h('div', { class: 'tourbar', role: 'group', 'aria-label': 'Guided tour' },
      button(this.paused ? 'Play' : 'Pause', { icon: this.paused ? 'play' : 'pause', kind: 'quiet', onClick: () => this.togglePause(), key: 'Space' }),
      h('div', { class: 'tourbar__track' }, ...this.beats.map((b, k) => h('span', { class: `tourbar__seg${k < this.index ? ' tourbar__seg--done' : ''}`, style: `flex:${b.duration / total}`, title: b.title }, h('i')))),
      h('span', { class: 'tourbar__title' }, this.beats[this.index].title),
      button('Skip', { icon: 'skip', kind: 'quiet', onClick: () => this.next(), key: '→' }),
      button('Exit tour', { icon: 'close', kind: 'quiet', onClick: () => void this.ctx.go('explore'), key: 'Esc' }),
    );
    this.ctx.ui.root.append(this.bar);
    this.updateBar();
  }

  private updateBar(): void {
    const seg = this.bar?.querySelectorAll('.tourbar__seg i')[this.index] as HTMLElement | undefined;
    if (seg) seg.style.width = `${Math.min(100, (this.t / this.beats[this.index].duration) * 100)}%`;
  }

  private caption(text: string, small?: string): void {
    this.ctx.ui.caption(text, small);
  }

  // ---------- beats ----------
  private introBeat(): Beat {
    return {
      id: 'intro', title: 'The robot', duration: 8,
      enter: () => {
        this.ctx.pose.display();
        this.caption('This is Asimov 1, Menlo Research’s open-source humanoid.', 'Drawn from the published CAD: 1,184 parts on 23 joints');
        if (this.reduce) void this.ctx.camera.goTo(HERO_SHOT, 0);
      },
      update: (t) => {
        if (this.reduce) return;
        // A slow quarter orbit around the robot.
        const a = 0.55 + (t / 8) * 0.55, r = 2.55;
        this.ctx.camera.camera.position.set(HOME.x + r * Math.cos(a), 1.2 + 0.1 * Math.sin(t * 0.4), r * Math.sin(a));
        this.ctx.camera.controls.target.set(HOME.x, 0.7, 0);
      },
      exit: () => undefined,
    };
  }

  private partsBeat(): Beat {
    let dirs: Float32Array | null = null;
    return {
      id: 'parts', title: 'Real parts', duration: 9,
      enter: () => {
        void this.ctx.camera.goTo({ position: [HOME.x + 1.9, 1.25, 1.65], target: [HOME.x, 0.68, 0] }, this.reduce ? 0 : 1.2);
        dirs = explodeVectors(this.ctx.robot);
        this.caption('Every part on screen is a part of the published design.', 'In the workshop, click any part to read its tag: BOM row, material, assembly step');
      },
      update: (t) => {
        const e = this.reduce ? (t > 1 && t < 7 ? 0.75 : 0) : 0.8 * (smooth(1.2, 3.6, t) - smooth(6, 8.4, t));
        applyExplode(this.ctx.robot, dirs!, e);
      },
      exit: () => { if (dirs) applyExplode(this.ctx.robot, dirs, 0); },
    };
  }

  private buildBeat(): Beat {
    let plan: ModulePlan | null = null;
    let moduleOf: Map<number, string> | null = null;
    let step = -1;
    let flights: Flight[] = [];
    let stepT = 0;
    // Step start times: 0.8 s per step, with step 9 held to show its documented cable.
    const CABLE_STEP = 8; // index of docs step 9
    const starts: number[] = [];
    for (let k = 0, t = 0.8; k < 14; k++) { starts.push(t); t += k === CABLE_STEP ? 3.2 : 0.8; }
    return {
      id: 'build', title: 'BUILD', duration: 16,
      enter: () => {
        plan ??= planModule(this.ctx.robot, lesson('left-leg'));
        moduleOf = new Map([...plan.members].map((i) => [i, 'left-leg']));
        this.ctx.robot.setGhostPass(true);
        step = -1;
        const shot = stepShot(this.ctx.robot, plan, plan.steps.length - 1, this.ctx.stage.camera.fov);
        if (shot) void this.ctx.camera.goTo(shot, this.reduce ? 0 : 1.3);
        applyBuildState(this.ctx.robot, plan, 0, new Set(), moduleOf);
        // Before step 1 nothing of the leg is installed yet.
        for (const i of plan.members) this.ctx.robot.state.setVisible(i, false);
      },
      update: (t, dt) => {
        const p = plan!;
        let k = -1;
        for (let i = 0; i < starts.length; i++) if (t >= starts[i]) k = i;
        if (k >= 0 && k !== step) {
          step = k;
          applyBuildState(this.ctx.robot, p, k, new Set(), moduleOf!);
          flights = this.reduce ? [] : planFlights(this.ctx.robot, p, p.steps[k], 2.2);
          stepT = 0;
          applyFlights(this.ctx.robot, flights, 0);
          this.ctx.highlights.clear('watch');
        }
        if (k < 0) this.caption('BUILD: the left leg goes together in Menlo’s 14 documented steps.', 'From the assembly guide at docs.menlo.ai');
        else if (k === CABLE_STEP) {
          // One documented electrical relationship: docs step 9 joins the two ankle actuators.
          const actuators = p.steps[k].parts.filter((q) => q.kind === 'actuator').map((q) => q.i);
          this.ctx.highlights.set('watch', actuators, 0.85);
          this.caption('Step 9: one 100 mm XT30 (2+2) cable joins ankle actuators A and B.', 'Actuator IDs 5 and 6 · docs.menlo.ai, left leg, step 9');
        } else {
          const s = p.steps[k].step;
          this.caption('BUILD: the left leg goes together in Menlo’s 14 documented steps.', `Step ${s.n} of ${p.steps.length}: ${s.title}`);
        }
        stepT += dt;
        if (flights.length) applyFlights(this.ctx.robot, flights, stepT);
      },
      exit: () => {
        const st = this.ctx.robot.state;
        for (let i = 0; i < st.count; i++) { st.setVisible(i, true); st.setGhost(i, false); st.setDim(i, 0); st.setOffset(i, 0, 0, 0); }
        this.ctx.robot.setGhostPass(false);
        this.ctx.highlights.clear('watch');
        // Restore the shell: the finished robot, as the workshop shows it.
        this.caption('Assembly view complete.', 'The whole robot again, as built from the CAD');
      },
    };
  }

  private ankleBeat(): Beat {
    let micro: AnkleMicroscope | null = null;
    return {
      id: 'ankle', title: 'The ankle', duration: 15,
      enter: () => {
        const bench = this.ctx.bench;
        this.ctx.pose.display({ ...TRAINED_DEFAULT_POSE, ...benchLegPose('left') });
        micro = this.ctx.microscope('left');
        micro.attach();
        micro.isolate();
        micro.update();
        const d = this.reduce ? 0 : 1.8;
        bench.present('left', d);
        bench.apply(1);
        const shot = micro.shot(bench.yaw);
        bench.apply(0);
        if (d === 0) bench.apply(1);
        void this.ctx.camera.goTo(shot, d);
      },
      update: (t) => {
        const m = micro!;
        const w = (2 * Math.PI) / 4.5;
        const pitch = this.reduce ? 0.25 : 0.3 * Math.sin(Math.max(0, t - 2) * w);
        const roll = this.reduce ? 0.07 : 0.085 * Math.sin(Math.max(0, t - 2) * w * 0.5);
        this.ctx.pose.setJoint('left_ankle_pitch_joint', pitch);
        this.ctx.pose.setJoint('left_ankle_roll_joint', roll);
        const r = m.update();
        const d = m.model.leg.derived;
        if (t < 5) this.caption('The ankle has no pitch motor and no roll motor.', 'The lower leg on the mechanism bench: two actuators in the calf, two push rods, one foot');
        else if (t < 10) this.caption('Both actuators turn for almost any foot motion.', `Actuator A ${deg(r.actuators.A)} · Actuator B ${deg(r.actuators.B)} · foot pitch ${deg(r.ankle.pitch)}, roll ${deg(r.ankle.roll)} · solved live from the CAD geometry`);
        else this.caption(`Measured on the CAD, the levers explain Menlo’s ${(d.jacobianAB_per_PR[0][0] * 72).toFixed(1)} N·m ankle peak.`, `Pitch lever ${d.jacobianAB_per_PR[0][0].toFixed(2)} × two 36 N·m actuators · rigid-link approximation`);
      },
      exit: () => {
        const m = micro;
        this.ctx.bench.retire(0, () => {
          m?.detach();
          const st = this.ctx.robot.state;
          for (let i = 0; i < st.count; i++) { st.setVisible(i, true); st.setDim(i, 0); }
          this.ctx.pose.display();
        });
      },
    };
  }

  private testBeat(): Beat {
    let sim: SimulationAdapter | null = null;
    let snapshot: SimSnapshot | null = null;
    let friction = 0.6;
    let owed = 0;
    let busy = false;
    let finishedAt = -1;
    let failed = false;
    let wall = 0;
    let simStart = 0;
    const endTick = scenario.ticks;
    const walk = scenario.commands.find((c) => c.vx > 0)!;
    const push = scenario.pushes[0];
    const beat: Beat = {
      id: 'test', title: 'TEST', duration: 14,
      enter: async () => {
        finishedAt = -1;
        failed = false;
        owed = 0;
        wall = 0;
        this.caption('Assembly view complete. Initializing physics model.', 'MuJoCo 3.3.8 in WebAssembly · Menlo’s model_aug_18_1 walking policy');
        void this.ctx.camera.goTo(TEST_SHOT, this.reduce ? 0 : 1.4);
        try {
          sim = await (this.simPromise ?? this.ctx.sim());
        } catch {
          failed = true;
          this.caption('Live simulation is not available on this device.', 'The physics engine could not start; the rest of the workshop still works');
          return;
        }
        if (!this.active || this.beats[this.index] !== beat) return;
        // Keep whatever the visitor had in TEST and restore it afterwards.
        snapshot = sim.status === 'READY' ? null : sim.captureState();
        simStart = sim.handle?.data.time ?? 0;
        friction = sim.footFriction;
        sim.setFootFriction(SURFACES.baseline);
        sim.reset({ vx: 0, vy: 0, wz: 0 });
        this.ctx.pose.followSim(() => sim?.qpos() ?? null);
        this.ctx.camera.follow(() => { const q = sim!.qpos(); return mjToThree([q[0], q[1], q[2]]).add(this.ctx.mjFrame.position); });
      },
      update: (t, dt) => {
        if (failed) return t > 5;
        // The state change gets two seconds on screen before physics starts.
        if (!sim?.ctrl || sim.status === 'LOADING' || t < 2) return false;
        const tick = sim.ctrl.s.tick;
        if (tick >= endTick) {
          if (finishedAt < 0) finishedAt = t;
          return t - finishedAt > 2.5;
        }
        owed += Math.min(dt, 0.1);
        wall += dt;
        if (!busy) {
          busy = true;
          void (async () => {
            const start = performance.now();
            // The scenario's own schedule, applied before the tick it names (as in the tests).
            while (owed >= 0.02 && sim!.ctrl!.s.tick < endTick) {
              const k = sim!.ctrl!.s.tick;
              if (k === walk.tick) sim!.setVelocityCommand({ vx: walk.vx, vy: walk.vy, wz: walk.wz });
              if (k === push.tick) sim!.applyExternalForce({ body: push.body, dirWorld: push.dir as [number, number, number], forceN: push.force, durationS: push.duration, label: TEST_PUSH.label });
              await sim!.stepTicks(1);
              owed -= 0.02;
              // A slow device runs the scenario slower rather than skipping physics.
              if (performance.now() - start > 12) { owed = Math.min(owed, 0.02); break; }
            }
          })().finally(() => { busy = false; });
        }
        this.updateArrow(sim);
        const mode = sim.getControllerMode();
        const fell = mode === 'FALL_DAMP';
        const simT = (sim.handle?.data.time ?? 0) - simStart;
        const rate = wall > 1 ? simT / wall : 1;
        // Controller state and pace, always on screen; slow motion is labelled as such.
        const state = `Controller: ${fell ? 'FALL · DAMP HOLD' : 'POLICY ACTIVE'} · t ${simT.toFixed(1)} s${rate < 0.9 ? ` · slow motion: ${Math.round(rate * 100)}% of real time on this device` : ''}`;
        if (tick < walk.tick) this.caption('TEST: Menlo’s published walking policy, live in this browser.', `${state} · standing at the verified start`);
        else if (tick < push.tick) this.caption('Command: walk forward at 0.5 m/s.', `${state} · 78 observations in, 23 joint targets out, every 20 ms`);
        else if (tick < push.tick + 40) this.caption('A defined push: 150 N for 0.15 s, through the pelvis.', `${state} · logged with time, point and direction`);
        else this.caption(fell ? 'It fell, and the controller switched to its safety hold.' : 'It recovered and kept walking.', fell ? `${state} · a fall is a real result` : `${state} · same scenario as the baseline checked against Menlo’s viewer`);
        return false;
      },
      exit: () => {
        this.arrow.visible = false;
        this.ctx.camera.follow(null);
        if (sim?.ctrl) {
          sim.setFootFriction(friction);
          if (snapshot) sim.restoreState(snapshot);
          else sim.reset({ vx: 0, vy: 0, wz: 0 });
        }
        this.ctx.pose.display();
      },
    };
    return beat;
  }

  private updateArrow(sim: SimulationAdapter): void {
    const t = sim.handle?.data.time ?? 0;
    const p = sim.perturbations.find((r) => t >= r.startTime - 1e-9 && t <= r.endTime + 0.35);
    if (!p) { this.arrow.visible = false; return; }
    const d = mjToThree(p.dirWorld);
    const com = sim.bodyCom(p.body) ?? p.pointWorld;
    this.arrow.place(mjToThree(com).add(this.ctx.mjFrame.position), d.normalize(), 0.1);
    this.arrow.opacity = t <= p.endTime ? 1 : 0.3;
    this.arrow.visible = true;
  }
}
