// Shared application context handed to every mode. Modes coordinate through it and never
// reach into each other: BUILD and UNDERSTAND pose a display copy of the rig, TEST owns the
// physics, and the pose driver decides which of them the rig follows.
import type { Group } from 'three';
import type { Stage } from '../scene/stage.ts';
import type { CameraDirector } from '../scene/camera-director.ts';
import type { RobotModel, PartInfo, PartHit } from '../robot/robot-model.ts';
import type { Workshop } from '../scene/workshop.ts';
import type { Lighting } from '../scene/lighting.ts';
import type { Drawer, Panel } from '../ui/components.ts';
import type { Signal } from '../ui/dom.ts';
import type { SimulationAdapter } from '../simulation/adapter.ts';
import type { Highlights } from './highlights.ts';
import type { AnkleBench } from '../understand/ankle-bench.ts';
import type { AnkleMicroscope } from '../understand/ankle-microscope.ts';
import type { Side } from '../understand/ankle-linkage.ts';
import { standOnFloor, TRAINED_DEFAULT_POSE } from '../robot/poses.ts';

export type ModeId = 'explore' | 'build' | 'understand' | 'test' | 'watch';

/** Optional entry parameters (deep links such as #build/left-leg-3). */
export type ModeParams = Record<string, string | undefined>;

export interface Mode {
  readonly id: ModeId;
  enter(from: ModeId | null, params?: ModeParams): void | Promise<void>;
  exit(to: ModeId): void;
  update?(dt: number): void;
  /** Keyboard shortcuts while the mode is active; return true when handled. */
  key?(e: KeyboardEvent): boolean;
  /** A click on the 3D view (null when it hit no visible part). */
  pick?(hit: PartHit | null): void;
  /** Hover filter: parts the mode lets the pointer highlight. */
  hoverable?(p: PartInfo): boolean;
}

export interface Ui {
  root: HTMLElement;
  panel: Panel;
  drawer: Drawer;
  toast(text: string): void;
  caption(text: string | null, small?: string): void;
  hint(text: string | null): void;
  openSources(): void;
  /** Hides brand, navigation and hints (the guided tour). */
  setChromeHidden(hidden: boolean): void;
}

/** Who moves the rig: a display pose, or the physics state. */
export class PoseDriver {
  source: 'display' | 'sim' = 'display';
  joints: Record<string, number> = { ...TRAINED_DEFAULT_POSE };
  private robot: RobotModel;
  private simQpos: (() => ArrayLike<number> | null) | null = null;
  private blend: { from: Record<string, number>; to: Record<string, number>; t: number; dur: number } | null = null;
  /** When set, the robot hangs at a fixed height (as from the gantry) instead of standing. */
  private hangZ: number | null = null;

  constructor(robot: RobotModel) {
    this.robot = robot;
  }

  /**
   * A static display pose standing on the floor at the simulation origin (EXPLORE, BUILD,
   * UNDERSTAND). With a duration, the joints blend from the current pose (display only).
   */
  display(joints: Record<string, number> = TRAINED_DEFAULT_POSE, duration = 0): void {
    const wasSim = this.source === 'sim';
    this.source = 'display';
    this.hangZ = null;
    this.simQpos = null;
    if (duration > 0 && !wasSim) {
      this.blend = { from: { ...this.joints }, to: { ...joints }, t: 0, dur: duration };
    } else {
      this.blend = null;
      this.joints = { ...joints };
      standOnFloor(this.robot.rig, this.joints);
    }
  }

  setJoint(name: string, q: number): void {
    this.joints[name] = q;
    if (this.source !== 'display') return;
    if (this.hangZ === null) standOnFloor(this.robot.rig, this.joints);
    else {
      this.robot.rig.setJoint(name, q);
      this.robot.rig.root.updateWorldMatrix(true, true);
    }
  }

  /**
   * Lifts the standing robot by `lift` metres and holds it there, so joints can move freely
   * without the feet pushing it around (Menlo's guide hangs the robot from its gantry for joint work).
   */
  hang(lift: number): void {
    const z = standOnFloor(this.robot.rig, this.joints) + lift;
    this.hangZ = z;
    this.robot.rig.setRootPose([0, 0, z, 1, 0, 0, 0]);
    this.robot.rig.root.updateWorldMatrix(true, true);
  }

  followSim(getQpos: () => ArrayLike<number> | null): void {
    this.source = 'sim';
    this.blend = null;
    this.simQpos = getQpos;
  }

  get blending(): boolean {
    return this.blend !== null;
  }

  update(dt = 0): void {
    if (this.source === 'sim') {
      const q = this.simQpos?.();
      if (q) this.robot.rig.setQpos(q);
      return;
    }
    const b = this.blend;
    if (!b) return;
    b.t = Math.min(1, b.t + dt / b.dur);
    const k = b.t < 0.5 ? 2 * b.t * b.t : 1 - Math.pow(-2 * b.t + 2, 2) / 2;
    for (const name of Object.keys(b.to)) this.joints[name] = (b.from[name] ?? b.to[name]) + (b.to[name] - (b.from[name] ?? b.to[name])) * k;
    standOnFloor(this.robot.rig, this.joints);
    if (b.t >= 1) this.blend = null;
  }
}

export interface AppContext {
  base: string;
  stage: Stage;
  camera: CameraDirector;
  robot: RobotModel;
  workshop: Workshop;
  lighting: Lighting;
  mjFrame: Group;
  /** Display transform above the MuJoCo frame (identity except on the mechanism bench). */
  mount: Group;
  /** The ankle mechanism bench and the per-ankle microscopes (shared by UNDERSTAND and WATCH). */
  bench: AnkleBench;
  microscope(side: Side): AnkleMicroscope;
  ui: Ui;
  pose: PoseDriver;
  selection: Signal<PartInfo | null>;
  highlights: Highlights;
  reducedMotion: () => boolean;
  /** The TEST simulation, created on first use (keeps MuJoCo and the policy out of the first load). */
  sim(onProgress?: (label: string, fraction: number) => void): Promise<SimulationAdapter>;
  simIfLoaded(): SimulationAdapter | null;
  go(mode: ModeId, params?: ModeParams): Promise<void>;
  mode(): ModeId;
}
