#!/usr/bin/env node
// Measures Asimov 1's RSU ankle linkage from the published CAD and writes the mechanism model
// the ankle microscope uses (src/data/ankle-linkage.json).
//
// Inputs: the tessellated CAD products (tools/.cache/cad/mesh, from tessellate.mjs), the
// registration (tools/.cache/cad/registration.json: each occurrence's CAD-to-body transform)
// and the simulation kinematics (src/data/kinematics.json).
//
// All calf-side and foot-side parts carry rigid CAD-to-body transforms derived from one global
// fit with the ankle at zero, so at zero ankle angles their relative positions are exactly the
// CAD's. Everything is therefore expressed in the calf (knee link) frame at zero ankle angles.
//
// Measured features (CAD DERIVED):
//  - ball-joint centres of the four rod ends: least-squares sphere fit (RANSAC seeded) on the
//    spherical faces of each rod-end mesh;
//  - actuator axes: circle fit on the cylindrical housing faces (normals perpendicular to the
//    axis), axis direction from the product's own frame;
//  - U-joint axes of the cross block: circle fits on its bores/trunnions about each axis.
//
// The model then solves the exact loop closure (rigid links, ideal joints) and compares it with
// the small-angle mapping published in Menlo's docs.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProductMesh, transformPoint, lcg } from './cad/geometry.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MESH = join(root, 'tools/.cache/cad/mesh');
const REG = JSON.parse(readFileSync(join(root, 'tools/.cache/cad/registration.json'), 'utf8'));
const PARTS = JSON.parse(readFileSync(join(root, 'public/robot/parts.json'), 'utf8')).parts;
const KIN = JSON.parse(readFileSync(join(root, 'src/data/kinematics.json'), 'utf8'));

// ---------- small vector helpers ----------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => mul(a, 1 / norm(a));
/** Rodrigues rotation of v about unit axis u by angle t. */
const rot = (v, u, t) => add(add(mul(v, Math.cos(t)), mul(cross(u, v), Math.sin(t))), mul(u, dot(u, v) * (1 - Math.cos(t))));
const round = (v, d = 6) => (Array.isArray(v) ? v.map((x) => +x.toFixed(d)) : +v.toFixed(d));

// ---------- geometry loading ----------
function occurrence(i) {
  const o = REG.occurrences.find((x) => x.i === i);
  if (!o) throw new Error(`no occurrence for part ${i}`);
  return o;
}

/** Vertices and normals of a part, in its body frame (metres). */
function partGeometry(i) {
  const o = occurrence(i);
  const { parts } = loadProductMesh(MESH, o.key);
  const L = o.local;
  const pts = [], nrm = [], mesh = [];
  for (const [mi, p] of parts.entries()) {
    for (let k = 0; k < p.positions.length; k += 3) {
      mesh.push(mi);
      // Tessellated products are in millimetres; the CAD-to-body transforms take metres.
      pts.push(transformPoint(L, p.positions[k] * 1e-3, p.positions[k + 1] * 1e-3, p.positions[k + 2] * 1e-3));
      const n = [L[0] * p.normals[k] + L[4] * p.normals[k + 1] + L[8] * p.normals[k + 2], L[1] * p.normals[k] + L[5] * p.normals[k + 1] + L[9] * p.normals[k + 2], L[2] * p.normals[k] + L[6] * p.normals[k + 1] + L[10] * p.normals[k + 2]];
      nrm.push(unit(n));
    }
  }
  return { pts, nrm, mesh, local: L };
}

// ---------- fitting ----------
/** Algebraic sphere through 4 points (null if degenerate). */
function sphere4(p) {
  // |x|^2 + D x + E y + F z + G = 0
  const A = p.map((q) => [q[0], q[1], q[2], 1]);
  const b = p.map((q) => -(q[0] * q[0] + q[1] * q[1] + q[2] * q[2]));
  const s = solve(A, b);
  if (!s) return null;
  const c = [-s[0] / 2, -s[1] / 2, -s[2] / 2];
  const r2 = dot(c, c) - s[3];
  return r2 > 0 ? { c, r: Math.sqrt(r2) } : null;
}

function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-18) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** Least-squares sphere (linear form) over points. */
function sphereLsq(pts) {
  // Normal equations for [D E F G].
  const AtA = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
  const Atb = [0, 0, 0, 0];
  for (const q of pts) {
    const row = [q[0], q[1], q[2], 1];
    const bb = -(q[0] * q[0] + q[1] * q[1] + q[2] * q[2]);
    for (let i = 0; i < 4; i++) { Atb[i] += row[i] * bb; for (let j = 0; j < 4; j++) AtA[i][j] += row[i] * row[j]; }
  }
  const s = solve(AtA, Atb);
  const c = [-s[0] / 2, -s[1] / 2, -s[2] / 2];
  return { c, r: Math.sqrt(dot(c, c) - s[3]) };
}

