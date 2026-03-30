# Implementation Plan: OpenAPI Publishing & SDK Generation

**Branch**: `088-openapi-sdk-publishing` | **Date**: 2026-03-30 | **Spec**: [spec.md](./spec.md)  
**Task ID**: US-DX-02-T04 | **Epic**: EP-17 | **Story**: US-DX-02 | **Priority**: P1  
**Input**: Publicar OpenAPI y, donde sea viable, generar SDKs para lenguajes principales.

---

## Summary

This plan implements a **workspace-scoped OpenAPI specification publishing pipeline** and a **pre-generated SDK delivery system** for JavaScript/TypeScript and Python. The system dynamically assembles an OpenAPI 3.x document reflecting the workspace's currently-enabled capabilities (sourced from the `effective-capabilities` API established in US-DX-02-T03), serves it via a versioned, authenticated endpoint with ETag caching support, renders it as an interactive API reference embedded in the console, and offers pre-built SDK packages for the two initially supported languages.

A new `services/openapi-sdk-service/` handles spec generation, version tracking, and SDK build orchestration via Apache OpenWhisk. A lightweight PostgreSQL table (`workspace_openapi_versions`) tracks spec versions and content hashes. SDKs are built using `openapi-generator-cli` running in an OpenWhisk action and stored as artefacts in S3-compatible object storage. The console gains a new `ConsoleApiReferencePage` with download buttons and embedded Swagger UI / Redoc viewer. Audit events are emitted to Kafka per access.

---

## Technical Context

**Language/Version**: Node.js 20+ ESM (`"type": "module"`) for backend actions; TypeScript + React 18 + Tailwind CSS + shadcn/ui for frontend  
**Primary Dependencies**: Apache OpenWhisk (spec-gen, sdk-gen actions), `pg` (PostgreSQL), `kafkajs` (Kafka audit), APISIX (route registration), Keycloak (token auth via X-Auth-* context headers), `@openapitools/openapi-generator-cli` (SDK generation), S3-compatible storage (SDK artefact hosting)  
**Storage**: PostgreSQL (`workspace_openapi_versions` table), S3-compatible (SDK package artefacts), Redis/APISIX cache (spec response caching)  
**Testing**: `node:test` (backend unit + integration), Vitest (frontend unit), Playwright (E2E smoke), `@stoplight/spectral-core` (OpenAPI linting in CI)  
**Target Platform**: Kubernetes / OpenShift via Helm  
**Project Type**: Multi-tenant BaaS — control-plane service + React console  
**Performance Goals**: Spec endpoint response ≤ 500ms p95 (cached); full spec re-generation on capability change ≤ 2 min (SC-005); SDK generation ≤ 5 min per language async  
**Constraints**: Multi-tenant isolation (tenant_id + workspace_id), secrets never in plaintext, access control via workspace RBAC, audit every spec/SDK download, no breaking changes to existing endpoints

---

## Constitution Check

*GATE: Evaluated before Phase 0. Re-evaluated after Phase 1.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Monorepo SoC | ✅ PASS | New service `services/openapi-sdk-service/`. Console additions under `apps/web-console`. Contracts in `services/internal-contracts`. No new top-level dirs outside established pattern. |
| II. Incremental Delivery | ✅ PASS | Additive: new service, new table, new console page. No changes to US-DX-02-T01/T02/T03 internals. |
| III. Kubernetes/OpenShift Compatibility | ✅ PASS | Helm chart follows `services/webhook-engine` pattern. SDK generation job runs as a short-lived OpenWhisk activation, not a persistent sidecar. |
| IV. Quality Gates at Root | ✅ PASS | New test scripts registered in root pnpm workspace. CI invokes spectral lint on generated specs. |
| V. Documentation as Part of the Change | ✅ PASS | `plan.md`, `data-model.md`, `contracts/`, produced as spec deliverables. |
| Secrets | ✅ PASS | No secrets in code. S3 credentials and signing keys injected via Helm/OpenWhisk env bindings. |
| pnpm workspaces | ✅ PASS | Reuses existing `pg`, `kafkajs`, S3 client. Adds `@openapitools/openapi-generator-cli` as a build-time dev dependency in the sdk-gen action package only. |

