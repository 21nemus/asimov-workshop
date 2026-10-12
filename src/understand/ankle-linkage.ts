// The RSU ankle as built: two actuators in the calf turn cranks, push rods with ball joints at
// both ends carry the motion to a bar on the foot, and the foot swings on a two-axis cross.
// Geometry measured from the published CAD by tools/measure-ankle.mjs (CAD DERIVED); the loop
// closure below is exact for rigid links and ideal joints (no compliance, backlash or clearance).
// Frame: the calf (knee link) body frame at zero ankle angles, MuJoCo axes, metres, radians.
import data from '../data/ankle-linkage.json' with { type: 'json' };

export type V3 = [number, number, number];
export type Side = 'left' | 'right';
export interface AnkleAngles { pitch: number; roll: number }
export interface ActuatorAngles { A: number; B: number }

interface ActuatorGeo {
  motor: string;
  crank: string;
  crankBall: string;
  footBall: string;
  axisPoint: V3;
  axisDir: V3;
  b0: V3;
  f0: V3;
  rodLength: number;
  crankRadius: number;
}

interface LegData {
  actuators: Record<'A' | 'B', ActuatorGeo>;
  balls: Record<string, { part: string; body: string; centerBody: V3; center: V3; radiusMm: number }>;
  ujoint: { part: string; pitch: { point: V3; dir: V3 }; roll: { point: V3; dir: V3 }; axisOffsetMm: number };
  mjcf: { pitchAxis: V3; rollAxis: V3; pitchPoint: V3; rollPoint: V3; pitchRange: [number, number]; rollRange: [number, number] };
  derived: {
    crankRadiusMm: number; pivotToBarMm: number; barEndpointsMm: number; rodLengthMm: { A: number; B: number };
    jacobianAB_per_PR: number[][]; exactSmallAngle_PR_per_AB: number[][]; docsFormula_PR_per_AB: number[][];
    docsFormulaWorstErrorRad: { pitch: number; roll: number; at: [number, number] };
  };
}

export const ANKLE = data as unknown as { legs: Record<Side, LegData> };

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** Rodrigues rotation of v about unit axis u by angle t. */
export const rotate = (v: V3, u: V3, t: number): V3 => add(add(mul(v, Math.cos(t)), mul(cross(u, v), Math.sin(t))), mul(u, dot(u, v) * (1 - Math.cos(t))));
const wrap = (x: number) => Math.atan2(Math.sin(x), Math.cos(x));

export class AnkleLinkage {
  readonly side: Side;
  readonly leg: LegData;

  constructor(side: Side) {
    this.side = side;
    this.leg = ANKLE.legs[side];
  }

  /** Foot point (given at zero) after roll about the CAD roll axis, then pitch about the CAD pitch axis. */
  footPoint(f0: V3, a: AnkleAngles): V3 {
    const { ujoint, mjcf } = this.leg;
    const sP = mjcf.pitchAxis[1], sR = mjcf.rollAxis[0];
    let v = add(ujoint.roll.point, rotate(sub(f0, ujoint.roll.point), [1, 0, 0], sR * a.roll));
    v = add(ujoint.pitch.point, rotate(sub(v, ujoint.pitch.point), [0, 1, 0], sP * a.pitch));
    return v;
  }

  /**
   * Crank angle that puts the crank ball exactly one rod length from foot ball position `f`
   * (circle-sphere intersection), choosing the solution nearest `prev`. Null when unreachable.
   */
  crankFor(name: 'A' | 'B', f: V3, prev = 0): number | null {
    const g = this.leg.actuators[name];
    const u = g.axisDir;
    const raw = sub(g.b0, g.axisPoint);
    const along = dot(raw, u);
    const v = sub(raw, mul(u, along));
    const o = add(g.axisPoint, mul(u, along));
    const w = sub(f, o);
    const K = (dot(v, v) + dot(w, w) - g.rodLength * g.rodLength) / 2;
    const p = dot(w, v), q = dot(w, cross(u, v));
    const R = Math.hypot(p, q);
    if (Math.abs(K) > R) return null;
    const base = Math.atan2(q, p), d = Math.acos(K / R);
    const c1 = wrap(base + d), c2 = wrap(base - d);
    return Math.abs(wrap(c1 - prev)) <= Math.abs(wrap(c2 - prev)) ? c1 : c2;
  }

  /** Exact inverse kinematics: foot angles (MJCF joint convention) to actuator angles. */
  ik(a: AnkleAngles, prev: ActuatorAngles = { A: 0, B: 0 }): ActuatorAngles | null {
    const A = this.crankFor('A', this.footPoint(this.leg.actuators.A.f0, a), prev.A);
    const B = this.crankFor('B', this.footPoint(this.leg.actuators.B.f0, a), prev.B);
    return A === null || B === null ? null : { A, B };
  }

  /** Exact forward kinematics by Newton iteration on the inverse (actuators to foot angles). */
  fk(t: ActuatorAngles, guess: AnkleAngles = { pitch: 0, roll: 0 }): AnkleAngles | null {
    let x = { ...guess };
    const h = 1e-6;
    for (let it = 0; it < 30; it++) {
      const f = this.ik(x, t);
      if (!f) return null;
      const r = [f.A - t.A, f.B - t.B];
      if (Math.hypot(r[0], r[1]) < 1e-10) return x;
      const fp = this.ik({ pitch: x.pitch + h, roll: x.roll }, t)!, fr = this.ik({ pitch: x.pitch, roll: x.roll + h }, t)!;
      const J = [[(fp.A - f.A) / h, (fr.A - f.A) / h], [(fp.B - f.B) / h, (fr.B - f.B) / h]];
      const det = J[0][0] * J[1][1] - J[0][1] * J[1][0];
      if (Math.abs(det) < 1e-12) return null;
      x = { pitch: x.pitch - (J[1][1] * r[0] - J[0][1] * r[1]) / det, roll: x.roll - (-J[1][0] * r[0] + J[0][0] * r[1]) / det };
    }
    return null;
  }

  /**
   * Menlo's published small-angle mapping (actuators to pitch and roll), evaluated with r, d and
   * c measured on the CAD: pitch = (A - B) r / 2d, roll = -(A + B) r / c.
   */
  docsMapping(t: ActuatorAngles): AnkleAngles {
    const { crankRadiusMm: r, pivotToBarMm: d, barEndpointsMm: c } = this.leg.derived;
    return { pitch: ((t.A - t.B) * r) / (2 * d), roll: (-(t.A + t.B) * r) / c };
  }

  /** Joint-space torque from actuator torques (virtual work: tau_joint = J^T tau_actuator). */
  jointTorque(tA: number, tB: number): { pitch: number; roll: number } {
    const J = this.leg.derived.jacobianAB_per_PR;
    return { pitch: J[0][0] * tA + J[1][0] * tB, roll: J[0][1] * tA + J[1][1] * tB };
  }
}
