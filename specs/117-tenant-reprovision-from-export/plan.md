# Plan de Implementación: US-BKP-02-T03 — Reaprovisionamiento de tenant a partir de export

**Branch**: `117-tenant-reprovision-from-export` | **Date**: 2026-04-01 | **Spec**: [`spec.md`](./spec.md)
**Task ID**: US-BKP-02-T03 | **Epic**: EP-20 — Backup, recuperación y continuidad operativa | **Story**: US-BKP-02
**Dependencias**: US-TEN-04, US-BKP-01, US-BKP-02-T01, US-BKP-02-T02
**Input**: Especificación de feature desde `/specs/117-tenant-reprovision-from-export/spec.md`

## Summary

Implementar el flujo de reprovisionamiento de un tenant destino a partir de un artefacto de exportación validado/migrado, con ajuste manual de identificadores cuando el tenant de origen y el de destino no coincidan. La solución mantiene el reprovisionamiento **best-effort por dominio**, evita sobrescrituras automáticas ante conflictos, soporta `dry_run`, genera un mapa de identificadores propuesto para revisión manual, y emite auditoría a PostgreSQL + Kafka.

La implementación reutiliza el stack existente del proyecto: acciones OpenWhisk para la lógica de control, APISIX para la exposición HTTP, Keycloak para autorización, PostgreSQL para locks y auditoría, Kafka para eventos, y React + Tailwind + shadcn/ui para la consola. Los aplicadores por dominio se organizan como un módulo nuevo de la capa backend, con diffs y validación conservadora para IAM, PostgreSQL, MongoDB, Kafka, OpenWhisk y S3-compatible storage.

Decisiones clave:
- El endpoint principal será **síncrono** y devolverá un resultado detallado por dominio y recurso.
- La concurrencia se resolverá con un **lock persistente en PostgreSQL** por `tenant_id` destino y TTL configurado.
- El mapa de identificadores se aplicará con **sustitución token-aware y ordenada por longitud** para evitar colisiones de subcadenas.
- Los recursos existentes con configuración diferente se reportarán como **`conflict`**, nunca se sobrescribirán automáticamente.
- Se añadirá una **página de consola** para revisar y ajustar el mapa antes de ejecutar el reprovisionamiento efectivo.

---

## Technical Context

**Language/Version**: Node.js 20+ ESM (`"type": "module"`, pnpm workspaces) + React 18 + TypeScript en consola
**Primary Dependencies**: `pg`, `kafkajs`, `undici`, `ajv`, React + Tailwind CSS + shadcn/ui
**Storage**: PostgreSQL (lock + auditoría); artefacto procesado en memoria; dependencias externas Keycloak, Kafka, MongoDB, S3-compatible, OpenWhisk
**Testing**: `node:test`, `node:assert`, `undici` (contracts/integration), `vitest` + React Testing Library (console)
**Target Platform**: Kubernetes / OpenShift con Helm, acciones OpenWhisk detrás de APISIX
**Project Type**: Plataforma BaaS multi-tenant de control plane + serverless actions + console web
**Performance Goals**: dry-run estándar < 30s; operación efectiva para tenant estándar < 60s; adquisición de lock < 1s; respuesta con resumen por dominio sin bloquear por un dominio fallido
**Constraints**: no almacenar el artefacto completo; no transacciones cross-domain; no overwrite ante conflictos; un solo reprovision activo por tenant; auditoría obligatoria; secretos redactados no se aplican
**Scale/Scope**: 6 dominios funcionales, decenas de recursos por dominio en tenants estándar, multi-tenant estricto, resultado detallado por recurso y dominio

---

## Constitution Check

