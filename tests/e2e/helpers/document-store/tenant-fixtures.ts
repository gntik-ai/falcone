// Document-store E2E tenant fixtures (change add-ferretdb-document-store-e2e, #464).
// Re-exports the canonical A/B tenants so the document-store suite uses the SAME identities
// as flows/storage/mcp (no duplication; design D2). `collectionName` yields a deterministic,
// run-scoped collection name — stable WITHIN a run (so a cross-tenant probe's A-writer and
// B-reader address the same collection) but unique ACROSS runs (avoids stale-data collisions
// when run against a persistent control-plane).
export { TENANT_A, TENANT_B, controlPlaneBaseUrl } from '../flows/tenant-fixtures'

const RUN_ID = Date.now()

export function collectionName(scenario: string): string {
  return `e2e-${scenario}-${RUN_ID}`
}
