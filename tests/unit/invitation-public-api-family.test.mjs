import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildFamilyDocument, collectPublicApiViolations } from '../../scripts/lib/public-api.mjs';

const document = JSON.parse(readFileSync('apps/control-plane-executor/openapi/control-plane.openapi.json'));
const taxonomy = JSON.parse(readFileSync('packages/internal-contracts/src/public-api-taxonomy.json'));
const operationIds = ['acceptInvitation', 'createInvitation', 'getInvitation', 'listInvitations', 'resendInvitation', 'revokeInvitation'];

test('975: IAM discovery includes all invitation operations while retaining tenant gateway scope', () => {
  const iam = buildFamilyDocument(document, taxonomy, 'iam');
  const invitations = Object.values(iam.paths).flatMap(methods => Object.values(methods)).filter(op => op['x-resource-type'] === 'invitation');
  assert.deepEqual(invitations.map(op => op.operationId).sort(), operationIds);
  assert.ok(invitations.every(op => op['x-family'] === 'tenants'));
  assert.deepEqual(invitations.find(op => op.operationId === 'acceptInvitation').security, []);
});

test('975: public API routing, family documents and structural safety gates remain aligned', () => {
  assert.deepEqual(collectPublicApiViolations(), []);
});