| Principle | Status | Notes |
|---|---|---|
| I. Monorepo Separation of Concerns | ✅ PASS | Backend en `services/provisioning-orchestrator/src/`; consola en `apps/web-console/src/`; rutas y scopes en `services/gateway-config/` y `services/keycloak-config/`; docs y contracts bajo `specs/117-tenant-reprovision-from-export/` |
| II. Incremental Delivery First | ✅ PASS | La feature se entrega por capas: contrato, lock/auditoría, helpers comunes, appliers por dominio, UI de revisión, pruebas |
| III. Kubernetes and OpenShift Compatibility | ✅ PASS | Se reutilizan acciones OpenWhisk y recursos Helm/APISIX; la persistencia queda en PostgreSQL sin dependencias de plataforma no portables |
| IV. Quality Gates at the Root | ✅ PASS | Contratos, integración y consola se verifican con scripts raíz existentes + tests nuevos en ubicaciones estándar |
| V. Documentation as Part of the Change | ✅ PASS | Este plan, `research.md`, `data-model.md`, `quickstart.md` y `contracts/` documentan la implementación propuesta |

No hay violaciones que requieran `Complexity Tracking`.

---

## Project Structure

### Documentation (this feature)

```text
specs/117-tenant-reprovision-from-export/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/
    ├── tenant-config-reprovision.json
    ├── tenant-config-identifier-map.json
    └── config-reprovision-audit-event.json
```

### Backend: provisioning-orchestrator

```text
services/provisioning-orchestrator/src/
├── actions/
│   ├── tenant-config-reprovision.mjs
│   └── tenant-config-identifier-map.mjs
├── reprovision/                              # nuevo módulo feature-scoped
│   ├── types.mjs
│   ├── identifier-map.mjs
│   ├── registry.mjs
│   ├── diff.mjs
│   └── appliers/
│       ├── iam-applier.mjs
│       ├── postgres-applier.mjs
│       ├── mongo-applier.mjs
│       ├── kafka-applier.mjs
│       ├── functions-applier.mjs
│       └── storage-applier.mjs
├── repositories/
│   ├── config-reprovision-audit-repository.mjs
│   └── config-reprovision-lock-repository.mjs
├── events/
│   └── config-reprovision-events.mjs
└── migrations/
    └── 117-tenant-config-reprovision.sql
```

### Console

```text
apps/web-console/src/
├── api/
│   └── configReprovisionApi.ts
├── components/
│   ├── ConfigIdentifierMapEditor.tsx
│   └── ConfigReprovisionResultPanel.tsx
└── pages/
    └── ConsoleTenantConfigReprovisionPage.tsx
```

### Gateway and IAM

```text
services/gateway-config/routes/
└── backup-admin-routes.yaml                  # add reprovision + identifier-map routes

services/keycloak-config/scopes/
└── backup-scopes.yaml                        # add platform:admin:config:reprovision
```

### Tests

```text
tests/contracts/
├── tenant-config-reprovision.contract.test.mjs
├── tenant-config-identifier-map.contract.test.mjs
└── config-reprovision-audit-event.contract.test.mjs

tests/e2e/workflows/
└── tenant-config-reprovision.test.mjs

services/provisioning-orchestrator/src/tests/
└── config-reprovision.test.mjs
```

---

## Design & Implementation Plan

### 1) Backend domain model and persistence

1. Add the migration `117-tenant-config-reprovision.sql` with:
   - `config_reprovision_audit_log`
   - `tenant_config_reprovision_locks`
2. Keep the artifact payload out of persistence.
3. Store only hashes, source/destination tenant IDs, domain summaries, resource summaries, and timestamps.
4. Provide repository modules for:
   - atomic lock acquire / renew / release / timeout reclaim
   - audit insert and lookup by correlation id

### 2) Shared reprovision runtime

1. Introduce `src/reprovision/` to isolate the feature-specific runtime.
2. `identifier-map.mjs` will:
   - build a proposed map from the source artifact to the destination tenant
   - normalize replacements by longest match first
   - validate overrides and reject empty/invalid targets
   - apply replacements recursively to string fields before appliers run
3. `diff.mjs` will provide conservative comparison helpers for:
   - exact match → `skipped`
   - mismatch → `conflict`
   - missing resource → `created` / `would_create`
