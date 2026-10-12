// Builds public/robot/sim-links.glb: the 25 STL link meshes the MJCF references,
// welded, simplified and given creased normals, one node per MJCF mesh name.
// Vertices stay in each body's local MuJoCo frame (metres, Z up) so the app can
// hang them on the same kinematic rig that carries the CAD parts. This is the
// "simulation model" view: what MuJoCo's visual geoms look like, not the hardware.
// Usage: node tools/build-sim-links.mjs
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { readBinaryStl, weld, simplify, compact, creasedNormals, readyMeshopt } from './mesh-utils.mjs';

const kin = JSON.parse(readFileSync('src/data/kinematics.json', 'utf8'));
const simDir = join('.reference-cache', `asimov-1@${kin.source.commit.slice(0, 7)}`, 'sim-model');
const S = await readyMeshopt();
const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene('sim-links');
const material = doc.createMaterial('sim-grey').setBaseColorFactor([0.7, 0.7, 0.7, 1]).setRoughnessFactor(0.6);
let totalIn = 0, totalOut = 0;
const meshNodes = new Map();
for (const [meshName, file] of Object.entries(kin.meshFiles)) {
  if (meshNodes.has(file)) continue;
  const raw = readBinaryStl(join(simDir, 'assets/meshes', file));
  const welded = weld(raw, 1e-7);
  totalIn += welded.index.length / 3;
  const s = simplify(S, welded.positions, welded.index, { ratio: 0.12, maxError: 0.0006 });
  const c = compact(welded.positions, s.index);
  const n = creasedNormals(c.positions, c.index, 40);
  totalOut += n.index.length / 3;
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(n.positions).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(n.normals).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(n.index.length < 65536 * 3 && n.positions.length / 3 < 65536 ? Uint16Array.from(n.index) : n.index).setBuffer(buffer))
    .setMaterial(material);
  const mesh = doc.createMesh(file).addPrimitive(prim);
  const node = doc.createNode(file).setMesh(mesh).setExtras({ file, meshNames: Object.entries(kin.meshFiles).filter(([, f]) => f === file).map(([m]) => m), simplifyError: +s.error.toExponential(2) });
  scene.addChild(node);
  meshNodes.set(file, node);
  console.log(`${file.padEnd(26)} ${String(welded.index.length / 3).padStart(7)} -> ${String(n.index.length / 3).padStart(6)} tris, error ${(s.error * 1000).toFixed(2)} mm`);
}
doc.getRoot().setExtras({ source: kin.source, note: 'MJCF visual link meshes (simulation representation), simplified for display' });
mkdirSync('public/robot', { recursive: true });
await new NodeIO().write('public/robot/sim-links.glb', doc);
console.log(`total ${totalIn} -> ${totalOut} triangles`);
