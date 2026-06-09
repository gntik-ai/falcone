# Retention-driven tenant purge executor (saga teardown)

| Field | Value |
|-------|-------|
| Change ID | `add-tenant-purge-executor` |
| Capability | `tenant-lifecycle`, `tenant-provisioning` |
| Type | enhancement |
| Priority | P0 |
| OpenSpec change | `openspec/changes/add-tenant-purge-executor/` |

## Why

Tenant purge is fully modeled as a preview/draft but has no executor. The
retention window is evaluated and a draft is constructed, but nothing performs
the cascading deletion. Soft-deleted tenants accumulate indefinitely; the
`retentionPolicy.purgeEligibleAt` timestamp is checked but never acted upon,
leaving orphaned IAM realms, Kafka topics/ACLs, Postgres schemas, Mongo
databases, storage namespaces, and OpenWhisk namespaces across six domains — a
lifecycle-cleanup gap (audit priority #5) and a data-retention / right-to-erasure
compliance risk.

## What Changes

- Add a `teardown(tenantId, domainData, options)` export to each of the six
  appliers (`iam`, `kafka`, `postgres`, `mongo`, `storage`, `functions`),
  symmetrically reversing the `apply` path.
- Add a new orchestrator sweep action `tenant-purge-sweep.mjs` that: (1) finds
  tenants in `state='deleted'` with elapsed `purgeEligibleAt`, (2) re-enforces
  the existing dual-confirmation/elevated-access guards via
  `evaluateTenantLifecycleMutation`, (3) drives a deletion saga across all six
  domains, (4) hard-deletes service-owned rows, (5) emits a `tenant.purged` audit
  event with a verifiable destruction manifest.
- Wire `POST /v1/admin/tenants/{tenantId}/purge` for operator-triggered on-demand
  purge; returns 202 Accepted + async-operation reference.
- No new public-facing data model; uses the existing `state='purged'` transition
  already defined in `evaluateTenantLifecycleMutation`.

## Spec delta (EARS)

From `openspec/changes/add-tenant-purge-executor/specs/tenant-lifecycle/spec.md`:

**REQ — Retention-window-driven automatic purge sweep**
The system SHALL automatically identify tenants in `state='deleted'` whose
`retentionPolicy.purgeEligibleAt` has elapsed and execute a cascading purge saga
across all six provisioned domains.

**REQ — Dual-confirmation and elevated-access enforcement**
The system SHALL refuse to execute a tenant purge unless both elevated access
and a second confirmation are present, as evaluated by
`evaluateTenantLifecycleMutation`.

**REQ — Six-domain cascading teardown**
The system SHALL remove all provisioned resources across all six domains (IAM,
Kafka, Postgres, Mongo, storage, functions), leaving no orphaned cross-tenant
data in any domain.

**REQ — tenant.purged audit event with destruction manifest**
The system SHALL emit a `tenant.purged` audit event upon successful completion of
a purge saga, including a destruction manifest enumerating all resources removed.

**REQ — On-demand operator-triggered purge endpoint**
The system SHALL expose `POST /v1/admin/tenants/{tenantId}/purge` subject to
the same dual-confirmation and export-checkpoint guards as the automated sweep.

## Tasks

See `openspec/changes/add-tenant-purge-executor/tasks.md` for the full checklist.
Key groups:

1. Baseline green
2. Black-box tests (write first — red before green); cross-tenant probe included
3. Applier teardown methods (all six; idempotent delete-if-exists semantics)
4. Purge sweep action (`tenant-purge-sweep.mjs`; dry-run flag for initial rollout)
5. On-demand purge endpoint (`POST /v1/admin/tenants/{tenantId}/purge`)
6. Final `bash tests/blackbox/run.sh`

## Acceptance criteria

- **AC1:** Calling `POST /v1/admin/tenants/{tenantId}/purge` without elevated
  access returns 403/409 with a `blocker` message; no resources are removed.
- **AC2:** On-demand purge with valid dual-confirmation returns 202 Accepted with
  an async-operation reference; tenant transitions to `state='purged'` on saga
  completion.
- **AC3:** After successful purge, no IAM realm, Kafka topics/ACLs, Postgres
  schema, Mongo database, storage namespace, or functions namespace belonging to
  the purged tenant exists.
- **AC4:** A `tenant.purged` audit event is emitted with a non-empty destruction
  manifest listing all removed resources by domain.
- **AC5:** A partial-failure scenario (one domain teardown fails) does NOT emit
  `tenant.purged`; the saga is retryable; no orphaned state is left.
- **AC6:** Tenant B's data is unaffected after Tenant A is purged (cross-tenant
  probe).
- **AC7:** Tenants inside the retention window are not touched by the scheduled
  sweep.
- **AC8:** `bash tests/blackbox/run.sh` passes green.

## Code evidence

- `services/internal-contracts/src/index.mjs::evaluateTenantLifecycleMutation` (lines 1523–1543) — purge preconditions checked but never executed
- `services/internal-contracts/src/index.mjs::buildTenantPurgeDraft` (lines 1460–1472) — draft constructed, no executor consumes it
- `services/provisioning-orchestrator/src/actions/` — directory listing: `async-operation-orphan-sweep.mjs`, `credential-rotation-expiry-sweep.mjs`, `quota-override-expiry-sweep.mjs`, `secret-rotation-expiry-sweep.mjs` present; **no `tenant-purge-sweep.mjs`**
- `services/provisioning-orchestrator/src/appliers/iam-applier.mjs::apply` — only `apply` exported; no `teardown`
- `services/provisioning-orchestrator/src/appliers/kafka-applier.mjs::apply` — only `apply` exported; no `teardown`
- Same gap confirmed in `postgres-applier.mjs`, `mongo-applier.mjs`, `storage-applier.mjs`, `functions-applier.mjs`
- No `tenant.purged` or purge executor anywhere in `services/` (grep for `tenant.purged` returns empty)

## Resolution (OpenSpec)

```
/opsx:apply add-tenant-purge-executor
/opsx:verify add-tenant-purge-executor
bash tests/blackbox/run.sh
/opsx:archive add-tenant-purge-executor
```

Alternatively: `/implement-change add-tenant-purge-executor`

Optional real-stack E2E: `/e2e-issue add-tenant-purge-executor`
