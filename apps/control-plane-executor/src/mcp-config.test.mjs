// Unit tests for the first-party MCP configuration store (add-control-mcp-completeness, #642).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMcpConfigStore } from './mcp-config.mjs';

test('defaults: server enabled, every tool enabled', () => {
  const c = createMcpConfigStore();
  assert.equal(c.isServerEnabled(), true);
  assert.equal(c.isToolEnabled('list_workspaces'), true);
  assert.deepEqual(c.get(), { enabled: true, disabledTools: [] });
});

test('disabling the server disables every tool', () => {
  const c = createMcpConfigStore();
  c.set({ enabled: false });
  assert.equal(c.isServerEnabled(), false);
  assert.equal(c.isToolEnabled('list_workspaces'), false);
});

test('disable/enable individual tools is idempotent and sorted in the snapshot', () => {
  const c = createMcpConfigStore();
  c.set({ disableTools: ['b_tool', 'a_tool', 'b_tool'] });
  assert.deepEqual(c.get().disabledTools, ['a_tool', 'b_tool']);
  assert.equal(c.isToolEnabled('a_tool'), false);
  c.set({ enableTools: ['a_tool'] });
  assert.deepEqual(c.get().disabledTools, ['b_tool']);
  assert.equal(c.isToolEnabled('a_tool'), true);
});

test('initial disabledTools are honored', () => {
  const c = createMcpConfigStore({ disabledTools: ['x'] });
  assert.equal(c.isToolEnabled('x'), false);
  assert.equal(c.isToolEnabled('y'), true);
});

test('stores are isolated instances', () => {
  const a = createMcpConfigStore();
  const b = createMcpConfigStore();
  a.set({ disableTools: ['t'] });
  assert.equal(a.isToolEnabled('t'), false);
  assert.equal(b.isToolEnabled('t'), true);
});
