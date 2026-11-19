import test from 'node:test';
import assert from 'node:assert/strict';
import { runCli } from './run-cli.mjs';
import { assertNoSampleData } from './parity/checks.mjs';
import { guardParity } from './parity/settled-state.mjs';
import { readFileSync } from 'node:fs';

test('sample strings reproduce from the installed pinned kit without network', async () => {
  const result = await runCli(['tests/parity/extract-kit-sample-strings.mjs', '--check']);
  assert.equal(result.status, 0, result.stderr);
});

test('the harness detects sample text appearing after open and after an action', async () => {
  const sample = JSON.parse(readFileSync(new URL('./parity/kit-sample-strings.json', import.meta.url))).strings[0];
  for (const stage of ['open', 'action', 'teardown']) {
    let text = 'Synthetic backend records';
    // The browser is the system boundary. The guard uses the same public page
    // operations as the browser journey, with no internal harness mocks.
    const page = { getByRole() { return { all: async () => [{ innerText: async () => text }], locator() { return this; }, click: async () => { text = sample; } }; } };
    const guarded = guardParity({ page, async open() { if (stage === 'open') text = sample; } }, assertNoSampleData);
    if (stage === 'open') await assert.rejects(guarded.open('/'), /assertNoSampleData/);
    else {
      await guarded.open('/');
      if (stage === 'action') await assert.rejects(guarded.page.getByRole('button').click(), /assertNoSampleData/);
      else { text = sample; await assert.rejects(guarded.settled(), /assertNoSampleData/); }
    }
  }
});
