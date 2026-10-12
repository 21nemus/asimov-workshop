// Registers the CAD assembly (SolidWorks frame, millimetres) to the MuJoCo model (metres,
// Z up) and assigns every CAD part occurrence to the simulation body it rides on.
//
//  1. Coarse orientation: best of the 24 axis-aligned rotations against the MJCF link meshes.
//  2. Surface ICP at the MJCF reference pose (qpos0).
//  3. Joint-chain landmark fit: the CAD assembly is posed slightly differently from qpos0
//     (notably the arms), so the global transform G and the CAD's own joint angles q_CAD are
//     solved together: every actuator's centre must lie on its joint axis, and each foot
//     pivot block must sit on its ankle joint.
//  4. Link membership from the documented assembly (docs.menlo.ai assembly steps: which part
//     is bolted to which actuator side), with fasteners inheriting the link of the plate or
//     housing they clamp. Parts no rule covers fall back to the nearest MJCF link surface.
//  5. Each part's rigid placement in its body frame is computed at q_CAD, so the rig can pose
//     the hardware at any joint angles.
// Output: tools/.cache/cad/registration.json
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readBinaryStl } from '../mesh-utils.mjs';
import { loadProductMesh, sampleSurface, transformPoint, VoxelIndex, kabsch, mat4mul, quatToMat, invertRigid, lcg } from './geometry.mjs';
import { Fk } from './kinematics-fk.mjs';

const OUT = 'tools/.cache/cad';
const MESH = join(OUT, 'mesh');
const kin = JSON.parse(readFileSync('src/data/kinematics.json', 'utf8'));
const occ = JSON.parse(readFileSync(join(OUT, 'occurrences.json'), 'utf8')).occurrences;
const simDir = join('.reference-cache', `asimov-1@${kin.source.commit.slice(0, 7)}`, 'sim-model');
const rand = lcg(11);
const fk = new Fk(kin);
const ZERO = fk.hinges.map(() => 0);
const W0 = fk.world(ZERO);

// ---------- simulation link surfaces, sampled in each body's LOCAL frame (mm) ----------
const links = [];
for (const g of kin.geoms) {
  if (g.type !== 'mesh') continue;
  const body = kin.bodies[g.body];
  const raw = readBinaryStl(join(simDir, 'assets/meshes', kin.meshFiles[g.mesh]));
  const index = Uint32Array.from({ length: raw.length / 3 }, (_, i) => i);
  const geomM = quatToMat(g.quat, g.pos);
  const pts = sampleSurface(raw, index, 4e-6, rand, 500, 60000).points;
  for (let i = 0; i < pts.length; i += 3) {
    const p = transformPoint(geomM, pts[i], pts[i + 1], pts[i + 2]);
    pts[i] = p[0] * 1000; pts[i + 1] = p[1] * 1000; pts[i + 2] = p[2] * 1000;
  }
  links.push({ body: body.name, bodyId: body.id, file: kin.meshFiles[g.mesh], local: pts, index: new VoxelIndex(pts, 6) });
}
const L = (name) => { const i = links.findIndex((l) => l.body === name); if (i < 0) throw new Error(`no link ${name}`); return i; };
function worldSamples(W) {
  const out = [];
  for (const l of links) {
    const M = W[l.bodyId];
    for (let i = 0; i < l.local.length; i += 3) out.push(...transformPoint(M, l.local[i], l.local[i + 1], l.local[i + 2]));
  }
  return Float64Array.from(out);
}
const sim0 = worldSamples(W0);
const sim0Index = new VoxelIndex(sim0, 6);
console.log(`sim links ${links.length}, ${sim0.length / 3} surface samples`);

