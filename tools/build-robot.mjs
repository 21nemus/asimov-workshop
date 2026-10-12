// Builds the hardware robot asset from the tessellated CAD assembly:
//   public/robot/asimov-cad.glb   one node per simulation body ("body:<name>"), holding one
//                                 merged mesh per material class, in that body's frame (metres,
//                                 MuJoCo axes). Each vertex carries _PART (part index).
//   public/robot/parts.json       per-part identity, provenance, material and draw ranges.
// Inputs: tools/.cache/cad/{occurrences,registration}.json, mesh/*, src/data/bom.json.
// Usage: node --max-old-space-size=6144 tools/build-robot.mjs
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { quantize, reorder } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { weld, simplify, compact, creasedNormals, readyMeshopt } from './mesh-utils.mjs';
import { loadProductMesh } from './cad/geometry.mjs';

const CACHE = 'tools/.cache/cad';
const reg = JSON.parse(readFileSync(join(CACHE, 'registration.json'), 'utf8'));
const bom = JSON.parse(readFileSync('src/data/bom.json', 'utf8'));
const kin = JSON.parse(readFileSync('src/data/kinematics.json', 'utf8'));
const S = await readyMeshopt();

// ---------- classification ----------
const bomByPn = new Map();
for (const r of bom.records) if (r.partNumber) { if (!bomByPn.has(r.partNumber)) bomByPn.set(r.partNumber, []); bomByPn.get(r.partNumber).push(r); }
const FASTENER = /^(M\d|M2\.5|18-8|.*DIN (912|7991|985|125|562))/;
const GOBILDA = /^(Mirror)?(1600-0515|1602-0032|2806-0005|2920-0001)/;
const ELECTRONICS = /^(Head_Board|MediaHat_Board|Motion Control Board|Power Distribution Board|RPU FAN|Battery Switch|XT60F)/;

function partNumberOf(name) {
  const m = name.match(/^(ASV1_\d{3}_\d{2}[A-Z](?:_SS)?)\.?$/);
  return m ? m[1] : null;
}

// CAD names the BOM does not list as such. Each alias is evidence-based and reported in
// docs/DISCREPANCIES.md; the BOM records themselves are never edited or merged.
const CAD_ALIASES = {
  // CAD product "ASV1_200_09." has no type letter; the BOM has ASV1_200_09C (MJF PA12).
  'ASV1_200_09': { use: 'ASV1_200_09C', why: 'CAD product name lacks the C suffix; BOM lists ASV1_200_09C in the pelvis module' },
  // Thigh outer housings: used in leg assembly step 6 and present in CAD, absent from the BOM mechanical sheet.
  'ASV1_500_14C': { use: null, cls: 'pa12-black', why: 'not in the supplied BOM; docs step 6 encloses the thigh with 14C and 04C; finish shown as its mating housing 04C (ILLUSTRATIVE)' },
  'ASV1_600_14C': { use: null, cls: 'pa12-black', why: 'not in the supplied BOM; docs step 6 encloses the thigh with 14C and 04C; finish shown as its mating housing 04C (ILLUSTRATIVE)' },
  // BOM module-600 row lists "ASV1_500_31X " (trailing space); the CAD part in module 600 is ASV1_600_31X.
  'ASV1_600_31X': { use: 'ASV1_500_31X', why: 'BOM Procure - Generic Unique row 33 (module ASV1_600) lists ASV1_500_31X; CAD part is ASV1_600_31X with identical geometry' },
  // Arm flanged bearings: CAD parts 19X/21X are geometric twins of the BOM-identified bearings ASV1_500_11X/600_11X.
  'ASV1_300_19X': { use: 'ASV1_500_11X', why: 'same tessellated geometry as BOM flanged ball bearing ASV1_500_11X; BOM numbers the right-arm bearings 300_22X/300_23X, which CAD uses for actuators' },
  'ASV1_300_21X': { use: 'ASV1_500_11X', why: 'same tessellated geometry as BOM flanged ball bearing ASV1_500_11X; BOM numbers the right-arm bearings 300_22X/300_23X, which CAD uses for actuators' },
  'ASV1_400_19X': { use: 'ASV1_500_11X', why: 'same tessellated geometry as BOM flanged ball bearing ASV1_500_11X; BOM lists left-arm bearings as 400_10X and 400_21X' },
};

