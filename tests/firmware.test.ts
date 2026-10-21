// Firmware facts shown in UNDERSTAND and TEST: the SDK's motor names line up with the docs'
// actuator IDs and roles, and the quoted ankle constants agree with our CAD measurement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIRMWARE_ACTUATORS, FIRMWARE_ANKLE, firmwareActuators } from '../src/catalog/firmware.ts';
import { AnkleLinkage } from '../src/understand/ankle-linkage.ts';
import specs from '../src/data/joint-specs.json' with { type: 'json' };

test('every firmware name matches the docs role with the same actuator ID', () => {
  assert.equal(FIRMWARE_ACTUATORS.length, specs.actuators.length);
  for (const a of specs.actuators) {
    const name = FIRMWARE_ACTUATORS[a.id - 1].replace(/^L_/, 'left_').replace(/^R_/, 'right_').toLowerCase();
    assert.equal(name, a.role.toLowerCase().replace(/_joint$/, ''), `ID ${a.id}`);
  }
});

test('joints map to their firmware actuators; ankles to motors A and B', () => {
  assert.deepEqual(firmwareActuators('left_knee_joint'), [{ id: 4, name: 'L_Knee' }]);
  assert.deepEqual(firmwareActuators('waist_yaw_joint'), [{ id: 23, name: 'Waist_Yaw' }]);
  assert.deepEqual(firmwareActuators('right_ankle_roll_joint'), [{ id: 11, name: 'R_Ankle_A' }, { id: 12, name: 'R_Ankle_B' }]);
});

test('firmware ankle constants agree with the CAD-measured lever ratios', () => {
  for (const side of ['left', 'right'] as const) {
    const d = new AnkleLinkage(side).leg.derived;
    assert.ok(Math.abs(d.jacobianAB_per_PR[0][0] - FIRMWARE_ANKLE.kPitch) < 0.01, `${side} pitch`);
    assert.ok(Math.abs(Math.abs(d.jacobianAB_per_PR[0][1]) - FIRMWARE_ANKLE.kRoll) < 0.01, `${side} roll`);
  }
});
