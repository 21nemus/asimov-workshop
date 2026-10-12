// The ankle microscope: an ankle's RSU linkage moving for real. Cranks turn about the measured
// actuator axes; each push rod (with its two rod ends) spans exactly from its crank ball to its
// foot ball. Crank angles come from the exact loop closure (ankle-linkage.ts). Either ankle.
import { Group, Matrix4, Quaternion, Vector3, type Material, type Mesh } from 'three';
import type { RobotModel, PartInfo } from '../robot/robot-model.ts';
import { AnkleLinkage, type ActuatorAngles, type AnkleAngles, type Side, type V3 } from './ankle-linkage.ts';
import type { LabelLayer } from '../ui/labels.ts';

/** The three bodies the mechanism bench shows: calf (with both ankle actuators), cross, foot. */
export const lowerLegBodies = (side: Side) => [`${side}_knee_link`, `${side}_ankle_pitch_link`, `${side}_ankle_roll_link`];
/** Straight leg for the bench: hip, knee and ankle at zero on that side. */
export const benchLegPose = (side: Side): Record<string, number> => Object.fromEntries(['hip_pitch', 'hip_roll', 'hip_yaw', 'knee', 'ankle_pitch', 'ankle_roll'].map((j) => [`${side}_${j}_joint`, 0]));
/** Actuator ids from the docs' actuator map. */
const ACTUATOR_IDS: Record<Side, { A: number; B: number }> = { left: { A: 5, B: 6 }, right: { A: 11, B: 12 } };

export interface MicroscopeReadout {
  ankle: AnkleAngles;
  /** Exact actuator angles (CAD geometry, CAD pivots). */
  actuators: ActuatorAngles;
  /** Menlo's small-angle mapping applied to those actuator angles. */
  docs: AnkleAngles;
}

interface Mover { group: Group; parts: PartInfo[] }

export class AnkleMicroscope {
  readonly side: Side;
  readonly model: AnkleLinkage;
  private robot: RobotModel;
  private readonly CALF: string;
  private readonly FOOT: string;
  private readonly PITCH: string;
  private readonly ROLL: string;
  private cranks: Record<'A' | 'B', Mover>;
  private rods: Record<'A' | 'B', Mover>;
  private hidden: number[] = [];
  private calfFromFoot0 = new Matrix4();
  private footBalls: Record<'A' | 'B', Vector3>;
  private prevDisplay: ActuatorAngles = { A: 0, B: 0 };
  private prevExact: ActuatorAngles = { A: 0, B: 0 };
  private materials = new Map<string, Material>();
  readout: MicroscopeReadout = { ankle: { pitch: 0, roll: 0 }, actuators: { A: 0, B: 0 }, docs: { pitch: 0, roll: 0 } };

