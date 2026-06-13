/**
 * Two-tenant fixture provisioning for the Flows E2E suite.
 *
 * Provisions two deterministic tenants (A and B) with one workspace each.
 * Every spec that is tenancy-sensitive includes a cross-tenant probe to verify
 * that tenant B cannot observe tenant A's flows, executions, or live streams.
 *
 * Identity values are FIXED (not random) so idempotent re-runs do not accumulate
 * stale rows. The flows API uses tenant_id-scoped Postgres RLS and
 * workflowId-prefix checks on Temporal, so the same UUIDs across runs are safe.
 */

/** Tenant A — the primary tenant for all scenario probes. */
export const TENANT_A = {
  tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  workspaceId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaa001',
  actorId: 'e2e-actor-a',
  roleName: 'falcone_app',
}

/** Tenant B — used ONLY for cross-tenant isolation probes. */
export const TENANT_B = {
  tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  workspaceId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb01',
  actorId: 'e2e-actor-b',
  roleName: 'falcone_app',
}

/** Control-plane base URL (direct, no gateway). Override with E2E_CP_BASE_URL. */
export function controlPlaneBaseUrl(): string {
  return process.env.E2E_CP_BASE_URL ?? 'http://localhost:8080'
}

/** Web console base URL (served by nginx). Override with E2E_BASE_URL. */
export function consoleBaseUrl(): string {
  return process.env.E2E_BASE_URL ?? 'http://localhost:3000'
}

/**
 * Generate a deterministic, unique flow name for a given test scenario label.
 * Keeps names stable across re-runs while avoiding collisions between specs.
 */
export function flowName(scenario: string): string {
  return `e2e-flows-${scenario}`
}
