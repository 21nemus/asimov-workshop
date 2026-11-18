// The gripper bench (UNDERSTAND): the right gripper of Menlo's 27-DOF simulation model, standing on
// the assembly bench. One motor turns the driver link; the MJCF ties five more joints to it
// (src/data/gripper.json), so both jaws move together and stay parallel. Display only and loaded on
// first use: the walking model has no gripper, and nothing here runs physics.
import { Box3, CylinderGeometry, Group, Matrix4, Mesh, MeshStandardMaterial, Vector3, type Material } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import data from '../data/gripper.json' with { type: 'json' };
import { meshFromNode } from './node-mesh.ts';
import { mjQuat } from '../utils/frames.ts';
import { ZONES } from '../scene/layout.ts';
import type { LabelLayer } from '../ui/labels.ts';

type V3 = [number, number, number];
interface GripperJoint { name: string; axis: V3; pos: V3; range: [number, number]; factor: number }
interface GripperBody { name: string; parent: string | null; pos: V3; quat: [number, number, number, number]; joint: GripperJoint | null }
export const GRIPPER = data as unknown as {
  source: { repository: string; commit: string; path: string; sha256: string; compiledWith: string; extracted: string };
  mount: { parent: string; pos: V3 };
  bodies: GripperBody[];
  driver: string;
  motor: { name: string; joint: string; gear: number; ctrlrange: [number, number] };
  jawGapMm: { note: string; samples: [number, number][] };
  jawTiltDegMax: number;
};

const DRIVER = GRIPPER.bodies.find((b) => b.joint?.name === GRIPPER.driver)!.joint!;
/** The driver joint's range (rad): 0 is closed, the upper end fully open. */
export const DRIVER_RANGE = DRIVER.range;
/** The joints that follow the driver, with their factor (joint = factor × driver). */
export const COUPLED = GRIPPER.bodies.flatMap((b) => (b.joint && b.joint.name !== GRIPPER.driver ? [b.joint] : []));

/** Jaw gap in mm at driver angle q, interpolated from the samples computed at build time. */
export function jawGapMm(q: number): number {
  const s = GRIPPER.jawGapMm.samples;
  if (q <= s[0][0]) return s[0][1];
  for (let i = 1; i < s.length; i++) {
    if (q <= s[i][0]) return s[i - 1][1] + ((q - s[i - 1][0]) / (s[i][0] - s[i - 1][0])) * (s[i][1] - s[i - 1][1]);
  }
  return s[s.length - 1][1];
}

const short = (name: string) => name.replace(/^right_gripper_/, '').replace(/_link$/, '');

export interface GripperRig {
  /** The gripper's own frame (MuJoCo; body frames as in the MJCF). */
  root: Group;
  /** Each body's content group (its frame after its joint), keyed by body name. */
  contents: Map<string, Group>;
  pivots: { pivot: Group; axis: Vector3; factor: number }[];
}

/** The gripper's body tree as nested groups, one pivot per joint, no meshes. */
export function gripperRig(): GripperRig {
  const root = new Group();
  const contents = new Map<string, Group>();
  const pivots: GripperRig['pivots'] = [];
  for (const b of GRIPPER.bodies) {
    const frame = new Group();
    frame.position.set(...b.pos);
    mjQuat(b.quat, frame.quaternion);
    const pivot = new Group();
    const content = new Group();
    content.name = `gripper:${short(b.name)}`;
    if (b.joint) {
      pivot.position.set(...b.joint.pos);
      content.position.set(-b.joint.pos[0], -b.joint.pos[1], -b.joint.pos[2]);
      pivots.push({ pivot, axis: new Vector3(...b.joint.axis).normalize(), factor: b.joint.factor });
    }
    frame.add(pivot);
    pivot.add(content);
    (b.parent ? contents.get(b.parent)! : root).add(frame);
    contents.set(b.name, content);
  }
  return { root, contents, pivots };
}

/** Poses the rig at driver angle q (clamped to its range); every coupled joint follows by its factor. Returns q. */
export function poseGripper(rig: GripperRig, q: number): number {
  const c = Math.min(DRIVER_RANGE[1], Math.max(DRIVER_RANGE[0], q));
  for (const p of rig.pivots) p.pivot.quaternion.setFromAxisAngle(p.axis, p.factor * c);
  return c;
}

export class GripperBench {
  /** World-placed group, hidden until the bench is opened. */
  readonly group = new Group();
  private readonly base: string;
  private rig: GripperRig | null = null;
  private loading: Promise<void> | null = null;
  private q = 0;

