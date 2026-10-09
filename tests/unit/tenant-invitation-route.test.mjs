// Supersedes the #759 masked-email/hash-only write contract with #975's lifecycle contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { routes } from '../../apps/control-plane/routes.mjs';
import { LOCAL_HANDLERS } from '../../apps/control-plane/b-handlers.mjs';

const runtime = JSON.parse(readFileSync('apps/control-plane/route-map.runtime.json', 'utf8'));
for (const operation of ['createInvitation', 'listInvitations', 'getInvitation', 'acceptInvitation', 'revokeInvitation', 'resendInvitation']) {
  test(`975: ${operation} resolves in seed, runtime and local handler registry`, () => {
    const route = routes.find(r => r.localHandler === operation);
    assert.ok(route);
    const mapped = runtime.find(r => r.method === route.method && r.path === route.path);
    assert.equal(mapped.localHandler, operation);
    assert.equal(typeof LOCAL_HANDLERS[operation], 'function');
    assert.equal(mapped.auth, operation === 'acceptInvitation' ? 'public' : 'authenticated');
  });
}
