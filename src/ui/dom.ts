// Tiny DOM helpers: no framework, typed element creation and small reactive bindings.

type Child = Node | string | number | null | undefined | false;
type Props = Record<string, unknown> & { class?: string; style?: string | Partial<CSSStyleDeclaration>; on?: Record<string, (e: Event) => void> };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props | null = null, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k === 'style') {
        if (typeof v === 'string') el.setAttribute('style', v);
        else Object.assign(el.style, v);
      } else if (k === 'on') {
        for (const [ev, fn] of Object.entries(v as Record<string, (e: Event) => void>)) el.addEventListener(ev, fn);
      } else if (k === 'dataset') {
        Object.assign(el.dataset, v as Record<string, string>);
      } else if (k in el && typeof v !== 'string') {
        (el as unknown as Record<string, unknown>)[k] = v;
      } else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el: Element, children: (Child | Child[])[]): void {
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.firstChild.remove();
}

export function svg(markup: string, cls = 'icon'): SVGElement {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  const s = t.content.firstElementChild as SVGElement;
  s.classList.add(...cls.split(' '));
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('focusable', 'false');
  return s;
}

/** A minimal observable value. */
export class Signal<T> {
  private v: T;
  private subs = new Set<(v: T) => void>();
  constructor(v: T) {
    this.v = v;
  }
  get value(): T {
    return this.v;
  }
  set(v: T): void {
    if (Object.is(v, this.v)) return;
    this.v = v;
    for (const s of this.subs) s(v);
  }
  subscribe(fn: (v: T) => void, immediate = true): () => void {
    this.subs.add(fn);
    if (immediate) fn(this.v);
    return () => this.subs.delete(fn);
  }
}

export const fmt = {
  num: (v: number, digits = 2) => (Number.isFinite(v) ? v.toFixed(digits) : 'n/a'),
  /** Radians with degrees in brackets, e.g. "0.35 rad (20.1°)". */
  rad: (v: number, digits = 2) => `${v.toFixed(digits)} rad (${((v * 180) / Math.PI).toFixed(1)}°)`,
  mm: (m: number, digits = 1) => `${(m * 1000).toFixed(digits)} mm`,
  sign: (v: number, digits = 2) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}`,
};