/** Material class + finish text + where the finish came from. */
function classify(name) {
  const cadPn = partNumberOf(name) ?? (name.match(/^(ASV1_\d{3}_\d{2})\.?$/)?.[1] ?? null);
  const alias = cadPn ? CAD_ALIASES[cadPn] : null;
  if (alias && alias.use === null) return { pn: cadPn, cls: alias.cls, material: null, finish: null, basis: 'ILLUSTRATIVE', bom: null, kind: 'fabricated', note: alias.why };
  const pn = alias?.use ?? cadPn;
  const r = classifyPn(name, pn);
  if (alias) { r.pn = cadPn; r.bomPartNumber = alias.use; r.note = alias.why; }
  return r;
}

function classifyPn(name, pn) {
  const recs = pn ? bomByPn.get(pn) ?? [] : [];
  const mech = recs.find((r) => r.kind === 'mechanical');
  const act = recs.find((r) => r.kind === 'actuator');
  const gen = recs.find((r) => r.kind === 'generic');
  if (mech) {
    const finish = mech.finish?.trim() ?? '';
    const material = mech.material?.trim() ?? '';
    let cls = 'unknown';
    if (/Matte Spray Paint/i.test(finish)) cls = 'shell-paint';
    else if (/Dyed Black/i.test(finish)) cls = 'pa12-black';
    else if (/Anodizing/i.test(finish)) cls = 'al-anodized';
    else if (/Stainless Steel 316/i.test(material)) cls = 'stainless-bar';
    else if (/SML 316L/i.test(material)) cls = 'slm-steel';
    return { pn, cls, material, finish, basis: 'BOM', bom: mech.id, kind: 'fabricated' };
  }
  if (act) return { pn, cls: 'actuator', material: null, finish: null, basis: 'ILLUSTRATIVE', bom: act.id, kind: 'actuator', model: act.sku };
  if (gen) {
    const d = gen.description ?? '';
    let cls = 'hardware-steel';
    if (/Pillow Block/i.test(d)) cls = 'hardware-alu';
    else if (/Compute|Raspberry|Camera/i.test(d)) cls = 'pcb';
    else if (/Speaker|Li-ion/i.test(d)) cls = 'electronics-dark';
    else if (/Standoff/i.test(d)) cls = 'brass';
    return { pn, cls, material: null, finish: null, basis: 'ILLUSTRATIVE', bom: gen.id, kind: /Compute|Raspberry|Camera|Speaker|Li-ion/i.test(d) ? 'electronics' : 'hardware', description: d };
  }
  if (pn) return { pn, cls: 'unknown', material: null, finish: null, basis: 'ILLUSTRATIVE', bom: null, kind: 'fabricated', note: 'part number not found in the supplied BOM' };
  if (/Insert/i.test(name)) return { pn: null, cls: 'brass', basis: 'ILLUSTRATIVE', bom: null, kind: 'fastener' };
  if (FASTENER.test(name)) return { pn: null, cls: /Locknut|Washer|Square Nut/i.test(name) ? 'zinc-steel' : 'fastener-black', basis: 'ILLUSTRATIVE', bom: null, kind: 'fastener' };
  if (GOBILDA.test(name)) return { pn: null, cls: /2920-0001/.test(name) ? 'hardware-steel' : 'hardware-alu', basis: 'ILLUSTRATIVE', bom: null, kind: 'hardware' };
  if (ELECTRONICS.test(name)) return { pn: null, cls: /FAN|Switch|XT60/.test(name) ? 'electronics-dark' : 'pcb', basis: 'ILLUSTRATIVE', bom: null, kind: 'electronics' };
  return { pn: null, cls: 'unknown', basis: 'ILLUSTRATIVE', bom: null, kind: 'other' };
}

/** Simplification budget per kind (absolute error in metres, triangle cap per part). */
function budget(c, name) {
  if (c.cls === 'brass') return { maxError: 0.0002, cap: 60 };
  if (c.kind === 'fastener') return { maxError: 0.00012, cap: 120 };
  if (c.kind === 'electronics') return { maxError: 0.00025, cap: 4000 };
  if (c.kind === 'hardware') return { maxError: 0.00008, cap: 1500 };
  if (c.kind === 'actuator') return { maxError: 0.0001, cap: 2500 };
  if (/ASV1_(100_01C|200_01C|100_10C)/.test(name)) return { maxError: 0.00009, cap: 22000 };
  return { maxError: 0.00007, cap: 12000 };
}

