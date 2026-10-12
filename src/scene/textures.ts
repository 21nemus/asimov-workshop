// Procedural textures for the workshop, drawn into canvases at startup. Original work:
// no photographs or third-party texture files are used.
import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';

type Rand = () => number;
function rng(seed: number): Rand {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}
function tex(c: HTMLCanvasElement, srgb = true, repeat: [number, number] = [1, 1]): Texture {
  const t = new CanvasTexture(c);
  if (srgb) t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 8;
  return t;
}

/** Value noise field, tileable, for grain and mottling. */
function noiseField(size: number, cells: number, rand: Rand): Float32Array {
  const g = Array.from({ length: cells * cells }, () => rand());
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const fx = (x / size) * cells, fy = (y / size) * cells;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const v = (ix: number, iy: number) => g[((iy % cells) + cells) % cells * cells + (((ix % cells) + cells) % cells)];
    out[y * size + x] = (v(x0, y0) * (1 - sx) + v(x0 + 1, y0) * sx) * (1 - sy) + (v(x0, y0 + 1) * (1 - sx) + v(x0 + 1, y0 + 1) * sx) * sy;
  }
  return out;
}

/**
 * Interlocking black rubber gym tiles (about 0.5 m), with subtle seams, speckle and wear.
 * One texture covers a 2 x 2 block of tiles.
 */
export function rubberTiles(): { map: Texture; roughness: Texture; bump: Texture } {
  const size = 1024;
  const rand = rng(31);
  const [c, ctx] = canvas(size, size);
  const [rc, rctx] = canvas(size, size);
  const [bc, bctx] = canvas(size, size);
  const n1 = noiseField(size, 8, rand), n2 = noiseField(size, 64, rand);
  const img = ctx.createImageData(size, size), rimg = rctx.createImageData(size, size), bimg = bctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const speck = rand() < 0.035 ? (rand() - 0.3) * 30 : 0;
    const base = 40 + (n1[i] - 0.5) * 10 + (n2[i] - 0.5) * 8 + speck;
    img.data[4 * i] = base; img.data[4 * i + 1] = base + 1; img.data[4 * i + 2] = base + 3; img.data[4 * i + 3] = 255;
    const r = 205 + (n2[i] - 0.5) * 50 - (n1[i] - 0.5) * 40;
    rimg.data[4 * i] = rimg.data[4 * i + 1] = rimg.data[4 * i + 2] = r; rimg.data[4 * i + 3] = 255;
    const b = 128 + (n2[i] - 0.5) * 60 + (rand() - 0.5) * 30;
    bimg.data[4 * i] = bimg.data[4 * i + 1] = bimg.data[4 * i + 2] = b; bimg.data[4 * i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0); rctx.putImageData(rimg, 0, 0); bctx.putImageData(bimg, 0, 0);
  // Puzzle-edge seams between tiles.
  const seam = (g: CanvasRenderingContext2D, color: string, width: number) => {
    g.strokeStyle = color;
    g.lineWidth = width;
    const half = size / 2;
    for (const horizontal of [true, false]) for (const at of [0, half]) {
      g.beginPath();
      for (let t = 0; t <= size; t += 4) {
        const tooth = Math.sin((t / size) * Math.PI * 16) > 0 ? 7 : -7;
        const p = at + tooth;
        if (horizontal) (t === 0 ? g.moveTo(t, p) : g.lineTo(t, p));
        else (t === 0 ? g.moveTo(p, t) : g.lineTo(p, t));
      }
      g.stroke();
    }
  };
  seam(ctx, 'rgba(12,12,13,0.95)', 3);
  seam(rctx, 'rgb(255,255,255)', 3);
  seam(bctx, 'rgb(40,40,40)', 4);
  return { map: tex(c), roughness: tex(rc, false), bump: tex(bc, false) };
}

