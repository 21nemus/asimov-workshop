// The ankle microscope's mechanism model: closure at the CAD pose, agreement with the
// measurement tool, inverse/forward consistency and the published joint-space peak torques.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AnkleLinkage, ANKLE } from '../src/understand/ankle-linkage.ts';
import specs from '../src/data/joint-specs.json' with { type: 'json' };

for (const side of ['left', 'right'] as const) {
  const m = new AnkleLinkage(side);

  test(`${side}: the CAD pose closes with both actuators at zero`, () => {
    // Coordinates are stored to 0.1 micrometre, which bounds closure at about 5e-6 rad.
    const t = m.ik({ pitch: 0, roll: 0 })!;
    assert.ok(Math.abs(t.A) < 1e-5 && Math.abs(t.B) < 1e-5, JSON.stringify(t));
  });

  test(`${side}: matches the measurement tool's grid`, () => {
    const grid = (ANKLE.legs[side] as unknown as { grid: number[][] }).grid;
    assert.ok(grid.length > 100);
    for (const [pitch, roll, A, B] of grid) {
      const t = m.ik({ pitch, roll })!;
      assert.ok(Math.abs(t.A - A) < 2e-5 && Math.abs(t.B - B) < 2e-5, `${pitch},${roll}`);
    }
  });

  test(`${side}: forward and inverse kinematics agree over the documented range`, () => {
    for (const pitch of [-0.35, -0.2, 0, 0.15, 0.35]) for (const roll of [-0.1, -0.03, 0, 0.06, 0.1]) {
      const t = m.ik({ pitch, roll })!;
      const back = m.fk(t)!;
      assert.ok(Math.abs(back.pitch - pitch) < 1e-8 && Math.abs(back.roll - roll) < 1e-8, `${pitch},${roll}`);
    }
  });

  test(`${side}: same signs as Menlo's mapping (pitch from A - B, roll from -(A + B))`, () => {
    const p = m.ik({ pitch: 0.05, roll: 0 })!;
    assert.ok(p.A > 0 && p.B < 0);
    const r = m.ik({ pitch: 0, roll: 0.05 })!;
    assert.ok(r.A < 0 && r.B < 0);
    const lin = m.docsMapping(m.ik({ pitch: 0.01, roll: 0.005 })!);
    assert.ok(Math.abs(lin.pitch - 0.01) < 0.0006 && Math.abs(lin.roll - 0.005) < 0.0001, JSON.stringify(lin));
  });

  test(`${side}: CAD lever ratios reproduce the documented joint-space peak torques`, () => {
    const peak = specs.actuators.find((a) => a.role === `${side}_ankle_A`)!.peakTorque; // 145.4 (pitch)
    const peakRoll = specs.actuators.find((a) => a.role === `${side}_ankle_B`)!.peakTorque; // 57.6 (roll)
    const motorPeak = 36; // EC-A4310-P2-36 peak torque, docs
    const pitch = m.jointTorque(motorPeak, -motorPeak).pitch;
    const roll = m.jointTorque(-motorPeak, -motorPeak).roll;
    assert.ok(Math.abs(Math.abs(pitch) - peak) / peak < 0.002, `pitch ${pitch} vs ${peak}`);
    assert.ok(Math.abs(Math.abs(roll) - peakRoll) / peakRoll < 0.002, `roll ${roll} vs ${peakRoll}`);
  });
}
