// A solid force arrow (shaft and head) drawn on top of the scene: the TEST push indicator.
// Its tip sits at the point of application; its length is fixed (it marks a direction and an
// instant, not a magnitude).
import { ConeGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, Quaternion, Vector3 } from 'three';

const UP = new Vector3(0, 1, 0);

export class ForceArrow {
  readonly group = new Group();
  private readonly material: MeshBasicMaterial;
  private readonly length: number;

  constructor(color = '#d9631f', length = 0.42) {
    this.length = length;
    this.material = new MeshBasicMaterial({ color, transparent: true, depthTest: false, depthWrite: false });
    const head = 0.085;
    const shaft = new Mesh(new CylinderGeometry(0.011, 0.011, length - head, 12), this.material);
    shaft.position.y = (length - head) / 2;
    const cone = new Mesh(new ConeGeometry(0.034, head, 20), this.material);
    cone.position.y = length - head / 2;
    for (const m of [shaft, cone]) m.renderOrder = 30;
    this.group.add(shaft, cone);
    this.group.visible = false;
    this.group.name = 'force-arrow';
  }

  /** Points the arrow along `dir` (unit vector) with its tip `gap` metres short of `tip`. */
  place(tip: Vector3, dir: Vector3, gap = 0.03): void {
    this.group.quaternion.copy(new Quaternion().setFromUnitVectors(UP, dir));
    this.group.position.copy(tip).addScaledVector(dir, -(this.length + gap));
  }

  set opacity(v: number) {
    this.material.opacity = v;
  }

  set visible(v: boolean) {
    this.group.visible = v;
  }
}
