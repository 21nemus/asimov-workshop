// Camera director: a constrained orbit for free exploration plus authored moves (focus a
// module, frame a bench, follow the robot). Moves respect prefers-reduced-motion by cutting.
import { MathUtils, PerspectiveCamera, Vector3 } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ROOM } from './layout.ts';

export interface Shot {
  position: [number, number, number];
  target: [number, number, number];
  fov?: number;
}

export interface OrbitLimits {
  minDistance: number;
  maxDistance: number;
  minPolar: number;
  maxPolar: number;
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class CameraDirector {
  readonly controls: OrbitControls;
  private move: { fromP: Vector3; fromT: Vector3; toP: Vector3; toT: Vector3; fromFov: number; toFov: number; t: number; dur: number; resolve: () => void } | null = null;
  private followTarget: (() => Vector3) | null = null;
  private followOffset = new Vector3();
  reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  /** Pulls authored shots back on narrow (portrait) views so subjects still fit. */
  shotScale = 1;
  /** Room box the camera may not leave. */
  bounds = { minX: ROOM.backX + 0.25, maxX: ROOM.frontX - 0.2, minY: 0.12, maxY: ROOM.height - 0.15, minZ: ROOM.rightZ + 0.25, maxZ: ROOM.leftZ - 0.2 };

  readonly camera: PerspectiveCamera;

  constructor(camera: PerspectiveCamera, dom: HTMLElement) {
    this.camera = camera;
    this.controls = new OrbitControls(camera, dom);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.rotateSpeed = 0.7;
    this.controls.zoomSpeed = 0.8;
    this.controls.panSpeed = 0.6;
    this.controls.screenSpacePanning = true;
    this.controls.zoomToCursor = false;
    this.setLimits({ minDistance: 0.45, maxDistance: 5.2, minPolar: 0.2, maxPolar: 1.5 });
    window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => (this.reducedMotion = e.matches));
  }

  setLimits(l: OrbitLimits): void {
    this.controls.minDistance = l.minDistance;
    this.controls.maxDistance = l.maxDistance;
    this.controls.minPolarAngle = l.minPolar;
    this.controls.maxPolarAngle = l.maxPolar;
  }

  get busy(): boolean {
    return this.move !== null;
  }

  /** Authored camera move. Resolves when the move ends (immediately on a cut). */
  goTo(shot: Shot, duration = 1.4): Promise<void> {
    this.followTarget = null;
    const toT = new Vector3(...shot.target);
    const toP = new Vector3(...shot.position).sub(toT).multiplyScalar(this.shotScale).add(toT);
    const toFov = shot.fov ?? this.camera.fov;
    if (this.move) this.move.resolve();
    if (this.reducedMotion || duration <= 0) {
      this.camera.position.copy(toP);
      this.controls.target.copy(toT);
      this.camera.fov = toFov;
      this.camera.updateProjectionMatrix();
      this.controls.update();
      this.move = null;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.move = { fromP: this.camera.position.clone(), fromT: this.controls.target.clone(), toP, toT, fromFov: this.camera.fov, toFov, t: 0, dur: duration, resolve };
    });
  }

  /** Keeps the current view offset while tracking a moving point (TEST follow camera). */
  follow(getTarget: (() => Vector3) | null): void {
    this.followTarget = getTarget;
    if (getTarget) this.followOffset.copy(this.camera.position).sub(this.controls.target);
  }

  cancelMove(): void {
    if (this.move) { this.move.resolve(); this.move = null; }
  }

  update(dt: number): void {
    if (this.move) {
      const m = this.move;
      m.t = Math.min(1, m.t + dt / m.dur);
      const k = ease(m.t);
      this.camera.position.lerpVectors(m.fromP, m.toP, k);
      this.controls.target.lerpVectors(m.fromT, m.toT, k);
      this.camera.fov = MathUtils.lerp(m.fromFov, m.toFov, k);
      this.camera.updateProjectionMatrix();
      if (m.t >= 1) { this.move = null; m.resolve(); }
    } else if (this.followTarget) {
      const t = this.followTarget();
      const desired = new Vector3(t.x, this.controls.target.y, t.z);
      const delta = desired.sub(this.controls.target).multiplyScalar(Math.min(1, dt * 3));
      this.controls.target.add(delta);
      this.camera.position.add(delta);
    }
    this.controls.enabled = this.move === null;
    this.controls.update();
    const b = this.bounds, p = this.camera.position;
    p.set(MathUtils.clamp(p.x, b.minX, b.maxX), MathUtils.clamp(p.y, b.minY, b.maxY), MathUtils.clamp(p.z, b.minZ, b.maxZ));
  }
}
