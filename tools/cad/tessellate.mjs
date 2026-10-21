// Splits the full-body assembly STEP into one small STEP per unique leaf product
// (the transitive closure of that product's shape definition, its B-rep and the
// STYLED_ITEMs that colour it) and tessellates each with occt-import-js
// (OpenCascade compiled to WebAssembly). Output, per product, in tools/.cache/cad/mesh/:
//   <key>.json  name, colours, face ranges, bounding box (millimetres, CAD frame)
//   <key>.bin   Float32 positions, Float32 normals, Uint32 indices
// plus tools/.cache/cad/occurrences.json with every leaf instance's world matrix.
//
// Usage: node --max-old-space-size=6144 tools/cad/tessellate.mjs <Asimov_1.STEP> [--only <substring>]
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readAssembly, flatten } from './assembly.mjs';
import { conditionDisplaySurfaces } from './display-surfaces.mjs';

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const stepPath = args[0];
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const force = args.includes('--force');
const OUT = join(process.cwd(), 'tools/.cache/cad');
const MESH = join(OUT, 'mesh');
mkdirSync(MESH, { recursive: true });

// Tessellation tolerance: 0.05 mm chordal deviation, 0.25 rad angular. Fine enough
// for close-ups of the ankle bench; decimation for the web happens in a later step.
const PARAMS = { linearUnit: 'millimeter', linearDeflectionType: 'absolute_value', linearDeflection: 0.05, angularDeflection: 0.25 };

export function productKey(name, pd) {
  return `${name.replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/\.+$/, '')}__${pd}`;
}

const asm = readAssembly(stepPath, console.log);
const { index } = asm;
const rootPd = asm.roots[0].pd;
const leaves = flatten(asm, rootPd);

// Styled items by the entity they style (a solid or a face).
const styledBy = new Map();
for (const t of ['STYLED_ITEM', 'OVER_RIDING_STYLED_ITEM']) {
  for (const id of index.idsOfType(t)) {
    const refs = index.refs(id);
    const item = refs[refs.length - 1];
    if (!styledBy.has(item)) styledBy.set(item, []);
    styledBy.get(item).push(id);
  }
}
// SDR and SRR entities by the representation they reference.
const sdrByRep = new Map();
for (const id of index.idsOfType('SHAPE_DEFINITION_REPRESENTATION')) {
  const refs = index.refs(id);
  sdrByRep.set(refs[1], id);
}
const srrByRep = new Map();
for (const id of index.idsOfType('SHAPE_REPRESENTATION_RELATIONSHIP')) {
  const refs = index.refs(id);
  for (const r of refs) {
    if (!srrByRep.has(r)) srrByRep.set(r, []);
    srrByRep.get(r).push(id);
  }
}

const visitedMark = new Uint8Array(index.maxId + 1);
function closure(roots) {
  const out = [];
  const stack = [...roots];
  while (stack.length) {
    const id = stack.pop();
    if (visitedMark[id]) continue;
    visitedMark[id] = 1;
    out.push(id);
    for (const r of index.refs(id)) if (!visitedMark[r]) stack.push(r);
  }
  return out;
}
function clearMarks(ids) { for (const id of ids) visitedMark[id] = 0; }

