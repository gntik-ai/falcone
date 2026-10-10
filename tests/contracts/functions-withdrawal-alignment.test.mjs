import assert from 'node:assert/strict';
import test from 'node:test';
import { collectPublicApiViolations } from '../../scripts/lib/public-api.mjs';
import { OPENAPI_PATH, readJson } from '../../scripts/lib/quality-gates.mjs';

test('withdrawn function audit bindings remain consistent with the public contract', () => {
  assert.deepEqual(collectPublicApiViolations(), []);
});

test('public API validation rejects resurrection of a withdrawn audit binding', () => {
  const document = readJson(OPENAPI_PATH);
  document.paths['/v1/functions/workspaces/{workspaceId}/audit'] = { get: {} };
  const violations = collectPublicApiViolations({ document });
  assert.ok(violations.includes('Domain entity function_audit_record must not publish withdrawn path /v1/functions/workspaces/{workspaceId}/audit.'));
});
