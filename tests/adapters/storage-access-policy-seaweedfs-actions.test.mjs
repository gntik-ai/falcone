import test from 'node:test';
import assert from 'node:assert/strict';

import { toSeaweedFSActions } from '../../services/adapters/src/storage-access-policy.mjs';

test('toSeaweedFSActions maps each granted permission to its SeaweedFS action in canonical order', () => {
  assert.deepEqual(toSeaweedFSActions({ read: true, write: true, list: true, admin: true }), ['Read', 'Write', 'List', 'Admin']);
  assert.deepEqual(toSeaweedFSActions({ read: true, list: true }), ['Read', 'List']);
  assert.deepEqual(toSeaweedFSActions({ write: true }), ['Write']);
  assert.deepEqual(toSeaweedFSActions({ admin: true }), ['Admin']);
});

test('toSeaweedFSActions preserves canonical order regardless of input key order', () => {
  assert.deepEqual(toSeaweedFSActions({ admin: true, list: true, read: true, write: true }), ['Read', 'Write', 'List', 'Admin']);
});

test('toSeaweedFSActions only includes permissions explicitly set to true', () => {
  assert.deepEqual(toSeaweedFSActions({ read: true, write: false, list: 1, admin: 'yes' }), ['Read']);
});

test('toSeaweedFSActions returns [] for no granted permissions (fail-closed trigger)', () => {
  assert.deepEqual(toSeaweedFSActions({}), []);
  assert.deepEqual(toSeaweedFSActions({ read: false, write: false, list: false, admin: false }), []);
  assert.deepEqual(toSeaweedFSActions(), []);
});
