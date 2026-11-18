// Typed access to src/data/kinematics.json, the MuJoCo 3.3.8 compile of the pinned Asimov MJCF.
import data from '../data/kinematics.json' with { type: 'json' };
import neckData from '../data/neck.json' with { type: 'json' };
import type { MjQuat, Vec3 } from '../utils/frames.ts';

export interface JointDef {
  id: number;
  name: string;
  type: 'free' | 'ball' | 'slide' | 'hinge';
  axis: Vec3;
  pos: Vec3;
  range: [number, number] | null;
  qpos0: number;
  qposadr: number;
  dofadr: number;
  armature: number;
}
export interface BodyDef {
  id: number;
  name: string;
  parent: number;
  pos: Vec3;
  quat: MjQuat;
  mass: number;
  ipos: Vec3;
  joints: JointDef[];
  xpos0: Vec3;
  xquat0: MjQuat;
}
export interface GeomDef {
  id: number;
  name: string;
  body: number;
  collides: boolean;
  type: string;
  size: Vec3;
  pos: Vec3;
  quat: MjQuat;
  friction: Vec3;
  priority: number;
  condim: number;
  mesh: string | null;
}
export interface Kinematics {
  source: { repository: string; commit: string; path: string; sha256: string; compiledWith: string };
  frame: string;
  timestep: number;
  totalMass: number;
  nq: number;
  nv: number;
  nu: number;
  bodies: BodyDef[];
  geoms: GeomDef[];
  sites: { name: string; body: number; pos: Vec3 }[];
  meshFiles: Record<string, string>;
}

export const KINEMATICS = data as unknown as Kinematics;

export const HINGES: JointDef[] = KINEMATICS.bodies.flatMap((b) => b.joints.filter((j) => j.type === 'hinge'));

/**
 * The neck's two joints from Menlo's 25-DOF model (src/data/neck.json, whose neck bodies have this
 * model's frames). Display only: they have no place in the physics state (qposadr -1), because the
 * walking model fixes the neck.
 */
export const NECK_HINGES: (JointDef & { body: string })[] = neckData.joints.map((j) => ({
  id: -1, name: j.name, type: 'hinge' as const, axis: j.axis as Vec3, pos: j.pos as Vec3, range: j.range as [number, number],
  qpos0: 0, qposadr: -1, dofadr: -1, armature: j.armature, body: j.body,
}));

/** Where the neck joints come from (repository, commit, MJCF path and hash). */
export const NECK_SOURCE = neckData.source;

/** Every joint the display rig can move: the walking model's 23, then the neck. */
export const DISPLAY_HINGES: JointDef[] = [...HINGES, ...NECK_HINGES];

/** Joint angles of the neck at rest (both zero, as the walking model holds it). */
export const NECK_REST: Record<string, number> = Object.fromEntries(NECK_HINGES.map((j) => [j.name, j.qpos0]));

export function bodyByName(name: string): BodyDef {
  const b = KINEMATICS.bodies.find((x) => x.name === name);
  if (!b) throw new Error(`no body ${name}`);
  return b;
}

export function jointByName(name: string): JointDef {
  const j = HINGES.find((x) => x.name === name);
  if (!j) throw new Error(`no hinge ${name}`);
  return j;
}