  constructor(robot: RobotModel, side: Side, setJointsZero: () => void) {
    this.robot = robot;
    this.side = side;
    this.model = new AnkleLinkage(side);
    this.CALF = `${side}_knee_link`;
    this.FOOT = `${side}_ankle_roll_link`;
    this.PITCH = `${side}_ankle_pitch_joint`;
    this.ROLL = `${side}_ankle_roll_joint`;
    const CALF = this.CALF, FOOT = this.FOOT;
    const module = side === 'left' ? 'ASV1_600' : 'ASV1_500';
    const prefix = `${module}_`;
    const leg = this.model.leg;
    const pn = (s: string) => `${prefix}${s}`;
    const byPn = (s: string) => robot.parts.find((p) => p.partNumber === pn(s))!;
    // Foot frame -> calf frame with the ankle at zero (for rod-end parts that live on the foot).
    setJointsZero();
    robot.rig.root.updateWorldMatrix(true, true);
    const calf = robot.rig.body(CALF).content, foot = robot.rig.body(FOOT).content;
    this.calfFromFoot0.copy(calf.matrixWorld).invert().multiply(foot.matrixWorld);
    this.footBalls = {
      A: new Vector3(...(leg.balls[leg.actuators.A.footBall.replace(prefix, '')]?.centerBody ?? [0, 0, 0])),
      B: new Vector3(...(leg.balls[leg.actuators.B.footBall.replace(prefix, '')]?.centerBody ?? [0, 0, 0])),
    };
    // Fasteners that clamp a crank (to its actuator, or the crank-side ball) turn with it.
    const near = (p: PartInfo, c: PartInfo, pad: number) => p.body === c.body && p.center.every((v, k) => Math.abs(v - c.center[k]) <= c.size[k] / 2 + pad);
    const smalls = robot.parts.filter((p) => p.module === module && p.body === CALF && (p.kind === 'fastener' || /Nut|Washer/i.test(p.name)));
    const crankParts = (s: string, ball: V3) => {
      const c = byPn(s);
      const extra = smalls.filter((f) => near(f, c, 0.002) || Math.hypot(f.center[0] - ball[0], f.center[1] - ball[1], f.center[2] - ball[2]) < 0.016);
      return [c, ...extra];
    };
    this.cranks = {
      A: { group: new Group(), parts: crankParts(leg.actuators.A.crank.replace(prefix, ''), leg.actuators.A.b0) },
      B: { group: new Group(), parts: crankParts(leg.actuators.B.crank.replace(prefix, ''), leg.actuators.B.b0) },
    };
    this.rods = {
      A: { group: new Group(), parts: ['23A_SS', leg.actuators.A.crankBall.replace(prefix, ''), leg.actuators.A.footBall.replace(prefix, '')].map(byPn) },
      B: { group: new Group(), parts: ['24A_SS', leg.actuators.B.crankBall.replace(prefix, ''), leg.actuators.B.footBall.replace(prefix, '')].map(byPn) },
    };
    // Crank fasteners must not also be counted with a rod.
    const rodSet = new Set([...this.rods.A.parts, ...this.rods.B.parts].map((p) => p.i));
    for (const k of ['A', 'B'] as const) this.cranks[k].parts = this.cranks[k].parts.filter((p) => !rodSet.has(p.i));
    for (const mover of [this.cranks.A, this.cranks.B, this.rods.A, this.rods.B]) {
      mover.group.matrixAutoUpdate = false;
      mover.group.name = 'ankle-mover';
      for (const p of mover.parts) {
        const proxy = robot.createProxy(p, this.plainMaterial(p));
        // Proxies are built in their own body's frame; rod ends on the foot need the foot-to-calf offset.
        if (p.body === FOOT) proxy.matrix.premultiply(this.calfFromFoot0);
        proxy.receiveShadow = true;
        mover.group.add(proxy);
      }
    }
  }

  /** Proxy materials without the per-part shader (the originals are hidden through it). */
  private plainMaterial(p: PartInfo): Material {
    const src = this.robot.meshOf(p).material as Material;
    let m = this.materials.get(src.uuid);
    if (!m) { m = src.clone(); this.materials.set(src.uuid, m); }
    return m;
  }

  get movingParts(): PartInfo[] {
    return [this.cranks.A, this.cranks.B, this.rods.A, this.rods.B].flatMap((m) => m.parts);
  }

  /** Only the lower leg on the bench: calf (with both actuators), cross and foot. */
  isolate(): void {
    const st = this.robot.state;
    const keep = new Set(lowerLegBodies(this.side));
    const moving = new Set(this.movingParts.map((p) => p.i));
    for (const p of this.robot.parts) {
      if (moving.has(p.i)) continue;
      st.setVisible(p.i, keep.has(p.body));
      st.setDim(p.i, 0);
    }
  }

  /**
   * A front view of the linkage from the leg's outer side, centred below the knee. `yaw` is how
   * far the leg has been turned about the vertical (the bench presents it to the room).
   */
  shot(yaw = 0): { position: [number, number, number]; target: [number, number, number] } {
    const t = this.calfPoint([0.03, 0, -0.16]);
    const outer = this.side === 'left' ? -1 : 1;
    const d = new Vector3(0.62, 0.12, 0.34 * outer).applyAxisAngle(new Vector3(0, 1, 0), yaw);
    return { position: [t.x + d.x, t.y + d.y, t.z + d.z], target: [t.x, t.y, t.z] };
  }

  attach(): void {
    const calf = this.robot.rig.body(this.CALF).content;
    for (const m of [this.cranks.A, this.cranks.B, this.rods.A, this.rods.B]) calf.add(m.group);
    this.hidden = this.movingParts.map((p) => p.i);
    for (const i of this.hidden) this.robot.state.setVisible(i, false);
  }

  detach(): void {
    for (const m of [this.cranks.A, this.cranks.B, this.rods.A, this.rods.B]) m.group.removeFromParent();
    for (const i of this.hidden) this.robot.state.setVisible(i, true);
    this.hidden = [];
  }

  dispose(): void {
    this.detach();
    for (const m of this.materials.values()) m.dispose();
  }

