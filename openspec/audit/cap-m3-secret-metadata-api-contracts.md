# Capability M3 — Secret Metadata API (contracts)

**Source locus:** `internal-contracts/secrets/` — 4 files only:

| File | LOC | Role |
|---|---|---|
| `README.md` | 7 | Three-line file listing |
| `secret-metadata-v1.yaml` | 43 | OpenAPI 3.0.3 fragment — `GET /v1/secrets/{domain}/{path}` |
| `secret-inventory-v1.yaml` | 60 | OpenAPI 3.0.3 fragment — `GET /v1/secrets/inventory` |
| `secret-audit-event-v1.yaml` | 44 | JSON Schema — `SecretAuditEvent` (already covered in M2 audit) |

**Method.** Read all 4 files end-to-end. Searched the repo for consumers, handlers, and gateway routes referencing these contracts.

**Headline finding up front:** **M3 is a documentation directory with no consumer.**
- `grep -rln "secret-metadata-v1\|secret-inventory-v1"` returns only the YAML files themselves (`secret-metadata-v1.yaml`, `secret-inventory-v1.yaml`). **No code loads, validates against, or generates from these schemas.**
- `grep -rln "/v1/secrets/" services apps` returns **no handler** for `GET /v1/secrets/{domain}/{path}` or `GET /v1/secrets/inventory`. Verified by grep.
- **No gateway routes** declare `/v1/secrets/*` in `services/gateway-config/routes/`. Verified.
- **No control-plane OpenAPI fragment** under `apps/control-plane/openapi/families/` covers `/v1/secrets/*`. Verified — the unified spec at `control-plane.openapi.json` does not reference these YAMLs.
- The **only consumer** of any `/v1/secrets/*` path is a hardening test at `tests/hardening/suites/tenant-isolation.test.mjs:38, 52`, which hits `/v1/secrets/${workspaceId}/metadata` — **a path neither YAML declares** (see B7 below).

---

## SPEC (what exists)

### S1. Directory layout (`README.md`)

- **WHEN** the directory is enumerated, **THE SYSTEM SHALL** contain exactly three contract files: `secret-inventory-v1.yaml`, `secret-metadata-v1.yaml`, `secret-audit-event-v1.yaml` (`README.md:1-7`).

### S2. Secret detail contract (`secret-metadata-v1.yaml`)

- **WHEN** a consumer reads `secret-metadata-v1.yaml`, **THE SYSTEM SHALL** declare OpenAPI 3.0.3 with `info.title: 'Secret Metadata Detail API', info.version: '1.0.0'` (`:1-4`).
- **WHEN** a client calls `GET /v1/secrets/{domain}/{path}`, **THE SYSTEM SHALL** require two path parameters: `domain` ∈ `{platform, tenant, functions, gateway, iam}` and `path` as a string (`:6-19`).
- **WHEN** a 200 response is produced, **THE SYSTEM SHALL** match a `{name, domain, path, createdAt, updatedAt, lastAccessedAt, status, secretType, vaultMount, accessPolicies[]}` object with `additionalProperties: false`; **no `required` array is declared** (`:20-40`).
- **WHEN** the response carries `createdAt/updatedAt/lastAccessedAt`, each **SHALL** be `string, format: date-time` (`:32-34`).
- **WHEN** unauthorised or not-found, **THE SYSTEM SHALL** return 403 or 404 with no body schema (`:41-42`).

### S3. Secret inventory contract (`secret-inventory-v1.yaml`)

- **WHEN** a consumer reads `secret-inventory-v1.yaml`, **THE SYSTEM SHALL** declare OpenAPI 3.0.3, `info.title: 'Secret Inventory API', info.version: '1.0.0'` (`:1-4`).
- **WHEN** a client calls `GET /v1/secrets/inventory`, **THE SYSTEM SHALL** require query param `domain` ∈ `{platform, tenant, functions, gateway, iam}` (required), optional `tenantId` (string), optional `offset` (integer ≥ 0), optional `limit` (integer ∈ [1, 200]) (`:6-29`).
- **WHEN** a 200 response is produced, **THE SYSTEM SHALL** return `{secrets: SecretMetadataItem[]}` where `secrets` is required (`:30-43`).
- **WHEN** each `SecretMetadataItem` is serialised, **THE SYSTEM SHALL** carry `{name, domain, path, createdAt, updatedAt, status, secretType}` with `additionalProperties: false` and **MUST NOT** carry `value` or `data` (per `not.anyOf` clause at `:56-59`).

### S4. Secret audit-event contract (`secret-audit-event-v1.yaml`)

