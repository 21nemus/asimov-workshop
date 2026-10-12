// Shared interface components: provenance stamps, buttons, panels, the side panel that
// becomes a bottom sheet on phones, the sources drawer and toasts.
import { h, svg } from './dom.ts';
import { ICONS, type IconName } from './icons.ts';

export type Provenance = 'SOURCE SPEC' | 'SIM VALUE' | 'ILLUSTRATIVE' | 'CONCEPT' | 'APPROXIMATION' | 'CAD DERIVED' | 'UNVERIFIED';

const STAMP_HELP: Record<Provenance, string> = {
  'SOURCE SPEC': 'Stated in Menlo documentation, the BOM or the CAD files.',
  'SIM VALUE': 'A value of the simulation model or the policy configuration, not a hardware measurement.',
  ILLUSTRATIVE: 'Shown to explain; not specified by any source.',
  CONCEPT: 'From concept material, not the Asimov 1 design.',
  APPROXIMATION: 'A simplified model valid only in the stated range.',
  'CAD DERIVED': 'Measured from the published CAD by this project.',
  UNVERIFIED: 'Could not be verified against a primary source.',
};

export function stamp(kind: Provenance): HTMLElement {
  return h('span', { class: `stamp stamp--${kind.toLowerCase().replace(/\s+/g, '-')}`, title: STAMP_HELP[kind] }, kind);
}

export function icon(name: IconName, cls = 'icon'): SVGElement {
  return svg(ICONS[name], cls);
}

export function button(label: string, opts: { icon?: IconName; onClick?: () => void; kind?: 'primary' | 'ghost' | 'quiet' | 'danger'; title?: string; disabled?: boolean; ariaPressed?: boolean; key?: string } = {}): HTMLButtonElement {
  // The accessible name is set explicitly: some layouts hide the text label and keep the icon.
  const b = h('button', { type: 'button', class: `btn btn--${opts.kind ?? 'ghost'}`, 'aria-label': label, title: opts.title ?? (opts.key ? `${label} (${opts.key})` : undefined), disabled: opts.disabled ?? false }, opts.icon ? icon(opts.icon) : null, h('span', { class: 'btn__label' }, label));
  if (opts.ariaPressed !== undefined) b.setAttribute('aria-pressed', String(opts.ariaPressed));
  if (opts.onClick) b.addEventListener('click', opts.onClick);
  return b;
}

export function iconButton(name: IconName, label: string, onClick: () => void): HTMLButtonElement {
  const b = h('button', { type: 'button', class: 'icon-btn', 'aria-label': label, title: label }, icon(name));
  b.addEventListener('click', onClick);
  return b;
}

export function kv(rows: [string, Node | string | null | undefined][]): HTMLElement {
  return h('dl', { class: 'kv' }, ...rows.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => [h('dt', null, k), h('dd', null, v as Node | string)]));
}

export function sectionTitle(text: string, aside?: Node | string): HTMLElement {
  return h('div', { class: 'section-title' }, h('h3', null, text), aside ? h('span', { class: 'section-title__aside' }, aside) : null);
}

/** Labelled range input with a live value readout. */
export function slider(label: string, opts: { min: number; max: number; step: number; value: number; format?: (v: number) => string; onInput: (v: number) => void; id?: string }): { el: HTMLElement; input: HTMLInputElement; set: (v: number) => void } {
  const id = opts.id ?? `s-${Math.random().toString(36).slice(2, 8)}`;
  const out = h('output', { class: 'slider__value', for: id });
  const input = h('input', { type: 'range', id, min: String(opts.min), max: String(opts.max), step: String(opts.step), value: String(opts.value) });
  const fmtv = opts.format ?? ((v: number) => v.toFixed(2));
  const sync = () => { out.textContent = fmtv(Number(input.value)); };
  input.addEventListener('input', () => { sync(); opts.onInput(Number(input.value)); });
  sync();
  const el = h('div', { class: 'slider' }, h('label', { class: 'slider__label', for: id }, label), out, input);
  return { el, input, set: (v: number) => { input.value = String(v); sync(); } };
}

