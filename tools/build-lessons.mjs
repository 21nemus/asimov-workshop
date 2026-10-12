// Resolves the documented assembly steps (src/data/assembly.json) onto the CAD parts
// (public/robot/parts.json) and writes src/data/lessons.json:
//   - every docs part row -> the CAD part instances it refers to (with a note where the docs
//     abbreviate numbering, e.g. "2 x 600_19X" for CAD 600_19X + 600_20X),
//   - every docs fastener line ("M4x10 Socket bolt x 8") -> that many CAD fasteners of the same
//     size and head type, chosen nearest to the step's parts; mismatched counts are reported,
//   - CAD parts no step mentions (heat-set inserts, pressed bearings) -> "prepared beforehand".
// Usage: node tools/build-lessons.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const assembly = JSON.parse(readFileSync('src/data/assembly.json', 'utf8'));
const { parts } = JSON.parse(readFileSync('public/robot/parts.json', 'utf8'));
const kin = JSON.parse(readFileSync('src/data/kinematics.json', 'utf8'));

// World centre of each part at the MJCF reference pose (rough, for proximity only).
const bodyWorld = new Map(kin.bodies.map((b) => [b.name, b]));
function quatRotate([w, x, y, z], [vx, vy, vz]) {
  const ix = w * vx + y * vz - z * vy, iy = w * vy + z * vx - x * vz, iz = w * vz + x * vy - y * vx, iw = -x * vx - y * vy - z * vz;
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
}
const center = (p) => { const b = bodyWorld.get(p.body); const r = quatRotate(b.xquat0, p.center); return [r[0] + b.xpos0[0], r[1] + b.xpos0[1], r[2] + b.xpos0[2]]; };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
/** Fastener type from a CAD name ("M4 x 10mm DIN 912 [Socket Head].") or a docs name ("M4x10 Socket bolt"). */
function fastenerType(name) {
  const m = name.match(/M(\d+(?:\.\d+)?)\s*(?:X\s*)?x\s*(\d+)\s*m?m?/i) ?? name.match(/M(\d+(?:\.\d+)?)x(\d+)/i);
  if (!m) return null;
  const head = /7991|flat/i.test(name) ? 'flat' : /912|socket|socekt/i.test(name) ? 'socket' : null;
  return head ? `M${m[1]}x${m[2]}-${head}` : null;
}
const cadFastenerType = (p) => (p.kind === 'fastener' && !/Insert|Nut|Washer/i.test(p.name) ? fastenerType(p.name) : null);

