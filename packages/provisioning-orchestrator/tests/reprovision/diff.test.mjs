import test from 'node:test';
import assert from 'node:assert/strict';
import { compareResources, resolveAction, buildDiff } from '../../src/reprovision/diff.mjs';

// --- compareResources ---

test('compareResources: deeply equal objects return equal', () => {
  const a = { name: 'role1', permissions: ['read', 'write'], nested: { key: 'val' } };
  const b = { name: 'role1', permissions: ['read', 'write'], nested: { key: 'val' } };
  assert.equal(compareResources(a, b), 'equal');
});

test('compareResources: objects with different key return different', () => {
  const a = { name: 'role1', permissions: ['read'] };
  const b = { name: 'role1', permissions: ['read', 'write'] };
  assert.equal(compareResources(a, b), 'different');
});

test('compareResources: ignores excluded keys', () => {
  const a = { name: 'role1', updated_at: '2024-01-01' };
  const b = { name: 'role1', updated_at: '2024-06-01' };
  assert.equal(compareResources(a, b, ['updated_at']), 'equal');
});

test('compareResources: different types return different', () => {
  assert.equal(compareResources('a', 1), 'different');
});

test('compareResources: null equals null', () => {
  assert.equal(compareResources(null, null), 'equal');
});

test('compareResources: null vs object returns different', () => {
  assert.equal(compareResources(null, {}), 'different');
});

test('compareResources: arrays of different length return different', () => {
  assert.equal(compareResources([1, 2], [1]), 'different');
});

// --- resolveAction ---

test('resolveAction: not exists, not dry run → created', () => {
  assert.equal(resolveAction(false, 'different', false), 'created');
});

test('resolveAction: not exists, dry run → would_create', () => {
  assert.equal(resolveAction(false, 'different', true), 'would_create');
});

test('resolveAction: exists + equal, not dry run → skipped', () => {
  assert.equal(resolveAction(true, 'equal', false), 'skipped');
});

test('resolveAction: exists + equal, dry run → would_skip', () => {
  assert.equal(resolveAction(true, 'equal', true), 'would_skip');
});

test('resolveAction: exists + different, not dry run → conflict', () => {
  assert.equal(resolveAction(true, 'different', false), 'conflict');
});

test('resolveAction: exists + different, dry run → would_conflict', () => {
  assert.equal(resolveAction(true, 'different', true), 'would_conflict');
});

// --- buildDiff ---

test('buildDiff: returns diff for different keys only', () => {
  const existing = { name: 'role1', permissions: ['read'] };
  const desired = { name: 'role1', permissions: ['read', 'write'] };
  const diff = buildDiff(existing, desired);
  assert.ok(diff);
  assert.ok(diff.permissions);
  assert.equal(diff.name, undefined);
});

test('buildDiff: returns null for identical objects', () => {
  const a = { name: 'role1' };
  const b = { name: 'role1' };
  assert.equal(buildDiff(a, b), null);
});

test('buildDiff: handles redacted values without exposing them', () => {
  const existing = { secret: '***REDACTED***', name: 'a' };
  const desired = { secret: 'new-value', name: 'b' };
  const diff = buildDiff(existing, desired);
  assert.ok(diff);
  assert.ok(diff.secret);
  assert.equal(diff.secret.existing, '***REDACTED***');
});

test('buildDiff: returns null for null inputs', () => {
  assert.equal(buildDiff(null, null), null);
  assert.equal(buildDiff(null, { a: 1 }), null);
});