4. `registry.mjs` will register the six domain appliers and a canonical execution order.
5. `types.mjs` will define in-code shapes for request envelope, domain result, resource result, and lock metadata.

### 3) Domain appliers

Each applier will be read-only until it decides a concrete action, and it will use the conservative policy below.

- **IAM / Keycloak**: roles, groups, client scopes, identity providers, mappers.
- **PostgreSQL metadata**: schemas, tables, views, extensions, grants.
- **MongoDB metadata**: databases, collections, indexes, validators, sharding metadata when available.
- **Kafka**: topics, ACLs, consumer-group metadata where exposed by admin APIs.
- **OpenWhisk**: actions, packages, triggers, rules; secrets marked redacted are not applied.
- **S3-compatible storage**: buckets, policies, lifecycle, CORS.

Rules shared by all appliers:
- If a resource exists and is equivalent, mark it `skipped`.
- If it exists and differs, mark it `conflict` and do not update it.
- If the artifact section is `empty`, return a domain-level `applied`/`would_apply` with zero resources changed and explicit counts.
- If the domain is `error`, `not_available`, or `not_requested`, mark it `skipped_not_exportable`.
- If no applier exists, mark it `skipped_no_applier`.

### 4) Actions and API flow

#### Main reprovision endpoint

`POST /v1/admin/tenants/{tenant_id}/config/reprovision`

Request envelope:
- `artifact` (required)
- `identifier_map` (optional; confirmed or manually edited proposal)
- `domains` (optional)
- `dry_run` (optional, default `false`)

Flow:
1. Authenticate and authorize with `platform:admin:config:reprovision`.
2. Validate the artifact format against the existing schema registry.
3. Reject future / incompatible major versions with `422`.
4. Derive or validate the identifier map.
5. Acquire the tenant lock in PostgreSQL.
6. Apply the normalized identifier map to the in-memory artifact.
7. Execute appliers in canonical order, collecting per-domain summaries.
8. Emit audit metadata and Kafka event(s).
9. Release the lock and return `200` or `207` depending on the outcome.

#### Identifier map endpoint

`POST /v1/admin/tenants/{tenant_id}/config/reprovision/identifier-map`

Flow:
1. Authenticate and authorize identically to the main endpoint.
2. Validate the artifact and derive the proposed replacement map.
3. Return the proposal without changing any external system.
4. Emit an audit event for the map-generation step.

### 5) Console flow

1. Add a new admin page for reprovisioning.
2. Allow the operator to paste/upload the export artifact.
3. Call the identifier-map endpoint to prefill a proposed map.
4. Allow manual edits to `from` / `to` pairs before confirmation.
5. Expose domain filtering and `dry_run` toggles.
6. Render the result panel with per-domain and per-resource statuses.
7. Hide or disable the action for non-privileged roles.

### 6) Contracts and gateway wiring

1. Extend `backup-admin-routes.yaml` with the two reprovision endpoints.
2. Add the new Keycloak scope and assign it to the same privileged personas used by export/validation.
3. Publish OpenAPI and JSON Schema contracts under `specs/117-tenant-reprovision-from-export/contracts/`.
4. Keep contract names stable so API tests can validate the response shape and authorization surface.

---

## Data, Metadata, Events, Secrets, and Infra

### Database

- New migration for lock + audit tables.
- No artifact payload persistence.
- No new cross-service DB dependency.

### Kafka

- New event publisher module for:
  - reprovision completed / partial / failed
  - identifier-map generated
- Events are fire-and-forget; Kafka failures must not abort the HTTP response after the backend has already completed local processing.

### Secrets

- Redacted values (`***REDACTED***`) are never restored.
- Appliers may create the resource without the secret and annotate the warning.
- No secret value from the export artifact is ever written to DB or logs.

### Infrastructure

- Reuse existing APISIX / Keycloak / OpenWhisk deployment paths.
- Keep all new resources Helm-compatible and OpenShift-safe.

