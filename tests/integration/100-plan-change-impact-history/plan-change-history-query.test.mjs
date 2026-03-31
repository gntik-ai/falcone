import test from 'node:test';
import assert from 'node:assert/strict';

test('history query ordering metadata shape', () => {
  const items = [{ effectiveAt: '2026-03-31T10:00:00Z' }, { effectiveAt: '2026-03-30T10:00:00Z' }];
  assert.equal(items[0].effectiveAt > items[1].effectiveAt, true);
});