- This contract is the canonical schema consumed (loosely) by the M2 secret-audit-pipeline. Already covered in the M2 audit; see `cap-m2-secret-audit-pipeline.md` § S6, B7. Briefly:
- **WHEN** an audit event is validated, **THE SYSTEM SHALL** require 8 top-level fields, enums for `operation/domain/result`, `additionalProperties: false`, and `not.anyOf: [{required:[value]},{required:[data]}]`.

---

## GAPS

### G-cross. Cross-cutting

1. **No consumer for the two metadata contracts.** Verified by grep:
   - `grep -rln "secret-metadata-v1\|secret-inventory-v1"` → only the YAMLs themselves.
   - `grep -rln "/v1/secrets/" services apps` → no handler in any service or façade.
   - `grep -rln "secrets" services/gateway-config/routes/` → no gateway route.
   - No fragment under `apps/control-plane/openapi/families/` for `/v1/secrets/*`.
   The two YAML files are documentation only.

2. **The audit-event contract is partially consumed** by the M2 secret-audit-pipeline (`services/secret-audit-handler/`), but that consumer ships its own JS schema constant that diverges from the YAML — see M2 audit B7. The M3 directory does not enforce contract alignment.

3. **OpenAPI version drift.** Both detail and inventory YAMLs declare `openapi: 3.0.3`. The unified public spec (`apps/control-plane/openapi/control-plane.openapi.json`, per A1 audit) is `openapi: 3.1.0`. If the M3 fragments are ever merged in, the version mismatch will require migration.

4. **No `components.securitySchemes` / `security` declarations** in either YAML. The B1 capability audit catalogued backup-* scopes; per that audit, scopes like `backup-status:read:own` are checked in code. No equivalent scope is declared here — but per the inventory's `tenantId` query param, the contract clearly expects tenant-scoping. **What scope is required is undocumented in the contract.**

5. **No error envelope.** 403 and 404 declare only `description` (`secret-metadata-v1.yaml:41-42`). No `content` schema. Clients can't expect a structured error.

6. **The directory lacks `secret-metadata-v1-rotation.yaml`, `secret-metadata-v1-versions.yaml`, or any operation beyond GET.** Vault supports list, write, delete, rotate, revoke per secret path. M3 declares only two GET endpoints — no mutation surface.

7. **`README.md` is a three-line directory listing.** No description of intent, no version policy, no consumer guidance, no relationship with `services/secret-audit-handler/` or with the Vault audit log.

### G-S2. Detail contract

- **G-S2.1** Path parameter `path` is a single string (`:15-19`) with no `style: simple` or wildcard hint. Vault secret paths typically contain slashes (`platform/postgresql/app-password`). Express-style routers reject extra path segments; OpenAPI 3.0.3 path templating without `style` defaults to non-greedy. The declared URL `/v1/secrets/{domain}/{path}` therefore **cannot match** a secret with an embedded slash. Either `path` must be `{path+}` (greedy syntax not in standard OAS 3.0.3) or the route shape must change.
- **G-S2.2** **No `required` array on the 200 response object** (`:25-40`). Every field is optional, including `name`, `domain`, `path`. A response with `{}` validates. This is a contract-design omission.
- **G-S2.3** `lastAccessedAt` declares `format: date-time` (`:34`) but no `nullable: true`. A secret never accessed has `lastAccessedAt = null`, which fails OAS 3.0.3's strict format-validation.
- **G-S2.4** `accessPolicies.items: {type: string}` (`:38-40`) — string semantic is undocumented (policy id? path? ARN?).
- **G-S2.5** No `vaultMount` validation pattern. The string can be anything.
- **G-S2.6** No `status` enum — the field is a free-form string.
- **G-S2.7** No `secretType` enum — likewise free-form.
- **G-S2.8** **No `not.anyOf: [{required:[value]},{required:[data]}]` clause.** The detail response is not formally forbidden from leaking secret material — only the inventory's `SecretMetadataItem` carries that guard (`secret-inventory-v1.yaml:56-59`). Two contracts in the same directory; only one enforces the "no secrets in metadata" invariant.

### G-S3. Inventory contract

- **G-S3.1** `domain` is `required: true` (`:11`). A caller cannot list secrets "across all domains" — must pick one. Restrictive vs. typical inventory APIs.
- **G-S3.2** Offset/limit pagination with no `totalCount`, no `nextOffset`, no `Link` headers. Caller must guess when to stop.
- **G-S3.3** Response shape is bare `{secrets: [...]}` (`:35-42`). No `pagination`/`page` envelope, no metadata for the consumer.
- **G-S3.4** `SecretMetadataItem` schema (`:45-59`) lacks `lastAccessedAt`, `vaultMount`, `accessPolicies` — fields present on the detail endpoint. **Inventory consumers must call detail per secret to see those fields** — undocumented N+1 pattern.
- **G-S3.5** `tenantId` is optional. When omitted, the contract doesn't say whether the response is platform-only, all-tenants (admin), or current-tenant-default. Undocumented behaviour.
- **G-S3.6** No `requested-by` / `requester-context` parameter or header. The contract leaves tenant-scope enforcement to whoever implements it.