**Resultado**: No violations. Can proceed.

---

## Project Structure

### Documentation (this feature)

```text
specs/088-openapi-sdk-publishing/
├── spec.md                                    # Functional specification (delivered)
├── plan.md                                    # This file
├── data-model.md                              # Phase 1 output
├── contracts/
│   ├── workspace-openapi-version.json         # Entity schema
│   ├── sdk-package.json                       # Entity schema
│   ├── openapi-spec-response.json             # API response contract
│   ├── sdk-package-status-response.json       # API response contract
│   ├── openapi-spec-updated-event.json        # Kafka audit + webhook event schema
│   └── sdk-generation-completed-event.json    # Kafka audit event schema
└── tasks.md                                   # Phase 2 output (speckit.tasks — NOT created here)
```

### Source Code (repository root)

```text
services/openapi-sdk-service/
├── package.json                               # ESM, "type": "module"
├── actions/
│   ├── openapi-spec-serve.mjs                 # OpenWhisk action: GET /v1/workspaces/{id}/openapi
│   ├── openapi-spec-regenerate.mjs            # OpenWhisk action: triggered on capability change
│   └── sdk-generate.mjs                       # OpenWhisk action: async SDK build job
├── src/
│   ├── spec-assembler.mjs                     # Assembles OpenAPI 3.x doc from capability manifest
│   ├── spec-version-repo.mjs                  # CRUD for workspace_openapi_versions (pg)
│   ├── sdk-package-repo.mjs                   # CRUD for workspace_sdk_packages (pg)
│   ├── sdk-builder.mjs                        # Wraps openapi-generator-cli invocation
│   ├── sdk-storage.mjs                        # S3-compatible upload/presigned-URL generation
│   ├── spec-cache.mjs                         # ETag / content-hash cache helpers
│   ├── spec-audit.mjs                         # Emits Kafka audit events for access/version change
│   ├── capability-manifest-client.mjs         # Calls /v1/workspaces/{id}/effective-capabilities
│   └── config.mjs                             # Env var bindings
├── migrations/
│   ├── 088-workspace-openapi-versions.sql     # DDL: workspace_openapi_versions table
│   └── 088-workspace-sdk-packages.sql         # DDL: workspace_sdk_packages table
└── tests/
    ├── spec-assembler.test.mjs
    ├── spec-version-repo.test.mjs
    ├── sdk-builder.test.mjs
    ├── sdk-storage.test.mjs
    ├── spec-cache.test.mjs
    └── openapi-spec-serve.action.test.mjs

apps/web-console/src/
├── pages/
│   ├── ConsoleApiReferencePage.tsx            # API reference + download hub page
│   └── ConsoleApiReferencePage.test.tsx
├── components/console/
│   ├── OpenApiViewer.tsx                      # Embeds Redoc/Swagger-UI for interactive reference
│   ├── OpenApiViewer.test.tsx
│   ├── SdkDownloadPanel.tsx                   # Language selector + download / install instructions
│   ├── SdkDownloadPanel.test.tsx
│   └── SpecDownloadButton.tsx                 # One-click JSON/YAML download with format toggle
├── lib/
│   └── console-openapi-sdk.ts                # API client: fetch spec, poll SDK status, download

services/internal-contracts/src/
├── workspace-openapi-version.json             # JSON Schema: WorkspaceOpenApiVersion
├── sdk-package.json                           # JSON Schema: SdkPackage
├── openapi-spec-updated-event.json            # JSON Schema: Kafka/webhook event
└── sdk-generation-completed-event.json        # JSON Schema: Kafka audit event

services/gateway-config/
└── openapi-fragments/
    └── workspace-openapi-sdk.openapi.json     # APISIX route registration fragment
```

---

## Architecture & Flow

### 1. Spec Serving Flow (Synchronous, Hot Path)

```
Developer/Console
  → GET /v1/workspaces/{id}/openapi?format=json|yaml
  → APISIX (auth: Keycloak token or API key, workspace RBAC check)
  → OpenWhisk action: openapi-spec-serve.mjs
      ├── Read workspace_openapi_versions WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 1
      ├── ETag match? → 304 Not Modified
      └── Return spec content (JSON or YAML serialisation) + headers:
              ETag: "sha256:{content_hash}"
              X-Spec-Version: "{spec_version}"
              Cache-Control: max-age=60, must-revalidate
```

