// Boolean-capability catalog keys — the single source of truth the console uses when
// gating features behind `CapabilityGate` / `useCapabilityGate`.
//
// These MUST stay in lockstep with the platform boolean-capability catalog
// (`boolean_capability_catalog.capability_key`), which is seeded by exactly two
// provisioning-orchestrator migrations:
//   - packages/provisioning-orchestrator/src/migrations/104-plan-boolean-capabilities.sql
//       sql_admin_api, passthrough_admin, realtime, webhooks, public_functions,
//       custom_domains, scheduled_functions
//   - packages/provisioning-orchestrator/src/migrations/114-backup-scope-deployment-profiles.sql
//       backup_scope_access
//
// The effective-capabilities endpoint (GET /v1/tenant/effective-capabilities) only ever
// returns keys present in this catalog, and `useCapabilityGate` is fail-closed (a key that
// is absent or `false` → disabled). Gating a feature on a key that is NOT in this catalog
// can therefore NEVER be satisfied for any tenant on any plan — the surface renders
// permanently dimmed. (#790)
//
// A console feature must only be gated on a key from this set; this is enforced at compile
// time via `BooleanCapabilityKey` (the `CapabilityGate.capability` / `useCapabilityGate`
// param type) and at test time via the audit guard in
// `src/lib/capabilities/capability-gate-keys.test.ts`.
export const BOOLEAN_CAPABILITY_KEYS = [
  'sql_admin_api',
  'passthrough_admin',
  'realtime',
  'webhooks',
  'public_functions',
  'custom_domains',
  'scheduled_functions',
  'backup_scope_access'
] as const

export type BooleanCapabilityKey = (typeof BOOLEAN_CAPABILITY_KEYS)[number]

const BOOLEAN_CAPABILITY_KEY_SET: ReadonlySet<string> = new Set(BOOLEAN_CAPABILITY_KEYS)

export function isBooleanCapabilityKey(value: string): value is BooleanCapabilityKey {
  return BOOLEAN_CAPABILITY_KEY_SET.has(value)
}
