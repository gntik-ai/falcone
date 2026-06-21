import test from 'node:test';
import assert from 'node:assert/strict';
import { applyStatusTransition, buildSubscriptionRecord, canTransition, softDelete, validateSubscriptionInput } from '../../services/webhook-engine/src/webhook-subscription.mjs';
import { checkSubscriptionQuota } from '../../services/webhook-engine/src/webhook-quota.mjs';

test('valid subscription construction', async () => {
  const resolver = async () => ['93.184.216.34'];
  const record = await buildSubscriptionRecord({ targetUrl: 'https://example.com/hook', eventTypes: ['document.created'] }, { tenantId: 't1', workspaceId: 'w1', actorId: 'u1', resolver });
  assert.equal(record.status, 'active');
});

test('reject non-https, private ips, and unknown event types', async () => {
  const resolver = async () => ['93.184.216.34'];
  await assert.rejects(validateSubscriptionInput({ targetUrl: 'http://example.com', eventTypes: ['document.created'] }, { resolver }), { code: 'INVALID_URL' });
  // 127.0.0.1 is an IP literal — no DNS resolver needed
  await assert.rejects(validateSubscriptionInput({ targetUrl: 'https://127.0.0.1/hook', eventTypes: ['document.created'] }), { code: 'INVALID_URL' });
  await assert.rejects(validateSubscriptionInput({ targetUrl: 'https://example.com', eventTypes: ['wat'] }, { resolver }), { code: 'INVALID_EVENT_TYPES' });
});

// ---------------------------------------------------------------------------
// Issue #671 — SSRF blocklist must cover RFC 6598 CGNAT (100.64.0.0/10),
// RFC 2544 benchmarking (198.18.0.0/15) and the NAT64 well-known prefix
// (64:ff9b::/96, screened via the embedded IPv4). These are IP literals, so
// validateSubscriptionInput runs the direct blocklist check (no resolver).
// ---------------------------------------------------------------------------
test('issue-671: NAT64 64:ff9b::/96 embedding a private IPv4 is rejected (INVALID_URL)', async () => {
  // WHEN targetUrl is https://[64:ff9b::a00:1]/... (embeds 10.0.0.1) THEN reject 400 INVALID_URL.
  for (const targetUrl of [
    'https://[64:ff9b::a00:1]/x',     // last two hextets 0a00:0001 → 10.0.0.1
    'https://[64:ff9b::10.0.0.1]/x',  // embedded dotted-quad form
  ]) {
    await assert.rejects(
      validateSubscriptionInput({ targetUrl, eventTypes: ['document.created'] }),
      { code: 'INVALID_URL' },
      `${targetUrl} must be rejected as SSRF`,
    );
  }
});

test('issue-671: RFC 6598 CGNAT 100.64.0.0/10 is rejected (INVALID_URL)', async () => {
  for (const targetUrl of [
    'https://100.64.0.1/x',
    'https://100.127.255.254/x',
    'https://100.100.100.200/x', // Alibaba cloud-metadata, inside the /10
  ]) {
    await assert.rejects(
      validateSubscriptionInput({ targetUrl, eventTypes: ['document.created'] }),
      { code: 'INVALID_URL' },
      `${targetUrl} must be rejected as SSRF`,
    );
  }
});

test('issue-671: RFC 2544 benchmarking 198.18.0.0/15 is rejected (INVALID_URL)', async () => {
  for (const targetUrl of [
    'https://198.18.0.1/x',
    'https://198.19.255.254/x',
  ]) {
    await assert.rejects(
      validateSubscriptionInput({ targetUrl, eventTypes: ['document.created'] }),
      { code: 'INVALID_URL' },
      `${targetUrl} must be rejected as SSRF`,
    );
  }
});

test('issue-671: public IP literals stay allowed (no false positive)', async () => {
  // 1.1.1.1 and 8.8.8.8 are public and must continue to build a record.
  for (const targetUrl of ['https://1.1.1.1/x', 'https://8.8.8.8/x']) {
    const record = await buildSubscriptionRecord(
      { targetUrl, eventTypes: ['document.created'] },
      { tenantId: 't1', workspaceId: 'w1', actorId: 'u1' },
    );
    assert.equal(record.status, 'active', `${targetUrl} must be accepted`);
    assert.equal(record.target_url, targetUrl);
  }
});

test('issue-671: NAT64 prefix embedding a PUBLIC IPv4 stays allowed', async () => {
  // Per the spec, NAT64 is screened by the EMBEDDED IPv4 — 8.8.8.8 is public,
  // so 64:ff9b::8.8.8.8 must NOT be blocked.
  const record = await buildSubscriptionRecord(
    { targetUrl: 'https://[64:ff9b::8.8.8.8]/x', eventTypes: ['document.created'] },
    { tenantId: 't1', workspaceId: 'w1', actorId: 'u1' },
  );
  assert.equal(record.status, 'active');
});

test('issue-671: addresses just outside the new ranges stay allowed (boundary pins)', async () => {
  for (const targetUrl of [
    'https://100.63.255.255/x', // one below 100.64.0.0/10
    'https://100.128.0.0/x',    // one above 100.64.0.0/10
    'https://198.17.0.1/x',     // one below 198.18.0.0/15
    'https://198.20.0.1/x',     // one above 198.18.0.0/15
  ]) {
    const record = await buildSubscriptionRecord(
      { targetUrl, eventTypes: ['document.created'] },
      { tenantId: 't1', workspaceId: 'w1', actorId: 'u1' },
    );
    assert.equal(record.status, 'active', `${targetUrl} must be allowed (outside blocked range)`);
  }
});

test('issue-671: pre-existing reject controls still rejected', async () => {
  // Loopback and IPv4-mapped private must remain blocked after the refactor.
  for (const targetUrl of ['https://127.0.0.1/x', 'https://[::ffff:10.0.0.1]/x']) {
    await assert.rejects(
      validateSubscriptionInput({ targetUrl, eventTypes: ['document.created'] }),
      { code: 'INVALID_URL' },
      `${targetUrl} must stay rejected`,
    );
  }
});

test('quota and status transitions', () => {
  assert.equal(checkSubscriptionQuota('w1', 2, 3).allowed, true);
  assert.equal(checkSubscriptionQuota('w1', 3, 3).allowed, false);
  assert.equal(canTransition('active', 'paused'), true);
  const paused = applyStatusTransition({ status: 'active' }, 'paused');
  assert.equal(paused.status, 'paused');
  assert.throws(() => applyStatusTransition({ status: 'paused' }, 'disabled'));
  const deleted = softDelete({ status: 'active' });
  assert.equal(deleted.status, 'deleted');
  assert.ok(deleted.deleted_at);
});
