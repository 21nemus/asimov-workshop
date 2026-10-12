// BOM extraction invariants: every record addressable by sheet and row, conflicting part
// numbers kept apart, unsupported totals never presented as verified, cancelled lines not
// active, missing quantities left missing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOM, activeBomRecords, bomRecords } from '../src/catalog/catalog.ts';

test('every BOM record has a unique sheet-and-row id', () => {
  const ids = BOM.records.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const r of BOM.records) assert.match(r.id, new RegExp(`/${r.sheet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/row${r.row}$`));
});

test('conflicting part numbers stay separate records', () => {
  assert.ok(BOM.conflicts.length >= 3);
  for (const c of BOM.conflicts) {
    assert.ok(c.records.length >= 2, c.partNumber);
    assert.equal(new Set(c.records).size, c.records.length);
    const recs = bomRecords({ partNumber: c.partNumber, bomPartNumber: null });
    assert.ok(recs.length >= 2, `${c.partNumber} collapsed to ${recs.length}`);
  }
});

test('cached workbook totals are never marked verified', () => {
  assert.ok(BOM.totals.length > 0);
  for (const t of BOM.totals) assert.doesNotMatch(t.status, /^verified/i, `${t.sheet} ${t.cell}`);
});

test('cancelled procurement lines are not active', () => {
  const cancelled = BOM.records.filter((r) => r.flags.includes('cancelled'));
  assert.ok(cancelled.length >= 1);
  for (const r of cancelled) {
    const p = { partNumber: r.partNumber, bomPartNumber: null };
    assert.ok(bomRecords(p).some((x) => x.id === r.id));
    assert.ok(!activeBomRecords(p).some((x) => x.id === r.id));
  }
});

test('missing quantities remain missing (never defaulted to 1)', () => {
  const missing = BOM.records.filter((r) => r.flags.includes('missing-quantity'));
  assert.equal(missing.length, 3);
  for (const r of missing) assert.equal(r.qty, null, r.id);
});
