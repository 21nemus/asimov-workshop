// Highlight layers over the single per-part highlight channel. Hover, selection and the modes
// each own a layer; a part shows the strongest highlight any layer gives it.
import type { PartState } from '../robot/part-state.ts';

export class Highlights {
  private readonly layers = new Map<string, Map<number, number>>();
  private readonly state: PartState;

  constructor(state: PartState) {
    this.state = state;
  }

  /** Replaces a layer's contents. */
  set(layer: string, parts: Iterable<number>, amount: number): void {
    const prev = this.layers.get(layer);
    const next = new Map<number, number>();
    for (const i of parts) next.set(i, amount);
    this.layers.set(layer, next);
    const touched = new Set<number>(next.keys());
    if (prev) for (const i of prev.keys()) touched.add(i);
    for (const i of touched) this.resolve(i);
  }

  clear(layer: string): void {
    const prev = this.layers.get(layer);
    if (!prev) return;
    this.layers.delete(layer);
    for (const i of prev.keys()) this.resolve(i);
  }

  clearAll(): void {
    for (const layer of [...this.layers.keys()]) this.clear(layer);
  }

  private resolve(i: number): void {
    let v = 0;
    for (const layer of this.layers.values()) v = Math.max(v, layer.get(i) ?? 0);
    this.state.setHighlight(i, v);
  }
}
