// Builds the display-only extras from Menlo's newer simulation models (asimov-1 @ 43aa368, pin
// 'asimov-1@sim-variants'). The walking physics, the policy and TEST stay on the verified 23-DOF
// model at 35ae7b3: nothing written here is read by the simulation.
//   src/data/neck.json        the 25-DOF model's neck yaw and pitch joints, written only if its neck
//                             bodies sit exactly where our rig's do (same frames, so the CAD head fits)
//   src/data/gripper.json     the 27-DOF model's right gripper: bodies, joints, the couplings that tie
//                             five joints to the driver, the motor, and the jaw gap over the driver's range
//   public/robot/gripper.glb  the gripper's seven link meshes, one node per body, in body frames
// Usage: node tools/build-sim-variants.mjs && node tools/compress-glb.mjs public/robot/gripper.glb public/robot/gripper.glb
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { getMujoco, nameReader } from './mujoco-node.mjs';
import { readBinaryStl, weld, simplify, compact, creasedNormals, readyMeshopt } from './mesh-utils.mjs';

const pins = JSON.parse(readFileSync('references/pins.json', 'utf8'));
const pin = pins.sources.find((s) => s.id === 'asimov-1@sim-variants');
const DIR = join('.reference-cache', 'asimov-1@43aa368', 'sim-model');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const r = (v, d = 9) => +v.toFixed(d);

/** The pinned XML text of a variant (bytes checked against the pin). */
function variantXml(variant) {
  const rel = `sim-model/${variant}/xml/${variant}.xml`;
  const xml = readFileSync(join(DIR, variant, 'xml', `${variant}.xml`));
  if (sha(xml) !== pin.files[rel].sha256) throw new Error(`${rel} does not match the pin`);
  return { rel, text: xml.toString('utf8'), sha256: sha(xml) };
}

/** Compiles `text` with the variant's meshes (only `meshes`, if given; each checked against the pin). */
async function compile(variant, text, rel, xmlSha, meshes = null) {
  const mujoco = await getMujoco();
  const root = `/working/${variant}`;
  for (const d of [root, `${root}/xml`, `${root}/meshes`]) mujoco.FS.mkdir(d);
  for (const f of meshes ?? readdirSync(join(DIR, variant, 'meshes'))) {
    const bytes = readFileSync(join(DIR, variant, 'meshes', f));
    if (sha(bytes) !== pin.files[`sim-model/${variant}/meshes/${f}`]?.sha256) throw new Error(`${f} does not match the pin`);
    mujoco.FS.writeFile(`${root}/meshes/${f}`, new Uint8Array(bytes));
  }
  mujoco.FS.writeFile(`${root}/xml/model.xml`, text);
  const model = mujoco.MjModel.loadFromXML(`${root}/xml/model.xml`);
  const data = new mujoco.MjData(model);
  mujoco.mj_forward(model, data);
  const name = nameReader(model);
  const body = (n) => { for (let b = 0; b < model.nbody; b++) if (name(model.name_bodyadr[b]) === n) return b; throw new Error(`${variant}: no body ${n}`); };
  const source = { repository: pin.repository, commit: pin.commit, path: rel, sha256: xmlSha, compiledWith: `MuJoCo ${mujoco.mj_versionString()} (mujoco-js 0.0.7)` };
  return { mujoco, model, data, name, body, source };
}

/** The balanced element starting at `start` (an opening tag of `tag`), nested same-name tags included. */
function element(text, start, tag) {
  const re = new RegExp(`<${tag}[\\s>/]|</${tag}>`, 'g');
  re.lastIndex = start;
  let depth = 0;
  for (let m; (m = re.exec(text));) {
    if (m[0].startsWith('</')) depth--;
    else if (!/\/>/.test(text.slice(m.index, text.indexOf('>', m.index) + 1))) depth++;
    if (depth === 0) return text.slice(start, m[0].startsWith('</') ? m.index + m[0].length : text.indexOf('>', m.index) + 1);
  }
  throw new Error(`unbalanced <${tag}>`);
}

/**
 * Menlo's 27-DOF model with only the right gripper kept: its body subtree (base fixed in the world),
 * the default classes, its mesh assets, its joint couplings and its motor, all copied verbatim.
 * The full model is too large to compile in mujoco-js (two meshes of 195,000 triangles).
 */