---

## Testing Strategy

### Unit tests

- Identifier-map generation and override validation.
- Token-aware substitution and longest-match-first behavior.
- Per-domain diff helpers for `skipped` vs `conflict`.
- Lock repository acquire/release/expiry semantics.

### Contract tests

- Main reprovision endpoint request/response schema.
- Identifier-map endpoint request/response schema.
- Kafka audit event schema.
- Authorization coverage for the new scope.

### Integration tests

- Full happy path on a mock tenant with all six domains.
- Dry-run path with existing resources and conflict detection.
- Partial success when one applier fails.
- `409` when the lock is already held.
- `422` when the artifact format is incompatible.

### Console tests

- Identifier map editor renders proposed entries and preserves edits.
- Result panel renders per-domain and per-resource statuses.
- Unauthorized roles do not see or cannot submit the reprovision action.

### Operational validation

- Verify no full artifact is stored in PostgreSQL.
- Verify audit event emission on both the map-generation and reprovision steps.
- Verify lock expiry cleanup works after a simulated crash.

---

## Implementation Sequence and Parallelization

### Recommended order

1. Add migration + repositories for audit and lock handling.
2. Add the shared `reprovision/` runtime and identifier-map logic.
3. Implement the two OpenWhisk actions.
4. Wire APISIX and Keycloak scope changes.
5. Add console API + page + components.
6. Add contracts and tests.
7. Run validation scripts and tighten response shapes.

### Parallelizable work

- Domain appliers can be developed independently once the shared runtime contract is stable.
- Console components can be built in parallel with backend actions after the response schemas are fixed.
- Contract tests and backend unit tests can advance in parallel once the contracts are agreed.

---

## Risks, Compatibility, Rollback, Idempotency, Observability, Security

### Risks

- **Identifier collision**: naive text replacement could corrupt the artifact. Mitigation: token-aware replacement + longest match first + post-validation.
- **Mixed-state tenant**: partial failure can leave some domains applied and others not. Mitigation: explicit domain summaries, dry-run, and no cross-domain rollback promise.
- **Lock leakage**: crash during reprovision can leave a stale lock. Mitigation: TTL-based reclamation and explicit lock status.
- **Comparison complexity**: deep equivalence checks differ per subsystem. Mitigation: conservative diff rules and a preference for `conflict` over silent overwrite.

### Compatibility

- The feature consumes the exported artifact format produced by T01/T02.
- It does not change the export artifact schema.
- It introduces a new scope and new endpoints without breaking existing backup routes.

### Rollback

- No automatic rollback across domains.
- If implementation mistakes are found, rollback is done by removing the new routes/actions/migration in the next patch and leaving existing export/validation paths untouched.

### Idempotency

- The feature is safe to retry at the resource level because equivalent resources are skipped.
- The lock prevents concurrent executions on the same tenant.
- The audit record stores the request summary and correlation id for replay analysis.

### Observability and security

- Emit audit data to Kafka and PostgreSQL.
- Keep log messages free of raw secret values or the full artifact payload.
- Surface `409`, `422`, and partial-success responses clearly to the caller.
- Ensure the console respects role-based visibility.

---

## Done Criteria / Evidence Expected

The task is done when all of the following are true:

1. `plan.md`, `research.md`, `data-model.md`, `quickstart.md`, and the contract files exist under `specs/117-tenant-reprovision-from-export/`.
2. The backend has a concrete plan for the reprovision action, identifier-map action, applier modules, lock table, and audit trail.
3. The gateway and Keycloak changes are specified for the new endpoint and scope.
4. The console flow is specified for manual identifier review and dry-run/application.
5. Test coverage is planned for unit, contract, integration, console, and operational validations.
6. The plan does **not** advance to T04 or introduce unrelated feature work.
7. The worktree contains only the feature’s plan-stage artifacts plus the minimal context update required by the planning workflow.
