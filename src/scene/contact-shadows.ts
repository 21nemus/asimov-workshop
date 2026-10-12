// Soft contact shadows: a dark, blurred footprint under each foot that fades as the foot lifts,
// and a faint occlusion pool under the robot. Grounds the robot better than the shadow map alone.
import { CanvasTexture, Group, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, Quaternion, Vector3 } from 'three';
import type { RobotRig } from '../robot/rig.ts';

function radialTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(0.45, 'rgba(0,0,0,0.55)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new CanvasTexture(c);
}

interface Blob { mesh: Mesh; material: MeshBasicMaterial; body: string; base: number }

export class ContactShadows {
  readonly group = new Group();
  private blobs: Blob[] = [];
  private pool: Blob;
  private readonly rig: RobotRig;
  private readonly m = new Matrix4();
  private readonly p = new Vector3();
  private readonly q = new Quaternion();
  private readonly s = new Vector3();
  private readonly fwd = new Vector3();

  constructor(rig: RobotRig) {
    this.rig = rig;
    this.group.name = 'contact-shadows';
    const tex = radialTexture();
    const make = (w: number, d: number, base: number, body: string): Blob => {
      const material = new MeshBasicMaterial({ map: tex, color: 0x000000, transparent: true, opacity: base, depthWrite: false });
      const mesh = new Mesh(new PlaneGeometry(w, d).rotateX(-Math.PI / 2), material);
      mesh.renderOrder = 1;
      mesh.position.y = 0.0015;
      this.group.add(mesh);
      return { mesh, material, body, base };
    };
    // Foot footprint about 0.25 x 0.12 m (MJCF contact spheres span 0.167 x 0.056 m).
    this.blobs = [make(0.3, 0.16, 0.55, 'left_ankle_roll_link'), make(0.3, 0.16, 0.55, 'right_ankle_roll_link')];
    this.pool = make(0.85, 0.6, 0.18, 'pelvis_link');
  }

  /** Call after the rig is posed; `floorY` is the floor height in world space. */
  update(floorY = 0): void {
    for (const b of [...this.blobs, this.pool]) {
      const content = this.rig.body(b.body).content;
      content.updateWorldMatrix(true, false);
      this.m.copy(content.matrixWorld);
      this.m.decompose(this.p, this.q, this.s);
      // Heading from the body's forward axis (MuJoCo +x) projected onto the floor.
      this.fwd.set(1, 0, 0).applyQuaternion(this.q);
      const yaw = Math.atan2(-this.fwd.z, this.fwd.x);
      const isFoot = b !== this.pool;
      // Foot frames sit about 30 mm above the sole; the pool follows the pelvis.
      const height = Math.max(0, this.p.y - floorY - (isFoot ? 0.03 : 0.55));
      const fade = Math.max(0, 1 - height / (isFoot ? 0.09 : 0.35));
      const ahead = isFoot ? 0.035 : 0;
      b.mesh.position.set(this.p.x + Math.cos(yaw) * ahead, floorY + 0.0015, this.p.z - Math.sin(yaw) * ahead);
      b.mesh.rotation.y = yaw;
      b.material.opacity = b.base * fade;
      b.mesh.visible = fade > 0.01;
    }
  }

  set visible(v: boolean) {
    this.group.visible = v;
  }
}
