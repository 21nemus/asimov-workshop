// Builds src/data/assembly.json from the pinned docs export (.reference-cache/docs-llms*.txt):
// every module's documented assembly steps in order, with each step's "Parts needed" table
// (part numbers, actuator IDs, fasteners, cables, consumables and counts) and its docs URL.
// Only structured facts and short step titles are extracted; instruction prose is not copied.
// Usage: node tools/build-assembly.mjs
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const INDEX = readFileSync('.reference-cache/docs-llms.txt', 'utf8');
const FULL = readFileSync('.reference-cache/docs-llms-full.txt', 'utf8');
const sha = (s) => createHash('sha256').update(s).digest('hex');
const pins = JSON.parse(readFileSync('references/pins.json', 'utf8'));
const docsPin = pins.sources.find((s) => s.id === 'docs.menlo.ai');
if (sha(FULL) !== docsPin.files['docs-llms-full.txt'].sha256) throw new Error('docs-llms-full.txt does not match the pin');

const MODULES = [
  { id: 'left-leg', slug: 'left-leg-module', label: 'Left leg', prefix: '600', side: 'left' },
  { id: 'right-leg', slug: 'right-leg-module', label: 'Right leg', prefix: '500', side: 'right' },
  { id: 'pelvis', slug: 'pelvis-module', label: 'Pelvis', prefix: '200' },
  { id: 'left-arm', slug: 'left-arm-module', label: 'Left arm', prefix: '400', side: 'left' },
  { id: 'right-arm', slug: 'right-arm-module', label: 'Right arm', prefix: '300', side: 'right' },
  { id: 'torso', slug: 'torso-module', label: 'Torso and head', prefix: '100' },
];

// ---- index: step titles, group titles and URLs per module, in documented order ----
// A group is the nearest unlinked bullet above a step. Its title can change while the URL slug
// stays (2026-10 docs: "Complete Left Leg Review" became "Left Leg Verification").
const entries = [];
let groupTitle = null;
for (const line of INDEX.split('\n')) {
  const g = line.match(/^\s*- ([^[\]]+?)(?::\s.*)?$/);
  if (g) groupTitle = g[1].trim();
  const m = line.match(/\[(Step \d+: [^\]]+)\]\((\/asimov\/1\/build\/assembly-steps\/([^/]+)\/([^/]+)\/step-(\d+))\)/);
  if (m) entries.push({ title: m[1], path: m[2], moduleSlug: m[3], groupSlug: m[4], groupTitle, n: Number(m[5]) });
}

