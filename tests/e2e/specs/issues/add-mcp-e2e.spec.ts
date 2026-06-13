/**
 * Per-issue MCP E2E smoke (issue #402) — entry point for `run-issue.sh add-mcp-e2e`.
 *
 * Deploys via stack.sh (ephemeral namespace, always torn down) and runs a representative slice of
 * the MCP suite: probe the management API, then create → get → delete a server. Skips with a
 * precise reason while the control-plane MCP management API is not yet wired live (see
 * mcp-api-client / MCP_MANAGEMENT_GATE_REASON). The full suite lives under specs/mcp/.
 */

import { test, expect } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import { TENANT_A, controlPlaneBaseUrl, serverName } from '../../helpers/mcp/tenant-fixtures'
import { createMcpApiClient, probeMcpManagement, MCP_MANAGEMENT_GATE_REASON } from '../../helpers/mcp/mcp-api-client'

test.describe('issue add-mcp-e2e: MCP runtime smoke', () => {
  let apiContext: APIRequestContext
  const WS = TENANT_A.workspaceId
  const cpBase = controlPlaneBaseUrl()

  test.beforeAll(async ({ playwright }) => {
    apiContext = await playwright.request.newContext({ baseURL: cpBase })
  })

  test.afterAll(async () => {
    await apiContext?.dispose()
  })

  test('mcp-e2e-smoke: create → get → delete a server', async () => {
    const served = await probeMcpManagement(apiContext, cpBase, TENANT_A)
    test.skip(!served, MCP_MANAGEMENT_GATE_REASON)

    const client = createMcpApiClient(apiContext, { baseUrl: cpBase, identity: TENANT_A })
    const name = serverName('smoke')
    const created = await client.createServer(WS, { name, source: 'instant', generator: 'postgres' })
    expect([200, 201]).toContain(created.status)
    const serverId = created.body.serverId ?? created.body.id

    const detail = await client.getServer(WS, serverId)
    expect(detail.status).toBe(200)

    const removed = await client.deleteServer(WS, serverId)
    expect([200, 202, 204]).toContain(removed.status)
  })
})
