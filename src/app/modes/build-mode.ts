// BUILD: assemble a module in place on the robot, step by step, following Menlo's documented
// assembly guide. Installed parts are solid, the step's parts move into place, parts still to
// come show as a faint outline, and the rest of the robot recedes. BUILD only poses a display
// copy of the robot; it never touches the TEST simulation.
import { h, clear } from '../../ui/dom.ts';
import { button, icon, sectionTitle, stamp } from '../../ui/components.ts';
import { partCard } from '../../ui/part-card.ts';
import { LESSONS, roleOf } from '../../catalog/catalog.ts';
import { MODULE_NAMES as SHORT, applyBuildState, applyFlights, planFlights, planModule, stepShot, type Flight, type ModulePlan, type StepPlan } from '../../build/build-plan.ts';
import type { AppContext, Mode, ModeId, ModeParams } from '../context.ts';
import type { PartHit, PartInfo } from '../../robot/robot-model.ts';

const STORAGE_KEY = 'asimov-workshop.build.v1';

export class BuildMode implements Mode {
  readonly id = 'build' as const;
  private ctx: AppContext;
  private plans = new Map<string, ModulePlan>();
  private module = 'left-leg';
  /** Index of the current step (its parts are being placed or have just been placed). */
  private index = 0;
  private completed: Record<string, number> = {};
  private flights: Flight[] = [];
  private flightT = 0;
  private flash = 0;
  private auto: { next: number } | null = null;
  private active = false;

  constructor(ctx: AppContext) {
    this.ctx = ctx;
    for (const lesson of LESSONS) this.plans.set(lesson.id, planModule(ctx.robot, lesson));
    this.load();
  }

  // ---------- planning ----------
  private get plan(): ModulePlan {
    return this.plans.get(this.module)!;
  }

  /** Modules joined into the current module up to and including step k (transitively). */
  private joinedModules(module: string, k: number, seen = new Set<string>()): Set<string> {
    const plan = this.plans.get(module);
    if (!plan) return seen;
    for (const [idx, mods] of plan.joins) {
      if (idx > k) continue;
      for (const m of mods) {
        if (seen.has(m)) continue;
        seen.add(m);
        this.joinedModules(m, Infinity, seen);
      }
    }
    return seen;
  }