### G-S4. Audit-event contract

Covered in M2 audit (`cap-m2-secret-audit-pipeline.md` § S6, G-cross 5, B7).

### G-tests

- **G-T1** No test under `tests/contracts/` validates the YAML schemas themselves (against AJV, `@apidevtools/swagger-parser`, or any other validator). The two metadata YAMLs may not even be valid OpenAPI 3.0.3.
- **G-T2** The hardening test that does reference `/v1/secrets/*` (`tenant-isolation.test.mjs:38, 52`) calls a path the contracts don't declare. See B7.
- **G-T3** No tests for `secret-inventory` pagination, `tenantId` scoping, or `not.anyOf` enforcement.

---

## BUGS

### Confirmed (verified-by-author from cited lines / grep)

- **B1. No implementation exists for either declared endpoint.**
  `grep -rln "/v1/secrets/" services apps` returns no handler (verified). The contracts declare two routes that nothing serves.

- **B2. No gateway route or unified-spec entry for `/v1/secrets/*`.**
  `grep -rln "secrets" services/gateway-config/routes/` returns no match. `grep -l "/v1/secrets" apps/control-plane/openapi -r` returns no file. **Even if a handler existed, no gateway would route traffic to it.**

- **B3. Detail contract has no `required` array on the 200 response.**
  `secret-metadata-v1.yaml:25-40` (verified-by-author). Empty object `{}` validates. The contract is non-restrictive on response shape.

- **B4. Detail contract `lastAccessedAt` lacks `nullable: true`.**
  `secret-metadata-v1.yaml:34` (verified-by-author). OAS 3.0.3 validators that strict-check `format: date-time` reject `null`. A never-accessed secret cannot be serialised to a spec-compliant response.

- **B5. Detail contract path parameter `path` cannot represent secret paths with slashes.**
  `secret-metadata-v1.yaml:15-19` (verified-by-author). `{path}` is a single non-greedy string path-parameter. Vault paths like `platform/postgresql/app-password` contain slashes. The OAS-templated URL `/v1/secrets/{domain}/{path}` parses `domain=platform, path=postgresql` and treats `/app-password` as 404. The contract under-describes the route shape.

