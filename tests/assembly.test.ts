// BUILD's assembly graph and step states: no cycles, prerequisites always point backwards,
// undo and replay reach the same per-part state as going there directly, and the BUILD code
// cannot reach the TEST simulation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LESSONS } from '../src/catalog/catalog.ts';
import { PartState } from '../src/robot/part-state.ts';
import { applyBuildState, planModule } from '../src/build/build-plan.ts';
import partsFile from '../public/robot/parts.json' with { type: 'json' };
import type { PartInfo, RobotModel } from '../src/robot/robot-model.ts';

const parts = (partsFile as unknown as { parts: PartInfo[] }).parts;
const fakeRobot = () => ({ parts, state: new PartState(parts.length) }) as unknown as RobotModel;
const snapshot = (r: RobotModel) => [Array.from(r.state.state.image.data as Uint8Array), Array.from(r.state.offset.image.data as Float32Array)];

test('the assembly graph across all modules has no cycles', () => {
  const requires = new Map<string, string[]>();
  for (const l of LESSONS) for (const s of l.steps) requires.set(s.id, s.requires);
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (id: string, path: string[]) => {
    if (state.get(id) === 'done') return;
    assert.notEqual(state.get(id), 'visiting', `cycle: ${[...path, id].join(' -> ')}`);
    state.set(id, 'visiting');
    for (const r of requires.get(id) ?? []) {
      assert.ok(requires.has(r), `${id} requires unknown step ${r}`);
      visit(r, [...path, id]);
    }
    state.set(id, 'done');
  };
  for (const id of requires.keys()) visit(id, []);
});

test('within a module, every prerequisite is an earlier step', () => {
  for (const l of LESSONS) for (const s of l.steps) for (const r of s.requires) {
    if (!r.startsWith(`${l.id}/`)) continue;
    const dep = l.steps.find((x) => x.id === r)!;
    assert.ok(dep.n < s.n, `${s.id} requires later step ${r}`);
  }
});

test('undo and replay reach exactly the state of going to the step directly', () => {
  const plan = planModule(fakeRobot(), LESSONS.find((l) => l.id === 'left-leg')!);
  const none = new Set<string>(), moduleOf = new Map<number, string>();
  for (const k of [0, 4, 8, 12]) {
    const direct = fakeRobot();
    applyBuildState(direct, plan, k, none, moduleOf);
    const undo = fakeRobot();
    applyBuildState(undo, plan, k, none, moduleOf);
    applyBuildState(undo, plan, k + 1, none, moduleOf);
    applyBuildState(undo, plan, k, none, moduleOf);
    const replay = fakeRobot();
    applyBuildState(replay, plan, k, none, moduleOf);
    applyBuildState(replay, plan, k, none, moduleOf);
    assert.deepEqual(snapshot(undo), snapshot(direct), `undo at step ${k + 1}`);
    assert.deepEqual(snapshot(replay), snapshot(direct), `replay at step ${k + 1}`);
  }
});

test('assembling step by step (as "assemble the rest" does) ends where a direct jump ends', () => {
  const plan = planModule(fakeRobot(), LESSONS.find((l) => l.id === 'left-leg')!);
  const none = new Set<string>(), moduleOf = new Map<number, string>();
  const stepwise = fakeRobot();
  for (let k = 0; k < plan.steps.length; k++) applyBuildState(stepwise, plan, k, none, moduleOf);
  const direct = fakeRobot();
  applyBuildState(direct, plan, plan.steps.length - 1, none, moduleOf);
  assert.deepEqual(snapshot(stepwise), snapshot(direct));
  // At the last step every left-leg part is installed and none is an outline.
  for (const i of plan.members) {
    assert.ok(direct.state.isVisible(i), `part ${i} not installed`);
    assert.ok(!direct.state.isGhost(i));
  }
});

test('BUILD code cannot reach the TEST simulation', () => {
  for (const f of ['src/build/build-plan.ts', 'src/app/modes/build-mode.ts']) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /from ['"][^'"]*simulation\//, `${f} imports simulation code`);
    assert.doesNotMatch(src, /\.sim\(|simIfLoaded/, `${f} asks for the simulation`);
  }
});
