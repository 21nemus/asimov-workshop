// Typed access to src/data/kinematics.json, the MuJoCo 3.3.8 compile of the pinned Asimov MJCF.
import data from '../data/kinematics.json' with { type: 'json' };
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