  constructor(base: string) {
    this.base = base;
    this.group.name = 'gripper-bench';
    this.group.visible = false;
  }

  get driver(): number {
    return this.q;
  }

  load(): Promise<void> {
    this.loading ??= this.build();
    return this.loading;
  }

  private async build(): Promise<void> {
    const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(`${this.base}robot/gripper.glb`);
    const nodes = new Map<string, Mesh>();
    gltf.scene.traverse((o) => { if ((o as Mesh).isMesh) nodes.set(o.name, o as Mesh); });
    // Colours are ILLUSTRATIVE (the simulation model has none): the motor's link orange, the housing dark.
    const grey = new MeshStandardMaterial({ color: 0xb9bcc1, roughness: 0.5, metalness: 0.1 });
    const dark = new MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.55, metalness: 0.15 });
    const orange = new MeshStandardMaterial({ color: 0xd9631f, roughness: 0.45, metalness: 0.05 });
    const materialFor = (b: GripperBody): Material => (b.parent === null ? dark : b.joint?.name === GRIPPER.driver ? orange : grey);
    // The gripper's own frame stood upright: its +x (towards the fingertips) points up, the jaws
    // open sideways and the joint axes face the room.
    const rig = gripperRig();
    this.rig = rig;
    const mj = rig.root;
    mj.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(new Vector3(0, 1, 0), new Vector3(1, 0, 0), new Vector3(0, 0, -1)));
    for (const b of GRIPPER.bodies) {
      const src = nodes.get(b.name);
      if (!src) throw new Error(`gripper.glb has no mesh for ${b.name}`);
      const mesh = meshFromNode(src, materialFor(b));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      rig.contents.get(b.name)!.add(mesh);
    }
    // Stand it on a small post on the bench's mat, clear of the parts trays and the laptop,
    // lowest point on the post.
    this.setDriver(DRIVER_RANGE[1]);
    mj.updateMatrixWorld(true);
    const box = new Box3().setFromObject(mj);
    const bench = ZONES.assemblyBench;
    const postH = 0.05;
    const post = new Mesh(new CylinderGeometry(0.035, 0.04, postH, 32), dark);
    post.position.set(0, bench.top + postH / 2, 0);
    post.castShadow = true;
    post.receiveShadow = true;
    mj.position.set(-(box.min.x + box.max.x) / 2, bench.top + postH - box.min.y, -(box.min.z + box.max.z) / 2);
    this.group.position.set(bench.x - 0.35, 0, bench.z - 0.12);
    this.group.add(post, mj);
    this.setDriver(0);
  }

  /** Sets the driver angle (clamped to its range); every coupled joint follows by its factor. */
  setDriver(q: number): void {
    this.q = this.rig ? poseGripper(this.rig, q) : Math.min(DRIVER_RANGE[1], Math.max(DRIVER_RANGE[0], q));
  }

  /** World position of a point given in one gripper body's frame (MJCF coordinates, metres). */
  point(body: string, local: V3): Vector3 {
    const c = this.rig!.contents.get(`right_gripper_${body}_link`)!;
    c.updateWorldMatrix(true, false);
    return c.localToWorld(new Vector3(...local));
  }

  /** A camera shot of the open gripper from the room side of the bench. */
  shot(): { position: V3; target: V3 } {
    const t = this.group.localToWorld(new Vector3(0, ZONES.assemblyBench.top + 0.11, 0));
    return { position: [t.x - 0.22, t.y + 0.16, t.z - 0.7], target: [t.x, t.y, t.z] };
  }

  /** Leader-line labels; `compact` (phones) drops the second line and keeps the tags close. */
  addLabels(layer: LabelLayer, compact = false): void {
    const d = compact ? 0.35 : 1;
    const sub = (t: string) => (compact ? undefined : t);
    layer.add('Motor link', () => this.point('driver', [0.03, 0, 0]), -80 * d, compact ? 40 : -10, sub(`driver joint · ${GRIPPER.motor.ctrlrange[1]} N·m limit`));
    layer.add('Jaw', () => this.point('finger', [0.066, 0, 0.033]), -70 * d, -40, sub('finger: −1 × driver'));
    layer.add('Jaw', () => this.point('finger_follower', [0.066, 0, 0.033]), 70 * d, -40, sub('follower finger: +1 × driver'));
    layer.add('Parallel bar', () => this.point('follower_parallel', [0.03, 0, 0]), 80 * d, compact ? 44 : 20, sub('keeps the jaw upright'));
  }
}
