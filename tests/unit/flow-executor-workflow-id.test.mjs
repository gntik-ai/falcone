// Unit test for workflow-id ownership parsing (#681 fix-workflow-id-schedule-fired-parse).
//
// The control-plane builds manual-run workflow ids as
//   {tenantId}:{workspaceId}:{flowId}:{runUuid}
// (buildWorkflowId), but a SCHEDULE-FIRED (cron) run is auto-named by Temporal as
//   {scheduleId}-workflow-{ISO8601}     where scheduleId = {tenantId}:{workspaceId}:{flowId}
// (flow-trigger-registry::scheduleIdFor + upsertSchedule, which sets no explicit workflowId).
// The ISO8601 timestamp (e.g. 2026-06-21T11:06:00Z) contains ':' — the SAME separator used to
// join the id — so a naive split mangled the flowId and made an OWNER's ownership check fail:
// getExecution → 404 EXECUTION_NOT_FOUND, cancelExecution → 403 CROSS_TENANT_FORBIDDEN, even
// though the tenant prefix genuinely belonged to the caller.
//
// These tests encode the issue's WHEN/THEN: parseWorkflowId must parse BOTH id shapes, an OWNER
// must be able to GET and CANCEL their own cron-fired run, and a DIFFERENT-tenant prefix on the
// SAME shape must still be rejected (404 get / 403 cancel). They FAIL on the unfixed code (the
// schedule-fired flowId is parsed as `{flowId}-workflow-2026-06-21T11`).
//
// Tests: ut-wfid-01 .. ut-wfid-08
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import {
  buildWorkflowId,
  parseWorkflowId,
  createFlowExecutor,
} from '../../apps/control-plane/src/runtime/flow-executor.mjs';

// Realistic UUIDs (UUIDs never contain ':' nor the substring "workflow").
const TENANT = '11111111-1111-4111-8111-111111111111';
const WORKSPACE = '22222222-2222-4222-8222-222222222222';
const FLOW = '33333333-3333-4333-8333-333333333333';
const RUN = '44444444-4444-4444-8444-444444444444';

// A schedule-fired id exactly as Temporal auto-names it: `{scheduleId}-workflow-{ISO8601}` where
// scheduleId = `{tenantId}:{workspaceId}:{flowId}`. The ISO timestamp carries colons.
const SCHEDULE_ISO = '2026-06-21T11:06:00Z';
const scheduleFiredId = (t = TENANT, w = WORKSPACE, f = FLOW) =>
  `${t}:${w}:${f}-workflow-${SCHEDULE_ISO}`;

// -- parseWorkflowId: pure parsing --------------------------------------------------------------

// ut-wfid-01: a manual run id round-trips to its parts (regression guard for the common case).
test('ut-wfid-01: parseWorkflowId parses a manual {t}:{w}:{flowId}:{runUuid} id', () => {
  const id = buildWorkflowId(TENANT, WORKSPACE, FLOW, RUN);
  const parsed = parseWorkflowId(id);
  assert.deepEqual(parsed, {
    tenantId: TENANT,
    workspaceId: WORKSPACE,
    flowId: FLOW,
    runUuid: RUN,
  });
});

// ut-wfid-02 (THE FIX): a schedule-fired id parses flowId WITHOUT eating the ISO timestamp.
test('ut-wfid-02: parseWorkflowId parses a schedule-fired {t}:{w}:{flowId}-workflow-{ISO} id', () => {
  const parsed = parseWorkflowId(scheduleFiredId());
  assert.ok(parsed, 'a schedule-fired id must parse, not return null');
  assert.equal(parsed.tenantId, TENANT, 'tenantId is parts[0]');
  assert.equal(parsed.workspaceId, WORKSPACE, 'workspaceId is parts[1]');
  // The real bug: the flowId must NOT absorb the `-workflow-2026-06-21T11` ISO fragment.
  assert.equal(parsed.flowId, FLOW, 'flowId must equal the real flow id, not flowId-workflow-2026-06-21T11');
  // The runUuid for a schedule-fired run is the `workflow-{ISO8601}` segment Temporal appended.
  assert.equal(parsed.runUuid, `workflow-${SCHEDULE_ISO}`);
});

// ut-wfid-03: tenantId/workspaceId stay correct so listExecutions / hasActiveExecutions /
// flow-monitoring-executor (which only read those two fields) keep filtering correctly.
test('ut-wfid-03: schedule-fired id keeps tenantId/workspaceId for the visibility-list consumers', () => {
  const parsed = parseWorkflowId(scheduleFiredId());
  assert.equal(parsed.tenantId, TENANT);
  assert.equal(parsed.workspaceId, WORKSPACE);
});

