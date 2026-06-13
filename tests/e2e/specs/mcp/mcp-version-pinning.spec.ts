/**
 * MCP E2E — version pinning / rug-pull review (issue #402, epic #386).
 *
 * A version bump that changes a tool's description/scope must be held for review and NOT served
 * until the tenant approves it (registry #396). The previously approved version keeps serving.
 *
 * LIVE GATE: skips with a precise reason until the control-plane MCP management API is wired.
 */

import { test, expect } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import { TENANT_A, controlPlaneBaseUrl, serverName } from '../../helpers/mcp/tenant-fixtures'
import { createMcpApiClient, McpApiClient, probeMcpManagement, MCP_MANAGEMENT_GATE_REASON } from '../../helpers/mcp/mcp-api-client'

test.describe('mcp: version pinning / rug-pull review', () => {
  test.describe.configure({ mode: 'serial' })

  let apiContext: APIRequestContext
  let client: McpApiClient
  let serverId: string
  const WS = TENANT_A.workspaceId
  const cpBase = controlPlaneBaseUrl()
  const SERVER_NAME = serverName('version-pinning')

  test.beforeAll(async ({ playwright }) => {
    apiContext = await playwright.request.newContext({ baseURL: cpBase })
    const served = await probeMcpManagement(apiContext, cpBase, TENANT_A)
    test.skip(!served, MCP_MANAGEMENT_GATE_REASON)
    client = createMcpApiClient(apiContext, { baseUrl: cpBase, identity: TENANT_A })
    const created = await client.createServer(WS, { name: SERVER_NAME, source: 'instant', generator: 'postgres' })
    serverId = created.body.serverId ?? created.body.id
    await client.publishVersion(WS, serverId, { version: 'v1' })
  })

  test.afterAll(async () => {
    if (serverId && client) await client.deleteServer(WS, serverId).catch(() => {})
    await apiContext?.dispose()
  })

  test('mcp-e2e-vp-01: a tool-description change is held for review (not served)', async () => {
    // publish a v2 that changes a tool description/scope -> requiresReview
    const pub = await client.publishVersion(WS, serverId, { version: 'v2', toolDescriptionChange: true })
    expect([200, 201]).toContain(pub.status)
    expect(pub.body.requiresReview ?? pub.body.status === 'requires_review').toBeTruthy()

    // the active served version is still v1
    const detail = await client.getServer(WS, serverId)
    expect(detail.body.version ?? detail.body.activeVersion).toMatch(/^v?1/)
  })

  test('mcp-e2e-vp-02: after approval, the new version serves', async () => {
    const approved = await client.approveVersion(WS, serverId, 'v2')
    expect([200, 201, 204]).toContain(approved.status)
    const detail = await client.getServer(WS, serverId)
    expect(detail.body.version ?? detail.body.activeVersion).toMatch(/^v?2/)
  })
})