const MODULE_CAD = { 'left-leg': 'ASV1_600', 'right-leg': 'ASV1_500', pelvis: 'ASV1_200', 'left-arm': 'ASV1_400', 'right-arm': 'ASV1_300', torso: null };
const used = new Set();
const lessons = [];
for (const mod of assembly.modules) {
  const cadModule = MODULE_CAD[mod.id];
  // Parts belonging to this module in the CAD tree (torso: the ASV1-level parts and the head).
  const inModule = (p) => (cadModule ? p.module === cadModule : p.module === 'ASV1' || p.module === 'ASV1_700' || /^ASV1_(100|700)_/.test(p.partNumber ?? ''));
  const pool = parts.filter(inModule);
  const steps = [];
  const placedCenters = [];
  for (const step of mod.steps) {
    const newParts = [];
    const notes = [];
    for (const row of step.parts) {
      const want = row.count ?? 1;
      let matches = [];
      if (row.partNumber) {
        const pn = row.partNumber.replace(/_SS$/, '');
        const exact = pool.filter((p) => p.partNumber && (p.partNumber === row.partNumber || p.partNumber === `${pn}_SS` || p.partNumber === pn));
        matches = exact.filter((p) => !used.has(p.i));
        if (exact.length && !matches.length) continue; // carried over from an earlier step
        if (matches.length < want && exact.length) {
          // Docs abbreviate repeated hardware with one number; take the following CAD numbers with identical geometry.
          const base = exact[0];
          const dims = (q) => [...q.size].sort((a, b) => a - b);
          const sameShape = (q) => q.cadTriangles === base.cadTriangles && dims(q).every((v, k) => Math.abs(v - dims(base)[k]) < 2e-4);
          const siblings = pool.filter((p) => !used.has(p.i) && p.partNumber && p.partNumber !== base.partNumber && p.partNumber.slice(0, 9) === base.partNumber.slice(0, 9) && sameShape(p));
          siblings.sort((a, b) => a.partNumber.localeCompare(b.partNumber));
          const extra = siblings.slice(0, want - matches.length);
          if (extra.length) notes.push(`Docs list ${want} x ${row.raw}; the CAD numbers them ${[...matches, ...extra].map((p) => p.partNumber).join(', ')} (identical geometry).`);
          matches = [...matches, ...extra];
        }
      } else {
        // Hardware named by supplier ids, e.g. "mirror1602-0032,mirror1600-0515".
        // Supplier ids may carry an instance suffix ("1602-0032-0006-1038") and a "mirror" prefix.
        const keys = row.raw.split(',').map((k) => norm(k.replace(/-\d{3,4}$/, '')));
        matches = pool.filter((p) => !used.has(p.i) && keys.some((k) => norm(p.name).startsWith(k.slice(0, Math.min(k.length, 14)))));
        if (keys.length > 1) {
          // One docs item made of several CAD products: take `want` of each product.
          const byKey = keys.map((k) => matches.filter((p) => norm(p.name).startsWith(k.slice(0, Math.min(k.length, 14)))).slice(0, want));
          matches = byKey.flat();
        } else matches = matches.slice(0, want);
      }
      if (!matches.length) { notes.push(`No CAD part found for docs item ${row.raw}${row.label ? ` (${row.label})` : ''}.`); continue; }
      for (const p of matches) { used.add(p.i); newParts.push(p.i); }
    }
    // Fasteners: nearest unused CAD fasteners of the documented size and head type.
    const anchor = newParts.length ? newParts.map((i) => center(parts[i])) : placedCenters.slice(-6);
    const fastenerGroups = [];
    for (const f of step.fasteners) {
      const type = fastenerType(f.name);
      const want = f.count ?? 0;
      const cands = parts.filter((p) => !used.has(p.i) && cadFastenerType(p) === type && (inModule(p) || p.module === 'Asimov_1' || p.module === 'ASV1'));
      cands.sort((a, b) => Math.min(...anchor.map((c) => dist(center(a), c))) - Math.min(...anchor.map((c) => dist(center(b), c))));
      const near = (p) => Math.min(...anchor.map((c) => dist(center(p), c))) < 0.25;
      let take = cands.slice(0, want).filter(near);
      let status = take.length === want ? 'matched' : take.length ? 'partial' : 'not-in-cad';
      if (take.length < want && type) {
        // Same diameter and head, different length: place the CAD screws, report the difference.
        const [dia, , head] = type.match(/^(M[\d.]+)x(\d+)-(\w+)$/).slice(1);
        const alt = parts.filter((p) => !used.has(p.i) && !take.includes(p) && cadFastenerType(p)?.startsWith(`${dia}x`) && cadFastenerType(p)?.endsWith(`-${head}`) && (inModule(p) || p.module === 'Asimov_1' || p.module === 'ASV1') && near(p));
        alt.sort((a, b) => Math.min(...anchor.map((c) => dist(center(a), c))) - Math.min(...anchor.map((c) => dist(center(b), c))));
        const extra = alt.slice(0, want - take.length);
        if (extra.length) {
          const lengths = [...new Set(extra.map((p) => cadFastenerType(p)))].join(', ');
          notes.push(`${f.name}: the docs specify ${want}; the CAD has ${lengths} at this location (${extra.length}). Shown as modelled in the CAD.`);
          take = [...take, ...extra];
          status = 'length-differs';
        }
      }
      for (const p of take) used.add(p.i);
      fastenerGroups.push({ name: f.name, type, docsCount: f.count, countNote: f.countNote, cad: take.map((p) => p.i), status });
      if (take.length !== want) notes.push(`${f.name}: docs ${want}, CAD ${take.length} found near this step.`);
    }
    for (const i of newParts) placedCenters.push(center(parts[i]));
    steps.push({ id: step.id, n: step.n, title: step.title, group: step.group, url: step.url, requires: step.requires, parts: newParts, fastenerGroups, cables: step.cables, consumables: step.consumables, carried: step.carried, notes });
  }
  // Module parts the steps never mention.
  const prepared = pool.filter((p) => !used.has(p.i) && (/Insert/i.test(p.name) || /11X$|19X$|21X$/.test(p.partNumber ?? '') || p.kind === 'fastener'));
  const leftovers = pool.filter((p) => !used.has(p.i) && !prepared.includes(p));
  for (const p of prepared) used.add(p.i);
  lessons.push({ id: mod.id, label: mod.label, steps, prepared: prepared.map((p) => p.i), unplaced: leftovers.map((p) => p.i) });
  const fastStats = steps.flatMap((s) => s.fastenerGroups);
  console.log(`${mod.label.padEnd(15)} steps ${steps.length}, parts placed ${steps.reduce((n, s) => n + s.parts.length, 0)}, fasteners ${fastStats.reduce((n, g) => n + g.cad.length, 0)}/${fastStats.reduce((n, g) => n + (g.docsCount ?? 0), 0)} matched (${fastStats.filter((g) => g.status === 'matched').length}/${fastStats.length} lines exact), prepared ${prepared.length}, unplaced ${leftovers.length}: ${leftovers.map((p) => p.name).slice(0, 8).join(', ')}`);
}
const allUnused = parts.filter((p) => !used.has(p.i));
writeFileSync('src/data/lessons.json', JSON.stringify({ note: 'Generated by tools/build-lessons.mjs from src/data/assembly.json (docs) and public/robot/parts.json (CAD).', lessons, notInAnyLesson: allUnused.map((p) => p.i) }, null, 1));
console.log(`parts in no lesson: ${allUnused.length} (${[...new Set(allUnused.map((p) => p.name))].slice(0, 12).join(', ')})`);
for (const s of lessons[0].steps) console.log(`  ${s.n}. ${s.title}: ${s.parts.map((i) => parts[i].name).join(', ')} | ${s.fastenerGroups.map((g) => `${g.name} ${g.cad.length}/${g.docsCount}`).join('; ')}${s.notes.length ? '\n     ' + s.notes.join('\n     ') : ''}`);