/**
 * The ball of a rod end: the largest set of vertices on one sphere whose normals point along the
 * radius (that excludes flat and cylindrical faces), radius between rMin and rMax.
 */
/**
 * The ball of a rod end. In the CAD each rod end is two solids, the eye housing and the ball
 * (a sphere with a through-bore). The ball solid is symmetric about its centre, so its vertex
 * centroid seeds the fit; a least-squares sphere through its spherical vertices refines it. The
 * solid whose vertices best fit one sphere of plausible radius is taken as the ball.
 */
function fitBall(geo, rMin = 0.004, rMax = 0.009) {
  let best = null;
  const meshes = [...new Set(geo.mesh)];
  for (const mi of meshes) {
    const pts = geo.pts.filter((_, k) => geo.mesh[k] === mi);
    const c0 = mul(pts.reduce((a, p) => add(a, p), [0, 0, 0]), 1 / pts.length);
    const ds = pts.map((p) => norm(sub(p, c0))).sort((a, b) => a - b);
    const rMax0 = ds[ds.length - 1];
    if (rMax0 < rMin || rMax0 > rMax) continue;
    // Spherical vertices are the outermost ones (the bore lies inside the sphere).
    const shell = pts.filter((p) => norm(sub(p, c0)) > rMax0 - 2e-4);
    const fit = sphereLsq(shell);
    const rms = Math.sqrt(shell.reduce((a, p) => a + (norm(sub(p, fit.c)) - fit.r) ** 2, 0) / shell.length);
    if (!best || shell.length > best.inliers) best = { center: fit.c, radius: fit.r, inliers: shell.length, rmsMm: rms * 1000 };
  }
  if (!best) throw new Error('no ball found');
  return best;
}

/**
 * Axis of a cylindrical feature with known direction u: vertices whose normals are perpendicular
 * to u, projected on the plane normal to u, give circles; the most supported circle (radius in
 * range) gives the axis line.
 */
function fitAxis(geo, u, rMin, rMax, near) {
  const rand = lcg(11);
  const e1 = unit(Math.abs(u[0]) < 0.9 ? cross(u, [1, 0, 0]) : cross(u, [0, 1, 0]));
  const e2 = cross(u, e1);
  const cand = [];
  geo.pts.forEach((p, k) => {
    if (Math.abs(dot(geo.nrm[k], u)) > 0.02) return;
    if (near && norm(sub(p, near.point)) > near.radius) return;
    cand.push({ x: dot(p, e1), y: dot(p, e2), nx: dot(geo.nrm[k], e1), ny: dot(geo.nrm[k], e2), along: dot(p, u) });
  });
  let best = null;
  for (let it = 0; it < 3000 && cand.length > 3; it++) {
    // Two points plus their normals define a circle centre (normal lines intersect at it).
    const a = cand[Math.floor(rand() * cand.length)], b = cand[Math.floor(rand() * cand.length)];
    const det = a.nx * -b.ny - a.ny * -b.nx;
    if (Math.abs(det) < 0.2) continue;
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = (dx * -b.ny - dy * -b.nx) / det;
    const cx = a.x + t * a.nx, cy = a.y + t * a.ny;
    const r = Math.hypot(a.x - cx, a.y - cy);
    if (r < rMin || r > rMax) continue;
    let count = 0;
    for (const q of cand) if (Math.abs(Math.hypot(q.x - cx, q.y - cy) - r) < 3e-5) count++;
    if (!best || count > best.count) best = { cx, cy, r, count };
  }
  if (!best) throw new Error('no cylinder found');
  // Refine: algebraic circle fit on inliers.
  const inl = cand.filter((q) => Math.abs(Math.hypot(q.x - best.cx, q.y - best.cy) - best.r) < 5e-5);
  const AtA = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], Atb = [0, 0, 0];
  for (const q of inl) {
    const row = [q.x, q.y, 1], bb = -(q.x * q.x + q.y * q.y);
    for (let i = 0; i < 3; i++) { Atb[i] += row[i] * bb; for (let j = 0; j < 3; j++) AtA[i][j] += row[i] * row[j]; }
  }
  const s = solve(AtA, Atb);
  const cx = -s[0] / 2, cy = -s[1] / 2, r = Math.sqrt(cx * cx + cy * cy - s[2]);
  const mid = inl.reduce((a, q) => a + q.along, 0) / inl.length;
  const point = add(add(mul(e1, cx), mul(e2, cy)), mul(u, mid));
  const rms = Math.sqrt(inl.reduce((a, q) => a + (Math.hypot(q.x - cx, q.y - cy) - r) ** 2, 0) / inl.length);
  return { point, dir: u, radius: r, inliers: inl.length, rmsMm: rms * 1000 };
}

