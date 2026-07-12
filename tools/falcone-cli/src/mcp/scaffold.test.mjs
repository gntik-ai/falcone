import test from 'node:test';
import assert from 'node:assert/strict';
import { scaffoldServer } from './scaffold.mjs';
import { CliError } from '../cli.mjs';

test('scaffoldServer ts: runnable server + package.json + run command', () => {
  const s = scaffoldServer({ lang: 'ts', name: 'Acme Orders' });
  assert.equal(s.name, 'acme-orders');
  assert.ok(s.files['server.mjs'].includes('@modelcontextprotocol/sdk'));
  assert.ok(s.files['server.mjs'].includes("server.tool('ping'"));
  assert.equal(JSON.parse(s.files['package.json']).name, 'acme-orders');
  assert.match(s.runCommand, /npm/);
});

test('scaffoldServer python: FastMCP server + requirements', () => {
  const s = scaffoldServer({ lang: 'python', name: 'svc' });
  assert.ok(s.files['server.py'].includes('FastMCP'));
  assert.ok(s.files['requirements.txt'].includes('mcp>='));
  assert.match(s.runCommand, /python/);
});

test('scaffoldServer go: server + go.mod', () => {
  const s = scaffoldServer({ lang: 'go', name: 'svc' });
  assert.ok(s.files['main.go'].includes('mcp.NewServer'));
  assert.ok(s.files['go.mod'].startsWith('module svc'));
  assert.match(s.runCommand, /go /);
});

test('scaffoldServer: unsupported language throws CliError(2); name defaults + sanitizes', () => {
  assert.throws(() => scaffoldServer({ lang: 'rust' }), (e) => e instanceof CliError && e.exitCode === 2);
  assert.equal(scaffoldServer({ lang: 'ts' }).name, 'ts-mcp-server');
  assert.equal(scaffoldServer({ lang: 'ts', name: '  My Server!! ' }).name, 'my-server');
});
