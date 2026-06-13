/**
 * Two-tenant fixtures for the MCP E2E suite (issue #402, epic #386).
 *
 * Reuses the canonical A/B E2E tenants (same fixed UUIDs as the flows suite) so the same
 * provisioned tenants back every real-stack suite. Tenant B is used ONLY for cross-tenant probes:
 * B must never reach A's MCP server, tools, logs, or OAuth credentials.
 *
 * Identity values are FIXED (not random) so idempotent re-runs do not accumulate stale rows
 * (the MCP registry + audit are tenant_id-scoped).
 */

/** Tenant A — the primary tenant for all MCP scenario probes. */
export const TENANT_A = {
  tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  workspaceId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaa001',
  actorId: 'e2e-mcp-actor-a',
  roleName: 'falcone_app',
}

/** Tenant B — used ONLY for cross-tenant isolation probes. */
export const TENANT_B = {
  tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  workspaceId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb01',
  actorId: 'e2e-mcp-actor-b',
  roleName: 'falcone_app',
}

/** Control-plane base URL (direct, no gateway). Override with E2E_CP_BASE_URL. */
export function controlPlaneBaseUrl(): string {
  return process.env.E2E_CP_BASE_URL ?? 'http://localhost:8080'
}

/** Deterministic, unique MCP server name for a scenario label (stable across re-runs). */
export function serverName(scenario: string): string {
  return `e2e-mcp-${scenario}`
}
