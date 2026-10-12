// UNDERSTAND: how Asimov 1 is put together and how it moves. Explode and section the hardware,
// compare it with what the simulation actually uses, move any joint through its range, and put
// the parallel ankle under the microscope.
import {
  BoxGeometry, BufferGeometry, CapsuleGeometry, CylinderGeometry, DoubleSide, FrontSide, Line, LineBasicMaterial, Mesh,
  MeshStandardMaterial, Plane, SphereGeometry, Vector3, type Material,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { h, clear, fmt } from '../../ui/dom.ts';
import { button, icon, kv, sectionTitle, segmented, slider, stamp } from '../../ui/components.ts';
import { partCard } from '../../ui/part-card.ts';
import { LabelLayer } from '../../ui/labels.ts';
import { HINGES, KINEMATICS } from '../../robot/kinematics.ts';
import { TRAINED_DEFAULT_POSE } from '../../robot/poses.ts';
import { HOME } from '../../scene/layout.ts';
import { benchLegPose, type AnkleMicroscope } from '../../understand/ankle-microscope.ts';
import type { Side } from '../../understand/ankle-linkage.ts';
import { applyExplode, explodeVectors } from '../../robot/explode.ts';
import specs from '../../data/joint-specs.json' with { type: 'json' };
import type { AppContext, Mode, ModeId, ModeParams } from '../context.ts';
import type { PartHit, PartInfo } from '../../robot/robot-model.ts';
import type { PolicyContract } from '../../simulation/contract.ts';

type View = 'overview' | 'ankle';
type Motion = null | { kind: 'pitch' | 'roll' | 'circle' | 'motorA' | 'motorB'; t: number };

export const UNDERSTAND_SHOT = { position: [HOME.x + 1.75, 1.15, 1.55] as [number, number, number], target: [HOME.x, 0.6, 0] as [number, number, number] };
const DOC_LIMITS = specs.ankleJointLimits as unknown as Record<string, { range: [number, number] }>;
const jointLabel = (name: string) => { const s = name.replace(/_joint$/, '').replace(/_/g, ' '); return s.charAt(0).toUpperCase() + s.slice(1); };
const deg = (r: number, d = 1) => `${((r * 180) / Math.PI).toFixed(d)}°`;
const GROUPS: [string, RegExp][] = [['Left leg', /^left_(hip|knee|ankle)/], ['Right leg', /^right_(hip|knee|ankle)/], ['Waist', /^waist/], ['Left arm', /^left_(shoulder|elbow|wrist)/], ['Right arm', /^right_(shoulder|elbow|wrist)/]];

export class UnderstandMode implements Mode {
  readonly id = 'understand' as const;
  private ctx: AppContext;
  private view: View = 'overview';
  private explode = 0;
  private explodeDirs: Float32Array | null = null;
  private section = false;
  private readonly sectionPlane = new Plane(new Vector3(-1, 0, 0), HOME.x);
  private model: 'hardware' | 'simulation' = 'hardware';
  private collision = false;
  /** MJCF link meshes and collision shapes, each hung on its rig body (loaded on first use). */
  private simMeshes: Mesh[] | null = null;
  private simLinksLoading: Promise<Mesh[]> | null = null;
  private collisionMeshes: Mesh[] | null = null;
  private joint: string | null = null;
  private axisLine: Line | null = null;
  private contract: PolicyContract | null = null;
  private micro: AnkleMicroscope | null = null;
  private side: Side = 'left';
  private labels: LabelLayer;
  private motion: Motion = null;
  private microEls: Record<string, HTMLElement> = {};
  private sliders: { pitch?: ReturnType<typeof slider>; roll?: ReturnType<typeof slider> } = {};
  private active = false;

  constructor(ctx: AppContext) {
    this.ctx = ctx;
    this.labels = new LabelLayer(ctx.ui.root);
  }

  enter(from: ModeId | null, params?: ModeParams): void {
    this.active = true;
    this.ctx.pose.display();
    void fetch(`${this.ctx.base}policy/model_aug_18_1/contract.json`).then((r) => r.json()).then((c: PolicyContract) => { this.contract = c; if (this.active && this.joint) this.renderPanel(); }).catch(() => undefined);
    if (params?.step === 'ankle' || params?.step === 'ankle-right') this.openAnkle(from ? 1.6 : 0, params.step === 'ankle-right' ? 'right' : 'left');
    else this.openOverview(from ? 1.3 : 0);
  }

  exit(): void {
    this.active = false;
    this.closeAnkle(0);
    this.setExplode(0);
    this.setSection(false);
    this.setModel('hardware');
    this.selectJoint(null);
    this.labels.clear();
    this.ctx.highlights.clear('understand');
    this.ctx.pose.display();
  }

  update(dt: number): void {
    if (!this.active) return;
    if (this.view === 'ankle' && this.micro) {
      if (this.motion) this.stepMotion(dt);
      const r = this.micro.update();
      this.renderReadout(r);
    }
    const c = this.ctx.stage.renderer.domElement;
    this.labels.update(this.ctx.stage.camera, c.clientWidth, c.clientHeight);
  }

  key(e: KeyboardEvent): boolean {
    if (e.key === 'Escape' && this.view === 'ankle') { this.openOverview(1.4); return true; }
    if (e.key === 'Escape' && this.joint) { this.selectJoint(null); this.renderPanel(); return true; }
    return false;
  }

  pick(hit: PartHit | null): void {
    if (!hit) return;
    if (this.view === 'overview') {
      const body = this.ctx.robot.rig.body(hit.part.body);
      if (body.joint) { this.selectJoint(body.joint.name); this.renderPanel(); return; }
    }
    this.ctx.ui.drawer.openWith('Part tag', partCard(hit.part));
  }

  hoverable(p: PartInfo): boolean {
    return this.ctx.robot.state.isVisible(p.i);
  }

  // ---------- views ----------
  private openOverview(duration: number): void {
    const wasAnkle = this.view === 'ankle';
    this.view = 'overview';
    history.replaceState(null, '', '#understand');
    this.ctx.ui.hint('Drag to orbit · Click a body to select its joint');
    this.renderPanel();
    if (wasAnkle) this.closeAnkle(duration);
    void this.ctx.camera.goTo(UNDERSTAND_SHOT, duration);
  }

  /** Takes one lower leg off the robot to the mechanism bench and opens its linkage. */
  private openAnkle(duration: number, side: Side = this.side): void {
    if (this.view === 'ankle') this.closeAnkle(0);
    this.selectJoint(null);
    this.setExplode(0);
    this.setSection(false);
    void this.setModel('hardware');
    this.view = 'ankle';
    this.side = side;
    history.replaceState(null, '', side === 'left' ? '#understand/ankle' : '#understand/ankle-right');
    const reduce = this.ctx.reducedMotion();
    const d = reduce ? 0 : duration;
    // Straight leg (the rest of the robot is hidden on the bench), ankle at zero.
    this.ctx.pose.display({ ...TRAINED_DEFAULT_POSE, ...benchLegPose(side) });
    this.micro = this.ctx.microscope(side);
    this.micro.attach();
    this.micro.isolate();
    this.micro.update();
    const bench = this.ctx.bench;
    bench.present(side, d);
    // Frame the leg where it will arrive.
    bench.apply(1);
    const shot = this.micro.shot(bench.yaw);
    bench.apply(0);
    if (d === 0) bench.apply(1);
    void this.ctx.camera.goTo(shot, d);
    this.labels.clear();
    this.micro.addLabels(this.labels);
    this.ctx.ui.hint('Drag the sliders or pick a motion · Esc back to the robot');
    this.renderAnkle();
  }

  private closeAnkle(duration: number, done?: () => void): void {
    if (!this.micro) { done?.(); return; }
    this.motion = null;
    this.labels.clear();
    const micro = this.micro;
    const restore = () => {
      micro.detach();
      const st = this.ctx.robot.state;
      for (let i = 0; i < st.count; i++) { st.setVisible(i, true); st.setDim(i, 0); }
      this.ctx.pose.display();
      done?.();
    };
    this.micro = null;
    if (this.view === 'ankle') this.view = 'overview';
    this.ctx.bench.retire(this.ctx.reducedMotion() ? 0 : duration, restore);
  }

  // ---------- overview tools ----------
  private setExplode(e: number): void {
    this.explode = e;
    if (e > 0 && !this.explodeDirs) this.explodeDirs = explodeVectors(this.ctx.robot);
    if (this.explodeDirs) applyExplode(this.ctx.robot, this.explodeDirs, e);
  }

  private robotMaterials(): Material[] {
    return [...Object.values(this.ctx.robot.materials), this.ctx.robot.ghostMaterial];
  }

  private setSection(on: boolean): void {
    this.section = on;
    this.ctx.stage.renderer.localClippingEnabled = on;
    for (const m of this.robotMaterials()) {
      m.clippingPlanes = on ? [this.sectionPlane] : null;
      m.side = on ? DoubleSide : FrontSide;
      m.needsUpdate = true;
    }
  }

  private async setModel(model: 'hardware' | 'simulation'): Promise<void> {
    this.model = model;
    const sim = model === 'simulation';
    for (const m of this.ctx.robot.meshes.values()) m.visible = !sim;
    if (sim) {
      const meshes = await this.loadSimLinks();
      if (this.model !== 'simulation') return;
      for (const m of meshes) m.visible = true;
    } else for (const m of this.simMeshes ?? []) m.visible = false;
    this.setCollision(sim && this.collision);
  }

  /** The MJCF visual meshes (what the simulation draws), hung on the same rig bodies. */
  private loadSimLinks(): Promise<Mesh[]> {
    if (this.simMeshes) return Promise.resolve(this.simMeshes);
    this.simLinksLoading ??= new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(`${this.ctx.base}robot/sim-links.glb`).then((gltf) => {
      const material = new MeshStandardMaterial({ color: 0xb9bcc1, roughness: 0.55, metalness: 0.05 });
      // GLTFLoader strips dots from node names ("IMU_ORIGIN.STL" -> "IMU_ORIGINSTL"); compare loosely.
      const key = (n: string) => n.replace(/[^A-Za-z0-9]/g, '').toLowerCase().replace(/stl$/, '');
      const byFile = new Map<string, Mesh>();
      gltf.scene.traverse((o) => { if ((o as Mesh).isMesh) byFile.set(key(o.name), o as Mesh); });
      const meshes: Mesh[] = [];
      for (const g of KINEMATICS.geoms) {
        if (!g.mesh) continue;
        const src = byFile.get(key(KINEMATICS.meshFiles[g.mesh]));
        if (!src) continue;
        const mesh = new Mesh(src.geometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        const bodyName = KINEMATICS.bodies[g.body].name;
        mesh.name = `sim:${bodyName}`;
        mesh.visible = false;
        this.ctx.robot.rig.body(bodyName).content.add(mesh);
        meshes.push(mesh);
      }
      this.simMeshes = meshes;
      return meshes;
    });
    return this.simLinksLoading;
  }

  private setCollision(on: boolean): void {
    if (on && !this.collisionMeshes) this.collisionMeshes = this.buildCollision();
    for (const m of this.collisionMeshes ?? []) m.visible = on;
  }

  /** The shapes MuJoCo actually collides with (capsules, spheres, boxes), from the compiled model. */
  private buildCollision(): Mesh[] {
    const material = new MeshStandardMaterial({ color: 0x2c62c9, transparent: true, opacity: 0.45, roughness: 0.4, depthWrite: false });
    const out: Mesh[] = [];
    for (const g of KINEMATICS.geoms) {
      if (!g.collides || g.body === 0) continue;
      let geo: BufferGeometry | null = null;
      // MuJoCo capsules and cylinders run along the geom's z axis; three's along y.
      if (g.type === 'sphere') geo = new SphereGeometry(g.size[0], 16, 12);
      else if (g.type === 'capsule') geo = new CapsuleGeometry(g.size[0], 2 * g.size[1], 6, 16).rotateX(Math.PI / 2);
      else if (g.type === 'cylinder') geo = new CylinderGeometry(g.size[0], g.size[0], 2 * g.size[1], 20).rotateX(Math.PI / 2);
      else if (g.type === 'box') geo = new BoxGeometry(2 * g.size[0], 2 * g.size[1], 2 * g.size[2]);
      if (!geo) continue;
      const mesh = new Mesh(geo, material);
      mesh.position.set(g.pos[0], g.pos[1], g.pos[2]);
      mesh.quaternion.set(g.quat[1], g.quat[2], g.quat[3], g.quat[0]);
      mesh.renderOrder = 12;
      this.ctx.robot.rig.body(KINEMATICS.bodies[g.body].name).content.add(mesh);
      out.push(mesh);
    }
    return out;
  }

  private selectJoint(name: string | null): void {
    this.joint = name;
    this.axisLine?.removeFromParent();
    this.axisLine = null;
    if (!name) { this.ctx.highlights.clear('understand'); return; }
    const robot = this.ctx.robot;
    const body = robot.rig.bodies.find((b) => b.joint?.name === name)!;
    // Highlight everything this joint moves: its body and all bodies below it.
    const below = new Set<string>();
    const walk = (id: number) => { for (const b of KINEMATICS.bodies) if (b.parent === id) { below.add(b.name); walk(b.id); } };
    below.add(body.def.name);
    walk(body.def.id);
    this.ctx.highlights.set('understand', robot.parts.filter((p) => below.has(p.body)).map((p) => p.i), 0.45);
    const j = body.joint!;
    const ax = new Vector3(...j.axis).normalize();
    const pos = new Vector3(...j.pos);
    const geo = new BufferGeometry().setFromPoints([pos.clone().addScaledVector(ax, -0.12), pos.clone().addScaledVector(ax, 0.12)]);
    this.axisLine = new Line(geo, new LineBasicMaterial({ color: 0xd9631f, depthTest: false, transparent: true }));
    this.axisLine.renderOrder = 40;
    body.frame.add(this.axisLine);
  }

  // ---------- panels ----------
  private renderPanel(): void {
    if (this.view !== 'overview') return;
    const { panel } = this.ctx.ui;
    panel.show('Understand', 'How it works');
    clear(panel.body);
    const ex = slider('Explode', { min: 0, max: 1, step: 0.01, value: this.explode, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => this.setExplode(v) });
    const sec = button('Section view', { icon: 'scissors', ariaPressed: this.section, onClick: () => { this.setSection(!this.section); sec.setAttribute('aria-pressed', String(this.section)); } });
    const model = segmented<'hardware' | 'simulation'>('Model', [{ value: 'hardware', label: 'Hardware CAD', icon: 'hardware' }, { value: 'simulation', label: 'Simulation model', icon: 'sim' }], this.model, (v) => { void this.setModel(v); this.renderPanel(); });
    const col = button('Collision shapes', { ariaPressed: this.collision, onClick: () => { this.collision = !this.collision; this.setCollision(this.collision); col.setAttribute('aria-pressed', String(this.collision)); } });
    const ankleCard = h('button', { type: 'button', class: 'area area--feature', 'aria-label': 'Ankle microscope: two actuators, two push rods, one foot' }, icon('ankle'), h('span', null, h('span', { class: 'area__title' }, 'Ankle microscope'), h('span', { class: 'area__text' }, 'Two actuators, two push rods, one foot. Watch the parallel linkage solve every pose.')), icon('next', 'icon area__go'));
    ankleCard.addEventListener('click', () => this.openAnkle(1.6, 'left'));
    panel.body.append(
      h('p', { class: 'lede' }, 'The robot here is the hardware CAD, hung on the simulation’s 23 joints. Take it apart, cut it open, and compare it with the much simpler body the physics engine sees.'),
      ankleCard,
      sectionTitle('Take it apart'),
      ex.el,
      h('div', { class: 'row' }, sec),
      sectionTitle('Hardware or simulation'),
      model.el,
      ...(this.model === 'simulation' ? [h('div', { class: 'row' }, col)] : []),
      h('p', { class: 'note note--sim' }, this.model === 'simulation'
        ? 'The simulation model: Menlo’s MJCF link meshes (drawn only) and, optionally, the capsules, spheres and boxes MuJoCo actually collides with. Each foot touches the floor through four small spheres.'
        : 'Hardware CAD: 1,184 parts from Menlo’s published assembly. The simulation does not use these shapes; switch to see what it does use.'),
      kv([
        ['Mass', h('span', null, h('span', { class: 'mono' }, `${KINEMATICS.totalMass.toFixed(2)} kg`), ' simulation ', stamp('SIM VALUE'), h('br'), h('span', { class: 'mono' }, '35 kg'), ' robot ', stamp('SOURCE SPEC'))],
        ['Height', h('span', null, h('span', { class: 'mono' }, '1.2 m'), ' ', stamp('SOURCE SPEC'))],
        ['Powered joints', h('span', null, h('span', { class: 'mono' }, '25'), ' on the robot ', stamp('SOURCE SPEC'), h('br'), h('span', { class: 'mono' }, '23'), ' in the simulation (neck fixed) ', stamp('SIM VALUE'))],
      ]),
      sectionTitle('Joints', 'drag to move, click a body to select'),
      this.jointPanel(),
    );
  }

  private jointPanel(): HTMLElement {
    const wrap = h('div', { class: 'joints' });
    if (this.joint) {
      const name = this.joint;
      const j = HINGES.find((x) => x.name === name)!;
      const range = j.range ?? [-Math.PI, Math.PI];
      const spec = specs.actuators.find((a) => a.role === name);
      const docRange = spec?.range ?? DOC_LIMITS[name]?.range ?? null;
      const idx = this.contract?.joints.indexOf(name) ?? -1;
      const simTorque = idx >= 0 ? this.contract!.pd.torqueLimit[idx] : null;
      const q = this.ctx.pose.joints[name] ?? 0;
      const s = slider(jointLabel(name), { min: range[0], max: range[1], step: 0.005, value: q, format: (v) => `${v.toFixed(2)} rad (${deg(v)})`, onInput: (v) => this.ctx.pose.setJoint(name, v) });
      const differs = docRange && j.range && (Math.abs(docRange[0] - range[0]) > 0.006 || Math.abs(docRange[1] - range[1]) > 0.006);
      wrap.append(
        h('div', { class: 'tag' },
          h('p', { class: 'tag__pn' }, jointLabel(name)),
          s.el,
          kv([
            ['Sim range', j.range ? h('span', null, h('span', { class: 'mono' }, `${range[0].toFixed(2)} to ${range[1].toFixed(2)} rad`), ' ', stamp('SIM VALUE')) : 'unlimited'],
            ['Docs range', docRange ? h('span', null, h('span', { class: 'mono' }, `${docRange[0].toFixed(2)} to ${docRange[1].toFixed(2)} rad`), ' ', stamp('SOURCE SPEC')) : 'not listed'],
            ['Axis', h('span', { class: 'mono' }, `${j.axis.map((v) => +v.toFixed(3)).join(' ')} (body frame)`)],
            ['Actuator', spec ? h('span', null, h('span', { class: 'mono' }, spec.model), ` · ${spec.ratedTorque} N·m rated, ${spec.peakTorque} N·m peak `, stamp('SOURCE SPEC')) : /ankle/.test(name) ? 'Two actuators through the ankle linkage' : 'not listed'],
            ['Sim torque limit', simTorque !== null ? h('span', null, h('span', { class: 'mono' }, `±${simTorque} N·m`), ' ', stamp('SIM VALUE')) : 'loading'],
          ]),
          differs ? h('p', { class: 'note note--warn' }, 'The documented range and the simulation model’s range differ. Both are shown as published.') : null,
          h('div', { class: 'row' },
            button('Back to standing', { kind: 'quiet', icon: 'reset', onClick: () => { this.ctx.pose.setJoint(name, TRAINED_DEFAULT_POSE[name] ?? 0); s.set(TRAINED_DEFAULT_POSE[name] ?? 0); } }),
            button('Done', { kind: 'quiet', onClick: () => { this.selectJoint(null); this.renderPanel(); } }),
          ),
          /ankle/.test(name) ? button('Open the ankle microscope', { icon: 'ankle', kind: 'primary', onClick: () => this.openAnkle(1.6, name.startsWith('right') ? 'right' : 'left') }) : null,
        ),
      );
    }
    for (const [group, re] of GROUPS) {
      const list = HINGES.filter((j) => re.test(j.name));
      if (!list.length) continue;
      wrap.append(h('p', { class: 'joints__group' }, group), h('div', { class: 'chips' }, ...list.map((j) => {
        const b = h('button', { type: 'button', class: 'chip', 'aria-pressed': String(j.name === this.joint) }, jointLabel(j.name.replace(/^(left|right)_/, '')));
        b.addEventListener('click', () => { this.selectJoint(j.name === this.joint ? null : j.name); this.renderPanel(); });
        return b;
      })));
    }
    wrap.append(h('p', { class: 'fine' }, 'The neck’s two joints are fixed in the simulation model (Menlo locks them for walking), so 23 of the robot’s 25 powered joints move here.'));
    return wrap;
  }

  private renderAnkle(): void {
    const { panel } = this.ctx.ui;
    const m = this.micro!;
    const d = m.model.leg.derived;
    panel.show('Ankle microscope', `Understand · ${this.side} ankle on the bench`);
    clear(panel.body);
    const side = this.side;
    const P = DOC_LIMITS[`${side}_ankle_pitch_joint`].range, R = DOC_LIMITS[`${side}_ankle_roll_joint`].range;
    this.sliders.pitch = slider('Ankle pitch', { min: P[0], max: P[1], step: 0.005, value: 0, format: (v) => `${v.toFixed(3)} rad (${deg(v)})`, onInput: (v) => { this.motion = null; this.ctx.pose.setJoint(`${side}_ankle_pitch_joint`, v); } });
    this.sliders.roll = slider('Ankle roll', { min: R[0], max: R[1], step: 0.002, value: 0, format: (v) => `${v.toFixed(3)} rad (${deg(v)})`, onInput: (v) => { this.motion = null; this.ctx.pose.setJoint(`${side}_ankle_roll_joint`, v); } });
    const sidePick = segmented<Side>('Ankle', [{ value: 'left', label: 'Left ankle' }, { value: 'right', label: 'Right ankle' }], side, (v) => { if (v !== this.side) this.openAnkle(0.01, v); });
    const motions: [Exclude<Motion, null>['kind'], string][] = [['pitch', 'Pitch only'], ['roll', 'Roll only'], ['circle', 'Both'], ['motorA', 'Actuator A alone'], ['motorB', 'Actuator B alone']];
    this.microEls.readout = h('div', { class: 'readout' });
    this.microEls.compare = h('div', { class: 'readout readout--compare' });
    panel.body.append(
      h('p', { class: 'lede' }, 'Neither actuator is “the pitch motor” or “the roll motor”. Both cranks turn for almost any foot motion, and the push rods add them up.'),
      sidePick.el,
      this.sliders.pitch.el, this.sliders.roll.el,
      h('div', { class: 'chips' }, ...motions.map(([kind, label]) => {
        const b = h('button', { type: 'button', class: 'chip' }, label);
        b.addEventListener('click', () => { this.motion = this.ctx.reducedMotion() ? null : { kind, t: 0 }; if (!this.motion) this.applyStatic(kind); });
        return b;
      }), (() => { const b = h('button', { type: 'button', class: 'chip' }, 'Centre'); b.addEventListener('click', () => { this.motion = null; this.setAnkle(0, 0); }); return b; })()),
      sectionTitle('Actuators', stamp('CAD DERIVED')),
      this.microEls.readout,
      sectionTitle('Menlo’s mapping', stamp('SOURCE SPEC')),
      h('p', { class: 'note' }, 'The docs give a small-angle rule: pitch = (A − B)·r/2d, roll = −(A + B)·r/c. With r, d and c measured on the CAD, here is what it predicts from the actuator angles above.'),
      this.microEls.compare,
      sectionTitle('Measured on the CAD', stamp('CAD DERIVED')),
      kv([
        ['Crank radius r', h('span', { class: 'mono' }, `${d.crankRadiusMm.toFixed(1)} mm (both)`)],
        ['Pivot to bar d', h('span', { class: 'mono' }, `${d.pivotToBarMm.toFixed(1)} mm`)],
        ['Bar endpoints c', h('span', { class: 'mono' }, `${d.barEndpointsMm.toFixed(1)} mm apart`)],
        ['Push rods', h('span', { class: 'mono' }, `A ${d.rodLengthMm.A.toFixed(1)} mm, B ${d.rodLengthMm.B.toFixed(1)} mm, ball to ball (bars 194 and 124 mm)`)],
        ['Cross axes', h('span', { class: 'mono' }, `${m.model.leg.ujoint.axisOffsetMm.toFixed(1)} mm apart, as in the simulation model`)],
        ['Lever ratios', h('span', { class: 'mono' }, `pitch ${d.jacobianAB_per_PR[0][0].toFixed(2)}, roll ${Math.abs(d.jacobianAB_per_PR[0][1]).toFixed(2)} (actuator rad per ankle rad)`)],
      ]),
      h('p', { class: 'note note--sim' }, `Why it matters: two actuators rated 36 N·m peak, through these levers, give ${(d.jacobianAB_per_PR[0][0] * 72).toFixed(1)} N·m of pitch and ${(Math.abs(d.jacobianAB_per_PR[0][1]) * 72).toFixed(1)} N·m of roll. Menlo lists 145.4 and 57.6 N·m as the ankle’s joint-space peaks.`),
      h('p', { class: 'note' }, 'In the simulation the ankle is two ideal joints the policy drives directly; on the robot, Menlo converts between joint angles and actuators A and B.'),
      h('p', { class: 'note note--warn' }, h('b', null, 'Approximation. '), 'Rigid links and ideal joints: no compliance, backlash or rod-end clearance. Limited to the documented ankle range (pitch ±0.35 rad, roll ±0.10 rad). Actuator angles are measured positive about the forward axis, zero in the CAD pose; Menlo does not publish its sign convention.'),
      h('div', { class: 'row' },
        button('Sources for this view', { icon: 'sources', onClick: () => this.ctx.ui.drawer.openWith('Ankle sources', ankleSources(this.side)) }),
        button('Back to the robot', { icon: 'prev', kind: 'quiet', onClick: () => this.openOverview(1.4) }),
      ),
    );
  }

  private renderReadout(r: ReturnType<AnkleMicroscope['update']>): void {
    const el = this.microEls.readout;
    if (!el?.isConnected) return;
    const row = (k: string, v: string, s = '') => h('div', null, h('span', null, k), h('b', { class: 'mono' }, v), s ? h('small', null, s) : null);
    el.replaceChildren(
      row('Actuator A', `${fmt.sign(r.actuators.A, 3)} rad`, deg(r.actuators.A)),
      row('Actuator B', `${fmt.sign(r.actuators.B, 3)} rad`, deg(r.actuators.B)),
      row('Foot pitch', `${fmt.sign(r.ankle.pitch, 3)} rad`, deg(r.ankle.pitch)),
      row('Foot roll', `${fmt.sign(r.ankle.roll, 3)} rad`, deg(r.ankle.roll)),
    );
    const ep = r.docs.pitch - r.ankle.pitch, er = r.docs.roll - r.ankle.roll;
    this.microEls.compare.replaceChildren(
      row('Predicted pitch', `${fmt.sign(r.docs.pitch, 3)} rad`, `off by ${deg(Math.abs(ep), 2)}`),
      row('Predicted roll', `${fmt.sign(r.docs.roll, 3)} rad`, `off by ${deg(Math.abs(er), 2)}`),
    );
    if (this.sliders.pitch && this.motion) { this.sliders.pitch.set(r.ankle.pitch); this.sliders.roll!.set(r.ankle.roll); }
  }

  private setAnkle(pitch: number, roll: number): void {
    this.ctx.pose.setJoint(`${this.side}_ankle_pitch_joint`, pitch);
    this.ctx.pose.setJoint(`${this.side}_ankle_roll_joint`, roll);
    this.sliders.pitch?.set(pitch);
    this.sliders.roll?.set(roll);
  }

  /** Reduced motion: show the motion's most telling pose instead of animating it. */
  private applyStatic(kind: Exclude<Motion, null>['kind']): void {
    const m = this.micro!.model;
    if (kind === 'pitch') this.setAnkle(0.3, 0);
    else if (kind === 'roll') this.setAnkle(0, 0.09);
    else if (kind === 'circle') this.setAnkle(0.25, 0.07);
    else { const a = m.fk(kind === 'motorA' ? { A: 0.15, B: 0 } : { A: 0, B: 0.15 }); if (a) this.setAnkle(a.pitch, a.roll); }
  }

  private stepMotion(dt: number): void {
    const mo = this.motion!;
    mo.t += dt;
    const w = (2 * Math.PI) / 4.5;
    const s = Math.sin(mo.t * w), c = Math.cos(mo.t * w);
    if (mo.kind === 'pitch') this.setAnkle(0.33 * s, 0);
    else if (mo.kind === 'roll') this.setAnkle(0, 0.095 * s);
    else if (mo.kind === 'circle') this.setAnkle(0.3 * s, 0.085 * c);
    else {
      // One actuator turns, the other holds: the foot pitches and rolls together. The swing is
      // kept small enough to stay inside the documented roll range.
      const t = mo.kind === 'motorA' ? { A: 0.15 * s, B: 0 } : { A: 0, B: 0.15 * s };
      const a = this.micro!.model.fk(t, this.micro!.readout.ankle);
      if (a) this.setAnkle(a.pitch, a.roll);
    }
  }
}

const CAD_TREE = 'https://github.com/menloresearch/asimov-1/tree/f71f3fe87ddfa6b7aac2a5cddeaad5dbbc19cca7/mechanical/ASV1';

/** What the microscope is built from, with links. */
function ankleSources(side: Side): HTMLElement {
  const a = (href: string, text: string) => h('a', { class: 'ext', href, target: '_blank', rel: 'noopener' }, text, icon('link'));
  const module = side === 'left' ? '600' : '500';
  return h('div', null,
    h('p', { class: 'lede' }, `The ${side} ankle linkage as drawn and solved here.`),
    h('div', { class: 'src' }, h('p', { class: 'src__title' }, 'Geometry ', stamp('CAD DERIVED')),
      h('p', null, `Measured on Menlo’s full-body CAD (asimov-1 @ f71f3fe) by tools/measure-ankle.mjs: ball centres fitted on the four rod-end balls (ASV1_${module}_19X to 22X), actuator axes on the EC-A4310 housings (${module}_15X, ${module}_16X), cross axes on the bores of ${module}_26B.`),
      h('p', null, a(CAD_TREE, 'CAD at f71f3fe'))),
    h('div', { class: 'src' }, h('p', { class: 'src__title' }, 'Mapping and limits ', stamp('SOURCE SPEC')),
      h('p', null, 'Menlo’s small-angle mapping (actuators A and B to pitch and roll) and the documented ankle range, pitch ±0.35 rad and roll ±0.10 rad.'),
      h('p', null, a('https://docs.menlo.ai/asimov/1/overview/system-tour/mechanical#parallel-ankle', 'Parallel ankle, docs.menlo.ai'))),
    h('div', { class: 'src' }, h('p', { class: 'src__title' }, 'In the simulation ', stamp('SIM VALUE')),
      h('p', null, 'The policy’s model drives ankle pitch and roll as two ideal joints (MJCF at asimov-1 @ 35ae7b3). The linkage shown here is explanatory and adds nothing to the physics in TEST.')),
    h('div', { class: 'src' }, h('p', { class: 'src__title' }, 'Model limits ', stamp('APPROXIMATION')),
      h('p', null, 'Rigid links, ideal ball joints, no compliance, backlash or rod-end clearance. Validated in tests/ankle.test.ts: closure at the CAD pose, inverse and forward solutions agree, and the measured levers reproduce Menlo’s 145.4 and 57.6 N·m ankle peaks.')),
  );
}
