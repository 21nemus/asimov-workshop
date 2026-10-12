// EXPLORE: the workshop's home view. The robot stands at its spot on the mat, every part can be
// picked and read, and the three areas plus the guided tour start from here.
import { h, clear } from '../../ui/dom.ts';
import { button, icon, stamp } from '../../ui/components.ts';
import { partCard } from '../../ui/part-card.ts';
import { moduleLabel, roleOf, stepOf } from '../../catalog/catalog.ts';
import type { AppContext, Mode, ModeId } from '../context.ts';
import type { PartHit } from '../../robot/robot-model.ts';
import { HOME } from '../../scene/layout.ts';
import type { IconName } from '../../ui/icons.ts';

export const HERO_SHOT = { position: [HOME.x + 2.35, 1.3, 1.7] as [number, number, number], target: [HOME.x, 0.64, 0] as [number, number, number] };

const AREAS: { id: ModeId; title: string; icon: IconName; text: string }[] = [
  { id: 'build', title: 'BUILD', icon: 'build', text: 'Assemble the left leg in place, step by step, from Menlo’s documented assembly guide.' },
  { id: 'understand', title: 'UNDERSTAND', icon: 'understand', text: 'Section, explode and isolate the robot. Follow the parallel ankle linkage under the microscope.' },
  { id: 'test', title: 'TEST', icon: 'test', text: 'Run Menlo’s published walking policy in live physics, push it, and freeze any moment.' },
  { id: 'watch', title: 'WATCH', icon: 'watch', text: 'A guided tour of all three, about a minute.' },
];

export class ExploreMode implements Mode {
  readonly id = 'explore' as const;
  private ctx: AppContext;

  constructor(ctx: AppContext) {
    this.ctx = ctx;
  }

  enter(from: ModeId | null): void {
    this.ctx.pose.display(undefined, from && !this.ctx.reducedMotion() ? 0.8 : 0);
    void this.ctx.camera.goTo(HERO_SHOT, from ? 1.3 : 0);
    this.ctx.ui.hint('Drag to orbit · Scroll to zoom · Click a part to read its tag');
    const sel = this.ctx.selection.value;
    if (sel) this.showPart(sel);
    else this.showHome();
  }

  exit(): void {
    this.ctx.selection.set(null);
  }

  pick(hit: PartHit | null): void {
    this.ctx.selection.set(hit?.part ?? null);
    if (hit) this.showPart(hit.part);
    else this.showHome();
  }

  key(e: KeyboardEvent): boolean {
    if (e.key === 'Escape' && this.ctx.selection.value) {
      this.ctx.selection.set(null);
      this.showHome();
      return true;
    }
    return false;
  }

  private showHome(): void {
    const { panel } = this.ctx.ui;
    panel.show('Asimov 1', 'Workshop');
    clear(panel.body);
    panel.body.append(
      h('p', { class: 'lede lede--big' }, 'Build it. Bring it up. Test it.'),
      h('p', { class: 'lede' }, 'This is Menlo Research’s open-source humanoid, drawn from its published CAD: ',
        h('b', null, `${this.ctx.robot.parts.length.toLocaleString('en')} parts`), ' hung on the simulation model’s 23 joints. Click any part to read its tag.'),
      h('div', { class: 'areas' }, ...AREAS.map((a) => {
        const b = h('button', { type: 'button', class: 'area', 'aria-label': `${a.title}: ${a.text}` }, icon(a.icon), h('span', null, h('span', { class: 'area__title' }, a.title), h('span', { class: 'area__text' }, a.text)), icon('next', 'icon area__go'));
        b.addEventListener('click', () => void this.ctx.go(a.id));
        return b;
      })),
      this.finder(),
      h('p', { class: 'note' }, 'Labels on every value say where it comes from: ', stamp('SOURCE SPEC'), ' ', stamp('SIM VALUE'), ' ', stamp('CAD DERIVED'), ' ', stamp('ILLUSTRATIVE'), '. ',
        h('button', { type: 'button', class: 'linklike', on: { click: () => this.ctx.ui.openSources() } }, 'Open the source register'), '.'),
      h('p', { class: 'fine' }, 'An independent educational project. Not affiliated with or endorsed by Menlo Research.'),
    );
  }

  /** Keyboard-friendly way to reach any part: search by part number, name or role. */
  private finder(): HTMLElement {
    const robot = this.ctx.robot;
    const list = h('ul', { 'aria-label': 'Matching parts' });
    const input = h('input', { type: 'search', placeholder: 'Find a part: 600_17B, crank, actuator…', 'aria-label': 'Find a part by number, name or role' }) as HTMLInputElement;
    const render = () => {
      const q = input.value.trim().toLowerCase();
      list.replaceChildren();
      if (q.length < 2) return;
      const seen = new Set<string>();
      const hits = robot.parts.filter((p) => {
        const key = `${p.partNumber ?? p.name}|${p.module}`;
        const hay = `${p.partNumber ?? ''} ${p.name} ${roleOf(p)} ${p.description ?? ''}`.toLowerCase();
        if (!hay.includes(q) || seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, 12);
      for (const p of hits) {
        const b = h('button', { type: 'button' }, h('span', { class: 'mono' }, (p.partNumber ?? p.name).replace(/^ASV1_/, '')), h('span', null, moduleLabel(p.module)), h('small', null, roleOf(p)));
        b.addEventListener('click', () => { this.ctx.selection.set(p); this.showPart(p); });
        list.append(h('li', null, b));
      }
      if (!hits.length) list.append(h('li', { class: 'fine' }, 'No part matches.'));
    };
    input.addEventListener('input', render);
    return h('div', { class: 'finder' }, input, list);
  }

  private showPart(p: NonNullable<AppContext['selection']['value']>): void {
    const { panel } = this.ctx.ui;
    panel.show('Part tag', 'Workshop');
    clear(panel.body);
    const actions: HTMLElement[] = [];
    const step = stepOf(p);
    if (step && step.lesson.id === 'left-leg') actions.push(button(`Build step ${step.step.n}`, { icon: 'build', kind: 'primary', onClick: () => void this.ctx.go('build', { step: step.step.id }) }));
    actions.push(button('Back', { icon: 'prev', kind: 'quiet', onClick: () => { this.ctx.selection.set(null); this.showHome(); } }));
    panel.body.append(partCard(p, actions));
  }
}