// ---------- frames ----------
const body = (name) => KIN.bodies.find((b) => b.name === name);
/** Foot-frame point -> calf (knee link) frame at zero ankle angles (bodies carry identity quats). */
function chainOffset(side) {
  const p = body(`${side}_ankle_pitch_link`), r = body(`${side}_ankle_roll_link`);
  for (const b of [p, r]) if (b.quat.some((q, k) => Math.abs(q - (k === 0 ? 1 : 0)) > 1e-9)) throw new Error(`${b.name} has a rotated frame; extend chainOffset`);
  return { pitch: p.pos, roll: add(p.pos, r.pos) };
}

function findPart(module, suffix) {
  const p = PARTS.find((q) => q.module === module && q.partNumber === `ASV1_${module.slice(5)}_${suffix}`);
  if (!p) throw new Error(`missing ${module} ${suffix}`);
  return p;
}

// ---------- mechanism ----------
function measureLeg(side) {
  const module = side === 'left' ? 'ASV1_600' : 'ASV1_500';
  const off = chainOffset(side);
  const toCalf = (p, b) => (b.endsWith('knee_link') ? p : b.endsWith('pitch_link') ? add(p, off.pitch) : add(p, off.roll));
  const geoOf = (suffix) => { const part = findPart(module, suffix); return { part, geo: partGeometry(part.i) }; };
  const out = { side, module, actuators: {} };

  // Rod-end balls. Which rod end belongs to which crank is read off the CAD: each crank-side
  // ball sits on its crank; each foot-side ball is the lower end of the rod from that crank.
  const balls = {};
  for (const s of ['19X', '20X', '21X', '22X']) {
    const { part, geo } = geoOf(s);
    const f = fitBall(geo);
    balls[s] = { part: part.partNumber, body: part.body, centerBody: f.center, center: toCalf(f.center, part.body), radiusMm: f.radius * 1000, inliers: f.inliers, rmsMm: f.rmsMm };
  }
  // Actuators and cranks.
  for (const [name, motorSuffix, crankSuffix] of [['A', '15X', '17B'], ['B', '16X', '18B']]) {
    const { part: motor, geo } = geoOf(motorSuffix);
    // Axis direction: the housing is a cylinder; try the three body axes and keep the one with
    // the best-supported circle of the housing radius (about 28 mm).
    let bestAxis = null;
    for (const u of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
      try {
        const a = fitAxis(geo, u, 0.02, 0.035);
        if (!bestAxis || a.inliers > bestAxis.inliers) bestAxis = a;
      } catch { /* no circle about this axis */ }
    }
    const crank = findPart(module, crankSuffix);
    // The crank-side ball nearest this crank.
    const crankBall = ['21X', '22X'].map((s) => balls[s]).sort((a, b) => norm(sub(a.center, crank.center.map((v) => v))) - norm(sub(b.center, crank.center)))[0];
    out.actuators[name] = { motor: motor.partNumber, crank: crank.partNumber, axisPoint: bestAxis.point, axisDir: bestAxis.dir, housingRadiusMm: bestAxis.radius * 1000, axisInliers: bestAxis.inliers, axisRmsMm: bestAxis.rmsMm, crankBall: crankBall.part, b0: crankBall.center };
  }
  // Pair each crank ball with its foot-side ball (the rod runs between them; the nearest in y).
  for (const name of ['A', 'B']) {
    const a = out.actuators[name];
    const foot = ['19X', '20X'].map((s) => balls[s]).sort((p, q) => Math.abs(p.center[1] - a.b0[1]) - Math.abs(q.center[1] - a.b0[1]))[0];
    a.footBall = foot.part;
    a.f0 = foot.center;
    a.rodLength = norm(sub(a.b0, a.f0));
    const v = sub(a.b0, a.axisPoint);
    a.crankRadius = norm(sub(v, mul(a.axisDir, dot(v, a.axisDir))));
  }
  out.balls = balls;

  // U-joint: the cross block's two axes (pitch about body y, roll about body x).
  const { part: crossPart, geo: crossGeo } = geoOf('26B');
  const pitchAxis = fitAxis(crossGeo, [0, 1, 0], 0.003, 0.012);
  const rollAxis = fitAxis(crossGeo, [1, 0, 0], 0.003, 0.012);
  const pitchPt = toCalf(pitchAxis.point, crossPart.body), rollPt = toCalf(rollAxis.point, crossPart.body);
  out.ujoint = {
    part: crossPart.partNumber,
    pitch: { point: pitchPt, dir: [0, 1, 0], radiusMm: pitchAxis.radius * 1000, inliers: pitchAxis.inliers, rmsMm: pitchAxis.rmsMm },
    roll: { point: rollPt, dir: [1, 0, 0], radiusMm: rollAxis.radius * 1000, inliers: rollAxis.inliers, rmsMm: rollAxis.rmsMm },
    // Shortest distance between the two axis lines (0 for a true U-joint cross).
    axisOffsetMm: Math.abs(pitchPt[2] - rollPt[2]) * 1000,
  };
  const pj = body(`${side}_ankle_pitch_link`).joints[0], rj = body(`${side}_ankle_roll_link`).joints[0];
  out.mjcf = { pitchAxis: pj.axis, rollAxis: rj.axis, pitchPoint: off.pitch, rollPoint: off.roll, pitchRange: pj.range, rollRange: rj.range };
  return out;
}

