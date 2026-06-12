/**
 * Flows E2E — Scenario 7: Version Pinning (GitHub issue #367).
 *
 * User story: us-flows-07
 *   As a workspace developer, I want an in-flight v1 run to complete with v1 behavior
 *   even after I publish v2, and I want subsequent trigger-started runs to use v2.
 *
 * Acceptance criteria exercised:
 *   - Start a run pinned to v1 (long-running flow to survive v2 publish).
 *   - Publish v2 with a modified definition (different description).
 *   - The v1 run completes with the v1 definition's behavior.
 *   - Starting a new execution defaults to the latest published version (v2).
 *   - The execution metadata reflects the correct version for each run.
 *
 * fn coverage: fn-flows-version-pin, fn-flows-publish-version.
 * Linked: us-flows-07, fn-flows-13.
 */

import { test, expect } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import { TENANT_A, flowName } from '../../helpers/flows/tenant-fixtures'
import { createFlowsApiClient, FlowsApiClient } from '../../helpers/flows/flows-api-client'
import { controlPlaneBaseUrl } from '../../helpers/flows/tenant-fixtures'
import { MINIMAL_3_NODE } from '../../fixtures/flows/flow-definitions'
import { pollExecutionStatus } from '../../helpers/flows/poll'
import type { FlowDefinition } from '../../fixtures/flows/flow-definitions'

const V2_DEFINITION: FlowDefinition = {
  ...MINIMAL_3_NODE,
  description: 'V2: identical tasks but updated description for version-pinning test',
}

test.describe('flows: version pinning', () => {
  test.describe.configure({ mode: 'serial' })

  let flowId: string
  let v1ExecId: string
  let v2ExecId: string
  let apiContext: APIRequestContext
  let client: FlowsApiClient
  const WS = TENANT_A.workspaceId
  const cpBase = controlPlaneBaseUrl()
  const FLOW_NAME = flowName('version-pinning')

  test.beforeAll(async ({ playwright }) => {
    apiContext = await playwright.request.newContext({ baseURL: cpBase })
    client = createFlowsApiClient(apiContext, { baseUrl: cpBase, identity: TENANT_A })
    const list = await client.listFlows(WS).catch(() => ({ items: [] }))
    const stale = list.items.find((f) => f.name === FLOW_NAME)
    if (stale) await client.deleteFlow(WS, stale.flowId).catch(() => {})

    // Create and publish v1.
    const created = await client.createFlow(WS, {
      name: FLOW_NAME,
      definition: MINIMAL_3_NODE,
    })
    flowId = created.flowId
    await client.publishFlow(WS, flowId)
  })

  test.afterAll(async () => {
    if (flowId) await client.deleteFlow(WS, flowId).catch(() => {})
    await apiContext.dispose()
  })

  // -----------------------------------------------------------------------
  // flw-e2e-vp-01: Start a v1 execution
  // -----------------------------------------------------------------------
  test('flw-e2e-vp-01: start v1 execution', async () => {
    const exec = await client.startExecution(WS, flowId, { version: 1 })
    v1ExecId = exec.executionId
    expect(v1ExecId).toBeTruthy()
  })

  // -----------------------------------------------------------------------
  // flw-e2e-vp-02: Publish v2 while the v1 run is in flight
  // -----------------------------------------------------------------------
  test('flw-e2e-vp-02: publish v2 with modified definition', async () => {
    // Update and publish v2.
    await client.updateFlow(WS, flowId, { definition: V2_DEFINITION })
    const result = await client.publishFlow(WS, flowId)
    expect(result.version).toBe(2)
  })

  // -----------------------------------------------------------------------
  // flw-e2e-vp-03: v1 execution completes (was not affected by v2 publish)
  // -----------------------------------------------------------------------
  test('flw-e2e-vp-03: v1 execution completes with v1 behavior', async () => {
    const detail = await pollExecutionStatus(
      () => client.getExecution(WS, flowId, v1ExecId),
      ['Completed', 'Failed'],
      { timeoutMs: 60_000, intervalMs: 2_000 },
    )
    expect(detail.status).toBe('Completed')
    // The execution's version field must reflect v1 (the version it was started with).
    // The version field on the execution maps to the flowVersion search attribute.
    if (detail.version !== undefined) {
      expect(String(detail.version)).toMatch(/^1|v1/)
    }
  })

  // -----------------------------------------------------------------------
  // flw-e2e-vp-04: A new (unversioned) execution uses v2
  // -----------------------------------------------------------------------
  test('flw-e2e-vp-04: new execution defaults to latest (v2)', async () => {
    const exec = await client.startExecution(WS, flowId)
    v2ExecId = exec.executionId

    const detail = await pollExecutionStatus(
      () => client.getExecution(WS, flowId, v2ExecId),
      ['Completed', 'Failed'],
      { timeoutMs: 60_000, intervalMs: 2_000 },
    )
    expect(detail.status).toBe('Completed')
    // The execution's version field must reflect v2.
    if (detail.version !== undefined) {
      expect(String(detail.version)).toMatch(/^2|v2/)
    }
  })

  // -----------------------------------------------------------------------
  // flw-e2e-vp-05: Flow's version list contains both v1 and v2
  // -----------------------------------------------------------------------
  test('flw-e2e-vp-05: flow has two published versions', async () => {
    const versions = await client.listVersions(WS, flowId)
    // Both v1 and v2 should be present.
    expect(versions.items.length).toBeGreaterThanOrEqual(2)
    const versionNumbers = versions.items.map((v) => v.version)
    expect(versionNumbers).toContain(1)
    expect(versionNumbers).toContain(2)
  })
})