// ut-wfid-04: malformed / non-string ids return null (defensive: never throw on a bad id).
test('ut-wfid-04: malformed ids return null', () => {
  assert.equal(parseWorkflowId(null), null);
  assert.equal(parseWorkflowId(undefined), null);
  assert.equal(parseWorkflowId(123), null);
  assert.equal(parseWorkflowId({}), null);
  assert.equal(parseWorkflowId(''), null, 'empty string → null');
  assert.equal(parseWorkflowId('a:b'), null, 'only two segments (no remainder) → null');
  assert.equal(parseWorkflowId('::x:y'), null, 'empty tenantId/workspaceId → null');
  assert.equal(parseWorkflowId(`${TENANT}::${FLOW}:${RUN}`), null, 'empty workspaceId → null');
  assert.equal(parseWorkflowId(`${TENANT}:${WORKSPACE}:`), null, 'empty remainder → null');
  assert.equal(parseWorkflowId(`${TENANT}:${WORKSPACE}:-workflow-${SCHEDULE_ISO}`), null,
    'empty flowId before the -workflow- marker → null');
  assert.equal(parseWorkflowId(`${TENANT}:${WORKSPACE}:${FLOW}`), null,
    'manual shape missing the runUuid → null');
});

// ut-wfid-05: a manual flowId that itself contains a hyphen (but not the -workflow- marker) is
// NOT misread as schedule-fired (UUIDs contain hyphens; the marker is the literal "-workflow-").
test('ut-wfid-05: a hyphenated manual flowId is not misclassified as schedule-fired', () => {
  const parsed = parseWorkflowId(buildWorkflowId(TENANT, WORKSPACE, FLOW, RUN));
  assert.equal(parsed.flowId, FLOW, 'the hyphenated UUID flowId stays intact');
  assert.equal(parsed.runUuid, RUN);
});

// -- Scenario: an OWNER can manage their OWN cron-fired run (drives the executor) ---------------

// A fake Temporal client whose getHandle returns a synthetic Running handle for ANY id, so the
// only gate a request can fail is assertOwnedWorkflowId (the unit under test). Mirrors the
// established makeFakeTemporal pattern in tests/blackbox/flows-api-isolation.test.mjs.
function makeFakeTemporal() {
  const handle = {
    async describe() {
      return { status: { name: 'Running' }, searchAttributes: { flowVersion: ['1'] }, startTime: 't', closeTime: null };
    },
    async fetchHistory() { return { events: [] }; },
    async cancel() {},
    async signal() {},
  };
  return {
    workflow: {
      getHandle() { return handle; },
      async start() { return handle; },
      async *list() { /* not exercised here */ },
    },
  };
}

function makeExecutor() {
  return createFlowExecutor({ temporalClient: makeFakeTemporal(), temporalAddress: 'fake:7233', logger: { error() {} } });
}

const ownerIdentity = { tenantId: TENANT, workspaceId: WORKSPACE, actorId: 'owner' };
// A different tenant addressing the SAME schedule-fired id shape (same workspace/flow ids in the
// string, but the caller's verified tenant prefix differs → must be rejected).
const foreignIdentity = { tenantId: 'ffffffff-ffff-4fff-8fff-ffffffffffff', workspaceId: WORKSPACE, actorId: 'attacker' };

// ut-wfid-06 (THE FIX, get): the OWNER GETs their cron-fired run and is NOT rejected by the parse.
test('ut-wfid-06: owner can GET their own schedule-fired execution (no 404 from the parse)', async () => {
  const executor = makeExecutor();
  try {
    const eid = scheduleFiredId();
    const res = await executor.executeFlows({
      operation: 'get_execution', identity: ownerIdentity, flowId: FLOW, executionId: eid,
    });
    assert.equal(res.executionId, eid, 'the executionId is echoed back verbatim');
    assert.equal(res.status, 'Running', 'the run is described, proving the ownership check passed');
  } finally {
    await executor.close().catch(() => {});
  }
});

// ut-wfid-07 (THE FIX, cancel): the OWNER CANCELs their cron-fired run and is NOT rejected (403).
test('ut-wfid-07: owner can CANCEL their own schedule-fired execution (no 403 from the parse)', async () => {
  const executor = makeExecutor();
  try {
    const eid = scheduleFiredId();
    const res = await executor.executeFlows({
      operation: 'cancel_execution', identity: ownerIdentity, flowId: FLOW, executionId: eid,
    });
    assert.equal(res.executionId, eid);
    assert.equal(res.status, 'Cancelling');
  } finally {
    await executor.close().catch(() => {});
  }
});

// ut-wfid-08: a DIFFERENT tenant on the SAME schedule-fired shape is STILL rejected (404 get /
// 403 cancel) — the fix must not weaken cross-tenant isolation.
test('ut-wfid-08: a foreign tenant is still rejected on a schedule-fired id (404 get / 403 cancel)', async () => {
  const executor = makeExecutor();
  try {
    const eid = scheduleFiredId(); // prefix is TENANT, but the caller is foreignIdentity
    await assert.rejects(
      () => executor.executeFlows({ operation: 'get_execution', identity: foreignIdentity, flowId: FLOW, executionId: eid }),
      (err) => { assert.equal(err.statusCode, 404); assert.equal(err.code, 'EXECUTION_NOT_FOUND'); return true; },
    );
    await assert.rejects(
      () => executor.executeFlows({ operation: 'cancel_execution', identity: foreignIdentity, flowId: FLOW, executionId: eid }),
      (err) => { assert.equal(err.statusCode, 403); assert.equal(err.code, 'CROSS_TENANT_FORBIDDEN'); return true; },
    );
  } finally {
    await executor.close().catch(() => {});
  }
});
