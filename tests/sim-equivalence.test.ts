// The SimulationAdapter's controller must reproduce the upstream viewer's run of the published
// policy. The reference is tools/.cache/baseline/upstream-harness-baseline-flat-01.json, produced
// by tools/baseline/upstream-harness.mjs from upstream's own modules on the full upstream MJCF.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { makeController } from './helpers/policy.ts';
import { runScenario, type Scenario, type TickRecord } from '../src/simulation/scenario.ts';

const REF = new URL('../tools/.cache/baseline/upstream-harness-baseline-flat-01.json', import.meta.url);
const scenario = JSON.parse(readFileSync(new URL('../src/simulation/scenarios/baseline-flat-01.json', import.meta.url), 'utf8')) as Scenario;

function maxDiff(a: number[], b: number[]): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

test('ORT engine reproduces the upstream harness bit for bit (baseline-flat-01, 500 ticks)', { skip: existsSync(REF) ? false : 'needs tools/baseline/upstream-harness.mjs output (requires .reference-cache)' }, async () => {
  const ref = JSON.parse(readFileSync(REF, 'utf8')) as { ticks: { qpos: number[]; qvel: number[]; action: number[]; tumbling: boolean }[] };
  const ctrl = await makeController('ort');
  const rows: TickRecord[] = [];
  await runScenario(ctrl, scenario, (r) => rows.push(r));
  let worst = 0, first = -1;
  for (let t = 0; t < rows.length; t++) {
    const d = Math.max(maxDiff(rows[t].qpos, ref.ticks[t].qpos), maxDiff(rows[t].qvel, ref.ticks[t].qvel), maxDiff(rows[t].action, ref.ticks[t].action));
    if (d > worst) worst = d;
    if (d !== 0 && first < 0) first = t;
    assert.equal(rows[t].tumbling, ref.ticks[t].tumbling, `controller mode at tick ${t}`);
  }
  assert.equal(worst, 0, `first difference at tick ${first}, max ${worst}`);
});

test('TS forward pass (mlp engine) stays within tolerance of the upstream trajectory', { skip: existsSync(REF) ? false : 'needs the upstream harness output' }, async () => {
  const ref = JSON.parse(readFileSync(REF, 'utf8')) as { ticks: { qpos: number[]; action: number[] }[] };
  const ctrl = await makeController('mlp');
  const rows: TickRecord[] = [];
  await runScenario(ctrl, scenario, (r) => rows.push(r));
  const firstActionDiff = maxDiff(rows[0].action, ref.ticks[0].action);
  const root = (q: number[]) => [q[0], q[1], q[2]];
  const finalRootErr = Math.hypot(...root(rows.at(-1)!.qpos).map((v, i) => v - root(ref.ticks.at(-1)!.qpos)[i]));
  console.log(`mlp vs upstream: first-tick action max |diff| ${firstActionDiff.toExponential(2)}, final root position error ${(finalRootErr * 1000).toFixed(2)} mm`);
  assert.ok(firstActionDiff < 1e-5, `first action differs by ${firstActionDiff}`);
  assert.ok(finalRootErr < 0.05, `final root position error ${finalRootErr} m`);
});
