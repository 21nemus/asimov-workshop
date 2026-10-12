// Deterministic test scenarios: commands and pushes keyed to policy-tick indices, so the same
// scenario gives the same physics on every run of the same engine build.
import type { Controller } from './controller.ts';

export interface ScenarioCommand { tick: number; vx: number; vy: number; wz: number }
export interface ScenarioPush { tick: number; body: string; dir: [number, number, number]; force: number; duration: number }
export interface Scenario {
  name: string;
  description?: string;
  ticks: number;
  commands: ScenarioCommand[];
  pushes?: ScenarioPush[];
}

export interface TickRecord {
  tick: number;
  t: number;
  tumbling: boolean;
  qpos: number[];
  qvel: number[];
  action: number[];
}

/** Applies the scenario's schedule for `tick` (before the tick runs). */
export function applySchedule(ctrl: Controller, sc: Scenario, tick: number): void {
  for (const c of sc.commands) if (c.tick === tick) ctrl.s.command = { vx: c.vx, vy: c.vy, wz: c.wz };
  for (const p of sc.pushes ?? []) if (p.tick === tick) ctrl.queuePush(p.body, p.dir, p.force, p.duration);
}

export async function runScenario(ctrl: Controller, sc: Scenario, onTick?: (r: TickRecord) => void): Promise<void> {
  ctrl.reset();
  for (let tick = 0; tick < sc.ticks; tick++) {
    applySchedule(ctrl, sc, tick);
    await ctrl.tick();
    if (onTick) {
      const d = ctrl.h.data;
      onTick({ tick, t: d.time, tumbling: ctrl.s.tumbling, qpos: Array.from(d.qpos as Float64Array), qvel: Array.from(d.qvel as Float64Array), action: Array.from(ctrl.s.lastActions) });
    }
  }
}
