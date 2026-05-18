## Why

Two adapters expose executor entry points that throw `NOT_YET_IMPLEMENTED`
at runtime. The compiler/validator layer is well-developed; the production
execution glue is not in the repo. From
`openspec/audit/cap-o1-backing-system-adapters.md`:

- **B10** (`services/adapters/src/kafka-admin.mjs:905-909`,
  `services/adapters/src/keycloak-admin.mjs:529-571`) — Kafka exposes a
  `createTopicNamespace` stub; Keycloak exposes 11 stubs covering realm,
  client, role creation, service-account lifecycle, and credential rotation.
  Every executor entry point throws `NOT_YET_IMPLEMENTED`.
- **G-S2.7** (`kafka-admin.mjs:905-909`) — stub exported; callers can
  invoke and get a runtime error.
- **G-S3.12** (`keycloak-admin.mjs:529-571`) — 11 executor stubs.
- **G-S4.4** (cross-cutting) — per-provider executor stubs flagged across
  the adapter directory.

This is a `complete-*` change because the executor code does not exist —
there is no buggy implementation to repair.

## What Changes

- Implement the 12 executor entry points across the two adapters by wiring
  to real provider clients (KafkaJS for Kafka, the Keycloak admin REST API
  for Keycloak). Each executor MUST:
  1. Consume the envelope built by `buildXxxAdapterCall`.
  2. Call the provider client with timeouts, retries, and the named error
     mapping documented at `ERROR_CODE_MAP` in each adapter.
  3. Emit the audit event already declared (`kafka.admin.reconciled` for
     Kafka, an equivalent `iam.admin.reconciled` for Keycloak).
- Keep the existing compile/validate layer unchanged; the executors are
  thin call-sites that the existing layer feeds.
- Mark the storage-adapter `provisionWorkspaceStorageBoundary` stub
  (referenced by G1 audit B6) as deliberately out of scope here so this
  proposal stays ≤10 tasks; it gets its own follow-up.

## Capabilities

### Modified Capabilities

- `deployment-and-operations`: Kafka and Keycloak executor entry points
  MUST call real provider clients with the documented timeouts, retries,
  error mappings, and audit emission; `NOT_YET_IMPLEMENTED` MUST NOT
  ship.

## Impact

- Affected code: `services/adapters/src/kafka-admin.mjs` (`:905-909`);
  `services/adapters/src/keycloak-admin.mjs` (`:529-571`); two new
  provider-client modules (e.g.,
  `services/adapters/src/runtime/kafka-client.mjs`,
  `services/adapters/src/runtime/keycloak-client.mjs`) so the adapter `.mjs`
  files keep their "pure compiler" shape and the runtime executors are
  isolated.
- Migration: the new clients require KafkaJS and a Keycloak admin REST
  dependency; both MUST be added with pinned versions; helm chart needs
  to provide a Keycloak admin service-account credential.
- Breaking changes: callers that today catch `NOT_YET_IMPLEMENTED` to noop
  will start seeing real provider errors; document the upgrade path.
- Out of scope: storage executor (`provisionWorkspaceStorageBoundary`);
  authorization-policy adoption (covered by
  `harden-o1-authorization-policy-adoption`); per-provider validation
  hardening (covered by `harden-o1-secondary-validation-gaps`).