### 2. Spec Regeneration Flow (Async, Triggered on Capability Change)

```
Capability change event (from US-DX-02-T03 or capability management service)
  → Kafka topic: console.workspace.capability.changed
  → OpenWhisk trigger: openapi-spec-regenerate (event-driven activation)
      ├── Call GET /v1/workspaces/{id}/effective-capabilities  (capability-manifest-client.mjs)
      ├── spec-assembler.mjs: merge base OpenAPI template + enabled capability path modules
      ├── Validate assembled spec with spectral programmatic API
      ├── Compute SHA-256 content hash
      ├── If hash unchanged → no-op (idempotent)
      ├── INSERT INTO workspace_openapi_versions (new version record)
      ├── Invalidate any in-flight SDK packages (mark status = 'stale')
      ├── Emit Kafka: console.openapi.spec.updated
      └── If webhook engine available: emit api_spec.updated webhook event
```

### 3. SDK Generation Flow (Async Job via OpenWhisk)

```
Developer requests SDK download
  → POST /v1/workspaces/{id}/sdks/generate  { language: "typescript" | "python" }
  → openapi-spec-serve.mjs delegates to sdk-generate.mjs (async OpenWhisk activation)
      ├── Fetch latest spec content from workspace_openapi_versions
      ├── sdk-builder.mjs: invoke openapi-generator-cli (runs in action sandbox)
      │     --generator-name typescript-fetch | python
      │     --input-spec <spec-json>
      │     --output /tmp/sdk-output
      │     --additional-properties packageName=workspace-{id}-sdk,...
      ├── Archive output as .zip (typescript) or .tar.gz (python)
      ├── sdk-storage.mjs: upload to S3 bucket, path: sdks/{workspace_id}/{lang}/{spec_version}/
      ├── INSERT / UPDATE workspace_sdk_packages (status = 'ready', download_url = presigned URL)
      ├── Emit Kafka: console.sdk.generation.completed
      └── Console polls GET /v1/workspaces/{id}/sdks/{language}/status → returns download URL
```

### Component Boundaries

| Component | Responsibility |
|-----------|---------------|
| `spec-assembler.mjs` | Merge base template + per-capability path/schema modules; no I/O |
| `spec-version-repo.mjs` | All PostgreSQL reads/writes for `workspace_openapi_versions` |
| `sdk-builder.mjs` | Wraps `openapi-generator-cli` CLI; no DB access |
| `sdk-storage.mjs` | All S3 interactions; returns presigned download URLs |
| `capability-manifest-client.mjs` | HTTP client for effective-capabilities API; pure I/O adapter |
| `spec-audit.mjs` | Kafka producer for audit events; no business logic |

---

## Data Model

### Table: `workspace_openapi_versions`

```sql
CREATE TABLE workspace_openapi_versions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  workspace_id    UUID NOT NULL,
  spec_version    VARCHAR(64) NOT NULL,        -- e.g. "1.0.0", "1.1.0" — semver incremented
  content_hash    VARCHAR(72) NOT NULL,         -- "sha256:{hex}" for ETag
  format_json     TEXT NOT NULL,               -- serialised OpenAPI JSON
  format_yaml     TEXT NOT NULL,               -- serialised OpenAPI YAML
  capability_tags TEXT[] NOT NULL,             -- array of included capability tags
  is_current      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_workspace_current UNIQUE (workspace_id, is_current) DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX idx_wov_workspace_current ON workspace_openapi_versions (workspace_id, is_current) WHERE is_current = TRUE;
CREATE INDEX idx_wov_tenant ON workspace_openapi_versions (tenant_id);
```

**Row lifecycle**: Each capability change inserts a new row (with `is_current = TRUE`) and flips the previous current row to `is_current = FALSE`. History is retained for audit. Rows older than 90 days with `is_current = FALSE` can be purged by a scheduled job.

### Table: `workspace_sdk_packages`

