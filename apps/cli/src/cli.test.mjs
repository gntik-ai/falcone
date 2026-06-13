import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, dispatch, USAGE, CliError } from './cli.mjs';

test('parseArgs: group/command/positionals/flags incl --key=value and boolean', () => {
  assert.deepEqual(parseArgs(['mcp', 'init', 'ts', '--name', 'foo']), { group: 'mcp', command: 'init', positionals: ['ts'], flags: { name: 'foo' } });
  assert.deepEqual(parseArgs(['mcp', 'deploy', '--image=r/x:1', '--help']), { group: 'mcp', command: 'deploy', positionals: [], flags: { image: 'r/x:1', help: true } });
  assert.deepEqual(parseArgs([]), { group: null, command: null, positionals: [], flags: {} });
});

test('dispatch: --help and bare invocation print usage', async () => {
  assert.equal((await dispatch(parseArgs(['--help']), {})).output, USAGE);
  assert.equal((await dispatch(parseArgs([]), {})).output, USAGE);
});

test('dispatch: routes to the matching handler', async () => {
  let seen = null;
  const handlers = { mcp: { init: (p) => { seen = p; return { ok: true, output: 'done' }; } } };
  const res = await dispatch(parseArgs(['mcp', 'init', 'go']), handlers);
  assert.equal(res.output, 'done');
  assert.equal(seen.positionals[0], 'go');
});

test('dispatch: unknown group/command throws a CliError with exit code 2', async () => {
  await assert.rejects(() => dispatch(parseArgs(['nope']), {}), (e) => e instanceof CliError && e.exitCode === 2);
  await assert.rejects(() => dispatch(parseArgs(['mcp', 'nope']), { mcp: {} }), (e) => e.exitCode === 2);
});
