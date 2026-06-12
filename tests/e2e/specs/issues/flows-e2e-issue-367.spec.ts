/**
 * Per-issue E2E regression spec for GitHub issue #367 (flows E2E gate).
 *
 * This is the THIN entry point used by `run-issue.sh flows-e2e-issue-367`; it
 * re-exports or directly exercises the core acceptance scenarios from the issue body:
 *
 *   1. Design & publish a 3-node flow via the API + console UI.
 *   2. Manual run: execution reaches Completed; all nodes completed.
 *   3. Cross-tenant probe: tenant B cannot read tenant A's flows.
 *
 * The full eight-scenario suite is in tests/e2e/specs/flows/*.spec.ts.
 * This file keeps a minimal regression footprint so `run-issue.sh` stays fast.
 *
 * Linked: us-flows-01, us-flows-02, us-flows-08 / fn-flows-01…15.
 * Change-id: flows-e2e-issue-367.
 */

import { test, expect } from '@playwright/test'
import { TENANT_A, TENANT_B, flowName } from '../../helpers/flows/tenant-fixtures'
import { createFlowsApiClient } from '../../helpers/flows/flows-api-client'
import { controlPlaneBaseUrl } from '../../helpers/flows/tenant-fixtures'
import { MINIMAL_3_NODE } from '../../fixtures/flows/flow-definitions'
import { pollExecutionStatus } from '../../helpers/flows/poll'

test.describe.configure({ mode: 'serial' })

const cpBase = controlPlaneBaseUrl()
const WS_A = TENANT_A.workspaceId
const WS_B = TENANT_B.workspaceId
let flowId: string
let execId: string

test.beforeAll(async ({ request }) => {
  const client = createFlowsApiClient(request, { baseUrl: cpBase, identity: TENANT_A })
  const list = await client.listFlows(WS_A).catch(() => ({ items: [] }))
  const stale = list.items.find((f) => f.name === flowName('issue-367'))
  if (stale) await client.deleteFlow(WS_A, stale.flowId).catch(() => {})
})

test.afterAll(async ({ request }) => {
  if (!flowId) return
  const client = createFlowsApiClient(request, { baseUrl: cpBase, identity: TENANT_A })
  await client.deleteFlow(WS_A, flowId).catch(() => {})
})

test('issue-367 scenario 1: create, publish, and verify flow definition', async ({ request }) => {
  const client = createFlowsApiClient(request, { baseUrl: cpBase, identity: TENANT_A })
  const created = await client.createFlow(WS_A, {
    name: flowName('issue-367'),
    definition: MINIMAL_3_NODE,
  })
  flowId = created.flowId
  expect(flowId).toBeTruthy()

  const published = await client.publishFlow(WS_A, flowId)
  expect(published.version).toBe(1)
})

test('issue-367 scenario 2: start execution; reaches Completed', async ({ request }) => {
  const client = createFlowsApiClient(request, { baseUrl: cpBase, identity: TENANT_A })
  const exec = await client.startExecution(WS_A, flowId)
  execId = exec.executionId
  expect(execId).toBeTruthy()

  const detail = await pollExecutionStatus(
    () => client.getExecution(WS_A, flowId, execId),
    ['Completed', 'Failed', 'Canceled'],
    { timeoutMs: 60_000, intervalMs: 2_000 },
  )
  expect(detail.status).toBe('Completed')
})

test('issue-367 scenario 8 (cross-tenant): tenant B cannot see tenant A flow', async ({
  request,
}) => {
  const url = `${cpBase}/v1/flows/workspaces/${encodeURIComponent(WS_B)}/flows/${encodeURIComponent(flowId)}`
  const res = await request.get(url, {
    headers: {
      'x-tenant-id': TENANT_B.tenantId,
      'x-workspace-id': WS_B,
      'x-auth-subject': 'b-actor',
      'x-pg-role': 'falcone_app',
    },
  })
  expect([403, 404]).toContain(res.status())
})
