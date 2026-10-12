// Assembly plans shared by BUILD and the WATCH tour: which parts each documented step places,
// how the robot looks after a given step, how the step's parts move into place and where the
// camera should stand to see them.
import { Box3, Quaternion, Vector3 } from 'three';
import type { Lesson, LessonStep } from '../catalog/catalog.ts';
import type { RobotModel, PartInfo } from '../robot/robot-model.ts';
import type { Shot } from '../scene/camera-director.ts';

export interface StepPlan {
  step: LessonStep;
  /** Main parts placed in this step, plus pre-installed items (inserts, bearings) they carry. */
  parts: PartInfo[];
  fasteners: PartInfo[];
}

export interface ModulePlan {
  lesson: Lesson;
  steps: StepPlan[];
  members: Set<number>;
  /** Parts of the module the documented steps never place (shown when the module is complete). */
  unplaced: PartInfo[];
  /** Other modules joined into this one by a step (cross-module prerequisites), per step index. */
  joins: Map<number, string[]>;
  view: [number, number, number];
  /** Step index per part (parts the steps never place are absent). */
  stepOfPart: Map<number, number>;
}

export interface Flight { i: number; from: Vector3; delay: number; dur: number }

/** Camera direction (three.js world, from the target) that shows each module's working side. */
export const MODULE_VIEWS: Record<string, [number, number, number]> = {
  'left-leg': [0.55, 0.32, -0.78],
  'right-leg': [0.55, 0.32, 0.78],
  pelvis: [0.85, 0.4, -0.35],
  'left-arm': [0.5, 0.3, -0.82],
  'right-arm': [0.5, 0.3, 0.82],
  torso: [0.9, 0.3, 0.32],
};
export const MODULE_NAMES: Record<string, string> = { 'left-leg': 'Left leg', 'right-leg': 'Right leg', pelvis: 'Pelvis', 'left-arm': 'Left arm', 'right-arm': 'Right arm', torso: 'Torso and head' };

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

export function planModule(robot: RobotModel, lesson: Lesson): ModulePlan {
  const parts = robot.parts;
  const steps: StepPlan[] = lesson.steps.map((step) => ({
    step,
    parts: step.parts.map((i) => parts[i]),
    fasteners: step.fastenerGroups.flatMap((g) => g.cad.map((i) => parts[i])),
  }));
  // Pre-installed items (heat-set inserts, bearings) go in with the part that holds them:
  // the nearest main part on the same body (distance from the item's centre to that part's box).
  const box = new Box3();
  const c = new Vector3();
  for (const i of lesson.prepared) {
    const p = parts[i];
    let best: StepPlan | null = null, bestD = Infinity;
    for (const sp of steps) for (const host of sp.parts) {
      if (host.body !== p.body) continue;
      box.setFromCenterAndSize(c.set(...host.center), new Vector3(...host.size));
      const d = box.distanceToPoint(new Vector3(...p.center));
      if (d < bestD) { bestD = d; best = sp; }
    }
    (best ?? steps[0]).parts.push(p);
  }
  const members = new Set<number>();
  const stepOfPart = new Map<number, number>();
  steps.forEach((sp, idx) => { for (const p of [...sp.parts, ...sp.fasteners]) { members.add(p.i); stepOfPart.set(p.i, idx); } });
  const unplaced = lesson.unplaced.map((i) => parts[i]);
  for (const p of unplaced) members.add(p.i);
  const joins = new Map<number, string[]>();
  lesson.steps.forEach((s, k) => {
    const ext = s.requires.filter((r) => !r.startsWith(`${lesson.id}/`)).map((r) => r.split('/')[0]);
    if (ext.length) joins.set(k, ext);
  });
  return { lesson, steps, members, unplaced, joins, view: MODULE_VIEWS[lesson.id] ?? [0.8, 0.3, 0.5], stepOfPart };
}

/** Fasteners, inserts, nuts and other very small items (no ghost outlines for these). */
export function isSmall(p: PartInfo): boolean {
  return p.kind === 'fastener' || /Insert|Nut|Washer/i.test(p.name) || Math.max(...p.size) < 0.012;
}

/**
 * The robot after step `index` of `plan`: installed parts solid, parts still to come as outlines,
 * other modules solid when joined or complete, faded otherwise. Clears all part offsets.
 */