/**
 * Exact inverse kinematics: ankle (pitch, roll) in MJCF joint convention -> actuator angles.
 * Pitch rotates about the CAD pitch axis, then roll about the CAD roll axis carried by it.
 * Actuator angles are right-handed about the actuator axis as fitted (positive about +x of the
 * calf frame, i.e. toward the front), zero in the CAD pose.
 */
function makeModel(m) {
  const sgnP = m.mjcf.pitchAxis[1]; // MJCF pitch axis is +y (left) or -y (right)
  const sgnR = m.mjcf.rollAxis[0]; // MJCF roll axis is -x on both legs
  const P = m.ujoint.pitch.point, Rp = [m.ujoint.roll.point[0], m.ujoint.roll.point[1], m.ujoint.roll.point[2]];
  const footPoint = (f0, pitch, roll) => {
    // Roll about the roll axis (through Rp), then pitch about the pitch axis (through P).
    let v = add(Rp, rot(sub(f0, Rp), [1, 0, 0], sgnR * roll));
    v = add(P, rot(sub(v, P), [0, 1, 0], sgnP * pitch));
    return v;
  };
  const ik = (pitch, roll, prev = { A: 0, B: 0 }) => {
    const out = {};
    for (const name of ['A', 'B']) {
      const a = m.actuators[name];
      const f = footPoint(a.f0, pitch, roll);
      const u = a.axisDir;
      const vRaw = sub(a.b0, a.axisPoint);
      const v = sub(vRaw, mul(u, dot(vRaw, u)));
      const o = add(a.axisPoint, mul(u, dot(vRaw, u)));
      const w = sub(f, o);
      const L = a.rodLength;
      const K = (dot(v, v) + dot(w, w) - L * L) / 2;
      const p = dot(w, v), q = dot(w, cross(u, v));
      const R = Math.hypot(p, q);
      if (Math.abs(K) > R) return null;
      const base = Math.atan2(q, p), d = Math.acos(K / R);
      const c1 = base + d, c2 = base - d;
      const wrap = (x) => Math.atan2(Math.sin(x), Math.cos(x));
      out[name] = Math.abs(wrap(c1 - prev[name])) < Math.abs(wrap(c2 - prev[name])) ? wrap(c1) : wrap(c2);
    }
    return out;
  };
  return { ik, footPoint };
}

