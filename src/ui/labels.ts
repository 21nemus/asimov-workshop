// Screen-space labels pinned to 3D points (leader-line tags). Plain DOM, positioned each frame
// by projecting the anchor; hidden when the anchor is behind the camera or off screen.
import { Vector3, type Camera } from 'three';
import { h } from './dom.ts';

export interface Label {
  el: HTMLElement;
  anchor: () => Vector3;
  /** Screen offset of the tag from its anchor, in CSS pixels. */
  dx: number;
  dy: number;
}

export class LabelLayer {
  readonly el: HTMLElement;
  private labels: Label[] = [];
  private readonly v = new Vector3();

  constructor(parent: HTMLElement) {
    this.el = h('div', { class: 'labels', 'aria-hidden': 'true' });
    parent.prepend(this.el);
  }

  add(text: string, anchor: () => Vector3, dx = 40, dy = -30, sub?: string): Label {
    const el = h('div', { class: 'label3d' }, h('span', { class: 'label3d__tag' }, text, sub ? h('small', null, sub) : null), h('i', { class: 'label3d__line' }));
    this.el.append(el);
    const label = { el, anchor, dx, dy };
    this.labels.push(label);
    return label;
  }

  clear(): void {
    for (const l of this.labels) l.el.remove();
    this.labels = [];
  }

  update(camera: Camera, width: number, height: number): void {
    for (const l of this.labels) {
      this.v.copy(l.anchor()).project(camera);
      const visible = this.v.z < 1 && Math.abs(this.v.x) < 1.1 && Math.abs(this.v.y) < 1.1;
      l.el.style.display = visible ? '' : 'none';
      if (!visible) continue;
      const x = (this.v.x * 0.5 + 0.5) * width, y = (-this.v.y * 0.5 + 0.5) * height;
      l.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      const line = l.el.lastElementChild as HTMLElement;
      const len = Math.hypot(l.dx, l.dy);
      line.style.width = `${len}px`;
      line.style.transform = `rotate(${Math.atan2(l.dy, l.dx)}rad)`;
      (l.el.firstElementChild as HTMLElement).style.transform = `translate(${l.dx}px, ${l.dy}px) translate(${l.dx < 0 ? '-100%' : '0'}, -50%)`;
    }
  }
}
