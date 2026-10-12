// Prints the structure of the Asimov 1 full-body assembly STEP and writes a JSON summary.
// Usage: node --max-old-space-size=6144 tools/cad/inspect-assembly.mjs <Asimov_1.STEP> <out.json>
import { writeFileSync } from 'node:fs';
import { readAssembly, flatten } from './assembly.mjs';

const [stepPath, outPath] = process.argv.slice(2);
const asm = readAssembly(stepPath, (m) => console.log(m));
console.log('units:', asm.units);
const root = asm.roots[0];
const leaves = flatten(asm, root.pd);
console.log('leaf occurrences:', leaves.length);
const byProduct = new Map();
for (const l of leaves) byProduct.set(l.name, (byProduct.get(l.name) ?? 0) + 1);
console.log('unique leaf products:', byProduct.size);
// Tree print, 3 levels.
function printTree(pd, depth, seen = new Set()) {
  const def = asm.pds.get(pd);
  const name = asm.products.get(def.product).name;
  const kids = new Map();
  for (const nid of def.children) {
    const c = asm.nauos.get(nid).child;
    kids.set(c, (kids.get(c) ?? 0) + 1);
  }
  console.log(`${'  '.repeat(depth)}${name}${def.children.length ? ` [${def.children.length} occurrences]` : ''}`);
  if (depth >= 2) return;
  for (const [c, n] of kids) {
    const cdef = asm.pds.get(c);
    if (cdef.children.length) printTree(c, depth + 1, seen);
    else console.log(`${'  '.repeat(depth + 1)}${asm.products.get(cdef.product).name}${n > 1 ? ` x${n}` : ''}`);
  }
}
printTree(root.pd, 0);
const bbox = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
for (const l of leaves) {
  const t = [l.matrix[12], l.matrix[13], l.matrix[14]];
  for (let i = 0; i < 3; i++) { bbox[i] = Math.min(bbox[i], t[i]); bbox[i + 3] = Math.max(bbox[i + 3], t[i]); }
}
console.log('leaf origin bbox (file units):', bbox.map((v) => v.toFixed(1)).join(', '));
writeFileSync(outPath, JSON.stringify({
  units: asm.units,
  root: asm.products.get(root.product).name,
  leaves: leaves.map((l) => ({ pd: l.pd, name: l.name, path: l.path.map((p) => `${p.product}#${p.instanceId}`).join(' / '), matrix: l.matrix.map((v) => +v.toFixed(9)) })),
  products: [...asm.pds.values()].map((d) => ({ pd: d.pd, name: asm.products.get(d.product).name, code: asm.products.get(d.product).code, shapeReps: d.shapeReps, children: d.children.length })),
}, null, 1));
console.log('wrote', outPath);