function gripperOnlyXml(text) {
  const subtree = element(text, text.indexOf('<body name="right_gripper_base_link"'), 'body');
  const defaults = element(text, text.indexOf('<default>'), 'default');
  const meshNames = [...subtree.matchAll(/\bmesh="([^"]+)"/g)].map((m) => m[1]);
  const assets = meshNames.map((n) => text.match(new RegExp(`<mesh name="${n}"[^>]*>`))[0]);
  const equality = [...text.matchAll(/<joint\s+name="couple_right_gripper[^>]*>/g)].map((m) => m[0]);
  const motor = text.match(/<motor name="right_gripper_motor"[^>]*>/)[0];
  const compiler = text.match(/<compiler[^>]*>/)[0];
  const xml = `<mujoco model="right_gripper">\n${compiler}\n${defaults}\n<asset>\n${assets.join('\n')}\n</asset>\n<worldbody>\n${subtree}\n</worldbody>\n<equality>\n${equality.join('\n')}\n</equality>\n<actuator>\n${motor}\n</actuator>\n</mujoco>\n`;
  const files = assets.map((a) => a.match(/file="([^"]+)"/)[1]);
  return { xml, files, basePos: subtree.match(/^<body[^>]*\bpos="([^"]+)"/)[1].split(/\s+/).map(Number) };
}
const v3 = (a, i) => [0, 1, 2].map((k) => r(a[3 * i + k]));
const q4 = (a, i) => [0, 1, 2, 3].map((k) => r(a[4 * i + k]));

// ---------- neck (25-DOF) ----------
const kin = JSON.parse(readFileSync('src/data/kinematics.json', 'utf8'));
const x25 = variantXml('asimov_1_25dof');
const m25 = await compile('asimov_1_25dof', x25.text, x25.rel, x25.sha256);
const neck = [];
for (const bodyName of ['neck_yaw_link', 'neck_pitch_link']) {
  const { model, name } = m25;
  const b = m25.body(bodyName);
  const ours = kin.bodies.find((x) => x.name === bodyName);
  const pos = v3(model.body_pos, b), quat = q4(model.body_quat, b);
  const parent = name(model.name_bodyadr[model.body_parentid[b]]);
  const dp = Math.hypot(...pos.map((v, k) => v - ours.pos[k]));
  const dq = 1 - Math.abs(quat.reduce((s, v, k) => s + v * ours.quat[k], 0));
  // 0.05 mm is far below CAD precision; the measured offset is written out.
  if (parent !== kin.bodies[ours.parent].name || dp > 5e-5 || dq > 1e-9) throw new Error(`${bodyName}: 25-DOF frame differs from our rig (${dp} m, ${dq}); the CAD head would not fit its joint`);
  if (model.body_jntnum[b] !== 1 || model.jnt_type[model.body_jntadr[b]] !== 3) throw new Error(`${bodyName}: expected one hinge`);
  const j = model.body_jntadr[b];
  neck.push({ name: name(model.name_jntadr[j]), body: bodyName, axis: v3(model.jnt_axis, j), pos: v3(model.jnt_pos, j), range: [r(model.jnt_range[2 * j]), r(model.jnt_range[2 * j + 1])], armature: r(model.dof_armature[model.jnt_dofadr[j]]), frameOffsetMm: r(dp * 1000, 4) });
}
// For the record: where the rest of the newer body differs from the one the policy walks on.
const differences = [];
for (let b = 2; b < m25.model.nbody; b++) {
  const n = m25.name(m25.model.name_bodyadr[b]);
  const ours = kin.bodies.find((x) => x.name === n);
  if (!ours) continue;
  const mm = Math.hypot(...v3(m25.model.body_pos, b).map((v, k) => v - ours.pos[k])) * 1000;
  if (mm > 0.5) differences.push({ body: n, offsetMm: +mm.toFixed(1) });
}
writeFileSync('src/data/neck.json', JSON.stringify({
  source: m25.source,
  note: 'Neck joints of Menlo’s 25-DOF model. Its neck bodies have our rig’s frames to within 0.05 mm (frameOffsetMm, checked at build), so the CAD head turns about Menlo’s axes. Display only: the walking policy runs on the 23-DOF model with the neck fixed.',
  joints: neck,
  otherDifferences: differences,
}, null, 1) + '\n');
console.log(`neck: ${neck.map((j) => `${j.name} axis ${j.axis} range ${j.range}`).join('; ')}`);
console.log(`25-DOF bodies offset from ours by > 0.5 mm: ${differences.map((d) => `${d.body} ${d.offsetMm}`).join(', ')}`);

// ---------- gripper (27-DOF, right hand) ----------
const x27 = variantXml('asimov_1_27dof');
const only = gripperOnlyXml(x27.text);
const m27 = await compile('asimov_1_27dof', only.xml, x27.rel, x27.sha256, only.files);
m27.source.extracted = 'right_gripper_base_link subtree with its default classes, mesh assets, couplings and motor, copied verbatim (tools/build-sim-variants.mjs)';
const { model, data, name, mujoco } = m27;
const baseId = m27.body('right_gripper_base_link');
const inSubtree = (b) => { for (let x = b; x > 0; x = model.body_parentid[x]) if (x === baseId) return true; return false; };
const ids = [];
for (let b = 0; b < model.nbody; b++) if (inSubtree(b)) ids.push(b);
const bodyName = (b) => name(model.name_bodyadr[b]);
const jointName = (j) => name(model.name_jntadr[j]);
// Equality constraints (mjEQ_JOINT = 2): joint1 = c0 + c1 * joint2 (higher terms must be zero).
const coupling = new Map();
for (let e = 0; e < model.neq; e++) {
  if (model.eq_type[e] !== 2) continue;
  const c = [0, 1, 2, 3, 4].map((k) => model.eq_data[e * model.eq_data.length / model.neq + k]);
  const j1 = jointName(model.eq_obj1id[e]), j2 = jointName(model.eq_obj2id[e]);
  if (!j1.startsWith('right_gripper')) continue;
  if (Math.abs(c[0]) > 1e-12 || c.slice(2).some((v) => Math.abs(v) > 1e-12)) throw new Error(`${j1}: coupling is not linear`);
  coupling.set(j1, { driver: j2, factor: r(c[1]) });
}
const driver = 'right_gripper_driver_joint';
const bodies = ids.map((b) => {
  const ja = model.body_jntadr[b];
  const j = model.body_jntnum[b] === 1 ? ja : -1;
  const jn = j >= 0 ? jointName(j) : null;
  return {
    name: bodyName(b), parent: b === baseId ? null : bodyName(model.body_parentid[b]),
    // The base is the bench's mount point; in Menlo's model it sits on right_6dof_link (see mount).
    pos: b === baseId ? [0, 0, 0] : v3(model.body_pos, b), quat: q4(model.body_quat, b),
    joint: j < 0 ? null : { name: jn, axis: v3(model.jnt_axis, j), pos: v3(model.jnt_pos, j), range: [r(model.jnt_range[2 * j]), r(model.jnt_range[2 * j + 1])], factor: jn === driver ? 1 : coupling.get(jn)?.factor ?? null },
  };
});
for (const b of bodies) if (b.joint && b.joint.factor === null) throw new Error(`${b.joint.name} is neither the driver nor coupled to it`);
let motor = null;
for (let a = 0; a < model.nu; a++) {
  if (model.actuator_trntype[a] === 0 && jointName(model.actuator_trnid[2 * a]) === driver) {
    motor = { name: name(model.name_actuatoradr[a]), joint: driver, gear: r(model.actuator_gear[6 * a]), ctrlrange: [r(model.actuator_ctrlrange[2 * a]), r(model.actuator_ctrlrange[2 * a + 1])] };
  }
}
if (!motor) throw new Error('no motor on the gripper driver');

// Meshes: the STL files are in their body frames (the MJCF mesh geoms carry no offset).
const S = await readyMeshopt();
const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene('gripper');
const material = doc.createMaterial('sim-grey').setBaseColorFactor([0.7, 0.7, 0.7, 1]).setRoughnessFactor(0.6);
const shown = new Map();
for (const b of bodies) {
  const file = `${b.name}.STL`;
  const raw = readBinaryStl(join(DIR, 'asimov_1_27dof', 'meshes', file));
  const welded = weld(raw, 1e-7);
  // The base housing arrives decimated to 195,000 triangles; it gets a coarser budget than the links.
  const s = simplify(S, welded.positions, welded.index, b.parent === null ? { ratio: 0.06, maxError: 0.0005 } : { ratio: 0.3, maxError: 0.0002 });
  const c = compact(welded.positions, s.index);
  const n = creasedNormals(c.positions, c.index, 40);
  shown.set(b.name, n.positions);
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(n.positions).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(n.normals).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(Uint32Array.from(n.index)).setBuffer(buffer))
    .setMaterial(material);
  scene.addChild(doc.createNode(b.name).setMesh(doc.createMesh(b.name).addPrimitive(prim)).setExtras({ file, simplifyError: +s.error.toExponential(2) }));
  console.log(`${file.padEnd(42)} ${String(welded.index.length / 3).padStart(7)} -> ${String(n.index.length / 3).padStart(6)} tris`);
}
doc.getRoot().setExtras({ source: m27.source, note: 'Right gripper link meshes of the 27-DOF simulation model, simplified for display' });
await new NodeIO().write('public/robot/gripper.glb', doc);

// Jaw gap over the driver's range: pose the subtree with MuJoCo (couplings applied exactly), then the
// closest points between the two finger meshes as drawn. Also checks that each jaw keeps its angle.
const qadr = new Map(bodies.filter((b) => b.joint).map((b) => [b.joint.name, model.jnt_qposadr[ids.find((i) => bodyName(i) === b.name) && model.body_jntadr[ids.find((i) => bodyName(i) === b.name)]]]));
const fingerA = m27.body('right_gripper_finger_link'), fingerB = m27.body('right_gripper_finger_follower_link');
const world = (b, pts) => {
  const out = new Float64Array(pts.length);
  for (let i = 0; i < pts.length; i += 3) for (let k = 0; k < 3; k++) {
    out[i + k] = data.xpos[3 * b + k] + data.xmat[9 * b + 3 * k] * pts[i] + data.xmat[9 * b + 3 * k + 1] * pts[i + 1] + data.xmat[9 * b + 3 * k + 2] * pts[i + 2];
  }
  return out;
};
const xmatOf = (b) => Array.from(data.xmat.slice(9 * b, 9 * b + 9));
const angleBetween = (a, b) => { const tr = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] + a[4] * b[4] + a[5] * b[5] + a[6] * b[6] + a[7] * b[7] + a[8] * b[8]; return Math.acos(Math.min(1, Math.max(-1, (tr - 1) / 2))); };
const pose = (q) => {
  for (const b of bodies) if (b.joint) data.qpos[qadr.get(b.joint.name)] = b.joint.factor * q;
  mujoco.mj_forward(model, data);
};
pose(0);
const restA = xmatOf(fingerA), restB = xmatOf(fingerB);
const [lo, hi] = bodies.find((b) => b.joint?.name === driver).joint.range;
const gap = [];
let maxTilt = 0;
for (let k = 0; k <= 20; k++) {
  const q = lo + ((hi - lo) * k) / 20;
  pose(q);
  maxTilt = Math.max(maxTilt, angleBetween(restA, xmatOf(fingerA)), angleBetween(restB, xmatOf(fingerB)));
  const A = world(fingerA, shown.get('right_gripper_finger_link')), B = world(fingerB, shown.get('right_gripper_finger_follower_link'));
  let best = Infinity;
  for (let i = 0; i < A.length; i += 3) for (let j = 0; j < B.length; j += 3) {
    const d = (A[i] - B[j]) ** 2 + (A[i + 1] - B[j + 1]) ** 2 + (A[i + 2] - B[j + 2]) ** 2;
    if (d < best) best = d;
  }
  gap.push([r(q, 4), r(Math.sqrt(best) * 1000, 1)]);
}
writeFileSync('src/data/gripper.json', JSON.stringify({
  source: m27.source,
  note: 'Right gripper of Menlo’s 27-DOF model (fixed-base, manipulation). One motor turns the driver; MJCF equality constraints tie five more joints to it (joint = factor × driver). Display only.',
  mount: { parent: 'right_6dof_link', pos: only.basePos },
  bodies, driver, motor,
  jawGapMm: { note: 'Closest points between the two finger meshes as drawn (simplified within 0.2 mm), over the driver range', samples: gap },
  jawTiltDegMax: r((maxTilt * 180) / Math.PI, 6),
}, null, 1) + '\n');
console.log(`gripper: ${bodies.length} bodies, motor ${motor.name} ctrlrange ${motor.ctrlrange}, couplings ${[...coupling].map(([j, c]) => `${j.replace('right_gripper_', '')} ${c.factor}`).join(', ')}`);
console.log(`jaw gap: ${gap[0][1]} mm at ${gap[0][0]} rad, ${gap.at(-1)[1]} mm at ${gap.at(-1)[0]} rad; jaw tilt max ${((maxTilt * 180) / Math.PI).toExponential(2)} deg`);