  /**
   * Poses the linkage for the rig's current ankle angles. The drawing closes the loop on the
   * displayed foot (the rig turns it about the simulation's joint axes, within 1.5 mm of the
   * CAD's); the reported actuator angles come from the CAD geometry itself.
   */
  update(): MicroscopeReadout {
    const rig = this.robot.rig;
    const ankle = { pitch: rig.q.get(this.PITCH) ?? 0, roll: rig.q.get(this.ROLL) ?? 0 };
    rig.root.updateWorldMatrix(true, true);
    const calf = rig.body(this.CALF).content, foot = rig.body(this.FOOT).content;
    const calfFromFoot = new Matrix4().copy(calf.matrixWorld).invert().multiply(foot.matrixWorld);
    const leg = this.model.leg;
    for (const k of ['A', 'B'] as const) {
      const g = leg.actuators[k];
      const f = this.footBalls[k].clone().applyMatrix4(calfFromFoot);
      const phi = this.model.crankFor(k, [f.x, f.y, f.z], this.prevDisplay[k]) ?? this.prevDisplay[k];
      this.prevDisplay[k] = phi;
      // Crank: rotation about the actuator axis.
      const o = new Vector3(...g.axisPoint), u = new Vector3(...g.axisDir).normalize();
      const rotM = new Matrix4().makeTranslation(o.x, o.y, o.z).multiply(new Matrix4().makeRotationAxis(u, phi)).multiply(new Matrix4().makeTranslation(-o.x, -o.y, -o.z));
      this.cranks[k].group.matrix.copy(rotM);
      this.cranks[k].group.matrixWorldNeedsUpdate = true;
      // Rod: from the moved crank ball to the foot ball, turning as little as possible.
      const b0 = new Vector3(...g.b0), f0 = new Vector3(...g.f0);
      const b = b0.clone().applyMatrix4(rotM);
      const q = new Quaternion().setFromUnitVectors(f0.clone().sub(b0).normalize(), f.clone().sub(b).normalize());
      const rodM = new Matrix4().makeTranslation(b.x, b.y, b.z).multiply(new Matrix4().makeRotationFromQuaternion(q)).multiply(new Matrix4().makeTranslation(-b0.x, -b0.y, -b0.z));
      this.rods[k].group.matrix.copy(rodM);
      this.rods[k].group.matrixWorldNeedsUpdate = true;
    }
    const exact = this.model.ik(ankle, this.prevExact) ?? this.prevExact;
    this.prevExact = exact;
    this.readout = { ankle, actuators: exact, docs: this.model.docsMapping(exact) };
    return this.readout;
  }

  /** World position of a calf-frame point (label anchors). */
  calfPoint(p: V3, out = new Vector3()): Vector3 {
    const calf = this.robot.rig.body(this.CALF).content;
    calf.updateWorldMatrix(true, false);
    return out.set(...p).applyMatrix4(calf.matrixWorld);
  }

  addLabels(layer: LabelLayer): void {
    const leg = this.model.leg;
    const mid = (a: V3, b: V3): V3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    const motorFace = (k: 'A' | 'B'): V3 => [leg.actuators[k].axisPoint[0] - 0.02, leg.actuators[k].axisPoint[1], leg.actuators[k].axisPoint[2]];
    const ids = ACTUATOR_IDS[this.side];
    layer.add('Actuator A', () => this.calfPoint(motorFace('A')), 70, -30, `ID ${ids.A} · EC-A4310`);
    layer.add('Actuator B', () => this.calfPoint(motorFace('B')), 70, -16, `ID ${ids.B} · EC-A4310`);
    layer.add('Push rod A', () => this.rodPoint('A', mid(leg.actuators.A.b0, leg.actuators.A.f0)), -70, 6, `${leg.derived.rodLengthMm.A.toFixed(1)} mm ball to ball`);
    layer.add('Push rod B', () => this.rodPoint('B', mid(leg.actuators.B.b0, leg.actuators.B.f0)), 74, 22, `${leg.derived.rodLengthMm.B.toFixed(1)} mm ball to ball`);
    layer.add('Cross', () => this.calfPoint(leg.ujoint.pitch.point), -72, 34, 'pitch and roll axes');
  }

  private rodPoint(k: 'A' | 'B', p: V3): Vector3 {
    return new Vector3(...p).applyMatrix4(this.rods[k].group.matrix).applyMatrix4(this.robot.rig.body(this.CALF).content.matrixWorld);
  }

  /** Mesh lookup for tests and debugging. */
  meshes(): Mesh[] {
    return [this.cranks.A, this.cranks.B, this.rods.A, this.rods.B].flatMap((m) => m.group.children as Mesh[]);
  }
}