```sql
CREATE TABLE workspace_sdk_packages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  workspace_id    UUID NOT NULL,
  language        VARCHAR(32) NOT NULL,         -- "typescript" | "python"
  spec_version    VARCHAR(64) NOT NULL,
  status          VARCHAR(16) NOT NULL,         -- "pending" | "building" | "ready" | "failed" | "stale"
  download_url    TEXT,                         -- presigned S3 URL (null until ready)
  url_expires_at  TIMESTAMPTZ,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_sdk_lang_version UNIQUE (workspace_id, language, spec_version)
);

CREATE INDEX idx_wsp_workspace_lang ON workspace_sdk_packages (workspace_id, language, status);
```

### Version Increment Strategy

- Spec version follows semver: `MAJOR.MINOR.PATCH`.
- **PATCH**: Minor spec metadata change (description, example text), no path/schema change.
- **MINOR**: New paths/schemas added (new capability enabled).
- **MAJOR**: Paths removed (capability disabled — potentially breaking for consumers).
- Version is computed in `spec-assembler.mjs` by comparing the new spec's path set against the previous version.

---

## API Contracts

### GET `/v1/workspaces/{workspaceId}/openapi`

**Auth**: Keycloak JWT or workspace API key; role `workspace:developer` or higher.  
**Query params**: `format=json` (default) | `yaml`  
**Conditional**: `If-None-Match: "{etag}"` → `304 Not Modified` if unchanged.

**Response 200**:
```
Content-Type: application/json  OR  application/yaml
ETag: "sha256:abc123..."
X-Spec-Version: "1.2.0"
Cache-Control: max-age=60, must-revalidate
X-Workspace-Id: "{workspaceId}"

<OpenAPI 3.x document>
```

**Response 304**: No body. ETag matches.  
**Response 401**: Unauthenticated.  
**Response 403**: Insufficient workspace permissions.  
**Response 404**: Workspace not found or no spec generated yet.  
**Response 429**: Rate limit exceeded (`Retry-After` header).

---

### POST `/v1/workspaces/{workspaceId}/sdks/generate`

**Auth**: Same as above.  
**Body**: `{ "language": "typescript" | "python" }`

**Response 202 Accepted**:
```json
{
  "packageId": "uuid",
  "language": "typescript",
  "specVersion": "1.2.0",
  "status": "pending",
  "statusUrl": "/v1/workspaces/{id}/sdks/typescript/status"
}
```

**Idempotent**: If a `ready` package exists for the current spec version and language, returns `200` with the existing download URL directly (no new build triggered).

---

### GET `/v1/workspaces/{workspaceId}/sdks/{language}/status`

**Response 200**:
```json
{
  "packageId": "uuid",
  "language": "typescript",
  "specVersion": "1.2.0",
  "status": "ready",            // "pending" | "building" | "ready" | "failed" | "stale"
  "downloadUrl": "https://...", // presigned S3 URL, present only when status = "ready"
  "urlExpiresAt": "2026-04-01T00:00:00Z",
  "errorMessage": null
}
```

---

### Kafka Events

| Topic | Retention | Trigger |
|-------|-----------|---------|
| `console.openapi.spec.updated` | 30d | New spec version published for a workspace |
| `console.sdk.generation.completed` | 7d | SDK build finished (success or failure) |
| `console.openapi.spec.accessed` | 7d | Developer downloads spec (audit, session-deduped) |
| `console.sdk.download.accessed` | 7d | Developer downloads SDK package (audit) |

**`console.openapi.spec.updated` event schema**:
```json
{
  "eventType": "openapi.spec.updated",
  "tenantId": "uuid",
  "workspaceId": "uuid",
  "specVersion": "1.2.0",
  "previousSpecVersion": "1.1.0",
  "contentHash": "sha256:abc...",
  "capabilityTags": ["storage", "functions", "authentication"],
  "changeType": "MINOR",
  "timestamp": "ISO8601"
}
```

If the webhook engine (US-DX-02-T01) is available, a webhook delivery with event type `api_spec.updated` is also dispatched using the same payload shape.

---

## Spec Assembly Architecture

The `spec-assembler.mjs` module implements a **capability-modular merge** approach:

