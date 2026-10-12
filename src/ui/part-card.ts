// The part tag: what a selected part is, what it is made of (and how we know), which step
// installs it, which simulation body carries it, and any known conflicts in the sources.
import { h } from './dom.ts';
import { icon, kv, stamp } from './components.ts';
import { MATERIAL_INFO } from '../robot/materials.ts';
import { bomRecords, moduleLabel, roleOf, stepOf } from '../catalog/catalog.ts';
import type { PartInfo } from '../robot/robot-model.ts';

const CAD_URL = 'https://github.com/menloresearch/asimov-1/tree/f71f3fe87ddfa6b7aac2a5cddeaad5dbbc19cca7/mechanical/ASV1';

function link(href: string, text: string): HTMLElement {
  return h('a', { class: 'ext', href, target: '_blank', rel: 'noopener' }, text, icon('link'));
}

export function partCard(p: PartInfo, actions: HTMLElement[] = []): HTMLElement {
  const recs = bomRecords(p);
  const mat = MATERIAL_INFO[p.cls];
  const step = stepOf(p);
  const conflict = recs.some((r) => r.flags.includes('conflicting-part-number'));
  const title = p.partNumber ?? p.name;
  const material = p.material
    ? h('span', null, `${p.material}`, h('br'), h('span', { class: 'mono' }, `“${(p.finish ?? '').trim()}”`), ' ', stamp('SOURCE SPEC'))
    : h('span', null, mat.label, ' ', stamp(mat.provenance));
  const bom = recs.length
    ? h('span', null, ...recs.map((r, k) => h('span', { class: 'mono' }, `${k ? '; ' : ''}${r.sheet}, row ${r.row}${r.qty !== null ? `, qty ${r.qty}` : ', qty missing'}`)))
    : h('span', { class: 'mono' }, p.kind === 'fastener' ? 'Fastener from the CAD; counted in the step, not a BOM row here' : 'No matching BOM row');
  const body = h('span', null, h('span', { class: 'mono' }, p.body), ' ', stamp('SIM VALUE'));
  const notes: HTMLElement[] = [];
  if (p.note) notes.push(h('p', { class: 'note note--warn' }, p.note));
  if (conflict) notes.push(h('p', { class: 'note note--warn' }, `The BOM uses ${p.bomPartNumber ?? p.partNumber} for different items on different sheets. Both rows are kept as written.`));
  for (const r of recs) if (r.flags.includes('missing-quantity')) notes.push(h('p', { class: 'note note--warn' }, `${r.sheet} row ${r.row} has no quantity. It is left blank, not assumed to be 1.`));
  for (const r of recs) if (r.flags.includes('cancelled')) notes.push(h('p', { class: 'note note--warn' }, `${r.sheet} row ${r.row} is marked cancelled in the workbook. It is shown for reference and not counted as part of the robot.`));
  if (p.assignment.confidence === 'nearest-link') notes.push(h('p', { class: 'note' }, 'No assembly rule covers this part; it is drawn on the nearest simulation body.'));
  return h('article', { class: 'tag', 'aria-label': `Part ${title}` },
    h('p', { class: 'tag__pn' }, title, p.instance > 1 ? h('span', { class: 'mono', style: 'color:var(--ink-3)' }, `  #${p.instance}`) : null),
    h('p', { class: 'tag__role' }, roleOf(p)),
    kv([
      ['Module', moduleLabel(p.module)],
      ['Material', material],
      ['Colour', /photos/.test(mat.basis) ? h('span', null, 'Hue matched to Menlo’s lab photos ', stamp('ILLUSTRATIVE')) : null],
      ['BOM record', bom],
      ['Installed in', step ? link(step.step.url, `${step.lesson.label}, step ${step.step.n}: ${step.step.title}`) : 'Prepared beforehand or not in a documented step'],
      ['Moves with', body],
      ['CAD', link(CAD_URL, p.cadPath)],
    ]),
    ...notes,
    actions.length ? h('div', { class: 'row', style: 'margin-top:10px' }, ...actions) : null,
  );
}