// ---------- CAD occurrence surfaces (CAD world, mm) ----------
const productCache = new Map();
const occSamples = occ.map((o) => {
  let prod = productCache.get(o.key);
  if (!prod) {
    prod = loadProductMesh(MESH, o.key);
    const n = prod.parts.reduce((s, p) => s + p.positions.length, 0);
    const pos = new Float32Array(n);
    const idx = [];
    let base = 0, off = 0;
    for (const p of prod.parts) { pos.set(p.positions, off); for (const i of p.index) idx.push(i + base); base += p.positions.length / 3; off += p.positions.length; }
    prod.sample = sampleSurface(pos, Uint32Array.from(idx), 6, rand, 24, 600);
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i += 3) for (let q = 0; q < 3; q++) { mn[q] = Math.min(mn[q], pos[i + q]); mx[q] = Math.max(mx[q], pos[i + q]); }
    prod.bbox = { mn, mx };
    prod.parts = null; // free the raw tessellation
    productCache.set(o.key, prod);
  }
  const s = prod.sample.points;
  const w = new Float64Array(s.length);
  for (let i = 0; i < s.length; i += 3) { const p = transformPoint(o.matrix, s[i], s[i + 1], s[i + 2]); w[i] = p[0]; w[i + 1] = p[1]; w[i + 2] = p[2]; }
  return w;
});
const cadAll = new Float64Array(occSamples.reduce((n, s) => n + s.length, 0));
{ let o = 0; for (const s of occSamples) { cadAll.set(s, o); o += s.length; } }
console.log(`CAD occurrences ${occ.length}, ${cadAll.length / 3} surface samples`);

// ---------- 1. coarse orientation ----------
function bbox(p) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[i + k]); mx[k] = Math.max(mx[k], p[i + k]); }
  return { center: [0, 1, 2].map((k) => (mn[k] + mx[k]) / 2), size: [0, 1, 2].map((k) => mx[k] - mn[k]) };
}
const cadBox = bbox(cadAll), simBox = bbox(sim0);
const rotations = [];
const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
for (const xi of [0, 1, 2]) for (const xs of [1, -1]) for (const yi of [0, 1, 2]) for (const ys of [1, -1]) {
  if (yi === xi) continue;
  const x = axes[xi].map((v) => v * xs), y = axes[yi].map((v) => v * ys);
  const z = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
  rotations.push([x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, 0, 0, 0, 1]);
}
const sub = [];
for (let i = 0; i < cadAll.length / 3; i += 37) sub.push(i);
function medianDistance(M, index, rings = 3) {
  const d = [];
  for (const i of sub) { const p = transformPoint(M, cadAll[3 * i], cadAll[3 * i + 1], cadAll[3 * i + 2]); d.push(index.nearest(p[0], p[1], p[2], rings)[0]); }
  d.sort((a, b) => a - b);
  return d[Math.floor(d.length / 2)];
}
let G = null, bestScore = Infinity;
for (const R of rotations) {
  const rc = transformPoint(R, ...cadBox.center);
  const M = R.slice(); M[12] = simBox.center[0] - rc[0]; M[13] = simBox.center[1] - rc[1]; M[14] = simBox.center[2] - rc[2];
  const s = medianDistance(M, sim0Index, 6);
  if (s < bestScore) { bestScore = s; G = M; }
}
console.log(`coarse orientation: median ${bestScore.toFixed(1)} mm`);

// ---------- 2. surface ICP at qpos0 ----------
for (let it = 0; it < 25; it++) {
  const A = [], B = [], ds = [];
  for (let i = 0; i < cadAll.length / 3; i += 5) {
    const p = transformPoint(G, cadAll[3 * i], cadAll[3 * i + 1], cadAll[3 * i + 2]);
    const [d, j] = sim0Index.nearest(p[0], p[1], p[2], 3);
    if (j < 0) continue;
    ds.push([d, p, [sim0[3 * j], sim0[3 * j + 1], sim0[3 * j + 2]]]);
  }
  ds.sort((a, b) => a[0] - b[0]);
  for (const [, p, q] of ds.slice(0, Math.floor(ds.length * 0.6))) { A.push(...p); B.push(...q); }
  G = mat4mul(kabsch(A, B), G);
}
console.log(`surface ICP at qpos0: median ${medianDistance(G, sim0Index).toFixed(2)} mm`);

