// Application bootstrap: progressive loading (shell, lab, robot), then mode wiring, picking,
// keyboard control and deep links (#build, #understand, #test, #watch).
import { Group, Raycaster, Vector2 } from 'three';
import { Stage } from '../scene/stage.ts';
import { createWorkshop } from '../scene/workshop.ts';
import { createLighting } from '../scene/lighting.ts';
import { CameraDirector } from '../scene/camera-director.ts';
import { RobotModel, type PartInfo, type PartHit } from '../robot/robot-model.ts';
import { createMujocoFrameRoot } from '../utils/frames.ts';
import { ContactShadows } from '../scene/contact-shadows.ts';
import { AnkleBench } from '../understand/ankle-bench.ts';
import { AnkleMicroscope } from '../understand/ankle-microscope.ts';
import type { Side } from '../understand/ankle-linkage.ts';
import { HOME } from '../scene/layout.ts';
import { Signal } from '../ui/dom.ts';
import { createShell } from './shell.ts';
import { Highlights } from './highlights.ts';
import { PoseDriver, type AppContext, type Mode, type ModeId, type ModeParams } from './context.ts';
import { ExploreMode, HERO_SHOT } from './modes/explore-mode.ts';
import { TestMode } from './modes/test-mode.ts';
import { BuildMode } from './modes/build-mode.ts';
import { UnderstandMode } from './modes/understand-mode.ts';
import { WatchMode } from './modes/watch-mode.ts';
import type { SimulationAdapter } from '../simulation/adapter.ts';

const MODE_IDS: ModeId[] = ['explore', 'build', 'understand', 'test', 'watch'];

function bootState(text: string, fraction?: number) {
  const boot = document.getElementById('boot');
  if (!boot) return;
  const s = boot.querySelector('.boot__state');
  if (s) s.textContent = text;
  if (fraction !== undefined) (boot.querySelector('.boot__bar span') as HTMLElement).style.width = `${Math.round(fraction * 100)}%`;
}