// ---- full text: split into pages by top-level heading ----
const pages = FULL.split(/\n(?=# [^\n]+\n)/).map((text) => ({ title: text.trim().split('\n', 1)[0].replace(/^# /, '').trim(), text }));

function pickPage(entry, mod) {
  const cands = pages.filter((p) => p.title === entry.title);
  if (cands.length === 1) return cands[0];
  const withPrefix = cands.filter((p) => p.text.includes(`${mod.prefix}_`));
  if (withPrefix.length === 1) return withPrefix[0];
  const bySide = cands.filter((p) => (mod.side ? new RegExp(`\\b${mod.side}\\b`, 'i').test(p.text) : true));
  if (bySide.length === 1) return bySide[0];
  throw new Error(`ambiguous page for ${mod.id} ${entry.title}: ${cands.length} candidates`);
}

function plain(s) {
  return s.replace(/<PartNumber id="([^"]+)">([^<]*)<\/PartNumber>/g, '$2').replace(/<PartNumber id="([^"]+)" \/>/g, '$1').replace(/<\/?[A-Za-z]+[^>]*>/g, '').replace(/\\_/g, '_').replace(/\s+/g, ' ').trim();
}

function parseParts(text) {
  const start = text.indexOf('Parts needed');
  const end = text.indexOf('Instructions', start);
  if (start < 0) return { parts: [], fasteners: [], cables: [], consumables: [], carried: [] };
  const rows = text.slice(start, end > 0 ? end : undefined).split('\n').filter((l) => l.startsWith('|') && !/^\|\s*-+/.test(l) && !/^\|\s*Part\s*\|/.test(l));
  const out = { parts: [], fasteners: [], cables: [], consumables: [], carried: [] };
  for (const row of rows) {
    const cells = row.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 2) continue;
    const [cell, countText] = cells;
    const count = /^\d+$/.test(countText) ? Number(countText) : null;
    const countNote = count === null ? countText : null;
    const pn = [...cell.matchAll(/<PartNumber id="([^"]+)"(?: \/>|>([^<]*)<\/PartNumber>)/g)];
    const bolt = cell.match(/<BoltName>([^<]*)<\/BoltName>/);
    const id = cell.match(/\(ID (\d+)\)/);
    if (/assembly from|Current assembly|Completed .* Module|Thigh assembly|Leg assembly|Foot assembly|Shoulder|Upper arm|Forearm|Pelvis and/i.test(plain(cell)) && !pn.length && !bolt) {
      out.carried.push({ text: plain(cell), count });
    } else if (bolt) {
      out.fasteners.push({ name: bolt[1], count, countNote });
    } else if (pn.length) {
      for (const [, raw, label] of pn) {
        const isAsv = /^\d{3}_\d{2}[A-Z](_SS)?$/.test(raw.replace(/\\_/g, '_'));
        out.parts.push({ raw, partNumber: isAsv ? `ASV1_${raw.replace(/\\_/g, '_')}` : null, label: plain(label ?? '') || null, count, countNote, actuatorId: id ? Number(id[1]) : null, context: plain(cell) });
      }
    } else if (/cable/i.test(cell)) {
      out.cables.push({ name: plain(cell), count, countNote });
    } else {
      out.consumables.push({ name: plain(cell), count, countNote });
    }
  }
  return out;
}

const modules = MODULES.map((mod) => {
  const steps = entries.filter((e) => e.moduleSlug === mod.slug).sort((a, b) => a.n - b.n).map((e) => {
    const page = pickPage(e, mod);
    const parsed = parseParts(page.text);
    return {
      id: `${mod.id}/${String(e.n).padStart(2, '0')}`,
      n: e.n,
      title: e.title.replace(/^Step \d+: /, ''),
      group: e.groupTitle ? e.groupTitle.replace(/\s*[+&]\s*/g, ' and ') : e.groupSlug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bAnd\b/g, 'and'),
      url: `https://docs.menlo.ai${e.path}`,
      ...parsed,
      requires: e.n > 1 ? [`${mod.id}/${String(e.n - 1).padStart(2, '0')}`] : [],
    };
  });
  return { id: mod.id, label: mod.label, prefix: mod.prefix, steps };
});

// Cross-module prerequisites stated by the integration steps.
const req = (mod, n, dep) => { const s = modules.find((m) => m.id === mod).steps.find((x) => x.n === n); s.requires.push(dep); };
const last = (id) => { const m = modules.find((x) => x.id === id); return m.steps.at(-1).id; };
req('pelvis', 7, last('right-leg'));
req('pelvis', 8, last('left-leg'));
req('torso', 5, last('left-arm'));
req('torso', 5, last('right-arm'));
req('torso', 6, last('pelvis'));

const doc = {
  source: { origin: 'https://docs.menlo.ai (llms.txt + llms-full.txt)', sha256: docsPin.files['docs-llms-full.txt'].sha256, retrievedAt: docsPin.retrievedAt, note: 'Step titles, part numbers, counts and URLs are extracted; instruction text is linked, not copied.' },
  modules,
  finish: { title: 'Finish Assembly', url: 'https://docs.menlo.ai/asimov/1/build/assembly-steps/finish-assembly', requires: [last('torso')] },
};
writeFileSync('src/data/assembly.json', JSON.stringify(doc, null, 1));
for (const m of modules) console.log(`${m.label.padEnd(15)} ${m.steps.length} steps, ${m.steps.reduce((n, s) => n + s.parts.length, 0)} part rows, ${m.steps.reduce((n, s) => n + s.fasteners.reduce((k, f) => k + (f.count ?? 0), 0), 0)} fasteners listed`);
const ll = modules[0].steps;
console.log(ll.map((s) => `${s.n}. ${s.title} | parts: ${s.parts.map((p) => (p.partNumber ?? p.raw) + (p.count ? '×' + p.count : '')).join(', ')} | fasteners: ${s.fasteners.map((f) => f.name + '×' + (f.count ?? f.countNote)).join(', ')}`).join('\n'));