- **B6. Detail and inventory contracts disagree on forbidden-field policy.**
  `secret-metadata-v1.yaml:25-40` (verified-by-author) has **no** `not.anyOf` clause. `secret-inventory-v1.yaml:56-59` (verified-by-author) declares `not.anyOf: [{required:[value]},{required:[data]}]`. Two adjacent contracts; only one formally forbids leaking secret material. Combined with M2 audit B7 (where the JS `FORBIDDEN_FIELDS` lists 6 entries vs. the YAML's 2), the repo has **three different forbidden-field policies** for secrets.

- **B7. The only consumer (`tenant-isolation.test.mjs`) calls a route the contracts don't declare.**
  `tests/hardening/suites/tenant-isolation.test.mjs:38, 52` (verified-by-grep):
  ```js
  const response = await get(`/v1/secrets/${fixture.workspaceBId}/metadata`, { headers });
  const response = await get(`/v1/secrets/${fixture.workspaceId}/metadata`, { headers });
  ```
  Path shape: `/v1/secrets/{workspaceId}/metadata`. The contracts declare `/v1/secrets/{domain}/{path}` (domain ∈ enum, path is secret path) and `/v1/secrets/inventory`. **`{workspaceId}` is not in any enum, and `metadata` is a literal segment with no contract.** Either the test asserts against a third route that's not in the contracts, the test is wrong, or the contracts under-describe the actual surface.

- **B8. Neither YAML declares security requirements.**
  `secret-metadata-v1.yaml:1-43` and `secret-inventory-v1.yaml:1-60` (verified-by-author). No `components.securitySchemes`, no `security`. Per the B1 capability audit, the platform has `backup-*:*` and `platform:admin:config:*` scope manifests for backup capabilities — but no analogous scope for secret metadata is documented. The contract is silent on authorization.

- **G-cross.1 promoted to bug — Contracts have no code generator.**
  Per the absence of any generation script in `package.json` or `scripts/` referring to these YAMLs, no client SDK or server stub is produced. Compare with J1's OpenAPI/SDK builder which generates per-workspace SDKs from `apps/control-plane/openapi/control-plane.openapi.json` only.

- **B9. Inventory contract requires `domain` query parameter — no "all domains" listing possible.**
  `secret-inventory-v1.yaml:11` (verified-by-author). Restrictive vs. typical inventory APIs.

- **B10. Inventory response lacks pagination metadata.**
  `secret-inventory-v1.yaml:35-42` (verified-by-author). Bare `{secrets: [...]}` — no `total`, `nextOffset`, `hasMore`, or `Link` header.

### Likely (smells, schema-design issues)

- **B11. Inventory `tenantId` query param has undefined "omitted" behaviour.**
  `secret-inventory-v1.yaml:16-18`. The contract doesn't document whether omitting `tenantId` means: (a) current-tenant default, (b) platform-only, (c) all-tenants (admin only). Three plausible interpretations, none specified.

- **B12. Inventory's `SecretMetadataItem` lacks `lastAccessedAt`, `vaultMount`, `accessPolicies`.**
  `secret-inventory-v1.yaml:45-59` (verified-by-author). Consumers must call detail per secret for those fields — undocumented N+1 pattern.

- **B13. Detail contract fields `status`, `secretType`, `vaultMount`, `accessPolicies[]` are free-form strings.**
  No enums, no patterns. Schema can't catch a misspelt status or an invalid mount.

- **B14. OpenAPI version 3.0.3 vs unified spec 3.1.0.**
  Merging will require an `nullable: true → type: ['x','null']` migration plus JSON Schema dialect change.

- **B15. The two YAMLs are not validated by any tool in CI.**
  No test asserts the YAMLs are well-formed OpenAPI. They may have syntactic issues nobody has noticed.

### Needs verification

- **B16. Whether `/v1/secrets/{workspaceId}/metadata` (the path used by the hardening test) is implemented anywhere in the repo.**
  The test expects 403/200 responses to actual HTTP calls — so the path must resolve to *something* during the test. Verify by reading `tests/hardening/suites/tenant-isolation.test.mjs` in full and tracing the `get(...)` helper to see whether it points at a mock server, a real service, or a no-op stub.

- **B17. Whether the M2 secret-audit-handler is the only intended consumer of any M3 contract.**
  M2's JS schema constant duplicates `secret-audit-event-v1.yaml` with different `FORBIDDEN_FIELDS` count. Whether the YAML is supposed to be the source-of-truth or the JS constant is needs a policy decision.

- **B18. Whether a future implementer plans to add `/v1/secrets/*` to `apps/control-plane/openapi/control-plane.openapi.json` and to `services/gateway-config/routes/`.**
  If yes, B5 (path syntax with slashes) and B8 (security scheme) must be resolved first.

- **B19. Whether `status` values for secrets are documented elsewhere (e.g., per-domain conventions).**
  The free-form string at B13 needs operational context.

---

## Scope note for downstream spec authoring

M3 is documentation in search of an implementation. Before any OpenSpec proposal:

1. **Decide whether `/v1/secrets/{domain}/{path}` and `/v1/secrets/inventory` are on the roadmap.** If not, archive `internal-contracts/secrets/` or move it under `docs/`. If yes, the contracts need consumers (B1), routes (B2), and security (B8).
2. **Reconcile B7 (hardening test calls undocumented `/v1/secrets/{workspaceId}/metadata`).** Either rewrite the test to call a declared route, or add the route to the contracts.
3. **Fix B5 (path-with-slashes).** Vault-style secret paths cannot fit OAS 3.0.3 `{path}` without escape or a different route shape (`/v1/secrets/{domain}` + `?path=...` query, or a `+`-greedy syntax outside standard OAS).
4. **Reconcile B6 (forbidden-field policy fragmentation).** Pick one policy source: the M2 sanitiser's JS constant, the audit-event YAML's `not.anyOf`, or the inventory YAML's `not.anyOf`. Currently three policies disagree.
5. **Add `required` to detail response (B3) and `nullable: true` to `lastAccessedAt` (B4).** Trivial fixes that prevent contract drift.
6. **Add `components.securitySchemes`** to both YAMLs and declare the scope each route requires. Per the B1 capability audit, the scope-manifest YAMLs at `services/keycloak-config/scopes/` are themselves dead — but the *concept* of scope-as-contract is the right model.
7. **Wire a contract validator** (`@apidevtools/swagger-parser`, AJV, or similar) into the repo's `validate:openapi` script. The current script (per `package.json:lint`) targets the unified spec; the M3 fragments are unwatched.

Until B1 and B2 are addressed (handler + gateway route), M3 has no functional surface; any FRs are aspirational against schemas no one reads.
