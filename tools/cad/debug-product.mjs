// Debug: shows how one product's geometry is wired in the assembly STEP.
// Usage: node tools/cad/debug-product.mjs <Asimov_1.STEP> <product name>
import { readAssembly } from './assembly.mjs';

const [stepPath, wanted] = process.argv.slice(2);
const asm = readAssembly(stepPath, console.log);
const { index } = asm;
const def = [...asm.pds.values()].find((d) => asm.products.get(d.product).name === wanted);
if (!def) throw new Error('not found');
console.log('PD', def.pd, index.text(def.pd));
for (const sr of def.shapeReps) {
  console.log('shapeRep', index.text(sr).slice(0, 300));
  for (const linked of asm.repLinks.get(sr) ?? []) console.log('  linked rep', index.typeOf(linked), index.text(linked).slice(0, 300));
}
// Who references the shape rep or its linked reps (reverse lookup by scanning a few types).
const targets = new Set([...def.shapeReps, ...def.shapeReps.flatMap((s) => asm.repLinks.get(s) ?? [])]);
const typesSeen = new Map();
for (let id = 1; id <= index.maxId; id++) {
  if (!index.end[id]) continue;
  const t = index.typeOf(id);
  if (!['SHAPE_REPRESENTATION_RELATIONSHIP', 'SHAPE_DEFINITION_REPRESENTATION', '(COMPLEX)', 'MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION', 'STYLED_ITEM'].includes(t)) continue;
  const refs = index.refs(id);
  if (refs.some((r) => targets.has(r))) {
    typesSeen.set(t, (typesSeen.get(t) ?? 0) + 1);
    if ((typesSeen.get(t) ?? 0) <= 3) console.log('  referenced by', t, index.text(id).slice(0, 240));
  }
}
// Closure type histogram from the linked B-rep reps.
const visited = new Set();
const stack = [...targets];
while (stack.length) {
  const id = stack.pop();
  if (visited.has(id)) continue;
  visited.add(id);
  for (const r of index.refs(id)) if (!visited.has(r)) stack.push(r);
}
const hist = new Map();
for (const id of visited) hist.set(index.typeOf(id), (hist.get(index.typeOf(id)) ?? 0) + 1);
console.log('closure size', visited.size, [...hist].sort((a, b) => b[1] - a[1]).slice(0, 25));
// Styled items targeting closure items.
let styled = 0;
const styleTypes = new Map();
for (const t of ['STYLED_ITEM', 'OVER_RIDING_STYLED_ITEM']) {
  for (const id of index.idsOfType(t)) {
    const refs = index.refs(id);
    const item = refs[refs.length - 1];
    if (visited.has(item)) { styled++; styleTypes.set(index.typeOf(item), (styleTypes.get(index.typeOf(item)) ?? 0) + 1); if (styled <= 2) console.log('styled', index.text(id)); }
  }
}
console.log('styled items on closure:', styled, [...styleTypes]);