```
base-template.openapi.json          # Common: info, servers, security schemes, common error schemas
  + capability-modules/
      auth.paths.json               # /auth/**, /tokens/**
      storage.paths.json            # /buckets/**, /objects/**
      functions.paths.json          # /functions/**
      realtime.paths.json           # /channels/**
      mongodb.paths.json            # /mongo/**
      postgresql.paths.json         # /pg/**
      events.paths.json             # /events/**
  → merged by spec-assembler.mjs using enabled capability tags
  → server.url set to workspace base URL
  → info.version set to computed semver
  → validated by spectral
  → serialised to JSON + YAML
```

Each capability module is a self-contained OpenAPI fragment containing:
- `paths`: all paths for that capability
- `components.schemas`: all schemas referenced by those paths
- `components.securitySchemes`: none (defined in base template)
- `tags`: single tag entry for the capability grouping

The assembler deep-merges enabled fragments into the base template, resolving `$ref` to inline schemas to produce a fully self-contained document.

---

## Console UI Design

### `ConsoleApiReferencePage` Route

- **Path**: `/workspaces/{id}/developer/api-reference`
- **Tab**: Developer > API Reference (new nav entry after the Docs tab from T03)
- **Auth guard**: `workspace:developer` role

### UI Sections

1. **Spec Download Bar** (top): Format toggle (JSON/YAML), Download button, version badge (`v1.2.0`), last-updated timestamp.
2. **Interactive API Reference** (main area): Renders via `<OpenApiViewer spec={specUrl} />` using [Redoc](https://github.com/Redocly/redoc) embedded as a React component. Lazy-loaded. Shows all paths grouped by capability tag. Includes "Try it" via Redoc's built-in `tryItOutEnabled` prop.
3. **SDK Downloads Panel** (sidebar/bottom): Language cards for TypeScript and Python.
   - Card states: `ready` (Download button + version + size), `building` (spinner + "Generating..."), `pending` (Queue button), `stale` (Regenerate button), `failed` (error message + retry + raw spec fallback).
   - For unsupported languages: informational card linking to raw spec + openapi-generator docs.
4. **Change Notification Banner**: If `specVersion` has changed since the developer last viewed the page (tracked in localStorage), show a dismissable banner: "API contract updated to v1.2.0 — changes may affect your integration."

---

## Testing Strategy

### Unit Tests (`node:test`, `vitest`)

| File | What is tested |
|------|---------------|
| `spec-assembler.test.mjs` | Fragment merge correctness; disabled capability paths absent; server URL injection; version computation (MAJOR/MINOR/PATCH); spectral validation passes on output |
| `spec-version-repo.test.mjs` | Insert/query/flip current flag; concurrent insert idempotency |
| `sdk-builder.test.mjs` | CLI invocation args; output structure; failure propagation |
| `sdk-storage.test.mjs` | S3 upload path construction; presigned URL format |
| `spec-cache.test.mjs` | ETag computation; 304 condition matching |
| `openapi-spec-serve.action.test.mjs` | Full action handler: 200 JSON, 200 YAML, 304, 401, 403, 404, 429 |
| `ConsoleApiReferencePage.test.tsx` | Page renders; download buttons; SDK status polling; stale banner |
| `SdkDownloadPanel.test.tsx` | All SDK card states render correctly; language fallback message |

### Integration Tests

- Capability change → `openapi-spec-regenerate` activation → new row in `workspace_openapi_versions` → spec endpoint returns updated doc → capability absent in spec.
- SDK generation lifecycle: POST generate → poll status → `ready` → download URL valid → package structurally valid (zip contains expected files).
- ETag cycle: initial 200 with ETag, re-request with `If-None-Match` → 304.
- RBAC: request with `workspace:viewer` role → 403 on spec endpoint.
- Audit: all accesses appear in Kafka `console.openapi.spec.accessed` topic.

### Contract Tests

- Generated OpenAPI spec passes `@stoplight/spectral-core` with `oas` ruleset — zero errors, zero warnings on schema validity rules.
- SDK TypeScript package: `tsc --noEmit` passes without errors on generated types.
- SDK Python package: `python -m py_compile` passes on all generated `.py` files.

### E2E (Playwright)

1. Enable storage + auth capabilities in a test workspace → navigate to API Reference → verify storage paths present, realtime absent.
2. Download JSON spec → import into Postman programmatically → confirm collection created.
3. Generate TypeScript SDK → download → run `ts-node` smoke test against a live endpoint.
4. Disable a capability → verify interactive reference no longer shows those endpoints within 2 min (SC-005).

### Operational Validation

- Spectral lint in CI: `pnpm run lint:openapi` validates generated specs for each capability combination in the test matrix.
- Prometheus metrics: `openapi_spec_serve_duration_seconds` histogram; `sdk_generation_duration_seconds` histogram.

---

## Risks, Mitigations & Non-Functional Concerns

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `openapi-generator-cli` produces invalid/unexpected TypeScript or Python for edge-case schemas | Medium | High | Pin generator version; run `tsc`/`py_compile` validation in CI as a gate; maintain a schema normalization step in `spec-assembler` to eliminate generator-unfriendly patterns |
| Spec assembly slow for workspaces with all capabilities enabled (large document) | Low | Medium | Assemble asynchronously on capability change, serve from DB; add response size/time monitoring; target ≤ 500ms p95 from DB read (SC-001) |
| Concurrent capability changes produce inconsistent spec | Low | High | Use `SELECT ... FOR UPDATE` on workspace_openapi_versions during regeneration; regeneration is idempotent (hash check) |
| S3 presigned URL expires before developer downloads SDK | Medium | Low | Set URL TTL to 24h; auto-refresh on `GET .../status` if within 1h of expiry; display `urlExpiresAt` in UI |
| Breaking capability removal (MAJOR version bump) confuses developers on old SDKs | Medium | Medium | Display prominent console notification; MAJOR bump triggers webhook event; old SDK download still available for previous spec version (history retained 90d) |
| `openapi-generator-cli` requires JVM runtime in OpenWhisk action | High | Medium | Package the CLI JAR with bundled JRE in the action archive; set action memory limit to 512MB; document resource requirements in Helm values |

### Security

- Spec and SDK endpoints are workspace-scoped: `tenant_id` from Keycloak context header must match workspace's tenant. Cross-tenant access → 403.
- Presigned S3 URLs are generated per-request, short-lived (24h), and scoped to the specific SDK object path.
- No capability-sensitive infrastructure details (internal IPs, internal service names) appear in the generated OpenAPI spec. The spec uses only the public-facing APISIX base URL.
- SDK packages do not include any workspace credentials. Authentication is done at initialisation time by the developer providing their own API key.

### Observability

- **Prometheus**: `openapi_spec_serve_duration_seconds`, `sdk_generation_duration_seconds`, `sdk_generation_errors_total{language}`, `openapi_spec_regeneration_duration_seconds`.
- **Structured logs**: All action invocations log `{workspaceId, tenantId, specVersion, action, durationMs, statusCode}`.
- **Kafka audit topics**: `console.openapi.spec.accessed`, `console.sdk.download.accessed` (with identity and version).

### Rollback

- The `workspace_openapi_versions` table preserves history; rolling back a capability enables or disables re-pointing the `is_current` flag without data loss.
- SDK packages in S3 are immutable by version; old packages remain downloadable for 90 days.
- The OpenWhisk action deployment follows the existing blue/green deployment pattern used by `webhook-engine`.

### Idempotency

- Spec regeneration: guarded by content hash comparison — identical capability set produces no new row.
- SDK generation: guarded by `UNIQUE (workspace_id, language, spec_version)` constraint — duplicate generate requests return the existing package record.
- Spec serve: ETag/304 support eliminates redundant downloads.

---

## Dependencies & Sequencing

### Prerequisites

| Dependency | Status | Impact |
|------------|--------|--------|
| US-DX-02-T03 (workspace docs + effective-capabilities API) | Must be complete | `spec-assembler` consumes `effective-capabilities` endpoint |
| US-DX-02-T01 (outbound webhooks) | Optional | Without it, `api_spec.updated` webhook events are silently skipped; console notifications still work |
| US-DX-02-T06 (capability catalogue) | Soft | Capability tag names in OpenAPI fragments must align with catalogue IDs; can be stubbed for initial delivery |

### Recommended Sequence

```
Phase 0 — Research & scaffolding       [~0.5d]
  ├── Confirm effective-capabilities API response shape from T03
  ├── Audit all existing OpenAPI fragments (if any) in gateway-config
  ├── Prototype spec-assembler merge with 2 capability modules
  └── Validate openapi-generator-cli JVM packaging in OpenWhisk action

Phase 1 — Core spec pipeline           [~2d]
  ├── DDL migrations (workspace_openapi_versions, workspace_sdk_packages)
  ├── spec-assembler.mjs: base template + 3 capability modules (auth, storage, functions)
  ├── openapi-spec-serve action: DB read + ETag + JSON/YAML response
  ├── openapi-spec-regenerate action: capability change → spec insert
  ├── Unit tests: spec-assembler, serve action
  └── APISIX route registration fragment

Phase 2 — Full capability coverage     [~1d]
  ├── Remaining capability modules (realtime, mongodb, postgresql, events)
  ├── Spectral lint integration in CI
  └── Integration test: capability add/remove → spec updates correctly

Phase 3 — SDK generation pipeline      [~2d]
  ├── sdk-builder.mjs: openapi-generator-cli wrapping + JVM bundling
  ├── sdk-storage.mjs: S3 upload + presigned URL
  ├── sdk-generate OpenWhisk action
  ├── POST /sdks/generate + GET /sdks/{language}/status endpoints
  └── Unit + integration tests: SDK lifecycle

Phase 4 — Console UI                   [~1.5d]
  ├── ConsoleApiReferencePage + OpenApiViewer (Redoc embed)
  ├── SdkDownloadPanel + SpecDownloadButton
  ├── console-openapi-sdk.ts API client
  └── Frontend unit tests + E2E Playwright scenarios

Phase 5 — Observability, audit, docs   [~0.5d]
  ├── Kafka audit events: spec.accessed, sdk.download.accessed
  ├── Prometheus metrics instrumentation
  ├── data-model.md + contracts/ files
  └── Final spectral + SDK contract validation gate in CI
```

**Parallelisation**: Phase 3 (SDK pipeline) and Phase 4 (UI) can proceed in parallel once Phase 1 spec-serve endpoint is available as a stable mock or real endpoint.

---

## Done Criteria & Expected Evidence

| Criterion | Verification |
|-----------|-------------|
| **CD-001**: Valid OpenAPI 3.x spec served for workspace with known capabilities | `GET /v1/workspaces/{id}/openapi` returns 200 with correct paths; Spectral lint: 0 errors |
| **CD-002**: Disabled capability paths absent from spec | Enable storage only, request spec → no realtime/mongodb paths present |
| **CD-003**: ETag / 304 works correctly | Two identical requests: first 200 with ETag, second 304 with `If-None-Match` |
| **CD-004**: Spec regenerates within 2 min of capability change | Capability toggle → Kafka event → new spec version → measured in integration test |
| **CD-005**: TypeScript SDK compiles | Download SDK zip → `tsc --noEmit` passes |
| **CD-006**: Python SDK compiles | Download SDK tarball → `python -m py_compile` passes on all files |
| **CD-007**: SDK generation idempotent | Two `POST /sdks/generate` for same version → same package UUID returned, no duplicate S3 artefact |
| **CD-008**: Interactive API reference renders in console | Playwright: navigate to `/developer/api-reference` → Redoc UI visible → "Try it" sends real request |
| **CD-009**: All spec/SDK accesses in audit trail | Kafka consumer confirms `console.openapi.spec.accessed` events for each access in integration test |
| **CD-010**: Access control enforced | Request without valid workspace token → 401; valid token for different workspace → 403 |
| **CD-011**: Rate limiting active | Exceed configured rate on spec endpoint → 429 with `Retry-After` |
| **CD-012**: SDK generation failure surfaces correctly | Inject invalid spec fragment → SDK status returns `failed` with `errorMessage`; raw spec download still works |
| **CD-013**: Prometheus metrics emitted | `openapi_spec_serve_duration_seconds_bucket` present in `/metrics` after test requests |
