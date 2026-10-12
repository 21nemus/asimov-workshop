// The persistent interface shell: brand, top actions, primary navigation, captions and hints.
import { h } from '../ui/dom.ts';
import { button, Drawer, icon, Panel, toast } from '../ui/components.ts';
import type { ModeId, Ui } from './context.ts';
import type { IconName } from '../ui/icons.ts';
import { sourcesContent } from '../ui/sources.ts';

const NAV: { id: ModeId; label: string; sub: string; icon: IconName; key: string }[] = [
  { id: 'build', label: 'BUILD', sub: 'assemble a leg', icon: 'build', key: 'B' },
  { id: 'understand', label: 'UNDERSTAND', sub: 'how it works', icon: 'understand', key: 'U' },
  { id: 'test', label: 'TEST', sub: 'run the policy', icon: 'test', key: 'T' },
  { id: 'watch', label: 'WATCH', sub: 'guided tour', icon: 'watch', key: 'W' },
];

export interface Shell extends Ui {
  setActive(mode: ModeId): void;
  nav: HTMLElement;
  setChromeHidden(hidden: boolean): void;
}

export function createShell(root: HTMLElement, go: (m: ModeId) => void): Shell {
  const brand = h('button', { type: 'button', class: 'brand', title: 'Back to the workshop (Esc)' }, h('span', { class: 'brand__mark' }, 'ASIMOV WORKSHOP'), h('span', { class: 'brand__line' }, 'Menlo Research’s open-source Asimov 1, from parts to policy'));
  brand.addEventListener('click', () => go('explore'));
  const drawer = new Drawer(root);
  const openSources = () => drawer.openWith('Sources', sourcesContent());
  const sources = button('Sources', { icon: 'sources', kind: 'ghost', onClick: openSources });
  sources.classList.add('chip-btn');
  // Local sharing only: copies a link to the current view (mode and step live in the URL).
  const share = button('Copy link', { icon: 'share', kind: 'ghost', title: 'Copy a link to this view', onClick: () => {
    const url = location.href;
    const done = () => toast(root, 'Link to this view copied.');
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(done, () => toast(root, url, 6000));
    else toast(root, url, 6000);
  } });
  share.classList.add('chip-btn');
  const top = h('div', { class: 'top-actions' }, share, sources);
  const navButtons = new Map<ModeId, HTMLButtonElement>();
  const nav = h('nav', { class: 'nav', 'aria-label': 'Workshop areas' }, ...NAV.map((n) => {
    const b = h('button', { type: 'button', class: 'nav__btn', 'aria-label': `${n.label}: ${n.sub}`, title: `${n.label} (${n.key})` }, icon(n.icon), h('span', null, h('span', { class: 'nav__label' }, n.label), h('span', { class: 'nav__sub' }, n.sub)));
    b.addEventListener('click', () => go(n.id));
    navButtons.set(n.id, b);
    return b;
  }));
  const caption = h('div', { class: 'caption', role: 'status', 'aria-live': 'polite' });
  const hint = h('div', { class: 'hint' });
  // Tab order: brand, Sources, areas, then the panel's content.
  root.append(brand, top, nav);
  const panel = new Panel(root, 'mode-panel');
  root.append(caption, hint);
  return {
    root, panel, drawer, nav, openSources,
    toast: (t) => toast(root, t),
    caption(text, small) {
      if (!text) { caption.classList.remove('caption--in'); return; }
      caption.replaceChildren(text, small ? h('small', null, small) : '');
      caption.classList.add('caption--in');
    },
    hint(text) {
      hint.textContent = text ?? '';
      hint.style.display = text ? '' : 'none';
    },
    setActive(mode) {
      for (const [id, b] of navButtons) {
        if (id === mode) b.setAttribute('aria-current', 'page');
        else b.removeAttribute('aria-current');
      }
    },
    setChromeHidden(hidden) {
      for (const el of [brand, top, nav, hint]) el.style.visibility = hidden ? 'hidden' : '';
    },
  };
}
