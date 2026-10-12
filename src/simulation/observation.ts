// The 78-value observation, built exactly as the upstream viewer builds it
// (observationHelpers.js @0c21078): same terms, same order, same float32 storage points, and
// projected gravity with three.js r151's quaternion arithmetic (the version upstream ships),
// so identical physics states give bit-identical observations.
import type { PolicyContract } from './contract.ts';

export interface PolicyState {
  jointPos: Float32Array;
  jointVel: Float32Array;
  rootQuat: Float32Array; // w, x, y, z (float32, as upstream)
  rootAngVel: Float32Array; // body-frame angular velocity (qvel[3..5])
}

export interface Command {
  vx: number;
  vy: number;
  wz: number;
}

/** (0, 0, -1) rotated by the inverse of q, three r151 Vector3.applyQuaternion + Quaternion.invert. */
export function projectedGravity(q: Float32Array, out: Float32Array, offset: number): void {
  // Quaternion(x, y, z, w).invert() is conjugate(): (-x, -y, -z, w), no normalisation.
  const qx = -q[1], qy = -q[2], qz = -q[3], qw = q[0];
  const x = 0, y = 0, z = -1;
  const ix = qw * x + qy * z - qz * y;
  const iy = qw * y + qz * x - qx * z;
  const iz = qw * z + qx * y - qy * x;
  const iw = -qx * x - qy * y - qz * z;
  out[offset] = ix * qw + iw * -qx + iy * -qz - iz * -qy;
  out[offset + 1] = iy * qw + iw * -qy + iz * -qx - ix * -qz;
  out[offset + 2] = iz * qw + iw * -qz + ix * -qy - iy * -qx;
}

export function buildObservation(c: PolicyContract, defaultPose: Float32Array, s: PolicyState, cmd: Command, lastActions: Float32Array, out: Float32Array): void {
  let o = 0;
  for (const term of c.observation.recipe) {
    switch (term.name) {
      case 'AsimovAngVel': {
        const k = term.scale ?? 0.25;
        out[o] = s.rootAngVel[0] * k; out[o + 1] = s.rootAngVel[1] * k; out[o + 2] = s.rootAngVel[2] * k;
        o += 3;
        break;
      }
      case 'AsimovProjectedGravity':
        projectedGravity(s.rootQuat, out, o);
        o += 3;
        break;
      case 'AsimovCommand':
        out[o] = cmd.vx; out[o + 1] = cmd.vy; out[o + 2] = cmd.wz;
        o += 3;
        break;
      case 'AsimovJointPosSlot':
        for (const idx of term.indices!) out[o++] = (s.jointPos[idx] ?? 0) - (defaultPose[idx] ?? 0);
        break;
      case 'AsimovJointVelSlot': {
        const k = term.scale ?? 0.1;
        for (const idx of term.indices!) out[o++] = (s.jointVel[idx] ?? 0) * k;
        break;
      }
      case 'AsimovPrevActions':
        out.set(lastActions, o);
        o += lastActions.length;
        break;
      default:
        throw new Error(`unsupported observation term ${term.name}`);
    }
  }
  if (o !== c.observation.size) throw new Error(`observation built ${o} values, expected ${c.observation.size}`);
}