export function applyBuildState(robot: RobotModel, plan: ModulePlan, index: number, solidModules: Set<string>, moduleOf: Map<number, string>): void {
  const st = robot.state;
  const last = index === plan.steps.length - 1;
  for (let i = 0; i < st.count; i++) {
    st.setOffset(i, 0, 0, 0);
    if (plan.members.has(i)) {
      const s = plan.stepOfPart.get(i);
      const installed = s === undefined ? last : s <= index;
      st.setVisible(i, installed);
      st.setGhost(i, !installed && !isSmall(robot.parts[i]));
      st.setDim(i, 0);
    } else {
      const m = moduleOf.get(i);
      st.setVisible(i, true);
      st.setGhost(i, false);
      st.setDim(i, m && solidModules.has(m) ? 0 : 0.8);
    }
  }
}

/** Main parts approach from outside the module; fasteners slide in along their own axis. */
export function planFlights(robot: RobotModel, plan: ModulePlan, sp: StepPlan, pace = 1): Flight[] {
  const view = new Vector3(...plan.view);
  const approachWorld = new Vector3(view.x * 0.35, 0.55, view.z).normalize();
  const flights: Flight[] = [];
  const centroid = new Vector3();
  for (const p of sp.parts) centroid.add(robot.partWorldCenter(p, new Vector3()));
  if (sp.parts.length) centroid.divideScalar(sp.parts.length);
  const q = new Quaternion();
  const toBody = (p: PartInfo, v: Vector3) => {
    const content = robot.rig.body(p.body).content;
    content.updateWorldMatrix(true, false);
    content.getWorldQuaternion(q);
    return v.applyQuaternion(q.invert());
  };
  sp.parts.forEach((p, k) => {
    flights.push({ i: p.i, from: toBody(p, approachWorld.clone().multiplyScalar(0.24)), delay: (k * 0.12) / pace, dur: 0.85 / pace });
  });
  const t0 = sp.parts.length ? (0.85 + (sp.parts.length - 1) * 0.12 + 0.05) / pace : 0;
  sp.fasteners.forEach((p, k) => {
    // The longest box dimension is a bolt's shaft; it backs out away from the step's parts.
    const ax = p.size.indexOf(Math.max(...p.size));
    const axis = new Vector3(ax === 0 ? 1 : 0, ax === 1 ? 1 : 0, ax === 2 ? 1 : 0);
    const world = robot.partWorldCenter(p, new Vector3());
    const local = toBody(p, world.clone().sub(sp.parts.length ? centroid : world.clone().add(approachWorld)));
    if (local.dot(axis) < 0) axis.negate();
    flights.push({ i: p.i, from: axis.multiplyScalar(0.045), delay: t0 + (k * 0.035) / pace, dur: 0.45 / pace });
  });
  return flights;
}

/** Applies flights at time t (seconds since the step began); returns true once all have landed. */
export function applyFlights(robot: RobotModel, flights: Flight[], t: number): boolean {
  let done = true;
  for (const f of flights) {
    const p = Math.min(1, Math.max(0, (t - f.delay) / f.dur));
    if (p < 1) done = false;
    const k = 1 - easeOut(p);
    robot.state.setOffset(f.i, f.from.x * k, f.from.y * k, f.from.z * k);
  }
  return done;
}

/** A camera shot that frames a step (or the whole module for parts-free and final steps). */
export function stepShot(robot: RobotModel, plan: ModulePlan, index: number, fovDeg: number): Shot | null {
  const sp = plan.steps[index];
  let list = [...sp.parts, ...sp.fasteners];
  if (!list.length || index === plan.steps.length - 1) list = [...plan.members].map((i) => robot.parts[i]);
  const box = new Box3();
  const tmp = new Box3();
  for (const p of list) {
    const content = robot.rig.body(p.body).content;
    content.updateWorldMatrix(true, false);
    tmp.setFromCenterAndSize(new Vector3(...p.center), new Vector3(...p.size)).applyMatrix4(content.matrixWorld);
    box.union(tmp);
  }
  if (box.isEmpty()) return null;
  const center = box.getCenter(new Vector3());
  const radius = Math.max(0.09, box.getSize(new Vector3()).length() / 2);
  const fov = (fovDeg * Math.PI) / 180;
  // Close enough to read the step, far enough to keep the module around it in view.
  const dist = Math.min(1.9, Math.max(0.95, (radius / Math.sin(fov / 2)) * 1.5));
  const pos = center.clone().addScaledVector(new Vector3(...plan.view).normalize(), dist);
  return { position: [pos.x, Math.max(0.25, pos.y), pos.z], target: [center.x, center.y, center.z] };
}