// ---------- per-product geometry (once per unique product) ----------
const productGeo = new Map();
function productGeometry(key, name, c) {
  if (productGeo.has(key)) return productGeo.get(key);
  const prod = loadProductMesh(join(CACHE, 'mesh'), key);
  let n = 0;
  for (const p of prod.parts) n += p.positions.length;
  const pos = new Float32Array(n);
  const idx = [];
  let base = 0, off = 0;
  for (const p of prod.parts) {
    for (let i = 0; i < p.positions.length; i++) pos[off + i] = p.positions[i] / 1000; // mm -> m
    for (const i of p.index) idx.push(i + base);
    base += p.positions.length / 3;
    off += p.positions.length;
  }
  const w = weld(pos, 1e-6, idx);
  const b = budget(c, name);
  let r = simplify(S, w.positions, w.index, { ratio: 0.002, maxError: b.maxError, permissive: true });
  for (let k = 2; r.index.length / 3 > b.cap && k <= 32; k *= 2) r = simplify(S, w.positions, w.index, { ratio: b.cap / (w.index.length / 3), maxError: b.maxError * k, permissive: true });
  const cpt = compact(w.positions, r.index);
  const g = creasedNormals(cpt.positions, cpt.index, 32);
  const out = { ...g, rawTriangles: w.index.length / 3, error: r.error };
  productGeo.set(key, out);
  return out;
}

// ---------- assemble per body and material class ----------
const parts = [];
const groups = new Map(); // body -> cls -> {pos:[], nor:[], idx:[], part:[]}
const instanceCount = new Map();
let rawTotal = 0, outTotal = 0;
for (const o of reg.occurrences) {
  if (!o.link) continue;
  const c = classify(o.name);
  const g = productGeometry(o.key, o.name, c);
  const L = o.local;
  const k = (instanceCount.get(o.name) ?? 0) + 1;
  instanceCount.set(o.name, k);
  const partIndex = parts.length;
  let bodyGroups = groups.get(o.link);
  if (!bodyGroups) { bodyGroups = new Map(); groups.set(o.link, bodyGroups); }
  let grp = bodyGroups.get(c.cls);
  if (!grp) { grp = { pos: [], nor: [], idx: [], part: [] }; bodyGroups.set(c.cls, grp); }
  const vBase = grp.pos.length / 3;
  const start = grp.idx.length;
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < g.positions.length; i += 3) {
    const x = g.positions[i], y = g.positions[i + 1], z = g.positions[i + 2];
    const px = L[0] * x + L[4] * y + L[8] * z + L[12], py = L[1] * x + L[5] * y + L[9] * z + L[13], pz = L[2] * x + L[6] * y + L[10] * z + L[14];
    grp.pos.push(px, py, pz);
    mn[0] = Math.min(mn[0], px); mn[1] = Math.min(mn[1], py); mn[2] = Math.min(mn[2], pz);
    mx[0] = Math.max(mx[0], px); mx[1] = Math.max(mx[1], py); mx[2] = Math.max(mx[2], pz);
    const nx = g.normals[i], ny = g.normals[i + 1], nz = g.normals[i + 2];
    grp.nor.push(L[0] * nx + L[4] * ny + L[8] * nz, L[1] * nx + L[5] * ny + L[9] * nz, L[2] * nx + L[6] * ny + L[10] * nz);
    grp.part.push(partIndex);
  }
  for (const i of g.index) grp.idx.push(i + vBase);
  rawTotal += g.rawTriangles;
  outTotal += g.index.length / 3;
  parts.push({
    i: partIndex, occurrence: o.i, name: o.name.replace(/\.$/, ''), partNumber: c.pn, instance: k,
    module: o.path[1]?.product?.replace(/\.$/, '') ?? 'Asimov_1', cadPath: o.path.map((p) => p.product.replace(/\.$/, '')).join(' / '),
    body: o.link, cls: c.cls, kind: c.kind, material: c.material ?? null, finish: c.finish ?? null, materialBasis: c.basis, bom: c.bom ?? null,
    model: c.model ?? null, description: c.description ?? null, note: c.note ?? null, bomPartNumber: c.bomPartNumber ?? null,
    assignment: { confidence: o.confidence, basis: o.basis, residualMm: o.residualMm },
    center: [0, 1, 2].map((q) => +((mn[q] + mx[q]) / 2).toFixed(5)), size: [0, 1, 2].map((q) => +(mx[q] - mn[q]).toFixed(5)),
    range: { mesh: `${o.link}|${c.cls}`, start, count: g.index.length },
    triangles: g.index.length / 3, cadTriangles: g.rawTriangles, simplifyErrorMm: +(g.error * 1000).toFixed(3),
  });
}

