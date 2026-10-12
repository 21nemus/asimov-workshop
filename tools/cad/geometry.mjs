// Geometry helpers for CAD registration: product mesh loading, surface sampling,
// a voxel-hash nearest-neighbour index and rigid (Kabsch) fitting.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function loadProductMesh(meshDir, key) {
  const meta = JSON.parse(readFileSync(join(meshDir, `${key}.json`), 'utf8'));
  const bin = readFileSync(join(meshDir, `${key}.bin`));
  const parts = meta.meshes.map((m) => ({
    color: m.color, faces: m.faces,
    positions: new Float32Array(bin.buffer.slice(bin.byteOffset + m.positions[0], bin.byteOffset + m.positions[0] + m.positions[1])),
    normals: new Float32Array(bin.buffer.slice(bin.byteOffset + m.normals[0], bin.byteOffset + m.normals[0] + m.normals[1])),
    index: new Uint32Array(bin.buffer.slice(bin.byteOffset + m.indices[0], bin.byteOffset + m.indices[0] + m.indices[1])),
  }));
  return { meta, parts };
}

export function transformPoint(m, x, y, z) {
  return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
}

/** Area-uniform samples on triangles: about one point per `density` square units, at least `minPts`. */
export function sampleSurface(positions, index, density, rand, minPts = 32, maxPts = 4000) {
  const nt = index.length / 3;
  const areas = new Float64Array(nt);
  let total = 0;
  for (let t = 0; t < nt; t++) {
    const a = 3 * index[3 * t], b = 3 * index[3 * t + 1], c = 3 * index[3 * t + 2];
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const area = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    total += area;
    areas[t] = total;
  }
  const n = Math.max(minPts, Math.min(maxPts, Math.round(total / density)));
  const out = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = rand() * total;
    let lo = 0, hi = nt - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (areas[mid] < r) lo = mid + 1; else hi = mid; }
    const t = lo;
    const a = 3 * index[3 * t], b = 3 * index[3 * t + 1], c = 3 * index[3 * t + 2];
    let u = rand(), v = rand();
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    for (let k = 0; k < 3; k++) out[3 * i + k] = positions[a + k] + u * (positions[b + k] - positions[a + k]) + v * (positions[c + k] - positions[a + k]);
  }
  return { points: out, area: total };
}

export class VoxelIndex {
  constructor(points, cell) {
    this.cell = cell;
    this.points = points;
    this.map = new Map();
    for (let i = 0; i < points.length / 3; i++) {
      const key = this.key(points[3 * i], points[3 * i + 1], points[3 * i + 2]);
      let list = this.map.get(key);
      if (!list) { list = []; this.map.set(key, list); }
      list.push(i);
    }
  }
  key(x, y, z) { return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)},${Math.floor(z / this.cell)}`; }
  /** Nearest point within `rings` cells; returns [distance, index] or [Infinity, -1]. */
  nearest(x, y, z, rings = 2) {
    const cx = Math.floor(x / this.cell), cy = Math.floor(y / this.cell), cz = Math.floor(z / this.cell);
    let best = Infinity, bi = -1;
    for (let dx = -rings; dx <= rings; dx++) for (let dy = -rings; dy <= rings; dy++) for (let dz = -rings; dz <= rings; dz++) {
      const list = this.map.get(`${cx + dx},${cy + dy},${cz + dz}`);
      if (!list) continue;
      for (const i of list) {
        const ex = this.points[3 * i] - x, ey = this.points[3 * i + 1] - y, ez = this.points[3 * i + 2] - z;
        const d = ex * ex + ey * ey + ez * ez;
        if (d < best) { best = d; bi = i; }
      }
    }
    return [Math.sqrt(best), bi];
  }
}

/** Kabsch: rigid transform (column-major 4x4) minimising |R a + t - b|^2 for paired point sets. */
export function kabsch(a, b) {
  const n = a.length / 3;
  const ca = [0, 0, 0], cb = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { ca[k] += a[3 * i + k] / n; cb[k] += b[3 * i + k] / n; }
  const H = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) H[r * 3 + c] += (a[3 * i + r] - ca[r]) * (b[3 * i + c] - cb[c]);
  // Rotation from the polar decomposition of H^T via Horn's quaternion method (robust, no SVD needed).
  const [Sxx, Sxy, Sxz, Syx, Syy, Syz, Szx, Szy, Szz] = H;
  const N = [
    [Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx],
    [Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz],
    [Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy],
    [Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz],
  ];
  const q = largestEigenvector4(N);
  const [w, x, y, z] = q;
  const R = [
    1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y),
    2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x),
    2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y),
  ]; // column-major 3x3
  const t = [0, 1, 2].map((k) => cb[k] - (R[k] * ca[0] + R[3 + k] * ca[1] + R[6 + k] * ca[2]));
  return [R[0], R[1], R[2], 0, R[3], R[4], R[5], 0, R[6], R[7], R[8], 0, t[0], t[1], t[2], 1];
}

function largestEigenvector4(N) {
  // Power iteration on N + c I (shifted to make it positive definite).
  let shift = 0;
  for (const row of N) shift = Math.max(shift, row.reduce((s, v) => s + Math.abs(v), 0));
  const M = N.map((row, i) => row.map((v, j) => v + (i === j ? shift : 0)));
  let v = [1, 0.1, 0.1, 0.1];
  for (let it = 0; it < 500; it++) {
    const nv = M.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2] + row[3] * v[3]);
    const l = Math.hypot(...nv);
    const next = nv.map((x) => x / l);
    const delta = Math.abs(next[0] - v[0]) + Math.abs(next[1] - v[1]) + Math.abs(next[2] - v[2]) + Math.abs(next[3] - v[3]);
    v = next;
    if (delta < 1e-14) break;
  }
  return v;
}

export function mat4mul(a, b) {
  const r = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let rr = 0; rr < 4; rr++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + rr] * b[c * 4 + k];
    r[c * 4 + rr] = s;
  }
  return r;
}
export function quatToMat(q, t = [0, 0, 0]) {
  const [w, x, y, z] = q;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y), 0,
    2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x), 0,
    2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y), 0,
    t[0], t[1], t[2], 1,
  ];
}
export function invertRigid(m) {
  const r = [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0, 0, 0, 0, 1];
  r[12] = -(r[0] * m[12] + r[4] * m[13] + r[8] * m[14]);
  r[13] = -(r[1] * m[12] + r[5] * m[13] + r[9] * m[14]);
  r[14] = -(r[2] * m[12] + r[6] * m[13] + r[10] * m[14]);
  return r;
}
export function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