/** Pale birch pegboard: ply grain plus a grid of 6 mm holes at 25 mm pitch. One texture = 1 m x 1 m. */
export function pegboard(): { map: Texture; alpha: Texture; bump: Texture } {
  const size = 1024;
  const rand = rng(77);
  const [c, ctx] = canvas(size, size);
  const [ac, actx] = canvas(size, size);
  const [bc, bctx] = canvas(size, size);
  const n = noiseField(size, 6, rand);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const grain = Math.sin((y + n[i] * 60) * 0.09 + Math.sin(x * 0.004) * 4) * 0.5 + 0.5;
    const r = 214 + grain * 12 + (n[i] - 0.5) * 22;
    img.data[4 * i] = r; img.data[4 * i + 1] = r - 26 + grain * 4; img.data[4 * i + 2] = r - 74; img.data[4 * i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  actx.fillStyle = '#fff';
  actx.fillRect(0, 0, size, size);
  bctx.fillStyle = 'rgb(140,140,140)';
  bctx.fillRect(0, 0, size, size);
  const pitch = size / 40; // 25 mm on a 1 m tile
  const r = pitch * 0.13;
  for (let gy = 0; gy < 40; gy++) for (let gx = 0; gx < 40; gx++) {
    const cx = (gx + 0.5) * pitch, cy = (gy + 0.5) * pitch;
    ctx.fillStyle = 'rgba(70,55,35,0.9)';
    ctx.beginPath(); ctx.arc(cx, cy, r * 1.25, 0, Math.PI * 2); ctx.fill();
    actx.fillStyle = '#000';
    actx.beginPath(); actx.arc(cx, cy, r, 0, Math.PI * 2); actx.fill();
    bctx.fillStyle = 'rgb(60,60,60)';
    bctx.beginPath(); bctx.arc(cx, cy, r * 1.3, 0, Math.PI * 2); bctx.fill();
  }
  return { map: tex(c), alpha: tex(ac, false), bump: tex(bc, false) };
}

/** Painted plaster wall with faint roller texture. */
export function paintedWall(hex = '#ebe8e3'): Texture {
  const size = 512;
  const rand = rng(5);
  const [c, ctx] = canvas(size, size);
  ctx.fillStyle = hex;
  ctx.fillRect(0, 0, size, size);
  const n = noiseField(size, 16, rand);
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < size * size; i++) {
    const d = (n[i] - 0.5) * 7 + (rand() - 0.5) * 4;
    img.data[4 * i] += d; img.data[4 * i + 1] += d; img.data[4 * i + 2] += d;
  }
  ctx.putImageData(img, 0, 0);
  return tex(c);
}

/** Smooth grey concrete for the floor outside the rubber mat. */
export function concrete(): { map: Texture; roughness: Texture } {
  const size = 1024;
  const rand = rng(91);
  const [c, ctx] = canvas(size, size);
  const [rc, rctx] = canvas(size, size);
  const n1 = noiseField(size, 5, rand), n2 = noiseField(size, 48, rand);
  const img = ctx.createImageData(size, size), rimg = rctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = 168 + (n1[i] - 0.5) * 26 + (n2[i] - 0.5) * 10 + (rand() - 0.5) * 6;
    img.data[4 * i] = v; img.data[4 * i + 1] = v - 1; img.data[4 * i + 2] = v - 4; img.data[4 * i + 3] = 255;
    const r = 120 + (n1[i] - 0.5) * 60 + (n2[i] - 0.5) * 40;
    rimg.data[4 * i] = rimg.data[4 * i + 1] = rimg.data[4 * i + 2] = r; rimg.data[4 * i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0); rctx.putImageData(rimg, 0, 0);
  return { map: tex(c), roughness: tex(rc, false) };
}

