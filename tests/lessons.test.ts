// The documented assembly data behind BUILD: every left-leg step is present in order, every
// CAD part a step names exists, and fastener counts are reported as written in the docs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import lessons from '../src/data/lessons.json' with { type: 'json' };
import parts from '../public/robot/parts.json' with { type: 'json' };

const L = (lessons as unknown as { lessons: { id: string; steps: { id: string; n: number; parts: number[]; fastenerGroups: { docsCount: number | null; cad: number[]; status: string }[]; requires: string[] }[]; prepared: number[] }[] }).lessons;
const P = (parts as unknown as { parts: { i: number; module: string }[] }).parts;

test('six modules, left leg has the 14 documented steps in order', () => {
  assert.deepEqual(L.map((l) => l.id), ['left-leg', 'right-leg', 'pelvis', 'left-arm', 'right-arm', 'torso']);
  const leg = L[0];
  assert.equal(leg.steps.length, 14);
  leg.steps.forEach((s, k) => assert.equal(s.n, k + 1));
  for (let k = 1; k < leg.steps.length; k++) assert.ok(leg.steps[k].requires.includes(leg.steps[k - 1].id));
});

test('left-leg steps reference real left-leg CAD parts only', () => {
  for (const s of L[0].steps) {
    for (const i of s.parts) assert.ok(P[i], `missing part ${i}`);
    for (const g of s.fastenerGroups) for (const i of g.cad) assert.ok(P[i], `missing fastener ${i}`);
  }
  const modules = new Set(L[0].steps.flatMap((s) => s.parts).map((i) => P[i].module));
  assert.ok([...modules].every((m) => m === 'ASV1_600' || m === 'Asimov_1'), [...modules].join(','));
});

test('fastener groups marked matched have exactly the documented count in the CAD', () => {
  for (const l of L) for (const s of l.steps) for (const g of s.fastenerGroups) {
    if (g.status === 'matched') assert.equal(g.cad.length, g.docsCount, `${s.id}`);
  }
});
