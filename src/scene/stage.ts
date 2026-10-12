// Renderer, scene, camera and the frame loop. Owns resizing and an adaptive pixel ratio
// that backs off when frames run long and recovers when there is headroom. It never owns
// simulation state: subscribers get (dt, now) and do their own fixed-step bookkeeping.
import {
  ACESFilmicToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Timer,
  WebGLRenderer,
} from 'three';

export type FrameCallback = (dt: number, now: number) => void;

export interface StageOptions {
  canvas: HTMLCanvasElement;
  maxPixelRatio?: number;
}

export class Stage {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(36, 1, 0.05, 80);
  private readonly timer = new Timer();
  private readonly callbacks = new Set<FrameCallback>();
  private readonly lateCallbacks = new Set<FrameCallback>();
  private readonly maxPixelRatio: number;
  private pixelRatio: number;
  private slowFrames = 0;
  private fastFrames = 0;
  private running = false;
  /** Smoothed frame time in milliseconds (for the stats readout and the adaptive ratio). */
  frameMs = 16.7;
  /** When set, the render loop skips drawing (e.g. the tab is hidden). */
  paused = false;
  /** Screen area covered by UI (side panel, bottom sheet), in CSS pixels. */
  private insets = { right: 0, bottom: 0 };

  constructor({ canvas, maxPixelRatio = 2 }: StageOptions) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.maxPixelRatio = Math.min(maxPixelRatio, window.devicePixelRatio || 1);
    this.pixelRatio = this.maxPixelRatio;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    // Timer.connect resets the delta when the page becomes visible again, so a hidden tab
    // never produces one huge step.
    this.timer.connect(document);
    document.addEventListener('visibilitychange', () => {
      this.paused = document.hidden;
    });
  }

  resize(): void {
    const w = this.renderer.domElement.clientWidth || window.innerWidth;
    const h = this.renderer.domElement.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.applyView(w, h);
  }

  /**
   * Keeps the camera's aim point centred in the part of the screen the UI leaves free, by
   * rendering an off-centre window of a wider virtual image (no change to the orbit itself).
   */
  setInsets(right: number, bottom: number): void {
    if (Math.abs(right - this.insets.right) < 0.5 && Math.abs(bottom - this.insets.bottom) < 0.5) return;
    this.insets = { right, bottom };
    this.applyView(this.renderer.domElement.clientWidth || window.innerWidth, this.renderer.domElement.clientHeight || window.innerHeight);
  }

  private applyView(w: number, h: number): void {
    const { right, bottom } = this.insets;
    this.camera.aspect = w / Math.max(1, h);
    // Shift the frustum by half the covered width/height: the aim point lands in the middle of
    // the free area with no change of zoom.
    if (right > 0.5 || bottom > 0.5) this.camera.setViewOffset(w, h, right / 2, bottom / 2, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  /** Width / height of the part of the canvas the UI leaves free. */
  get freeAspect(): number {
    const w = this.renderer.domElement.clientWidth || window.innerWidth;
    const h = this.renderer.domElement.clientHeight || window.innerHeight;
    return Math.max(1, w - this.insets.right) / Math.max(1, h - this.insets.bottom);
  }

  onFrame(cb: FrameCallback): () => void {
    this.callbacks.add(cb);
    return () => this.callbacks.delete(cb);
  }

  /** Runs after onFrame callbacks, right before rendering (camera rigs, labels). */
  onLateFrame(cb: FrameCallback): () => void {
    this.lateCallbacks.add(cb);
    return () => this.lateCallbacks.delete(cb);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.renderer.setAnimationLoop((time) => this.tick(time));
  }

  renderOnce(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private tick(time: number): void {
    this.timer.update(time);
    const dt = Math.min(this.timer.getDelta(), 0.1);
    if (this.paused) return;
    this.frame(dt, performance.now());
  }

  /**
   * Runs frames with a fixed delta, outside requestAnimationFrame. Development only: lets
   * automated checks drive the app while the page is hidden (no animation frames fire then).
   */
  async manualFrames(n: number, dt = 1 / 60): Promise<void> {
    // A message-channel task drains all pending microtasks (async physics ticks) between
    // frames and, unlike timers, is not throttled in hidden pages.
    const nextTask = () => new Promise<void>((resolve) => { const c = new MessageChannel(); c.port1.onmessage = () => resolve(); c.port2.postMessage(0); });
    for (let i = 0; i < n; i++) {
      this.frame(dt, performance.now());
      await nextTask();
    }
  }

  private frame(dt: number, now: number): void {
    for (const cb of this.callbacks) cb(dt, now);
    for (const cb of this.lateCallbacks) cb(dt, now);
    this.renderer.render(this.scene, this.camera);
    this.frameMs += (dt * 1000 - this.frameMs) * 0.05;
    this.adaptPixelRatio();
  }

  private adaptPixelRatio(): void {
    // Back off when the smoothed frame time stays above ~45 fps, recover below ~58 fps.
    if (this.frameMs > 22) { this.slowFrames++; this.fastFrames = 0; } else if (this.frameMs < 17.3) { this.fastFrames++; this.slowFrames = 0; }
    if (this.slowFrames > 90 && this.pixelRatio > 1) {
      this.pixelRatio = Math.max(1, this.pixelRatio - 0.25);
      this.renderer.setPixelRatio(this.pixelRatio);
      this.resize();
      this.slowFrames = 0;
    } else if (this.fastFrames > 240 && this.pixelRatio < this.maxPixelRatio) {
      this.pixelRatio = Math.min(this.maxPixelRatio, this.pixelRatio + 0.25);
      this.renderer.setPixelRatio(this.pixelRatio);
      this.resize();
      this.fastFrames = 0;
    }
  }

  get currentPixelRatio(): number {
    return this.pixelRatio;
  }

  /** Browser-rendered capture of the current frame (dev evidence and the social preview). */
  capture(type: 'image/png' | 'image/jpeg' = 'image/png', quality = 0.92): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL(type, quality);
  }
}