/** Fine wood for bench tops (birch ply edge stripes visible on the sides are geometry). */
export function benchTop(): Texture {
  const size = 512;
  const rand = rng(13);
  const [c, ctx] = canvas(size, size);
  const n = noiseField(size, 5, rand);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const g = Math.sin((x + n[i] * 80) * 0.11) * 0.5 + 0.5;
    const v = 190 + g * 16 + (n[i] - 0.5) * 18;
    img.data[4 * i] = v; img.data[4 * i + 1] = v - 30; img.data[4 * i + 2] = v - 78; img.data[4 * i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return tex(c);
}

/** A small printed label (part tags, bin labels, signage) as a texture. */
export function labelTexture(lines: string[], opts: { w?: number; h?: number; bg?: string; fg?: string; font?: string } = {}): Texture {
  const w = opts.w ?? 512, h = opts.h ?? 128;
  const [c, ctx] = canvas(w, h);
  ctx.fillStyle = opts.bg ?? '#f2efe8';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = opts.fg ?? '#17181b';
  ctx.font = opts.font ?? `600 ${Math.round(h * 0.34)}px "Barlow Condensed", sans-serif`;
  ctx.textBaseline = 'middle';
  lines.forEach((line, k) => ctx.fillText(line, h * 0.18, (h / (lines.length + 1)) * (k + 1)));
  return tex(c);
}

/**
 * A used whiteboard: faint ghosting from old notes, and a marker sketch of a parallel ankle
 * (two cranks, two rods, a foot on a cross) with a few working notes. Original drawing.
 */
export function whiteboard(): Texture {
  const W = 1536, H = 768;
  const rand = rng(77);
  const [c, ctx] = canvas(W, H);
  ctx.fillStyle = '#f7f7f4';
  ctx.fillRect(0, 0, W, H);
  // Ghosting of erased writing.
  ctx.strokeStyle = 'rgba(120,130,150,0.07)';
  ctx.lineWidth = 6;
  for (let k = 0; k < 40; k++) {
    ctx.beginPath();
    const x = rand() * W, y = rand() * H;
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(x + rand() * 160, y + (rand() - 0.5) * 40, x + rand() * 260, y + (rand() - 0.5) * 40, x + 120 + rand() * 260, y + (rand() - 0.5) * 30);
    ctx.stroke();
  }
  const pen = (color: string, w: number) => { ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; };
  const wobble = (pts: [number, number][]) => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => { const jx = x + (rand() - 0.5) * 2.5, jy = y + (rand() - 0.5) * 2.5; if (i) ctx.lineTo(jx, jy); else ctx.moveTo(jx, jy); });
    ctx.stroke();
  };
  const circle = (x: number, y: number, r: number) => { ctx.beginPath(); ctx.ellipse(x, y, r, r * (0.96 + rand() * 0.08), rand(), 0, Math.PI * 2); ctx.stroke(); };
  // Calf outline with two actuators and cranks.
  pen('#23324d', 6);
  wobble([[260, 90], [430, 90], [455, 560], [300, 600], [250, 300], [260, 90]]);
  circle(345, 200, 46); circle(355, 360, 46);
  pen('#c2410c', 6);
  wobble([[345, 200], [290, 214]]); wobble([[355, 360], [412, 346]]);
  circle(290, 214, 9); circle(412, 346, 9);
  // Rods down to the foot bar.
  pen('#23324d', 5);
  wobble([[290, 214], [318, 640]]); wobble([[412, 346], [404, 640]]);
  // Foot and cross.
  pen('#23324d', 6);
  wobble([[200, 700], [560, 700], [600, 650], [470, 610], [260, 620], [200, 700]]);
  ctx.strokeRect(332, 596, 36, 36);
  pen('#1f6f43', 4);
  ctx.setLineDash([14, 10]);
  wobble([[350, 560], [350, 690]]);
  ctx.setLineDash([]);
  // Notes.
  ctx.font = '600 46px "Barlow Condensed", "Arial Narrow", sans-serif';
  pen('#23324d', 3);
  ctx.fillText('ANKLE A / B', 640, 140);
  ctx.font = '500 36px "Barlow Condensed", "Arial Narrow", sans-serif';
  ctx.fillText('pitch: A and B opposite', 640, 210);
  ctx.fillText('roll: A and B together', 640, 262);
  pen('#c2410c', 3);
  ctx.fillText('check rod-end play', 640, 330);
  pen('#23324d', 4);
  wobble([[630, 350], [960, 352]]);
  // A small torque curve sketch.
  pen('#23324d', 4);
  wobble([[1080, 560], [1080, 300]]); wobble([[1080, 560], [1420, 560]]);
  pen('#1f6f43', 5);
  ctx.beginPath();
  for (let x = 0; x <= 320; x += 8) { const y = 540 - 200 * Math.exp(-((x - 110) ** 2) / 9000) - x * 0.15; if (x) ctx.lineTo(1090 + x, y); else ctx.moveTo(1090 + x, y); }
  ctx.stroke();
  ctx.font = '500 32px "Barlow Condensed", "Arial Narrow", sans-serif';
  pen('#23324d', 3);
  ctx.fillText('push test, lateral', 1100, 290);
  return tex(c);
}