const result = { generated: 'tools/measure-ankle.mjs', units: 'metres and radians unless noted', frame: 'calf (knee link) body frame at zero ankle angles, MuJoCo axes: x forward, y left, z up', legs: {} };
for (const side of ['left', 'right']) {
  const m = measureLeg(side);
  const model = makeModel(m);
  // Jacobian at zero by central differences; its inverse is the exact small-angle mapping.
  const h = 1e-5;
  const dP = model.ik(h, 0), dPm = model.ik(-h, 0), dR = model.ik(0, h), dRm = model.ik(0, -h);
  const J = [[(dP.A - dPm.A) / (2 * h), (dR.A - dRm.A) / (2 * h)], [(dP.B - dPm.B) / (2 * h), (dR.B - dRm.B) / (2 * h)]];
  const det = J[0][0] * J[1][1] - J[0][1] * J[1][0];
  const Jinv = [[J[1][1] / det, -J[0][1] / det], [-J[1][0] / det, J[0][0] / det]];
  // Docs quantities measured on the CAD.
  const r = (m.actuators.A.crankRadius + m.actuators.B.crankRadius) / 2;
  const fMid = mul(add(m.actuators.A.f0, m.actuators.B.f0), 0.5);
  const d = Math.hypot(fMid[0] - m.ujoint.pitch.point[0], fMid[2] - m.ujoint.pitch.point[2]);
  const c = norm(sub(m.actuators.A.f0, m.actuators.B.f0));
  // Sweep over the documented range: exact vs the docs' linear mapping (AB -> PR) with CAD r, d, c.
  const docs = (A, B) => ({ pitch: (A - B) * (r / (2 * d)), roll: -(A + B) * (r / c) });
  let worst = { pitch: 0, roll: 0, at: null }, reach = true;
  const grid = [];
  for (let i = -7; i <= 7; i++) for (let j = -4; j <= 4; j++) {
    const pitch = (0.35 * i) / 7, roll = (0.1 * j) / 4;
    const s = model.ik(pitch, roll);
    if (!s) { reach = false; continue; }
    const lin = docs(s.A, s.B);
    const ep = Math.abs(lin.pitch - pitch), er = Math.abs(lin.roll - roll);
    if (ep + er > worst.pitch + worst.roll) worst = { pitch: ep, roll: er, at: [pitch, roll] };
    grid.push([round(pitch, 4), round(roll, 4), round(s.A, 5), round(s.B, 5)]);
  }
  result.legs[side] = {
    ...m,
    derived: {
      crankRadiusMm: round(r * 1000, 2), pivotToBarMm: round(d * 1000, 2), barEndpointsMm: round(c * 1000, 2),
      rodLengthMm: { A: round(m.actuators.A.rodLength * 1000, 2), B: round(m.actuators.B.rodLength * 1000, 2) },
      jacobianAB_per_PR: J.map((row) => round(row, 4)),
      exactSmallAngle_PR_per_AB: Jinv.map((row) => round(row, 4)),
      docsFormula_PR_per_AB: [[round(r / (2 * d), 4), round(-r / (2 * d), 4)], [round(-r / c, 4), round(-r / c, 4)]],
      docsFormulaWorstErrorRad: { pitch: round(worst.pitch, 4), roll: round(worst.roll, 4), at: worst.at },
      reachableOverDocumentedRange: reach,
    },
    grid,
  };
  console.log(`\n== ${side} leg`);
  console.log('balls', Object.fromEntries(Object.entries(m.balls).map(([k, b]) => [k, `${b.center.map((v) => (v * 1000).toFixed(2)).join(', ')} mm r ${b.radiusMm.toFixed(2)} (${b.inliers} pts, rms ${b.rmsMm.toFixed(3)} mm)`])));
  for (const n of ['A', 'B']) { const a = m.actuators[n]; console.log(n, a.motor, 'axis', a.axisPoint.map((v) => (v * 1000).toFixed(2)).join(', '), 'dir', a.axisDir.join(','), 'housing r', a.housingRadiusMm.toFixed(2), 'crank r', (a.crankRadius * 1000).toFixed(2), 'rod', (a.rodLength * 1000).toFixed(2), a.crankBall, '->', a.footBall); }
  console.log('ujoint pitch', m.ujoint.pitch.point.map((v) => (v * 1000).toFixed(2)).join(', '), 'r', m.ujoint.pitch.radiusMm.toFixed(2), '| roll', m.ujoint.roll.point.map((v) => (v * 1000).toFixed(2)).join(', '), 'r', m.ujoint.roll.radiusMm.toFixed(2), '| axis offset', m.ujoint.axisOffsetMm.toFixed(2), 'mm');
  console.log('mjcf pitch point', m.mjcf.pitchPoint.map((v) => (v * 1000).toFixed(2)).join(', '), 'roll point', m.mjcf.rollPoint.map((v) => (v * 1000).toFixed(2)).join(', '));
  console.log('derived', JSON.stringify(result.legs[side].derived));
}
writeFileSync(join(root, 'src/data/ankle-linkage.json'), JSON.stringify(result, (k, v) => (typeof v === 'number' ? +v.toFixed(7) : v), 0));
console.log('\nwrote src/data/ankle-linkage.json');