function parseHash(): { mode: ModeId; params: ModeParams } {
  const [id, arg] = location.hash.replace(/^#/, '').split('/');
  const mode = (MODE_IDS as string[]).includes(id) ? (id as ModeId) : 'explore';
  return { mode, params: arg ? { step: decodeURIComponent(arg) } : {} };
}

export async function startApp(): Promise<void> {
  const base = import.meta.env.BASE_URL;
  const canvas = document.getElementById('stage') as HTMLCanvasElement;
  const uiRoot = document.getElementById('ui') as HTMLElement;
  if (!canvas.getContext('webgl2')) throw new Error('this browser has no WebGL 2');
  const stage = new Stage({ canvas });
  bootState('Setting up the workshop', 0.05);
  const workshop = createWorkshop();
  stage.scene.add(workshop.group);
  const lighting = createLighting(stage.scene, stage.renderer);
  lighting.follow(HOME.x, HOME.z);
  const camera = new CameraDirector(stage.camera, canvas);
  // On a portrait phone the bottom sheet covers the lower part of the screen (38% plus the
  // navigation bar); authored shots pull back so their subject fits the free part.
  const fitShots = () => {
    const w = window.innerWidth, hgt = window.innerHeight;
    const portraitPhone = w <= 720 && hgt > 480;
    camera.shotScale = portraitPhone ? Math.min(1.9, hgt / Math.max(1, hgt - 0.38 * hgt - 60)) : 1;
  };
  fitShots();
  window.addEventListener('resize', fitShots);
  void camera.goTo(HERO_SHOT, 0);
  stage.onLateFrame((dt) => camera.update(dt));
  stage.start();

  // Everything robot-related lives in MuJoCo coordinates under this group; its position is
  // where the simulation's world origin is drawn in the workshop.
  const mjFrame = createMujocoFrameRoot();
  mjFrame.position.set(HOME.x, 0, HOME.z);
  // The mount is a display-only transform above the MuJoCo frame (the mechanism bench moves it).
  const mount = new Group();
  mount.name = 'robot-mount';
  mount.add(mjFrame);
  stage.scene.add(mount);
  const robot = new RobotModel();
  mjFrame.add(robot.rig.root);
  bootState('Loading Asimov 1 (1,184 CAD parts)', 0.1);
  await robot.load(base, (f) => bootState('Loading Asimov 1 (1,184 CAD parts)', 0.1 + f * 0.85));

  const modes = new Map<ModeId, Mode>();
  let current: Mode | null = null;
  const shell = createShell(uiRoot, (m) => void go(m));
  const pose = new PoseDriver(robot);
  const highlights = new Highlights(robot.state);
  const selection = new Signal<PartInfo | null>(null);
  let simPromise: Promise<SimulationAdapter> | null = null;
  let sim: SimulationAdapter | null = null;

  async function go(id: ModeId, params?: ModeParams): Promise<void> {
    const next = modes.get(id);
    if (!next) { shell.toast('This area is still being built.'); return; }
    if (current === next && !params) return;
    const from = current?.id ?? null;
    if (current && current !== next) current.exit(id);
    current = next;
    shell.setActive(id);
    const hash = id === 'explore' ? '' : `#${id}${params?.step ? `/${encodeURIComponent(params.step)}` : ''}`;
    if (location.hash !== hash) history.replaceState(null, '', hash || location.pathname + location.search);
    await next.enter(from, params);
  }

  const bench = new AnkleBench(mount, robot, lighting, workshop.materials.aluminium, workshop.materials.darkMetal);
  stage.scene.add(bench.fixture);
  stage.onFrame((dt) => bench.update(dt));
  const microscopes = new Map<Side, AnkleMicroscope>();
  const ctx: AppContext = {
    base, stage, camera, robot, workshop, lighting, mjFrame, mount, bench, ui: shell, pose, selection, highlights,
    microscope(side) {
      let m = microscopes.get(side);
      if (!m) {
        m = new AnkleMicroscope(robot, side, () => { pose.setJoint(`${side}_ankle_pitch_joint`, 0); pose.setJoint(`${side}_ankle_roll_joint`, 0); });
        microscopes.set(side, m);
      }
      return m;
    },
    reducedMotion: () => camera.reducedMotion,
    sim(onProgress) {
      if (!simPromise) {
        simPromise = (async () => {
          const { SimulationAdapter } = await import('../simulation/adapter.ts');
          sim ??= new SimulationAdapter();
          await sim.initialize({ base, engine: 'mlp', onProgress });
          return sim;
        })();
        simPromise.catch(() => { simPromise = null; });
      }
      return simPromise;
    },
    simIfLoaded: () => (sim?.ctrl ? sim : null),
    go,
    mode: () => current?.id ?? 'explore',
  };
  for (const m of [new ExploreMode(ctx), new BuildMode(ctx), new UnderstandMode(ctx), new TestMode(ctx), new WatchMode(ctx)]) modes.set(m.id, m);

  // Selection and hover highlights.
  selection.subscribe((p) => { if (p) highlights.set('selection', [p.i], 1); else highlights.clear('selection'); });
  let hovered: PartInfo | null = null;
  const setHover = (p: PartInfo | null) => {
    if (p === hovered) return;
    hovered = p;
    if (p) highlights.set('hover', [p.i], 0.42); else highlights.clear('hover');
    canvas.style.cursor = p ? 'pointer' : '';
  };

  // Picking: a click (not a drag) on the canvas goes to the active mode.
  const raycaster = new Raycaster();
  const ndc = new Vector2();
  const pickAt = (x: number, y: number): PartHit | null => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, stage.camera);
    return robot.pick(raycaster, current?.hoverable ? (p) => current!.hoverable!(p) : undefined);
  };
  let down: { x: number; y: number; t: number; id: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId }; });
  canvas.addEventListener('pointerup', (e) => {
    const d = down;
    down = null;
    if (!d || d.id !== e.pointerId || !current?.pick) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 600) return;
    current.pick(pickAt(e.clientX, e.clientY));
  });
  let hoverEvent: PointerEvent | null = null;
  let lastHover = 0;
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || e.buttons) { setHover(null); hoverEvent = null; return; }
    hoverEvent = e;
  });
  canvas.addEventListener('pointerleave', () => { hoverEvent = null; setHover(null); });
  stage.onFrame((_dt, now) => {
    if (!hoverEvent || now - lastHover < 60) return;
    lastHover = now;
    const e = hoverEvent;
    hoverEvent = null;
    setHover(current?.pick ? pickAt(e.clientX, e.clientY)?.part ?? null : null);
  });

  // The 3D view stays centred in the part of the screen the panel leaves free.
  const inset = { right: 0, bottom: 0 };
  stage.onLateFrame((dt) => {
    const p = shell.panel.el;
    let right = 0, bottom = 0;
    if (shell.panel.open && p.offsetWidth > 0) {
      const w = uiRoot.clientWidth, hgt = uiRoot.clientHeight;
      if (p.offsetWidth > w * 0.8) bottom = Math.min(hgt * 0.55, Math.max(0, hgt - p.offsetTop));
      else right = Math.max(0, w - p.offsetLeft);
    }
    const k = camera.reducedMotion ? 1 : 1 - Math.exp(-dt * 7);
    inset.right += (right - inset.right) * k;
    inset.bottom += (bottom - inset.bottom) * k;
    stage.setInsets(inset.right, inset.bottom);
  });

  // Mode updates, then the pose, then the per-part state upload, then the camera and the render.
  const contact = new ContactShadows(robot.rig);
  stage.scene.add(contact.group);
  stage.onFrame((dt) => current?.update?.(dt));
  stage.onFrame((dt) => pose.update(dt));
  stage.onLateFrame(() => { robot.state.flush(); contact.update(0); });

  // After a mouse or touch click on a control, hand focus back to the page so the area's
  // shortcuts (Space, F, R, P, arrows) keep working. Keyboard activation (detail 0) keeps focus.
  uiRoot.addEventListener('click', (e) => {
    const ctl = (e.target as HTMLElement).closest('button');
    if (ctl && e.detail > 0) ctl.blur();
  });
  uiRoot.addEventListener('pointerup', (e) => {
    const range = (e.target as HTMLElement).closest('input[type="range"]') as HTMLInputElement | null;
    if (range && e.pointerType) range.blur();
  });

  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest?.('input, textarea, select, [contenteditable]')) return;
    if ((e.key === ' ' || e.key === 'Enter') && t?.closest?.('button, a, [role="button"], summary')) return;
    if (e.key === 'Escape' && shell.drawer.isOpen) { shell.drawer.close(); e.preventDefault(); return; }
    if (current?.key?.(e)) { e.preventDefault(); return; }
    const nav = ({ b: 'build', u: 'understand', t: 'test', w: 'watch' } as Record<string, ModeId>)[e.key.toLowerCase()];
    if (nav) { e.preventDefault(); void go(nav); return; }
    if (e.key === 'Escape' && current?.id !== 'explore') { e.preventDefault(); void go('explore'); }
  });
  window.addEventListener('hashchange', () => { const r = parseHash(); void go(r.mode, r.params); });

  if (import.meta.env.DEV) {
    // Dev hooks for inspection from the console and automated evidence captures.
    (window as unknown as Record<string, unknown>).__asimov = {
      ctx, go, stage, robot, camera, workshop, lighting, raycaster, ndc, pickAt,
      sim: () => sim,
      async capture(name: string, type: 'image/png' | 'image/jpeg' = 'image/jpeg') {
        const url = stage.capture(type, 0.9);
        const r = await fetch(`/__capture?name=${encodeURIComponent(name)}`, { method: 'POST', body: url });
        return r.ok ? r.text() : `capture failed: ${r.status}`;
      },
    };
  }

  const start = parseHash();
  const entering = go(start.mode, start.params);
  document.getElementById('boot')?.classList.add('boot--done');
  await entering;
}