// ---------- glTF ----------
const doc = new Document();
doc.createExtension(KHRMeshQuantization).setRequired(true);
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
const buffer = doc.createBuffer();
const scene = doc.createScene('asimov-cad');
const materials = new Map();
const mat = (cls) => {
  if (!materials.has(cls)) materials.set(cls, doc.createMaterial(cls));
  return materials.get(cls);
};
for (const [body, byCls] of groups) {
  const node = doc.createNode(`body:${body}`).setExtras({ body });
  for (const [cls, grp] of byCls) {
    const prim = doc.createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(Float32Array.from(grp.pos)).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(Float32Array.from(grp.nor)).setBuffer(buffer))
      .setAttribute('_PART', doc.createAccessor().setType('SCALAR').setArray(Uint16Array.from(grp.part)).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(Uint32Array.from(grp.idx)).setBuffer(buffer))
      .setMaterial(mat(cls));
    node.addChild(doc.createNode(`mesh:${body}|${cls}`).setMesh(doc.createMesh(`${body}|${cls}`).addPrimitive(prim)).setExtras({ body, cls }));
  }
  scene.addChild(node);
}
doc.getRoot().setExtras({ generator: 'ASIMOV WORKSHOP tools/build-robot.mjs', source: 'menloresearch/asimov-1@f71f3fe mechanical/ASV1/FullBodyAssembly/Asimov_1.STEP (CERN-OHL-S-2.0)', frame: 'per-body MuJoCo frames, metres' });
await MeshoptEncoder.ready;
// reorder() would change vertex order and break nothing (draw ranges are index ranges), but the
// index buffer order must stay grouped by part, so only vertex-cache-safe reordering is skipped.
await doc.transform(quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeGeneric: 16 }));
mkdirSync('public/robot', { recursive: true });
const io = new NodeIO().registerExtensions([KHRMeshQuantization, EXTMeshoptCompression]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
await io.write('public/robot/asimov-cad.glb', doc);

const summary = {
  source: { repository: 'https://github.com/menloresearch/asimov-1', commit: 'f71f3fe87ddfa6b7aac2a5cddeaad5dbbc19cca7', file: 'mechanical/ASV1/FullBodyAssembly/Asimov_1.STEP', sha256: '35903b20bffd0e21d709acc75a30d0ee98323fa6c76b59fefffd181471422ba7', licence: 'CERN-OHL-S-2.0' },
  conversion: 'STEP split per product (tools/cad/tessellate.mjs, OpenCascade via occt-import-js 0.0.23, 0.05 mm / 0.25 rad), registered to the MJCF reference pose (tools/cad/register.mjs), simplified per part (tools/build-robot.mjs).',
  triangles: { cad: rawTotal, shipped: outTotal },
  parts,
};
writeFileSync('public/robot/parts.json', JSON.stringify(summary));
const kb = (f) => (statSync(f).size / 1024).toFixed(0);
console.log(`parts ${parts.length}, bodies ${groups.size}, meshes ${[...groups.values()].reduce((n, m) => n + m.size, 0)}`);
console.log(`triangles: CAD (welded, non-degenerate, instanced) ${rawTotal} -> shipped ${outTotal}`);
console.log(`asimov-cad.glb ${kb('public/robot/asimov-cad.glb')} KB, parts.json ${kb('public/robot/parts.json')} KB`);
const byCls = new Map();
for (const p of parts) byCls.set(p.cls, (byCls.get(p.cls) ?? 0) + p.triangles);
console.log('triangles by class', Object.fromEntries([...byCls].sort((a, b) => b[1] - a[1])));
void kin; void reorder;