// ---------- 3. joint-chain landmark fit ----------
const occByName = (name) => occ.findIndex((o) => o.name === name);
function occCenter(k) {
  const { mn, mx } = productCache.get(occ[k].key).bbox;
  return transformPoint(occ[k].matrix, (mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2);
}
// Actuator -> the joint it drives (docs: system tour actuator ID table + assembly steps).
const LANDMARKS = [
  ['ASV1_200_10X.', 'waist_yaw_joint'],
  ['ASV1_600_02X.', 'left_hip_yaw_joint'], ['ASV1_500_02X.', 'right_hip_yaw_joint'],
  ['ASV1_600_07X.', 'left_knee_joint'], ['ASV1_500_07X.', 'right_knee_joint'],
  ['ASV1_400_17X.', 'left_shoulder_pitch_joint'], ['ASV1_300_17X.', 'right_shoulder_pitch_joint'],
  ['ASV1_400_18X.', 'left_shoulder_roll_joint'], ['ASV1_300_18X.', 'right_shoulder_roll_joint'],
  ['ASV1_400_20X.', 'left_shoulder_yaw_joint'], ['ASV1_300_20X.', 'right_shoulder_yaw_joint'],
  ['ASV1_400_22X.', 'left_elbow_joint'], ['ASV1_300_22X.', 'right_elbow_joint'],
  ['ASV1_400_23X.', 'left_wrist_yaw_joint'], ['ASV1_300_23X.', 'right_wrist_yaw_joint'],
  ['ASV1_600_26B.', 'left_ankle_pitch_joint', 'point'], ['ASV1_500_26B.', 'right_ankle_pitch_joint', 'point'],
];
const lm = [];
for (const [name, joint, kind] of LANDMARKS) {
  const k = occByName(name);
  if (k < 0) throw new Error(`landmark part ${name} missing`);
  lm.push({ name, joint, kind: kind ?? 'line', cad: occCenter(k) });
}
// Pelvis pairs: hip pitch (A6416) and hip roll (A5013); sides by +Y after the current G.
for (const [a, b, suffix] of [['ASV1_200_11X.', 'ASV1_200_12X.', 'hip_pitch_joint'], ['ASV1_200_13X.', 'ASV1_200_14X.', 'hip_roll_joint']]) {
  const ca = occCenter(occByName(a)), cb = occCenter(occByName(b));
  const leftA = transformPoint(G, ...ca)[1] > transformPoint(G, ...cb)[1];
  lm.push({ name: leftA ? a : b, joint: `left_${suffix}`, kind: 'line', cad: leftA ? ca : cb });
  lm.push({ name: leftA ? b : a, joint: `right_${suffix}`, kind: 'line', cad: leftA ? cb : ca });
}
// Joints whose CAD angle is solved (every one constrained by a downstream landmark).
const FIT_JOINTS = ['waist_yaw_joint',
  'left_hip_pitch_joint', 'left_hip_roll_joint', 'left_knee_joint',
  'right_hip_pitch_joint', 'right_hip_roll_joint', 'right_knee_joint',
  'left_shoulder_pitch_joint', 'left_shoulder_roll_joint', 'left_shoulder_yaw_joint', 'left_elbow_joint',
  'right_shoulder_pitch_joint', 'right_shoulder_roll_joint', 'right_shoulder_yaw_joint', 'right_elbow_joint'];
function axisMat([kx, ky, kz], th) {
  const c = Math.cos(th), s = Math.sin(th), v = 1 - c;
  return [c + kx * kx * v, ky * kx * v + kz * s, kz * kx * v - ky * s, 0, kx * ky * v - kz * s, c + ky * ky * v, kz * ky * v + kx * s, 0, kx * kz * v + ky * s, ky * kz * v - kx * s, c + kz * kz * v, 0, 0, 0, 0, 1];
}
function smallTransform(x) {
  const th = Math.hypot(x[0], x[1], x[2]);
  const R = th > 0 ? axisMat([x[0] / th, x[1] / th, x[2] / th], th) : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  R[12] = x[3]; R[13] = x[4]; R[14] = x[5];
  return R;
}
function offsetsFrom(params) {
  const o = ZERO.slice();
  FIT_JOINTS.forEach((n, i) => (o[fk.jointIndex.get(n)] = params[6 + i]));
  return o;
}
function residuals(Gm, offsets) {
  const W = fk.world(offsets);
  const out = [];
  for (const l of lm) {
    const p = transformPoint(Gm, ...l.cad);
    const { point, axis } = fk.jointLine(W, l.joint);
    const d = [p[0] - point[0], p[1] - point[1], p[2] - point[2]];
    if (l.kind === 'point') { out.push(...d.map((v) => v * 1.5)); continue; }
    const dot = d[0] * axis[0] + d[1] * axis[1] + d[2] * axis[2];
    out.push(d[0] - dot * axis[0], d[1] - dot * axis[1], d[2] - dot * axis[2]);
  }
  return out;
}
function landmarkTable(Gm, offsets) {
  const r = residuals(Gm, offsets);
  return lm.map((l, i) => ({ joint: l.joint, part: l.name.replace(/\.$/, ''), errMm: +(Math.hypot(r[3 * i], r[3 * i + 1], r[3 * i + 2]) / (l.kind === 'point' ? 1.5 : 1)).toFixed(2) }));
}
const rms = (t) => Math.sqrt(t.reduce((s, r) => s + r.errMm ** 2, 0) / t.length);
console.log(`landmarks at surface-ICP G, CAD pose = qpos0: RMS ${rms(landmarkTable(G, ZERO)).toFixed(2)} mm`);
let params = new Array(6 + FIT_JOINTS.length).fill(0);
const Gbase = G.slice();
for (let it = 0; it < 80; it++) {
  const r0 = residuals(mat4mul(smallTransform(params), Gbase), offsetsFrom(params));
  const w = r0.map((_, i) => { const k = Math.floor(i / 3); const e = Math.hypot(r0[3 * k], r0[3 * k + 1], r0[3 * k + 2]); return e < 8 ? 1 : 8 / e; });
  const n = params.length;
  const J = [];
  for (let k = 0; k < n; k++) {
    const h = k < 3 ? 1e-6 : k < 6 ? 1e-3 : 1e-6;
    const p2 = params.slice(); p2[k] += h;
    const r = residuals(mat4mul(smallTransform(p2), Gbase), offsetsFrom(p2));
    J.push(r.map((v, i) => (v - r0[i]) / h));
  }
  const A = Array.from({ length: n }, () => new Array(n).fill(0));
  const bv = new Array(n).fill(0);
  for (let i = 0; i < r0.length; i++) for (let a = 0; a < n; a++) {
    if (J[a][i] === 0) continue;
    bv[a] -= J[a][i] * r0[i] * w[i];
    for (let c = 0; c < n; c++) A[a][c] += J[a][i] * J[c][i] * w[i];
  }
  // Mild damping keeps unconstrained joint angles at the reference pose.
  for (let a = 0; a < n; a++) A[a][a] += a < 6 ? 1e-6 : 20;
  const M = A.map((row, i) => [...row, bv[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let q = c; q <= n; q++) M[r][q] -= f * M[c][q]; }
  }
  const dx = M.map((row, i) => row[n] / row[i]);
  params = params.map((v, i) => v + dx[i]);
  if (Math.hypot(...dx) < 1e-10) break;
}
G = mat4mul(smallTransform(params), Gbase);
const qOffsets = offsetsFrom(params);
const Wc = fk.world(qOffsets);
const lmTable = landmarkTable(G, qOffsets);
console.log(`landmarks after joint-chain fit: RMS ${rms(lmTable).toFixed(2)} mm`);
for (const r of lmTable) console.log(`   ${r.joint.padEnd(28)} ${String(r.errMm).padStart(7)} mm   (${r.part})`);
const qCad = Object.fromEntries(fk.hinges.map((h, i) => [h.name, +(h.qpos0 + qOffsets[i]).toFixed(5)]));
console.log('CAD pose minus MJCF reference (deg):');
for (const n of FIT_JOINTS) console.log(`   ${n.padEnd(28)} ${(qOffsets[fk.jointIndex.get(n)] * 180 / Math.PI).toFixed(2).padStart(7)}`);

// ---------- 4. link membership ----------
const cadWorld = occSamples.map((s) => {
  const pts = [];
  for (let i = 0; i < s.length; i += 3) pts.push(transformPoint(G, s[i], s[i + 1], s[i + 2]));
  return pts;
});
function sideOf(k) {
  return transformPoint(G, ...occCenter(k))[1] >= 0 ? 'left' : 'right';
}
/** Documented membership rules. Returns [link, basis] or null. */
function rule(k) {
  const o = occ[k];
  const n = o.name.replace(/\.$/, '');
  const mod = o.path[1]?.product;
  const id = n.match(/^ASV1_\d{3}_(\d{2}[A-Z]?(?:_SS)?)$/)?.[1] ?? null;
  if (mod === 'ASV1_700.' || /^(Head_Board|MediaHat_Board)$/.test(n)) {
    if (['02B', '13X'].includes(id)) return ['neck_yaw_link', 'Torso step 8: bracket 700_02B on neck yaw actuator ID 24 carries neck pitch actuator ID 25'];
    if (id || /Board$/.test(n)) return ['neck_pitch_link', 'Torso steps 8-9: head assembly on neck pitch actuator ID 25'];
    return null;
  }
  if (o.path.length === 2) {
    if (/^ASV1_100_/.test(n) || /^(Battery Switch|RPU FAN|Motion Control Board|XT60F|Power Distribution Board)$/.test(n)) return ['waist_yaw_link', 'Torso steps 1-10: parts fixed in the torso on the waist yaw actuator output (waist plate 100_02A)'];
    if (/^ASV1_[34]00_17X$/.test(n)) return ['waist_yaw_link', 'Arm steps 1 and 13: shoulder pitch actuator body in bracket 04B, bolted to the torso'];
    return null;
  }
  if (mod === 'ASV1_200.') {
    if (['01C', '10X', '16A', '11X', '12X', '03A', '02A', '15C'].includes(id)) return ['pelvis_link', 'Pelvis steps 1-4: pelvis housing, waist yaw actuator body, hip pitch actuators and their mounting rings, cover'];
    if (['04B', '05B', '06C', '07C', '08C', '09C', '09', '13X', '14X'].includes(id)) return [`${sideOf(k)}_hip_pitch_link`, 'Pelvis steps 5-6: hip roll actuator in bracket 04B/05B, which rotates with the hip pitch actuator (stops on 03A/02A)'];
    return null;
  }
  if (mod === 'ASV1_600.' || mod === 'ASV1_500.') {
    const side = mod === 'ASV1_600.' ? 'left' : 'right';
    if (id === '01B') return [`${side}_hip_roll_link`, 'Leg step 7 + pelvis steps 7-8: actuator hub 01B joins the hip yaw actuator output to the hip roll actuator output'];
    if (['02X', '03C', '04C', '14C', '05A', '06A', '07X', '12A', '11X'].includes(id)) return [`${side}_hip_yaw_link`, 'Leg steps 1-6, 8: thigh assembly (hip yaw actuator body, thigh housings, knee actuator body, bearing)'];
    if (['10C', '08A', '09A', '13C', '15X', '16X', '25A'].includes(id)) return [`${side}_knee_link`, 'Leg steps 8-10, 13: calf housing 10C with plates 08A/09A on the knee actuator output, ankle actuators A/B, rear cover, foot pivot plate 25A'];
    if (['17B', '18B', '21X', '22X', '23A_SS', '24A_SS'].includes(id)) return [`${side}_knee_link`, 'Leg steps 10, 13: ankle cranks and push rods; carried by the calf, posed by the linkage model in mechanism views'];
    if (id === '26B') return [`${side}_ankle_pitch_link`, 'Leg step 12: foot pivot cross block between calf-side and foot-side pillow blocks'];
    if (['36A', '37C', '39C', '31X', '19X', '20X'].includes(id)) return [`${side}_ankle_roll_link`, 'Leg step 11: foot plates, D-shaft and lower rod ends'];
    if (['27X', '28X', '29X', '30X'].includes(id)) {
      const { mn, mx } = productCache.get(o.key).bbox;
      const ext = [0, 1, 2].map((q) => mx[q] - mn[q]);
      const thin = ext.indexOf(Math.min(...ext));
      const M = mat4mul(G, o.matrix);
      const pitch = Math.abs(M[thin * 4 + 1]) > Math.abs(M[thin * 4]);
      return [`${side}_${pitch ? 'knee_link' : 'ankle_roll_link'}`, `Leg step 12: 12 mm pillow block with its bore along ${pitch ? 'Y (pitch): bolted to calf-side plate 25A' : 'X (roll): bolted to the foot'}`];
    }
    if (/^(Mirror)?(1602-0032|1600-0515|2920-0001|2806-0005)/.test(n)) return [`${side}_ankle_roll_link`, 'Leg step 11: 6 mm pillow blocks and set-screw collars on the foot D-shaft'];
    return null;
  }
  if (mod === 'ASV1_400.' || mod === 'ASV1_300.') {
    const side = mod === 'ASV1_400.' ? 'left' : 'right';
    if (id === '04B') return ['waist_yaw_link', 'Arm steps 1 and 13: shoulder bracket 04B is bolted to the torso'];
    if (['02A', '03A', '01A'].includes(id)) return [`${side}_shoulder_pitch_link`, 'Arm steps 2 and 7: shoulder base on the shoulder pitch actuator output'];
    if (['13C', '14C', '18X', '20X', '19X', '05A'].includes(id)) return [`${side}_shoulder_roll_link`, 'Arm steps 3-6, 8: upper arm housings 13C/14C with the shoulder roll and shoulder yaw actuator bodies'];
    if (['06B', '15C', '22X', '07A', '08A', '21X'].includes(id)) return [`${side}_shoulder_yaw_link`, 'Arm steps 8-10, 13: elbow housing 15C bolted to the shoulder yaw output plate 06B, elbow actuator body, housing plates'];
    if (['09A', '16C', '10A', '11A', '23X'].includes(id)) return [`${side}_elbow_link`, 'Arm steps 11-12: elbow shaft plate 09A on the elbow actuator output, forearm housing 16C, wrist actuator body'];
    if (id === '12B') return [`${side}_wrist_yaw_link`, 'Arm step 12: wrist output part on the wrist actuator'];
    return null;
  }
  return null;
}
function medianToLink(pts, li, rings) {
  const inv = invertRigid(Wc[links[li].bodyId]);
  const d = pts.map((p) => { const q = transformPoint(inv, p[0], p[1], p[2]); return links[li].index.nearest(q[0], q[1], q[2], rings)[0]; }).sort((a, b) => a - b);
  return d[Math.floor(d.length / 2)];
}
const assignment = occ.map(() => null);
for (let k = 0; k < occ.length; k++) {
  const r = rule(k);
  if (!r) continue;
  const li = L(r[0]);
  assignment[k] = { link: li, phase: 0, basis: r[1], residual: medianToLink(cadWorld[k], li, 3) };
}
// Fasteners and other unruled parts: inherit from the CAD part they sit in. Bolt heads seat on
// plates and housings while their threads go into actuator bodies, so actuators lose ties.
const isFastener = (name) => /^(M\d|M2\.5|18-8)|Insert|Washer|Nut/.test(name);
const p1pts = [], p1link = [], p1actuator = [];
for (let k = 0; k < occ.length; k++) if (assignment[k]) for (const p of cadWorld[k]) { p1pts.push(...p); p1link.push(assignment[k].link); p1actuator.push(/_\d{2}X\.$/.test(occ[k].name) ? 1 : 0); }
const p1index = new VoxelIndex(Float64Array.from(p1pts), 5);
for (let k = 0; k < occ.length; k++) {
  if (assignment[k]) continue;
  const votes = new Map();
  for (const p of cadWorld[k]) {
    const [d, j] = p1index.nearest(p[0], p[1], p[2], 2);
    if (j < 0 || d > 4) continue;
    votes.set(p1link[j], (votes.get(p1link[j]) ?? 0) + (p1actuator[j] ? 0.35 : 1));
  }
  const best = [...votes].sort((a, b) => b[1] - a[1])[0];
  if (best) assignment[k] = { link: best[0], phase: 2, basis: isFastener(occ[k].name) ? 'fastener: follows the plate or housing it clamps' : 'follows the CAD part it is mounted on', residual: medianToLink(cadWorld[k], best[0], 3) };
}
for (let k = 0; k < occ.length; k++) {
  if (assignment[k]) continue;
  const scores = links.map((_, li) => [medianToLink(cadWorld[k], li, 8), li]).sort((a, b) => a[0] - b[0]);
  assignment[k] = { link: scores[0][1], phase: 3, basis: 'nearest simulation link surface (no assembly rule)', residual: scores[0][0] };
}
const phases = [0, 2, 3].map((ph) => assignment.filter((a) => a.phase === ph).length);
console.log(`membership: ${phases[0]} by documented rule, ${phases[1]} inherited from the part they sit in, ${phases[2]} nearest link`);
for (let k = 0; k < occ.length; k++) if (assignment[k].phase === 3) console.log(`   nearest-link: ${occ[k].name} -> ${links[assignment[k].link].body} (${assignment[k].residual.toFixed(1)} mm)`);

console.log('\nlink                         parts  median distance to MJCF link mesh at the CAD pose (mm)');
for (let li = 0; li < links.length; li++) {
  const mine = assignment.map((a, k) => (a.link === li ? k : -1)).filter((k) => k >= 0);
  const res = mine.map((k) => assignment[k].residual).filter(Number.isFinite).sort((a, b) => a - b);
  console.log(`${links[li].body.padEnd(28)} ${String(mine.length).padStart(5)}  ${(res[Math.floor(res.length / 2)] ?? NaN).toFixed(2).padStart(8)}`);
}

// ---------- outputs ----------
const Gm = G.slice(); Gm[12] /= 1000; Gm[13] /= 1000; Gm[14] /= 1000;
writeFileSync(join(OUT, 'registration.json'), JSON.stringify({
  note: 'G maps CAD world (mm) to MuJoCo world (mm). qCad is the CAD assembly pose expressed as MuJoCo joint positions. local maps part vertices (metres) into the part body frame.',
  G, qCad, landmarks: lmTable, landmarkRmsMm: +rms(lmTable).toFixed(3),
  occurrences: occ.map((o, k) => {
    const a = assignment[k];
    const B = Wc[links[a.link].bodyId].slice(); B[12] /= 1000; B[13] /= 1000; B[14] /= 1000;
    const Mm = o.matrix.slice(); Mm[12] /= 1000; Mm[13] /= 1000; Mm[14] /= 1000;
    const local = mat4mul(invertRigid(B), mat4mul(Gm, Mm));
    return {
      i: k, key: o.key, name: o.name, path: o.path,
      link: links[a.link].body, phase: a.phase, basis: a.basis,
      confidence: a.phase === 0 ? 'documented' : a.phase === 2 ? 'inherited' : 'nearest-link',
      residualMm: Number.isFinite(a.residual) ? +a.residual.toFixed(3) : null,
      local: local.map((v) => +v.toFixed(9)),
    };
  }),
}, null, 1));
console.log('wrote registration.json');
