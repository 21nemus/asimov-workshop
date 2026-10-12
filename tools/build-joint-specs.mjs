#!/usr/bin/env node
// Extracts Menlo's published Asimov 1 joint and actuator table (docs.menlo.ai, "Full Actuator
// Specifications", and the signed ankle limits of "Joint Direction and Limits") from the pinned
// docs export into src/data/joint-specs.json. Values are copied as written; nothing is derived.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, '.reference-cache/docs-llms-full.txt');
const text = readFileSync(src, 'utf8');
const sha256 = createHash('sha256').update(text).digest('hex');

function tableAfter(heading) {
  const at = text.indexOf(heading);
  if (at < 0) throw new Error(`heading not found: ${heading}`);
  const lines = text.slice(at).split('\n');
  const start = lines.findIndex((l) => l.startsWith('|'));
  const rows = [];
  for (let i = start; i < lines.length && lines[i].startsWith('|'); i++) rows.push(lines[i].split('|').slice(1, -1).map((c) => c.trim()));
  return rows.filter((r) => !/^-+:?$|^:?-+:?$/.test(r[0].replace(/\s/g, '')));
}

const range = (s) => {
  const m = s.match(/(-?\d+(?:\.\d+)?)\s*to\s*(-?\d+(?:\.\d+)?)/);
  return m ? [Number(m[1]), Number(m[2])] : null;
};

// Full Actuator Specifications (first heading occurrence that has the table with an ID column).
const spec = tableAfter('Full Actuator Specifications [#full-actuator-specifications]');
const [head, ...body] = spec;
if (head[0] !== 'ID' || !/Physical role/.test(head[1])) throw new Error(`unexpected table header: ${head.join(' | ')}`);
const actuators = body.map((r) => ({
  id: Number(r[0]),
  role: r[1].replace(/`/g, ''),
  model: r[2].replace(/`/g, ''),
  rangeText: r[3],
  range: range(r[3]),
  velocityLimit: Number(r[4]),
  kt: Number(r[5]),
  armature: Number(r[6]),
  ratedTorque: Number(r[7]),
  peakTorque: Number(r[8]),
  staticFriction: Number(r[9]),
  dynamicFriction: Number(r[10]),
}));

// Signed ankle limits (the actuator table says "See ankle mechanism" for the ankle rows).
const legs = tableAfter('Legs [#legs]');
const ankle = {};
for (const r of legs) {
  if (r[0] === 'Ankle pitch' || r[0] === 'Ankle roll') {
    const key = r[0] === 'Ankle pitch' ? 'ankle_pitch' : 'ankle_roll';
    ankle[`left_${key}_joint`] = { range: range(r[1]), axis: r[2].replace(/`/g, '') };
    ankle[`right_${key}_joint`] = { range: range(r[3]), axis: r[4].replace(/`/g, '') };
  }
}

const out = {
  source: { origin: 'https://docs.menlo.ai/asimov/1 (hardware: joints and actuators)', export: 'docs-llms-full.txt', sha256, note: 'Copied as written. The ankle actuator rows carry joint-space pitch (A) and roll (B) torques; see the ankle mechanism.' },
  actuators,
  ankleJointLimits: ankle,
};
writeFileSync(join(root, 'src/data/joint-specs.json'), JSON.stringify(out, null, 1));
console.log(`wrote src/data/joint-specs.json: ${actuators.length} actuators, ${Object.keys(ankle).length} ankle joint limits (docs sha256 ${sha256.slice(0, 12)})`);
