# Quickstart — US-BKP-02-T03

This guide covers the implementation and verification flow for the tenant reprovision-from-export feature.

## 1. Prerequisites

- Node.js 20+
- `pnpm` workspace available at repository root
- PostgreSQL test database reachable by the provisioning-orchestrator tests
- Mockable admin endpoints for Keycloak, Kafka, OpenWhisk, MongoDB, and S3-compatible storage
- Existing export artifact from T01/T02 for manual testing

## 2. Files expected from this feature

### Feature docs
- `specs/117-tenant-reprovision-from-export/plan.md`
- `specs/117-tenant-reprovision-from-export/research.md`
- `specs/117-tenant-reprovision-from-export/data-model.md`
- `specs/117-tenant-reprovision-from-export/quickstart.md`
- `specs/117-tenant-reprovision-from-export/contracts/*`

### Backend implementation targets
- `services/provisioning-orchestrator/src/actions/tenant-config-reprovision.mjs`
- `services/provisioning-orchestrator/src/actions/tenant-config-identifier-map.mjs`
- `services/provisioning-orchestrator/src/reprovision/*`
- `services/provisioning-orchestrator/src/repositories/config-reprovision-*.mjs`
- `services/provisioning-orchestrator/src/events/config-reprovision-events.mjs`
- `services/provisioning-orchestrator/src/migrations/117-tenant-config-reprovision.sql`

### Console implementation targets
- `apps/web-console/src/api/configReprovisionApi.ts`
- `apps/web-console/src/pages/ConsoleTenantConfigReprovisionPage.tsx`
- `apps/web-console/src/components/ConfigIdentifierMapEditor.tsx`
- `apps/web-console/src/components/ConfigReprovisionResultPanel.tsx`

## 3. Suggested local verification flow

### 3.1 Baseline repository checks

```bash
pnpm lint
pnpm test:contracts
pnpm validate:openapi
pnpm validate:authorization-model
```

### 3.2 Targeted feature tests

After implementation, run the feature-specific tests that should be added to the standard test locations:

```bash
node --test tests/contracts/config-reprovision*.test.mjs
node --test tests/e2e/workflows/config-reprovision*.test.mjs
node --test services/provisioning-orchestrator/src/tests/config-reprovision*.test.mjs
```

If the console page gets dedicated unit tests, run them through the existing console test suite or the repo-wide `pnpm test:e2e:console` command.

### 3.3 Manual API smoke test

1. Obtain a valid export artifact from T01/T02.
2. Confirm the destination tenant exists.
3. Request the identifier map:

```bash
curl -X POST \
  https://<gateway>/v1/admin/tenants/<tenant-id>/config/reprovision/identifier-map \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <token>' \
  -d '{"artifact": { ... }}'
```

4. Review and adjust the returned map.
5. Execute a dry-run:

```bash
curl -X POST \
  https://<gateway>/v1/admin/tenants/<tenant-id>/config/reprovision \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <token>' \
  -d '{"artifact": { ... }, "identifier_map": { ... }, "dry_run": true}'
```

6. Execute the effective reprovision with the same payload and `dry_run: false`.

## 4. What to verify

- `422` for artifacts that are not compatible with the current format version.
- `409` when a second reprovision is attempted for the same destination tenant.
- `200` for dry-run completions with `would_*` results.
- `200` or `207` for effective runs depending on partial outcomes.
- No raw export artifact is written to PostgreSQL.
- Audit events are emitted for both the identifier-map step and the reprovision step.
- Conflicts are reported, not overwritten.
- Redacted secrets stay redacted and are reported with warnings.

## 5. Operational notes

- Prefer dry-run before effective application in production.
- If a run fails midway, retry only the affected domains after fixing the cause.
- The lock TTL should be long enough for a standard tenant but short enough to recover from crashes.
- Keep the identifier map explicit; do not rely on naive global string replacement.
