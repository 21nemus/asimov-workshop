// The support card ships disabled and only renders verified, non-empty entries.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SUPPORT, supportReady } from '../src/config/support.ts';

test('support ships disabled and empty', () => {
  assert.equal(SUPPORT.enabled, false);
  assert.equal(SUPPORT.links.length, 0);
  assert.equal(SUPPORT.addresses.length, 0);
  assert.equal(supportReady(), false);
});

test('enabled but empty, or with non-https links, still renders nothing', () => {
  assert.equal(supportReady({ enabled: true, message: 'x', links: [], addresses: [] }), false);
  assert.equal(supportReady({ enabled: true, message: '', links: [{ label: 'x', url: 'http://example.org' }], addresses: [] }), false);
  assert.equal(supportReady({ enabled: true, message: '', links: [{ label: 'x', url: 'https://example.org' }], addresses: [] }), true);
});