function splitProduct(pd) {
  const def = asm.pds.get(pd);
  const roots = [];
  let brepContext = null;
  for (const sr of def.shapeReps) {
    const sdr = sdrByRep.get(sr);
    if (sdr) roots.push(sdr);
    for (const srr of srrByRep.get(sr) ?? []) roots.push(srr);
  }
  if (!roots.length) return null;
  let ids = closure(roots);
  // Styled items for anything in the closure (solids and faces).
  const styled = [];
  for (const id of ids) for (const s of styledBy.get(id) ?? []) styled.push(s);
  const extra = closure(styled);
  ids = ids.concat(extra);
  for (const id of ids) {
    if (index.typeOf(id) === 'ADVANCED_BREP_SHAPE_REPRESENTATION' || index.typeOf(id) === 'MANIFOLD_SURFACE_SHAPE_REPRESENTATION') {
      brepContext = index.refs(id).at(-1);
    }
  }
  clearMarks(ids);
  ids.sort((a, b) => a - b);
  const parts = [index.headerText, 'DATA;\n'];
  for (const id of ids) parts.push(index.text(id), '\n');
  if (styled.length && brepContext) {
    parts.push(`#${index.maxId + 1} = MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION ( '', ( ${styled.map((s) => `#${s}`).join(', ')} ), #${brepContext} ) ;\n`);
  }
  parts.push('ENDSEC;\nEND-ISO-10303-21;\n');
  return { text: parts.join(''), entityCount: ids.length, styledCount: styled.length };
}

const unique = new Map();
for (const l of leaves) if (!unique.has(l.pd)) unique.set(l.pd, l.name);

// Occurrences: every leaf instance with its world matrix (CAD frame, millimetres).
writeFileSync(join(OUT, 'occurrences.json'), JSON.stringify({
  source: 'mechanical/ASV1/FullBodyAssembly/Asimov_1.STEP',
  units: 'millimetre',
  occurrences: leaves.map((l, i) => ({
    i, key: productKey(l.name, l.pd), name: l.name, pd: l.pd,
    path: l.path.map((p) => ({ product: p.product, instance: p.instanceId })),
    matrix: l.matrix,
  })),
}));

const occt = await require('occt-import-js')();
let n = 0;
const t0 = Date.now();
const summary = [];
for (const [pd, name] of unique) {
  if (only && !name.includes(only)) continue;
  const key = productKey(name, pd);
  const jsonPath = join(MESH, `${key}.json`);
  const split = splitProduct(pd);
  if (!split) { console.warn('no geometry for', name); continue; }
  const display = conditionDisplaySurfaces(split.text, PARAMS.linearDeflection);
  if (!force && existsSync(jsonPath)) {
    const cached = JSON.parse(readFileSync(jsonPath, 'utf8'));
    // Invalidate old affected meshes even without --force. Unaffected products
    // retain their existing geometry and cache. Changing tolerance also rebuilds.
    if (JSON.stringify(cached.displaySurfaceCorrections ?? []) === JSON.stringify(display.corrections)
      && JSON.stringify(cached.params) === JSON.stringify(PARAMS)) { n++; continue; }
  }
  const t1 = Date.now();
  const result = occt.ReadStepFile(new TextEncoder().encode(display.text), PARAMS);
  if (!result.success) { console.warn('OCCT failed for', name); continue; }
  const meshes = [];
  const chunks = [];
  let offset = 0;
  const bbox = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  let tris = 0;
  for (const m of result.meshes) {
    const pos = Float32Array.from(m.attributes.position.array);
    const nor = m.attributes.normal ? Float32Array.from(m.attributes.normal.array) : new Float32Array(pos.length);
    const idx = Uint32Array.from(m.index.array);
    for (let i = 0; i < pos.length; i += 3) {
      for (let k = 0; k < 3; k++) { bbox[k] = Math.min(bbox[k], pos[i + k]); bbox[k + 3] = Math.max(bbox[k + 3], pos[i + k]); }
    }
    tris += idx.length / 3;
    meshes.push({
      name: m.name, color: m.color ?? null,
      faces: (m.brep_faces ?? []).map((f) => [f.first, f.last, f.color ?? null]),
      positions: [offset, pos.byteLength], normals: [offset + pos.byteLength, nor.byteLength], indices: [offset + pos.byteLength * 2, idx.byteLength],
    });
    chunks.push(Buffer.from(pos.buffer), Buffer.from(nor.buffer), Buffer.from(idx.buffer));
    offset += pos.byteLength * 2 + idx.byteLength;
  }
  writeFileSync(join(MESH, `${key}.bin`), Buffer.concat(chunks));
  writeFileSync(jsonPath, JSON.stringify({ key, name, pd, entityCount: split.entityCount, styledCount: split.styledCount, triangles: tris, bbox, meshes, params: PARAMS, displaySurfaceCorrections: display.corrections }));
  n++;
  summary.push([name, tris, ((Date.now() - t1) / 1000).toFixed(1)]);
  if (n % 10 === 0) console.log(`${n}/${unique.size} done, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
console.log(`tessellated ${summary.length} products in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
for (const s of summary.sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(s.join('\t'));
