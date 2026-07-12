import test from 'node:test';
import assert from 'node:assert/strict';
import { computeContentHash, etagFromHash, isEtagMatch } from '../src/spec-cache.mjs';

test('computeContentHash is deterministic', () => {
  assert.equal(computeContentHash('{"a":1}'), computeContentHash('{"a":1}'));
});

test('computeContentHash changes for different input', () => {
  assert.notEqual(computeContentHash('{"a":1}'), computeContentHash('{"a":2}'));
});

test('etagFromHash wraps in quotes', () => {
  assert.equal(etagFromHash('sha256:abc'), '"sha256:abc"');
});

test('isEtagMatch matches identical etag', () => {
  assert.equal(isEtagMatch('"sha256:abc"', 'sha256:abc'), true);
});

test('isEtagMatch rejects mismatch and wildcard', () => {
  assert.equal(isEtagMatch('"sha256:def"', 'sha256:abc'), false);
  assert.equal(isEtagMatch('*', 'sha256:abc'), false);
});
