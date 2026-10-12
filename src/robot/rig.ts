// Kinematic rig: one three.js Group per MuJoCo body, nested exactly like the MJCF body
// tree, in MuJoCo coordinates (the caller parents `root` under a MuJoCo-frame group).
//
// MuJoCo places a hinge's child body at its compiled (pos, quat) when qpos equals the
// joint's qpos0 (the MJCF `ref`), and rotates it about the joint axis (body frame,
// through the joint position) by (q - qpos0). The elbows use ref = +-0.785 rad, so
// "angle zero" is not "MJCF pose" for them; that offset is handled here and nowhere else.
import { Group, Quaternion, Vector3 } from 'three';
import { KINEMATICS, type BodyDef, type JointDef } from './kinematics.ts';
import { mjQuat } from '../utils/frames.ts';

export interface RigBody {
  def: BodyDef;
  /** Static frame: compiled body pos/quat relative to the parent body. */
  frame: Group;
  /** Rotates about the hinge axis through the joint position. */
  pivot: Group;
  /** Holds visuals and child bodies, offset back by -joint.pos. */
  content: Group;
  joint: JointDef | null;
}

const tmpQ = new Quaternion();
const tmpAxis = new Vector3();

export class RobotRig {
  readonly root = new Group();
  readonly bodies: RigBody[] = [];
  private readonly byName = new Map<string, RigBody>();
  /** Current joint angles keyed by joint name (absolute MuJoCo qpos values). */
  readonly q = new Map<string, number>();

  constructor() {
    this.root.name = 'asimov-rig';
    for (const def of KINEMATICS.bodies) {
      if (def.id === 0) continue;
      const hinge = def.joints.find((j) => j.type === 'hinge') ?? null;
      const frame = new Group();
      frame.name = `body:${def.name}`;
      frame.position.set(def.pos[0], def.pos[1], def.pos[2]);
      mjQuat(def.quat, frame.quaternion);
      const pivot = new Group();
      pivot.name = `pivot:${def.name}`;
      const content = new Group();
      content.name = `content:${def.name}`;
      if (hinge) {
        pivot.position.set(hinge.pos[0], hinge.pos[1], hinge.pos[2]);
        content.position.set(-hinge.pos[0], -hinge.pos[1], -hinge.pos[2]);
        this.q.set(hinge.name, hinge.qpos0);
      }
      frame.add(pivot);
      pivot.add(content);
      const body: RigBody = { def, frame, pivot, content, joint: hinge };
      this.bodies.push(body);
      this.byName.set(def.name, body);
      const parent = this.bodies.find((b) => b.def.id === def.parent);
      (parent ? parent.content : this.root).add(frame);
    }
  }

  body(name: string): RigBody {
    const b = this.byName.get(name);
    if (!b) throw new Error(`rig has no body ${name}`);
    return b;
  }

  /** Sets one hinge to an absolute MuJoCo joint position (radians). */
  setJoint(name: string, q: number): void {
    const body = this.bodies.find((b) => b.joint?.name === name);
    if (!body || !body.joint) throw new Error(`rig has no hinge ${name}`);
    this.q.set(name, q);
    const j = body.joint;
    tmpAxis.set(j.axis[0], j.axis[1], j.axis[2]).normalize();
    body.pivot.quaternion.copy(tmpQ.setFromAxisAngle(tmpAxis, q - j.qpos0));
  }

  setJoints(values: Record<string, number>): void {
    for (const [name, q] of Object.entries(values)) this.setJoint(name, q);
  }

  /** Floating base pose from a MuJoCo qpos layout: [x, y, z, qw, qx, qy, qz]. */
  setRootPose(qpos: ArrayLike<number>): void {
    const pelvis = this.bodies[0];
    pelvis.frame.position.set(qpos[0], qpos[1], qpos[2]);
    pelvis.frame.quaternion.set(qpos[4], qpos[5], qpos[6], qpos[3]);
  }

  /** Applies a full MuJoCo qpos vector (free joint + hinges, compiled qposadr layout). */
  setQpos(qpos: ArrayLike<number>): void {
    this.setRootPose(qpos);
    for (const b of this.bodies) {
      if (!b.joint) continue;
      const j = b.joint;
      const q = qpos[j.qposadr];
      this.q.set(j.name, q);
      tmpAxis.set(j.axis[0], j.axis[1], j.axis[2]).normalize();
      b.pivot.quaternion.setFromAxisAngle(tmpAxis, q - j.qpos0);
    }
  }

  /** The MJCF reference configuration: every hinge at qpos0, root at the compiled pelvis pose. */
  resetToReference(): void {
    const pelvis = this.bodies[0];
    pelvis.frame.position.set(pelvis.def.pos[0], pelvis.def.pos[1], pelvis.def.pos[2]);
    mjQuat(pelvis.def.quat, pelvis.frame.quaternion);
    for (const b of this.bodies) if (b.joint) this.setJoint(b.joint.name, b.joint.qpos0);
  }
}
