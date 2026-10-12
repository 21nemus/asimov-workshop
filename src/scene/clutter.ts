// Original engineering clutter: generic objects that make the workshop feel used without
// copying any specific item from the reference photos. Seeded so the layout is stable.
import {
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SRGBColorSpace,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import type { PropMaterials } from './props.ts';

function rng(seed: number) {
  let s = Math.floor(Math.abs(seed)) >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
function cast<T extends Mesh>(m: T): T {
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Shelf contents along a shelf of `length` (local X), sitting on y = 0, depth along +Z. */
export function shelfObjects(pm: PropMaterials, length: number, seed: number): Group {
  const g = new Group();
  const r = rng(seed);
  let x = -length / 2 + 0.06;
  while (x < length / 2 - 0.12) {
    const pick = r();
    if (pick < 0.28) {
      // A short row of books.
      const n = 3 + Math.floor(r() * 5);
      for (let k = 0; k < n && x < length / 2 - 0.05; k++) {
        const h = 0.17 + r() * 0.09, t = 0.022 + r() * 0.02;
        const colors = ['#8e2b26', '#2f3e57', '#d9cfb8', '#3a5b4a', '#c69a3c', '#1f1f22', '#a8a29a'];
        const book = cast(new Mesh(new BoxGeometry(t, h, 0.13 + r() * 0.02), pm.plastic(colors[Math.floor(r() * colors.length)], 0.7)));
        book.position.set(x + t / 2, h / 2, 0.08);
        book.rotation.z = k === n - 1 && r() < 0.4 ? 0.18 : 0;
        g.add(book);
        x += t + 0.002;
      }
      x += 0.05;
    } else if (pick < 0.45) {
      // Filament spool.
      const spool = new Group();
      const flange = new CylinderGeometry(0.1, 0.1, 0.008, 40);
      const c = ['#f2f0ea', '#e07a22', '#2b2b2e', '#4a7fc0'][Math.floor(r() * 4)];
      for (const s of [-1, 1]) { const f = cast(new Mesh(flange, pm.plastic('#26272a', 0.4))); f.position.z = s * 0.032; f.rotation.x = Math.PI / 2; spool.add(f); }
      const core = cast(new Mesh(new CylinderGeometry(0.085, 0.085, 0.058, 40), pm.plastic(c, 0.45)));
      core.rotation.x = Math.PI / 2;
      spool.add(core);
      spool.position.set(x + 0.1, 0.1, 0.08);
      g.add(spool);
      x += 0.22;
    } else if (pick < 0.62) {
      // Labelled parts box.
      const w = 0.16 + r() * 0.1, h = 0.09 + r() * 0.07;
      const box = cast(new Mesh(new BoxGeometry(w, h, 0.14), pm.plastic(r() < 0.5 ? '#f3f1ec' : '#d8cdb5', 0.85)));
      box.position.set(x + w / 2, h / 2, 0.08);
      g.add(box);
      x += w + 0.03;
    } else if (pick < 0.74) {
      // Small desk fan.
      const fan = new Group();
      const ring = cast(new Mesh(new TorusGeometry(0.07, 0.008, 8, 32), pm.plastic('#2a2b2e', 0.5)));
      ring.position.y = 0.11;
      fan.add(ring);
      const hub = cast(new Mesh(new CylinderGeometry(0.02, 0.02, 0.03, 16), pm.plastic('#2a2b2e')));
      hub.rotation.x = Math.PI / 2;
      hub.position.y = 0.11;
      fan.add(hub);
      const stem = cast(new Mesh(new CylinderGeometry(0.008, 0.012, 0.05, 10), pm.darkMetal));
      stem.position.y = 0.025;
      fan.add(stem);
      fan.position.set(x + 0.08, 0, 0.08);
      g.add(fan);
      x += 0.18;
    } else if (pick < 0.86) {
      // Coiled cable.
      const coil = cast(new Mesh(new TorusGeometry(0.06, 0.012, 8, 28), pm.plastic(r() < 0.5 ? '#202124' : '#3f74c4', 0.6)));
      coil.rotation.x = Math.PI / 2;
      coil.position.set(x + 0.07, 0.012, 0.08);
      g.add(coil);
      x += 0.16;
    } else {
      // Plant in a pot.
      const pot = cast(new Mesh(new CylinderGeometry(0.05, 0.04, 0.09, 20), pm.plastic('#d8d2c6', 0.8)));
      pot.position.set(x + 0.06, 0.045, 0.08);
      g.add(pot);
      for (let k = 0; k < 7; k++) {
        const leaf = cast(new Mesh(new SphereGeometry(0.035, 10, 8), pm.plastic('#3f6b3b', 0.7)));
        leaf.scale.set(1, 0.45, 0.7);
        leaf.position.set(x + 0.06 + (r() - 0.5) * 0.06, 0.1 + r() * 0.06, 0.08 + (r() - 0.5) * 0.06);
        leaf.rotation.set(r(), r() * 3, r());
        g.add(leaf);
      }
      x += 0.14;
    }
  }
  return g;
}

function screenTexture(kind: 'scope' | 'code'): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 160;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = kind === 'scope' ? '#0e1512' : '#101216';
  ctx.fillRect(0, 0, 256, 160);
  if (kind === 'scope') {
    ctx.strokeStyle = 'rgba(120,160,140,0.25)';
    for (let i = 0; i < 10; i++) { ctx.beginPath(); ctx.moveTo(i * 25.6, 0); ctx.lineTo(i * 25.6, 160); ctx.stroke(); }
    for (let i = 0; i < 8; i++) { ctx.beginPath(); ctx.moveTo(0, i * 20); ctx.lineTo(256, i * 20); ctx.stroke(); }
    ctx.strokeStyle = '#e8c34a'; ctx.lineWidth = 2; ctx.beginPath();
    for (let x = 0; x < 256; x++) { const y = 60 + Math.sin(x * 0.12) * 24 * Math.exp(-x / 300); x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
    ctx.stroke();
    ctx.strokeStyle = '#4fc1e9'; ctx.beginPath();
    for (let x = 0; x < 256; x++) { const y = 115 + (Math.floor(x / 32) % 2 ? -12 : 12); x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
    ctx.stroke();
  } else {
    const colors = ['#8fb3d9', '#d3a05a', '#9ccc8f', '#c9c5bd'];
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = colors[i % colors.length];
      ctx.fillRect(14 + (i % 3) * 10, 10 + i * 10, 40 + ((i * 37) % 140), 4);
    }
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Assembly bench clutter: anti-static mat, parts trays, tools, a laptop. Local frame: bench top at y = 0. */
export function benchClutter(pm: PropMaterials, length: number, depth: number): Group {
  const g = new Group();
  const esd = cast(new Mesh(new BoxGeometry(length * 0.62, 0.003, depth * 0.72), new MeshStandardMaterial({ color: new Color('#5d7686'), roughness: 0.85 })));
  esd.position.set(-length * 0.08, 0.0015, 0.02);
  g.add(esd);
  // Divided parts trays at the back of the bench.
  for (let k = 0; k < 3; k++) {
    const tray = new Group();
    const base = cast(new Mesh(new BoxGeometry(0.34, 0.012, 0.22), pm.plastic('#26272a', 0.6)));
    base.position.y = 0.006;
    tray.add(base);
    for (const [w, d, x, z] of [[0.34, 0.006, 0, 0.107], [0.34, 0.006, 0, -0.107], [0.006, 0.22, 0.167, 0], [0.006, 0.22, -0.167, 0], [0.006, 0.22, 0, 0], [0.34, 0.006, 0, 0]] as const) {
      const wall = cast(new Mesh(new BoxGeometry(w, 0.04, d), pm.plastic('#26272a', 0.6)));
      wall.position.set(x, 0.02, z);
      tray.add(wall);
    }
    tray.position.set(length / 2 - 0.25 - k * 0.37, 0, -depth / 2 + 0.16);
    g.add(tray);
  }
  // Screwdrivers and hex keys.
  for (let k = 0; k < 4; k++) {
    const handle = cast(new Mesh(new CylinderGeometry(0.012, 0.012, 0.1, 12), pm.plastic(k % 2 ? '#e07a22' : '#1f2023', 0.5)));
    handle.rotation.z = Math.PI / 2;
    handle.rotation.y = 0.3 + k * 0.05;
    handle.position.set(-length * 0.35 + k * 0.05, 0.012, depth * 0.22);
    g.add(handle);
    const shaft = cast(new Mesh(new CylinderGeometry(0.003, 0.003, 0.09, 8), pm.aluminium));
    shaft.rotation.z = Math.PI / 2;
    shaft.rotation.y = 0.3 + k * 0.05;
    shaft.position.set(-length * 0.35 + k * 0.05 + 0.09, 0.012, depth * 0.22 - 0.028);
    g.add(shaft);
  }
  // Laptop.
  const lap = new Group();
  lap.add(cast(new Mesh(new BoxGeometry(0.32, 0.012, 0.22), pm.plastic('#9a9da2', 0.35))));
  const lid = cast(new Mesh(new BoxGeometry(0.32, 0.21, 0.008), pm.plastic('#9a9da2', 0.35)));
  lid.position.set(0, 0.1, -0.11);
  lid.rotation.x = -0.25;
  lap.add(lid);
  const screen = new Mesh(new BoxGeometry(0.29, 0.18, 0.001), new MeshStandardMaterial({ map: screenTexture('code'), emissiveMap: screenTexture('code'), emissive: new Color('#ffffff'), emissiveIntensity: 0.6, roughness: 0.3 }));
  screen.position.set(0, 0.1, -0.105);
  screen.rotation.x = -0.25;
  lap.add(screen);
  lap.position.set(-length / 2 + 0.28, 0.006, -0.02);
  lap.rotation.y = 0.35;
  g.add(lap);
  return g;
}

/** Electronics desk: bench supply, oscilloscope, soldering station, monitor. */
export function electronicsDesk(pm: PropMaterials): Group {
  const g = new Group();
  const top = cast(new Mesh(new BoxGeometry(1.5, 0.03, 0.66), pm.plastic('#d9d6cf', 0.6)));
  top.position.y = 0.76;
  g.add(top);
  for (const sx of [-0.7, 0.7]) for (const sz of [-0.28, 0.28]) {
    const leg = cast(new Mesh(new BoxGeometry(0.04, 0.76, 0.04), pm.darkMetal));
    leg.position.set(sx, 0.38, sz);
    g.add(leg);
  }
  const scope = cast(new Mesh(new BoxGeometry(0.34, 0.17, 0.14), pm.plastic('#2e3033', 0.5)));
  scope.position.set(-0.35, 0.86, 0.12);
  g.add(scope);
  const scopeScreen = new Mesh(new BoxGeometry(0.2, 0.12, 0.002), new MeshStandardMaterial({ map: screenTexture('scope'), emissiveMap: screenTexture('scope'), emissive: new Color('#ffffff'), emissiveIntensity: 0.8 }));
  scopeScreen.position.set(-0.39, 0.86, 0.192);
  g.add(scopeScreen);
  const psu = cast(new Mesh(new BoxGeometry(0.22, 0.13, 0.26), pm.plastic('#d4d1c9', 0.5)));
  psu.position.set(0.05, 0.84, 0.08);
  g.add(psu);
  for (const [x, c] of [[0.0, '#c8382c'], [0.04, '#1f1f22'], [0.1, '#3f74c4']] as const) {
    const jack = cast(new Mesh(new CylinderGeometry(0.008, 0.008, 0.01, 12), pm.plastic(c, 0.4)));
    jack.rotation.x = Math.PI / 2;
    jack.position.set(x - 0.02, 0.8, 0.215);
    g.add(jack);
  }
  const iron = cast(new Mesh(new BoxGeometry(0.16, 0.09, 0.18), pm.plastic('#c43a2e', 0.45)));
  iron.position.set(0.42, 0.82, 0.1);
  g.add(iron);
  const monitor = new Group();
  const panel = cast(new Mesh(new BoxGeometry(0.62, 0.36, 0.03), pm.plastic('#1b1c1f', 0.4)));
  panel.position.y = 0.32;
  monitor.add(panel);
  const disp = new Mesh(new BoxGeometry(0.58, 0.32, 0.002), new MeshStandardMaterial({ map: screenTexture('code'), emissiveMap: screenTexture('code'), emissive: new Color('#ffffff'), emissiveIntensity: 0.5 }));
  disp.position.set(0, 0.32, 0.017);
  monitor.add(disp);
  const neck = cast(new Mesh(new BoxGeometry(0.05, 0.18, 0.03), pm.darkMetal));
  neck.position.y = 0.09;
  monitor.add(neck);
  monitor.position.set(0.1, 0.775, -0.18);
  g.add(monitor);
  return g;
}
