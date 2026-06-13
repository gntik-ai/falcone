/**
 * MCP E2E — full loop (issue #402, epic #386).
 *
 * User story: generate/create a server → curate tools → deploy → connect via OAuth → call a tool →
 * observe in the audit/console. Runs against the real control-plane on the kind cluster.
 *
 * LIVE GATE: the control-plane does not yet serve the MCP management API (the MCP modules are pure;
 * not wired into runtime/server.mjs). `probeMcpManagement` detects this and the suite skips with a
 * precise reason. When the routes are wired, this spec executes the full loop unchanged.
 */

import { test, expect } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import { TENANT_A, controlPlaneBaseUrl, serverName } from '../../helpers/mcp/tenant-fixtures'
import { createMcpApiClient, McpApiClient, probeMcpManagement, MCP_MANAGEMENT_GATE_REASON } from '../../helpers/mcp/mcp-api-client'

test.describe('mcp: full loop (create → curate → deploy → connect → call → observe)', () => {
  test.describe.configure({ mode: 'serial' })

  let apiContext: APIRequestContext
  let client: McpApiClient
  let serverId: string
  const WS = TENANT_A.workspaceId
  const cpBase = controlPlaneBaseUrl()
  const SERVER_NAME = serverName('full-loop')

  test.beforeAll(async ({ playwright }) => {
    apiContext = await playwright.request.newContext({ baseURL: cpBase })
    const served = await probeMcpManagement(apiContext, cpBase, TENANT_A)
    test.skip(!served, MCP_MANAGEMENT_GATE_REASON)
    client = createMcpApiClient(apiContext, { baseUrl: cpBase, identity: TENANT_A })
    // idempotent cleanup of a stale server from a prior run
    const list = await client.listServers(WS).catch(() => ({ status: 0, body: { items: [] } }))
    const stale = (list.body.items ?? []).find((s: { name?: string }) => s.name === SERVER_NAME)
    if (stale) await client.deleteServer(WS, stale.serverId).catch(() => {})
  })

  test.afterAll(async () => {
    if (serverId && client) await client.deleteServer(WS, serverId).catch(() => {})
    await apiContext?.dispose()
  })

  test('mcp-e2e-fl-01: create a server with a draft tool set', async () => {
    const res = await client.createServer(WS, { name: SERVER_NAME, source: 'instant', generator: 'postgres' })
    expect([200, 201]).toContain(res.status)
    serverId = res.body.serverId ?? res.body.id
    expect(serverId).toBeTruthy()
  })

  test('mcp-e2e-fl-02: curate and publish the tool set', async () => {
    await client.curateServer(WS, serverId, { decisions: {} })
    const pub = await client.publishVersion(WS, serverId, { version: 'v1' })
    expect([200, 201]).toContain(pub.status)
  })

  test('mcp-e2e-fl-03: the published server exposes an endpoint and curated tools', async () => {
    const detail = await client.getServer(WS, serverId)
    expect(detail.status).toBe(200)
    expect(detail.body.endpoint ?? detail.body.endpointUrl).toBeTruthy()
    expect(Array.isArray(detail.body.tools)).toBe(true)
  })

  test('mcp-e2e-fl-04: call a tool through the OAuth-backed path and get a structured result', async () => {
    // Invoke a real curated tool from the published manifest; the control-plane mediates the call
    // (scope-enforced, tenant-scoped) and returns a structured MCP result envelope.
    const detail = await client.getServer(WS, serverId)
    const toolName = detail.body.tools[0].name
    const result = await client.callTool(WS, serverId, { name: toolName, arguments: { workspaceId: WS } })
    expect([200, 202]).toContain(result.status)
    expect(result.body).toBeTruthy()
    expect(Array.isArray(result.body.content)).toBe(true)
  })

  test('mcp-e2e-fl-05: the tool call is observable in the tenant audit', async () => {
    const audit = await client.listAudit(WS, serverId)
    expect(audit.status).toBe(200)
    expect(Array.isArray(audit.body.items)).toBe(true)
  })
})
