/**
 * MCP E2E — cross-tenant isolation probes (issue #402, epic #386).
 *
 * Tenant B must not reach tenant A's MCP server, tools, logs, or OAuth credentials. Tenant A
 * creates a server; tenant B's reads/calls/audit against it must be denied (404/403) or empty.
 *
 * LIVE GATE: skips with a precise reason until the control-plane MCP management API is wired
 * (see mcp-api-client). The isolation model itself (registry #396, audit #398, OAuth #390,
 * NetworkPolicy #399) is tenant_id-scoped by the same identity headers the control-plane enforces.
 */

import { test, expect } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import { TENANT_A, TENANT_B, controlPlaneBaseUrl, serverName } from '../../helpers/mcp/tenant-fixtures'
import { createMcpApiClient, McpApiClient, probeMcpManagement, MCP_MANAGEMENT_GATE_REASON } from '../../helpers/mcp/mcp-api-client'

test.describe('mcp: cross-tenant isolation', () => {
  test.describe.configure({ mode: 'serial' })

  let ctxA: APIRequestContext
  let ctxB: APIRequestContext
  let clientA: McpApiClient
  let clientB: McpApiClient
  let serverId: string
  const WS_A = TENANT_A.workspaceId
  const WS_B = TENANT_B.workspaceId
  const cpBase = controlPlaneBaseUrl()
  const SERVER_NAME = serverName('xt-a')

  test.beforeAll(async ({ playwright }) => {
    ctxA = await playwright.request.newContext({ baseURL: cpBase })
    ctxB = await playwright.request.newContext({ baseURL: cpBase })
    const served = await probeMcpManagement(ctxA, cpBase, TENANT_A)
    test.skip(!served, MCP_MANAGEMENT_GATE_REASON)
    clientA = createMcpApiClient(ctxA, { baseUrl: cpBase, identity: TENANT_A })
    clientB = createMcpApiClient(ctxB, { baseUrl: cpBase, identity: TENANT_B })
    const created = await clientA.createServer(WS_A, { name: SERVER_NAME, source: 'instant', generator: 'postgres' })
    serverId = created.body.serverId ?? created.body.id
    await clientA.publishVersion(WS_A, serverId, { version: 'v1' }).catch(() => {})
  })

  test.afterAll(async () => {
    if (serverId && clientA) await clientA.deleteServer(WS_A, serverId).catch(() => {})
    await ctxA?.dispose()
    await ctxB?.dispose()
  })

  test('mcp-e2e-xt-01: B cannot get A\'s server detail', async () => {
    const res = await clientB.getServer(WS_A, serverId)
    expect([403, 404]).toContain(res.status)
  })

  test('mcp-e2e-xt-02: A\'s server does not appear in B\'s server list', async () => {
    const list = await clientB.listServers(WS_B)
    const ids = (list.body.items ?? []).map((s: { serverId?: string; id?: string }) => s.serverId ?? s.id)
    expect(ids).not.toContain(serverId)
  })

  test('mcp-e2e-xt-03: B cannot call a tool on A\'s server', async () => {
    const res = await clientB.callTool(WS_A, serverId, { name: 'list', arguments: {} })
    expect([403, 404]).toContain(res.status)
  })

  test('mcp-e2e-xt-04: B cannot read A\'s server audit (logs/credentials)', async () => {
    const res = await clientB.listAudit(WS_A, serverId)
    expect([403, 404]).toContain(res.status)
  })
})
