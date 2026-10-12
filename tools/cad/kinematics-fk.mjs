// Forward kinematics over src/data/kinematics.json (MuJoCo compile of the MJCF), in
// millimetres, for the registration tools. World pose of body b:
//   W_b = W_parent * T(pos) * R(quat) * R(axis, q - qpos0)   (all hinges have pos = 0)
import { mat4mul, quatToMat } from './geometry.mjs';

export function axisAngleMat(axis, angle) {
  const [x, y, z] = axis;
  const l = Math.hypot(x, y, z);
  const kx = x / l, ky = y / l, kz = z / l;
  const c = Math.cos(angle), s = Math.sin(angle), v = 1 - c;
  return [
    c + kx * kx * v, ky * kx * v + kz * s, kz * kx * v - ky * s, 0,
    kx * ky * v - kz * s, c + ky * ky * v, kz * ky * v + kx * s, 0,
    kx * kz * v + ky * s, ky * kz * v - kx * s, c + kz * kz * v, 0,
    0, 0, 0, 1,
  ];
}

export class Fk {
  constructor(kin) {
    this.kin = kin;
    this.hinges = kin.bodies.flatMap((b) => b.joints.filter((j) => j.type === 'hinge').map((j) => ({ ...j, body: b.id })));
    for (const h of this.hinges) if (h.pos.some((v) => Math.abs(v) > 1e-9)) throw new Error(`joint ${h.name} has a non-zero pos; extend Fk`);
    this.jointIndex = new Map(this.hinges.map((h, i) => [h.name, i]));
  }

  /** World matrices (mm) for all bodies. `offsets[i]` is q - qpos0 for hinge i; root pose from the MJCF qpos0. */
  world(offsets) {
    const W = new Array(this.kin.bodies.length);
    W[0] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    for (const b of this.kin.bodies) {
      if (b.id === 0) continue;
      let local = quatToMat(b.quat, b.pos.map((v) => v * 1000));
      const h = b.joints.find((j) => j.type === 'hinge');
      if (h) local = mat4mul(local, axisAngleMat(h.axis, offsets[this.jointIndex.get(h.name)] ?? 0));
      W[b.id] = mat4mul(W[b.parent], local);
    }
    return W;
  }

  /** World point and unit axis direction of a hinge for the given offsets. */
  jointLine(W, name) {
    const h = this.hinges[this.jointIndex.get(name)];
    const M = W[h.body];
    const a = h.axis;
    const d = [M[0] * a[0] + M[4] * a[1] + M[8] * a[2], M[1] * a[0] + M[5] * a[1] + M[9] * a[2], M[2] * a[0] + M[6] * a[1] + M[10] * a[2]];
    const l = Math.hypot(...d);
    return { point: [M[12], M[13], M[14]], axis: d.map((v) => v / l) };
  }
}
