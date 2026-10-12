// Diagnostic GLB: CAD occurrences (aggressively simplified) transformed by the global
// registration G into the MuJoCo world frame (metres), one colour per CAD module, next to
// the MJCF link meshes at qpos0. Viewed in dev/diag.html. Development evidence only.
// Usage: node tools/cad/diag-glb.mjs [--placement registration|links]
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { readBinaryStl, weld, simplify, compact, readyMeshopt } from '../mesh-utils.mjs';
import { loadProductMesh, transformPoint, mat4mul, quatToMat } from './geometry.mjs';

const OUT = 'tools/.cache/cad';
const reg = JSON.parse(readFileSync(join(OUT, 'registration.json'), 'utf8'));
const occ = JSON.parse(readFileSync(join(OUT, 'occurrences.json'), 'utf8')).occurrences;
const kin = JSON.parse(readFileSync('src/data/kinematics.json', 'utf8'));
const S = await readyMeshopt();
const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene();
const palette = [[0.9, 0.3, 0.2], [0.2, 0.5, 0.9], [0.3, 0.8, 0.4], [0.95, 0.7, 0.1], [0.6, 0.3, 0.9], [0.1, 0.8, 0.8], [0.9, 0.5, 0.7], [0.5, 0.5, 0.2]];
const linkNames = [...new Set(reg.occurrences.map((o) => o.link ?? 'none'))];
const mats = Object.fromEntries(linkNames.map((k, i) => [k, doc.createMaterial(k).setBaseColorFactor([...palette[i % palette.length], 1]).setRoughnessFactor(0.7)]));
const simMat = doc.createMaterial('sim').setBaseColorFactor([1, 1, 1, 0.35]).setAlphaMode('BLEND');
const simplified = new Map();
const buckets = new Map();
for (const o of occ) {
  let s = simplified.get(o.key);
  if (!s) {
    const prod = loadProductMesh(join(OUT, 'mesh'), o.key);
    const pos = [], idx = [];
    let base = 0;
    for (const p of prod.parts) { for (const v of p.positions) pos.push(v); for (const i of p.index) idx.push(i + base); base += p.positions.length / 3; }
    const w = weld(Float32Array.from(pos), 1e-4, idx);
    const r = simplify(S, w.positions, w.index, { ratio: 0.01, maxError: 0.3, permissive: true });
    s = compact(w.positions, r.index);
    simplified.set(o.key, s);
  }
  const assigned = reg.occurrences[o.i]?.link ?? 'none';
  const mod = assigned;
  const M = mat4mul(reg.G, o.matrix);
  let b = buckets.get(mod);
  if (!b) { b = { pos: [], idx: [] }; buckets.set(mod, b); }
  const base = b.pos.length / 3;
  for (let i = 0; i < s.positions.length; i += 3) { const p = transformPoint(M, s.positions[i], s.positions[i + 1], s.positions[i + 2]); b.pos.push(p[0] / 1000, p[1] / 1000, p[2] / 1000); }
  for (const i of s.index) b.idx.push(i + base);
}
for (const [mod, b] of buckets) {
  const prim = doc.createPrimitive().setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(Float32Array.from(b.pos)).setBuffer(buffer)).setIndices(doc.createAccessor().setType('SCALAR').setArray(Uint32Array.from(b.idx)).setBuffer(buffer)).setMaterial(mats[mod]);
  scene.addChild(doc.createNode(`cad:${mod}`).setMesh(doc.createMesh(mod).addPrimitive(prim)));
}
const simDir = join('.reference-cache', `asimov-1@${kin.source.commit.slice(0, 7)}`, 'sim-model');
for (const g of kin.geoms) {
  if (g.type !== 'mesh') continue;
  const body = kin.bodies[g.body];
  const raw = readBinaryStl(join(simDir, 'assets/meshes', kin.meshFiles[g.mesh]));
  const w = weld(raw, 1e-7);
  const r = simplify(S, w.positions, w.index, { ratio: 0.05, maxError: 0.0006, permissive: true });
  const c = compact(w.positions, r.index);
  const M = quatToMat(body.xquat0, body.xpos0);
  const out = new Float32Array(c.positions.length);
  for (let i = 0; i < out.length; i += 3) { const p = transformPoint(M, c.positions[i], c.positions[i + 1], c.positions[i + 2]); out[i] = p[0]; out[i + 1] = p[1]; out[i + 2] = p[2]; }
  const prim = doc.createPrimitive().setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(out).setBuffer(buffer)).setIndices(doc.createAccessor().setType('SCALAR').setArray(c.index).setBuffer(buffer)).setMaterial(simMat);
  scene.addChild(doc.createNode(`sim:${body.name}`).setMesh(doc.createMesh(body.name).addPrimitive(prim)));
}
await new NodeIO().write(join(OUT, 'diag.glb'), doc);
console.log('wrote diag.glb');
