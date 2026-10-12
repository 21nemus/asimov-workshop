// Mesh helpers shared by the asset builders: binary STL reading, vertex welding,
// meshoptimizer simplification and normal generation. Positions stay in the frame
// and units they came in; callers decide transforms.
import { readFileSync } from 'node:fs';
import { MeshoptSimplifier } from 'meshoptimizer';

export async function readyMeshopt() { await MeshoptSimplifier.ready; return MeshoptSimplifier; }

/** Binary STL -> non-indexed Float32 positions. Throws on ASCII STL. */
export function readBinaryStl(path) {
  const buf = readFileSync(path);
  const count = buf.readUInt32LE(80);
  if (84 + count * 50 !== buf.length) throw new Error(`${path}: not a binary STL (size mismatch)`);
  const pos = new Float32Array(count * 9);
  for (let i = 0; i < count; i++) {
    const o = 84 + i * 50 + 12;
    for (let k = 0; k < 9; k++) pos[i * 9 + k] = buf.readFloatLE(o + k * 4);
  }
  return pos;
}

/**
 * Welds identical positions (quantised to `eps`) into an indexed mesh. Without `sourceIndex`
 * the input is a triangle soup (every three vertices form a triangle, as in STL); with it,
 * the given triangles are kept and only their vertices are merged.
 */
export function weld(positions, eps = 1e-6, sourceIndex = null) {
  const map = new Map();
  const outPos = [];
  const remap = new Uint32Array(positions.length / 3);
  for (let i = 0; i < positions.length / 3; i++) {
    const x = positions[3 * i], y = positions[3 * i + 1], z = positions[3 * i + 2];
    const key = `${Math.round(x / eps)},${Math.round(y / eps)},${Math.round(z / eps)}`;
    let v = map.get(key);
    if (v === undefined) { v = outPos.length / 3; outPos.push(x, y, z); map.set(key, v); }
    remap[i] = v;
  }
  const index = sourceIndex ? Uint32Array.from(sourceIndex, (i) => remap[i]) : remap;
  // Drop triangles that collapsed during welding.
  const tri = [];
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t], b = index[t + 1], c = index[t + 2];
    if (a !== b && b !== c && a !== c) tri.push(a, b, c);
  }
  return { positions: Float32Array.from(outPos), index: Uint32Array.from(tri) };
}

/**
 * Simplifies an indexed mesh to at most `ratio` of its triangles within `maxError` (absolute,
 * mesh units). `permissive` lets meshoptimizer collapse across seams left by per-face CAD
 * tessellation, which otherwise stall the topology-preserving simplifier.
 */
export function simplify(S, positions, index, { ratio = 0.25, maxError = 0.0005, lockBorder = false, permissive = false } = {}) {
  const target = Math.max(3, Math.floor((index.length * ratio) / 3) * 3);
  const flags = ['ErrorAbsolute'];
  if (lockBorder) flags.push('LockBorder');
  if (permissive) flags.push('Permissive');
  const [out, err] = S.simplify(index, positions, 3, target, maxError, flags);
  return { index: out, error: err };
}

export function boundsExtent(p) {
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[i + k]); mx[k] = Math.max(mx[k], p[i + k]); }
  return Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) || 1;
}

/** Removes unreferenced vertices and remaps the index. */
export function compact(positions, index, extra = []) {
  const remap = new Int32Array(positions.length / 3).fill(-1);
  let n = 0;
  for (const v of index) if (remap[v] < 0) remap[v] = n++;
  const p = new Float32Array(n * 3);
  const ex = extra.map((e) => new Float32Array(n * e.size));
  for (let v = 0; v < remap.length; v++) {
    const r = remap[v];
    if (r < 0) continue;
    p.set(positions.subarray(3 * v, 3 * v + 3), 3 * r);
    extra.forEach((e, i) => ex[i].set(e.array.subarray(e.size * v, e.size * v + e.size), e.size * r));
  }
  const idx = new Uint32Array(index.length);
  for (let i = 0; i < index.length; i++) idx[i] = remap[index[i]];
  return { positions: p, index: idx, extra: ex };
}

/** Area-weighted vertex normals with a crease angle: vertices are split where faces meet sharper than `creaseDeg`. */
export function creasedNormals(positions, index, creaseDeg = 35) {
  const cosT = Math.cos((creaseDeg * Math.PI) / 180);
  const nt = index.length / 3;
  const fn = new Float32Array(nt * 3);
  for (let t = 0; t < nt; t++) {
    const a = index[3 * t], b = index[3 * t + 1], c = index[3 * t + 2];
    const ax = positions[3 * a], ay = positions[3 * a + 1], az = positions[3 * a + 2];
    const ux = positions[3 * b] - ax, uy = positions[3 * b + 1] - ay, uz = positions[3 * b + 2] - az;
    const vx = positions[3 * c] - ax, vy = positions[3 * c + 1] - ay, vz = positions[3 * c + 2] - az;
    fn[3 * t] = uy * vz - uz * vy; fn[3 * t + 1] = uz * vx - ux * vz; fn[3 * t + 2] = ux * vy - uy * vx;
  }
  // Faces around each vertex.
  const nv = positions.length / 3;
  const counts = new Uint32Array(nv + 1);
  for (const v of index) counts[v + 1]++;
  for (let v = 0; v < nv; v++) counts[v + 1] += counts[v];
  const faces = new Uint32Array(index.length);
  const fill = counts.slice();
  for (let i = 0; i < index.length; i++) faces[fill[index[i]]++] = (i / 3) | 0;
  const outPos = [], outNor = [], outIdx = new Uint32Array(index.length);
  const unit = (t) => { const x = fn[3 * t], y = fn[3 * t + 1], z = fn[3 * t + 2]; const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };
  const cornerVertex = new Map();
  for (let i = 0; i < index.length; i++) {
    const v = index[i], t = (i / 3) | 0;
    const nT = unit(t);
    let sx = 0, sy = 0, sz = 0;
    const group = [];
    for (let k = counts[v]; k < counts[v + 1]; k++) {
      const f = faces[k];
      const nf = unit(f);
      if (nf[0] * nT[0] + nf[1] * nT[1] + nf[2] * nT[2] >= cosT) { sx += fn[3 * f]; sy += fn[3 * f + 1]; sz += fn[3 * f + 2]; group.push(f); }
    }
    const l = Math.hypot(sx, sy, sz) || 1;
    const n = [sx / l, sy / l, sz / l];
    const key = `${v}:${Math.round(n[0] * 1e3)},${Math.round(n[1] * 1e3)},${Math.round(n[2] * 1e3)}`;
    let id = cornerVertex.get(key);
    if (id === undefined) { id = outPos.length / 3; outPos.push(positions[3 * v], positions[3 * v + 1], positions[3 * v + 2]); outNor.push(n[0], n[1], n[2]); cornerVertex.set(key, id); }
    outIdx[i] = id;
  }
  return { positions: Float32Array.from(outPos), normals: Float32Array.from(outNor), index: outIdx };
}