export function segmented<T extends string>(label: string, options: { value: T; label: string; icon?: IconName }[], value: T, onChange: (v: T) => void): { el: HTMLElement; set: (v: T) => void } {
  const buttons = options.map((o) => {
    const b = h('button', { type: 'button', class: 'seg__btn', 'aria-pressed': String(o.value === value) }, o.icon ? icon(o.icon) : null, h('span', null, o.label));
    b.addEventListener('click', () => { set(o.value); onChange(o.value); });
    return b;
  });
  const set = (v: T) => buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(options[i].value === v)));
  const el = h('div', { class: 'seg', role: 'group', 'aria-label': label }, ...buttons);
  return { el, set };
}

/** Right-hand panel on wide screens, draggable bottom sheet on phones. */
export class Panel {
  readonly el: HTMLElement;
  readonly body: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly kickerEl: HTMLElement;
  private expanded = false;

  constructor(parent: HTMLElement, id: string) {
    this.titleEl = h('h2', { class: 'panel__title' });
    this.kickerEl = h('p', { class: 'panel__kicker' });
    const grip = h('button', { type: 'button', class: 'panel__grip', 'aria-label': 'Expand or collapse panel' });
    grip.addEventListener('click', () => this.setExpanded(!this.expanded));
    this.body = h('div', { class: 'panel__body' });
    this.el = h('section', { class: 'panel', id, 'aria-labelledby': `${id}-title` }, grip, h('header', { class: 'panel__head' }, this.kickerEl, this.titleEl), this.body);
    this.titleEl.id = `${id}-title`;
    parent.append(this.el);
    let startY = 0, startH = 0, dragging = false;
    grip.addEventListener('pointerdown', (e) => { dragging = true; startY = e.clientY; startH = this.el.getBoundingClientRect().height; grip.setPointerCapture(e.pointerId); });
    grip.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const hpx = Math.max(120, Math.min(window.innerHeight * 0.88, startH + (startY - e.clientY)));
      this.el.style.setProperty('--sheet-h', `${hpx}px`);
    });
    grip.addEventListener('pointerup', () => { dragging = false; });
  }

  setExpanded(v: boolean): void {
    this.expanded = v;
    this.el.classList.toggle('panel--expanded', v);
    this.el.style.removeProperty('--sheet-h');
  }

  show(title: string, kicker = ''): void {
    this.titleEl.textContent = title;
    this.kickerEl.textContent = kicker;
    this.el.classList.add('panel--open');
  }

  hide(): void {
    this.el.classList.remove('panel--open');
  }

  get open(): boolean {
    return this.el.classList.contains('panel--open');
  }
}

export class Drawer {
  readonly el: HTMLElement;
  readonly body: HTMLElement;
  private readonly title: HTMLElement;
  private lastFocus: HTMLElement | null = null;

  constructor(parent: HTMLElement) {
    this.title = h('h2', { class: 'drawer__title', id: 'drawer-title' });
    this.body = h('div', { class: 'drawer__body' });
    const close = iconButton('close', 'Close', () => this.close());
    this.el = h('aside', { class: 'drawer', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'drawer-title', hidden: true }, h('header', { class: 'drawer__head' }, this.title, close), this.body);
    parent.append(this.el);
    this.el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); this.close(); } });
  }

  openWith(title: string, content: Node): void {
    this.lastFocus = document.activeElement as HTMLElement | null;
    this.title.textContent = title;
    this.body.replaceChildren(content);
    this.el.hidden = false;
    requestAnimationFrame(() => this.el.classList.add('drawer--open'));
    (this.el.querySelector('.icon-btn') as HTMLElement | null)?.focus();
  }

  close(): void {
    this.el.classList.remove('drawer--open');
    window.setTimeout(() => { if (!this.el.classList.contains('drawer--open')) this.el.hidden = true; }, 240);
    this.lastFocus?.focus();
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }
}

export function toast(parent: HTMLElement, text: string, ms = 3200): void {
  const t = h('div', { class: 'toast', role: 'status' }, text);
  parent.append(t);
  requestAnimationFrame(() => t.classList.add('toast--in'));
  window.setTimeout(() => { t.classList.remove('toast--in'); window.setTimeout(() => t.remove(), 300); }, ms);
}
