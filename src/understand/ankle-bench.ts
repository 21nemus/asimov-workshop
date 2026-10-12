// The mechanism bench: the lower leg leaves the robot and is presented in a clamp on the
// workshop's ankle bench, turned towards the room. Only the robot's mount moves (a display
// transform); nothing here touches the simulation, and everything returns on leaving.
import { BoxGeometry, CylinderGeometry, Group, Matrix4, Mesh, TorusGeometry, Vector3, type Material } from 'three';
import type { RobotModel } from '../robot/robot-model.ts';
import type { Lighting } from '../scene/lighting.ts';
import { HOME, ZONES } from '../scene/layout.ts';
import type { Side } from './ankle-linkage.ts';

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const UP = new Vector3(0, 1, 0);

export class AnkleBench {
  readonly fixture = new Group();
  /** Turn about the vertical that presents the leg's outer side and front to the room. */
  yaw = 0;
  private mount: Group;
  private robot: RobotModel;
  private lighting: Lighting;
  private knee0 = new Vector3();
  private target = new Vector3();
  private p = 0;
  private anim: { from: number; to: number; t: number; dur: number; done?: () => void } | null = null;

  constructor(mount: Group, robot: RobotModel, lighting: Lighting, metal: Material, dark: Material) {
    this.mount = mount;
    this.robot = robot;
    this.lighting = lighting;
    this.mount.matrixAutoUpdate = false;
    // A plain clamp stand: base plate, upright, arm and a split ring around the calf.
    const base = new Mesh(new BoxGeometry(0.22, 0.012, 0.16), dark);
    base.position.y = 0.006;
    const post = new Mesh(new BoxGeometry(0.03, 0.42, 0.03), metal);
    post.position.set(0, 0.21, 0);
    const arm = new Mesh(new BoxGeometry(0.03, 0.03, 0.16), metal);
    arm.name = 'arm';
    const ring = new Mesh(new TorusGeometry(0.062, 0.009, 10, 40), dark);
    ring.name = 'ring';
    ring.rotation.x = Math.PI / 2;
    const knob = new Mesh(new CylinderGeometry(0.012, 0.012, 0.03, 14), dark);
    knob.name = 'knob';
    knob.rotation.z = Math.PI / 2;
    for (const m of [base, post, arm, ring, knob]) { m.castShadow = true; m.receiveShadow = true; this.fixture.add(m); }
    this.fixture.visible = false;
    this.fixture.name = 'ankle-bench-fixture';
  }

  get onBench(): boolean {
    return this.p > 0;
  }

  get moving(): boolean {
    return this.anim !== null;
  }

  /**
   * Call with the robot standing at home and the leg posed straight. The knee is placed so the
   * foot hangs a few centimetres above the bench top, clear of it at any ankle angle.
   */
  present(side: Side, duration: number, done?: () => void): void {
    const bench = ZONES.ankleBench;
    this.apply(0);
    const knee = this.robot.rig.body(`${side}_knee_link`).content;
    knee.updateWorldMatrix(true, false);
    this.knee0.setFromMatrixPosition(knee.matrixWorld);
    // Straight leg: knee origin to sole is about 0.32 m (MJCF chain plus the contact spheres).
    this.target.set(bench.x, bench.top + 0.37, bench.z + 0.06);
    this.yaw = side === 'left' ? -Math.PI / 2 + 0.5 : -Math.PI / 2 - 0.5;
    // The clamp ring goes round the calf housing where it will arrive.
    const housing = this.robot.parts.find((p) => p.partNumber === `ASV1_${side === 'left' ? '600' : '500'}_10C`);
    this.apply(1);
    const at = housing ? this.robot.partWorldCenter(housing) : this.target.clone();
    this.apply(0);
    this.placeFixture(bench.top, at);
    this.animate(1, duration, done);
  }

  /** Back to the robot. */
  retire(duration: number, done?: () => void): void {
    this.animate(0, duration, () => { this.fixture.visible = false; done?.(); });
  }

  /** The mount transform at progress p (0 home, 1 on the bench), applied now. */
  apply(p: number): void {
    this.p = p;
    const pos = this.knee0.clone().lerp(this.target, p);
    const m = new Matrix4().makeTranslation(pos.x, pos.y, pos.z)
      .multiply(new Matrix4().makeRotationAxis(UP, this.yaw * p))
      .multiply(new Matrix4().makeTranslation(-this.knee0.x, -this.knee0.y, -this.knee0.z));
    if (p === 0) m.identity();
    this.mount.matrix.copy(m);
    this.mount.matrixWorldNeedsUpdate = true;
    this.mount.updateWorldMatrix(false, true);
    this.fixture.visible = p > 0.85;
    // The shadow-casting key light follows the leg to the bench.
    const x = HOME.x + (ZONES.ankleBench.x - HOME.x) * p, z = HOME.z + (ZONES.ankleBench.z - HOME.z) * p;
    this.lighting.follow(x, z);
  }

  update(dt: number): void {
    const a = this.anim;
    if (!a) return;
    a.t = Math.min(1, a.t + dt / a.dur);
    this.apply(a.from + (a.to - a.from) * ease(a.t));
    if (a.t >= 1) { this.anim = null; a.done?.(); }
  }

  private animate(to: number, duration: number, done?: () => void): void {
    if (duration <= 0) { this.anim = null; this.apply(to); done?.(); return; }
    this.anim = { from: this.p, to, t: 0, dur: duration, done };
  }

  private placeFixture(top: number, calf: Vector3): void {
    // The upright stands behind the calf (towards the glass); the ring holds it below the knee.
    this.fixture.position.set(calf.x, top, calf.z - 0.13);
    const ringY = Math.min(calf.y, this.target.y - 0.06) - top;
    const arm = this.fixture.getObjectByName('arm')!, ring = this.fixture.getObjectByName('ring')!, knob = this.fixture.getObjectByName('knob')!;
    arm.position.set(0, ringY, 0.04);
    ring.position.set(0, ringY, 0.13);
    knob.position.set(0.075, ringY, 0.13);
  }
}
