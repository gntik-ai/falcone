import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const workflowPaths = [
  '.github/workflows/ci.yml',
  '.github/workflows/integration.yml',
];
const approvedActions = new Set([
  'actions/checkout',
  'actions/setup-node',
  'actions/upload-artifact',
  'pnpm/action-setup',
  'helm/kind-action',
]);
const pinnedUse = /^\s*(?:-\s*)?uses:\s*([^@\s]+)@([a-f0-9]{40})\s+# v\d+\.\d+\.\d+\s*$/;

function assertPinnedWorkflowActions(contents, label) {
  const usesLines = contents.split('\n').filter((line) => /^\s*(?:-\s*)?uses:/.test(line));
  assert.ok(usesLines.length > 0, `${label} must contain action uses lines`);

  for (const line of usesLines) {
    const match = line.match(pinnedUse);
    assert.ok(match, `${label} has a mutable or incomplete action pin: ${line.trim()}`);
    assert.ok(approvedActions.has(match[1]), `${label} uses an unapproved action: ${match[1]}`);
  }
}

test('CI workflow action references are SHA-pinned approved actions', () => {
  for (const workflowPath of workflowPaths) {
    assertPinnedWorkflowActions(
      readFileSync(resolve(repoRoot, workflowPath), 'utf8'),
      workflowPath,
    );
  }
});

test('workflow action pin validation rejects mutable and incomplete references', () => {
  for (const value of [
    'uses: actions/checkout@v4',
    'uses: actions/checkout@11d5960',
    'uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
    '- uses: actions/checkout@v4',
    '- uses: actions/checkout@11d5960',
    '- uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
  ]) {
    assert.throws(() => assertPinnedWorkflowActions(value, 'fixture'));
  }
});