  // ---------- persistence (per-viewer convenience only) ----------
  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw) as { module?: string; index?: number; completed?: Record<string, number> };
      if (s.module && this.plans.has(s.module)) this.module = s.module;
      if (typeof s.index === 'number') this.index = Math.max(0, Math.min(s.index, this.plan.steps.length - 1));
      if (s.completed) this.completed = s.completed;
    } catch { /* storage unavailable: start fresh */ }
  }

  private save(): void {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ module: this.module, index: this.index, completed: this.completed })); } catch { /* ignore */ }
  }

  // ---------- mode lifecycle ----------
  enter(from: ModeId | null, params?: ModeParams): void {
    this.active = true;
    const wanted = params?.step;
    if (wanted) {
      const [mod] = wanted.split('/');
      if (this.plans.has(mod)) {
        this.module = mod;
        const k = this.plan.steps.findIndex((s) => s.step.id === wanted);
        this.index = k >= 0 ? k : 0;
      }
    }
    // The trained standing pose, as in the rest of the workshop: parts ride on the joints, so
    // the pose does not change where anything is installed.
    this.ctx.pose.display();
    this.ctx.robot.setGhostPass(true);
    this.ctx.ui.hint('← → steps · R replay · Click a part to read its tag');
    this.goToStep(this.index, { animate: true, camera: from ? 1.3 : 0 });
  }

  exit(): void {
    this.active = false;
    this.auto = null;
    this.flights = [];
    const st = this.ctx.robot.state;
    for (let i = 0; i < st.count; i++) { st.setVisible(i, true); st.setGhost(i, false); st.setDim(i, 0); st.setOffset(i, 0, 0, 0); }
    this.ctx.robot.setGhostPass(false);
    this.ctx.highlights.clear('build');
    this.ctx.highlights.clear('build-hover');
  }

  update(dt: number): void {
    if (!this.active) return;
    if (this.flights.length) {
      this.flightT += dt;
      if (applyFlights(this.ctx.robot, this.flights, this.flightT)) { this.flights = []; this.flash = 1; }
    }
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 1.4);
      const sp = this.plan.steps[this.index];
      this.ctx.highlights.set('build', [...sp.parts, ...sp.fasteners].map((p) => p.i), 0.15 + 0.55 * this.flash);
      if (this.flash === 0) this.ctx.highlights.set('build', [...sp.parts, ...sp.fasteners].map((p) => p.i), 0.15);
    }
    if (this.auto && !this.flights.length) {
      this.auto.next -= dt;
      if (this.auto.next <= 0) {
        if (this.index >= this.plan.steps.length - 1) this.auto = null;
        else { this.next(); if (this.auto) this.auto.next = 2.2; }
      }
    }
  }

  key(e: KeyboardEvent): boolean {
    if (e.key === 'ArrowRight' || e.key === 'n' || e.key === 'N') { this.stopAuto(); this.next(); return true; }
    if (e.key === 'ArrowLeft') { this.stopAuto(); this.prev(); return true; }
    if (e.key === 'r' || e.key === 'R') { this.stopAuto(); this.goToStep(this.index, { animate: true }); return true; }
    if (e.key === 'Escape' && this.auto) { this.stopAuto(); return true; }
    return false;
  }

  pick(hit: PartHit | null): void {
    if (!hit) return;
    this.ctx.ui.drawer.openWith('Part tag', partCard(hit.part));
  }

  hoverable(p: PartInfo): boolean {
    return this.ctx.robot.state.isVisible(p.i);
  }

  // ---------- navigation ----------
  private next(): void {
    if (this.index < this.plan.steps.length - 1) this.goToStep(this.index + 1, { animate: true });
  }

  private prev(): void {
    if (this.index > 0) this.goToStep(this.index - 1, { animate: false });
  }

  private stopAuto(): void {
    if (!this.auto) return;
    this.auto = null;
    this.renderPanel();
  }

  private setModule(id: string): void {
    if (id === this.module) return;
    this.stopAuto();
    this.module = id;
    this.index = Math.min(this.completed[id] ?? 0, this.plan.steps.length - 1);
    this.goToStep(this.index, { animate: true });
  }

  /** Shows the robot as it stands after step `k`, with step k's parts flying in. */
  private goToStep(k: number, opts: { animate: boolean; camera?: number }): void {
    const plan = this.plan;
    this.index = Math.max(0, Math.min(k, plan.steps.length - 1));
    this.completed[this.module] = Math.max(this.completed[this.module] ?? 0, this.index);
    this.save();
    const robot = this.ctx.robot;
    const st = robot.state;
    const solidModules = new Set<string>([...this.joinedModules(this.module, this.index)]);
    for (const [id, p] of this.plans) if (id !== this.module && (this.completed[id] ?? 0) >= p.steps.length - 1) solidModules.add(id);
    const moduleOf = new Map<number, string>();
    for (const [id, p] of this.plans) for (const i of p.members) moduleOf.set(i, id);
    applyBuildState(robot, plan, this.index, solidModules, moduleOf);
    const sp = plan.steps[this.index];
    if (this.active) history.replaceState(null, '', `#build/${encodeURIComponent(sp.step.id)}`);
    const moving = [...sp.parts, ...sp.fasteners];
    this.ctx.highlights.set('build', moving.map((p) => p.i), 0.15);
    this.flights = opts.animate && !this.ctx.reducedMotion() ? planFlights(robot, plan, sp) : [];
    this.flightT = 0;
    this.flash = this.flights.length ? 0 : moving.length ? 1 : 0;
    for (const f of this.flights) st.setOffset(f.i, f.from.x, f.from.y, f.from.z);
    const shot = stepShot(robot, plan, this.index, this.ctx.stage.camera.fov);
    if (shot) void this.ctx.camera.goTo(shot, opts.camera ?? 1.0);
    this.renderPanel();
  }

  // ---------- panel ----------
  private renderPanel(): void {
    const { panel } = this.ctx.ui;
    const plan = this.plan;
    const sp = plan.steps[this.index];
    const s = sp.step;
    const total = plan.steps.length;
    panel.show(SHORT[this.module] ?? plan.lesson.label, 'Build');
    clear(panel.body);
    const modules = h('div', { class: 'chips', role: 'group', 'aria-label': 'Module' }, ...[...this.plans.keys()].map((id) => {
      const done = (this.completed[id] ?? 0) >= this.plans.get(id)!.steps.length - 1;
      const b = h('button', { type: 'button', class: 'chip', 'aria-pressed': String(id === this.module) }, SHORT[id] ?? id, done ? icon('check') : null);
      b.addEventListener('click', () => this.setModule(id));
      return b;
    }));
    const progress = h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '1', 'aria-valuemax': String(total), 'aria-valuenow': String(this.index + 1), 'aria-label': 'Build progress' }, h('span', { style: `width:${((this.index + 1) / total) * 100}%` }));
    const nav = h('div', { class: 'row' },
      button('Back', { icon: 'prev', disabled: this.index === 0, onClick: () => { this.stopAuto(); this.prev(); } }),
      button(this.index === total - 1 ? 'Done' : 'Next step', { icon: 'next', kind: 'primary', disabled: this.index === total - 1, onClick: () => { this.stopAuto(); this.next(); } }),
      button('Replay', { icon: 'replay', kind: 'quiet', onClick: () => { this.stopAuto(); this.goToStep(this.index, { animate: true }); } }),
    );
    const autoBtn = this.auto
      ? button('Stop', { icon: 'stop', kind: 'quiet', onClick: () => this.stopAuto() })
      : button('Assemble the rest', { icon: 'play', kind: 'quiet', disabled: this.index === total - 1, onClick: () => { this.auto = { next: 0.6 }; this.renderPanel(); } });
    const restart = button('Start over', { icon: 'reset', kind: 'quiet', disabled: this.index === 0, onClick: () => { this.stopAuto(); this.completed[this.module] = 0; this.goToStep(0, { animate: true }); } });

    panel.body.append(
      modules,
      h('div', { class: 'stephead' },
        h('p', { class: 'stephead__meta mono' }, `${s.group} · Step ${s.n} of ${total}`),
        h('h3', { class: 'stephead__title' }, s.title),
        h('a', { class: 'ext', href: s.url, target: '_blank', rel: 'noopener' }, `Step ${s.n} in Menlo’s assembly guide`, icon('link')),
      ),
      progress, nav, h('div', { class: 'row' }, autoBtn, restart),
      ...this.stepContents(sp),
      sectionTitle('All steps'),
      this.stepList(),
      h('p', { class: 'fine' }, 'Parts, quantities and order follow docs.menlo.ai (retrieved 2026-10-21); the shapes and positions come from the CAD at f71f3fe. Where the two disagree, both are stated.'),
    );
  }

  private stepContents(sp: StepPlan): HTMLElement[] {
    const out: HTMLElement[] = [];
    const s = sp.step;
    const last = this.index === this.plan.steps.length - 1;
    if (last) {
      const parts = [...this.plan.members].map((i) => this.ctx.robot.parts[i]);
      const fasteners = parts.filter((p) => p.kind === 'fastener').length;
      out.push(h('p', { class: 'lede' }, `${SHORT[this.module] ?? this.plan.lesson.label} complete: ${parts.length - fasteners} parts and ${fasteners} fasteners in the CAD.`));
      if (this.plan.unplaced.length) out.push(h('p', { class: 'note note--warn' }, `${this.plan.unplaced.length} CAD part${this.plan.unplaced.length > 1 ? 's are' : ' is'} not placed by any documented step here (${[...new Set(this.plan.unplaced.map((p) => p.partNumber ?? p.name))].join(', ')}). ${this.plan.unplaced.length > 1 ? 'They appear' : 'It appears'} now, with the finished module.`));
      if (this.module === 'left-leg' || this.module === 'right-leg') {
        out.push(h('div', { class: 'row' },
          button('See the ankle linkage', { icon: 'ankle', kind: 'primary', onClick: () => void this.ctx.go('understand', { step: 'ankle' }) }),
          button('Walk it in TEST', { icon: 'test', onClick: () => void this.ctx.go('test') }),
        ));
      }
    }
    if (sp.parts.length) {
      const groups = new Map<string, PartInfo[]>();
      for (const p of sp.parts) {
        const key = p.kind === 'fastener' || /Insert/i.test(p.name) ? `${p.name}` : (p.partNumber ?? p.name);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(p);
      }
      out.push(sectionTitle('Parts', stamp('SOURCE SPEC')), h('ul', { class: 'partlist' }, ...[...groups].map(([key, list]) => this.partRow(key, list))));
    }
    if (s.fastenerGroups.length) {
      out.push(sectionTitle('Fasteners', 'docs count · CAD'), h('ul', { class: 'partlist' }, ...s.fastenerGroups.map((g) => {
        const list = g.cad.map((i) => this.ctx.robot.parts[i]);
        const status = g.status === 'matched' ? `${g.cad.length} in CAD`
          : g.status === 'not-in-cad' ? 'not modelled in the CAD'
          : g.status === 'length-differs' ? `CAD models ${list[0]?.name.match(/M\d+\s*x\s*\d+/i)?.[0]?.replace(/\s/g, '') ?? 'a different length'}`
          : `${g.cad.length} in CAD`;
        const li = h('li', { class: g.status === 'matched' ? '' : 'partlist__warn' }, h('span', { class: 'qty' }, g.docsCount !== null ? `${g.docsCount}×` : '?'), h('span', null, g.name, g.countNote ? h('small', null, ` (${g.countNote})`) : null), h('span', { class: 'mono partlist__aside' }, status));
        this.hoverRow(li, list);
        return li;
      })));
    }
    const extras: [string, { name: string; count: number | null; countNote: string | null }[]][] = [['Cables', s.cables], ['Consumables', s.consumables]];
    for (const [title, list] of extras) {
      if (!list.length) continue;
      out.push(sectionTitle(title), h('ul', { class: 'partlist' }, ...list.map((c) => h('li', null, h('span', { class: 'qty' }, c.count !== null ? `${c.count}×` : ''), h('span', null, c.name), h('span', { class: 'mono partlist__aside' }, c.countNote ?? '')))));
    }
    if (s.carried.length) out.push(h('p', { class: 'note' }, 'Brings in: ', s.carried.map((c) => c.text).join('; '), '.'));
    for (const n of s.notes) out.push(h('p', { class: 'note note--warn' }, n));
    return out;
  }

  private partRow(key: string, list: PartInfo[]): HTMLElement {
    const p = list[0];
    const li = h('li', null,
      h('span', { class: 'qty' }, `${list.length}×`),
      h('button', { type: 'button', class: 'linklike partlist__name' }, h('span', { class: 'mono' }, key.replace(/^ASV1_/, '')), h('small', null, roleOf(p))),
      h('span', null),
    );
    li.querySelector('button')!.addEventListener('click', () => this.ctx.ui.drawer.openWith('Part tag', partCard(p)));
    this.hoverRow(li, list);
    return li;
  }

  private hoverRow(el: HTMLElement, list: PartInfo[]): void {
    const on = () => this.ctx.highlights.set('build-hover', list.map((p) => p.i), 0.9);
    const off = () => this.ctx.highlights.clear('build-hover');
    el.addEventListener('pointerenter', on);
    el.addEventListener('pointerleave', off);
    el.addEventListener('focusin', on);
    el.addEventListener('focusout', off);
  }

  private stepList(): HTMLElement {
    const list = h('ol', { class: 'steps' });
    let group = '';
    this.plan.steps.forEach((sp, k) => {
      const showGroup = sp.step.group !== group;
      group = sp.step.group;
      const b = h('button', { type: 'button', class: `step${k < this.index ? ' step--done' : ''}${k === this.index ? ' step--current' : ''}`, 'aria-current': k === this.index ? 'step' : undefined },
        h('span', { class: 'step__n' }, String(sp.step.n)),
        h('span', { class: 'step__title' }, showGroup ? h('span', { class: 'step__group' }, sp.step.group) : null, sp.step.title),
      );
      b.addEventListener('click', () => { this.stopAuto(); this.goToStep(k, { animate: k > this.index }); });
      list.append(h('li', null, b));
    });
    return list;
  }
}
