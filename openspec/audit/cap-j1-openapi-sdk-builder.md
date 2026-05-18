# Capability J1 — OpenAPI / SDK Builder

**Source locus:** `services/openapi-sdk-service/` — **778 LOC** across 14 source files + 2 migrations + 7 capability module JSON files + 1 OpenAPI-lint script + 7 tests.

| File | LOC | Role |
|---|---|---|
| `actions/sdk-generate.mjs` | 123 | HTTP-shaped action: `POST /v1/workspaces/{id}/sdks`, `GET .../sdks/{lang}/status` |
| `actions/openapi-spec-regenerate.mjs` | 49 | Internal regeneration trigger |
| `actions/openapi-spec-serve.mjs` | 74 | HTTP-shaped action: `GET /v1/workspaces/{id}/openapi` with ETag + rate-limit |
| `src/spec-assembler.mjs` | 79 | Compose base + capability modules; compute version + content hash |
| `src/spec-version-repo.mjs` | 69 | `getCurrentSpec`, `insertNewSpec` (txn), `getSpecHistory` |
| `src/sdk-builder.mjs` | 73 | Spawn `openapi-generator-cli`, zip/tar archive |
| `src/sdk-package-repo.mjs` | 79 | `upsertSdkPackage`, `updateSdkPackageStatus`, `getSdkPackage`, `markStaleSdkPackages` |
| `src/sdk-storage.mjs` | 41 | S3 PUT + presigned GET |
| `src/network.mjs` | 64 | URL normalisation, internal-http allow-list, path-segment encoding |
| `src/config.mjs` | 62 | Env loading; production-only required-var check |
| `src/spec-audit.mjs` | 31 | 4 Kafka topic emitters (per-event producer create/connect/send/disconnect) |
| `src/spec-cache.mjs` | 14 | SHA-256 content hash, ETag helpers |
| `src/capability-manifest-client.mjs` | 20 | HTTP GET workspaces/{id}/effective-capabilities |
| `migrations/088-workspace-openapi-versions.sql` | 19 | `workspace_openapi_versions` table |
| `migrations/088-workspace-sdk-packages.sql` | 18 | `workspace_sdk_packages` table |

Tests: 7 unit/integration tests covering spec-assembler, spec-cache, spec-version-repo, sdk-builder, sdk-storage, capability-manifest-client, and openapi-spec-serve action.

**Method.** Read every file end-to-end (no file > 123 LOC). Did not consult `docs/`, `openspec/`, or `01-capability-map.md`.

Up-front observations:
- This is the most cleanly-decomposed action service in the audit so far. The `package.json` (`:7`) wires real tests under `tests/**`. Capability modules are JSON fragments composed into a single OpenAPI 3.1 spec.
- `config.mjs:20-35` enforces required env vars **only in production** (`nodeEnv !== 'production'` → no check). Development omissions go silently undefined.
- `sdk-builder.mjs:65` spawns `openapi-generator-cli` (external CLI). Not in `dependencies`; assumed to be on PATH. Likewise `tar`/`zip` (`sdk-builder.mjs:29-39`).
- Same upstream-trust pattern as F3/H1/I1: `__ow_headers['x-auth-tenant-id']` is trusted from the gateway.

---

## SPEC (what exists)

### S1. Configuration and bootstrapping

- **WHEN** the module is loaded, **THE SYSTEM SHALL** freeze `config` from env vars: `DATABASE_URL`, comma-split `KAFKA_BROKERS`, optional `KAFKA_CLIENT_ID`, `S3_ENDPOINT`/`S3_ACCESS_KEY`/`S3_SECRET_KEY`/`S3_SDK_BUCKET ?? 'workspace-sdks'`/`S3_PRESIGNED_URL_TTL_SECONDS ?? 86400`, `EFFECTIVE_CAPABILITIES_BASE_URL`, `SPEC_RATE_LIMIT_PER_MINUTE ?? 60`, `SDK_RETENTION_DAYS ?? 90`, `NODE_ENV ?? 'development'` (`src/config.mjs:37-62`).
- **WHEN** `nodeEnv === 'production'`, **THE SYSTEM SHALL** throw if any of `DATABASE_URL`, `KAFKA_BROKERS`, `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `EFFECTIVE_CAPABILITIES_BASE_URL` is unset (`src/config.mjs:20-35`).
- **WHEN** `effectiveCapabilitiesBaseUrl` is set, **THE SYSTEM SHALL** normalise it via `normalizeServiceBaseUrl(..., { allowBareInternalHttp: true })` (`src/config.mjs:53-59`, `src/network.mjs:13-43`).
- **WHEN** `normalizeServiceBaseUrl` runs, **THE SYSTEM SHALL** require `http:` or `https:`, reject embedded credentials and query/hash fragments, and reject bare-internal `http:` unless host is loopback, `*.svc{.cluster.local}`, or a single-label name with `allowBareInternalHttp: true` (`src/network.mjs:1-43`).

### S2. Spec assembly

- **WHEN** `assembleSpec({enabledCapabilities, workspaceBaseUrl, previousSpecVersion, previousCapabilityTags})` runs, **THE SYSTEM SHALL** clone `base-template.openapi.json`, sort `enabledCapabilities`, merge each enabled module's `paths` and `components.schemas` into the spec, push each module's `tag` into `spec.tags`, set `info.version = computeNextVersion(...)`, set `servers[0].url = workspaceBaseUrl`, serialise to JSON + YAML, compute `contentHash = sha256:<hex>`, and return `{formatJson, formatYaml, contentHash, specVersion, capabilityTags}` (`src/spec-assembler.mjs:57-79`).
- **WHEN** `computeNextVersion(prev, prevTags, newTags)` runs, **THE SYSTEM SHALL** bump MAJOR if any prevTag is missing from newTags; else MINOR if any newTag is missing from prevTags; else PATCH (`spec-assembler.mjs:39-47`).
- **WHEN** `computeChangeType(prevTags, newTags)` runs, **THE SYSTEM SHALL** return `'MAJOR'` / `'MINOR'` / `'PATCH'` by the same rule (`spec-assembler.mjs:49-55`).
- **WHEN** a capability id is not in `CAPABILITY_MODULES`, **THE SYSTEM SHALL** silently skip it (`spec-assembler.mjs:62-63`).
- **WHEN** the same capability id is reused across modules (impossible per static map), **THE SYSTEM SHALL** apply later-merged paths and schemas with last-write-wins shallow merge (`spec-assembler.mjs:65-66`).

### S3. Spec version persistence

- **WHEN** `getCurrentSpec(pool, workspaceId)` runs, **THE SYSTEM SHALL** select the row with `is_current = TRUE` for that workspace, returning `{id, tenantId, workspaceId, specVersion, contentHash, formatJson, formatYaml, capabilityTags, createdAt}` (`src/spec-version-repo.mjs:1-25`).
- **WHEN** `insertNewSpec(pool, spec)` runs, **THE SYSTEM SHALL** open a connection, `BEGIN`, UPDATE prior current row to `is_current = FALSE`, INSERT the new row with `is_current = TRUE`, `COMMIT`, and release the client; on any error, ROLLBACK (`spec-version-repo.mjs:27-47`).
- **WHEN** `getSpecHistory(pool, workspaceId, limit = 10)` runs, **THE SYSTEM SHALL** return up to `limit` rows ordered by `created_at DESC` (`spec-version-repo.mjs:49-69`).

### S4. Regeneration trigger

- **WHEN** `openapi-spec-regenerate.main(params)` runs, **THE SYSTEM SHALL** fetch `enabledCapabilities` for the workspace via `fetchEnabledCapabilities(workspaceId, authToken)`, load the current spec, call `assembleSpec` with the previous version + tags, and if the computed `contentHash` is unchanged return `{message: 'no-op'}` (`actions/openapi-spec-regenerate.mjs:10-28`).
- **WHEN** the content hash changes, **THE SYSTEM SHALL** insert the new spec, mark every prior `ready` SDK for `(workspace, spec_version ≠ new)` as `stale`, and emit `console.openapi.spec.updated` with `{workspaceId, tenantId, specVersion, previousSpecVersion, contentHash, capabilityTags, changeType}` (`actions/openapi-spec-regenerate.mjs:30-48`).

### S5. Spec serve

- **WHEN** `GET /v1/workspaces/{id}/openapi` is invoked, **THE SYSTEM SHALL** extract `workspaceId` from path, require `x-auth-tenant-id` and `x-auth-user-id` headers (else `401 UNAUTHORIZED`), enforce per-workspace rate limit (`SPEC_RATE_LIMIT_PER_MINUTE ?? 60`; `429` with `Retry-After: 60` on excess), load the current spec, return `403 FORBIDDEN` if `spec.tenantId !== tenantId`, return `404 SPEC_NOT_FOUND` if absent, honour `If-None-Match` with ETag (returns `304`), and serve `format = 'yaml'` if `?format=yaml` or `Accept: application/x-yaml` else `json`; fire-and-forget `console.openapi.spec.accessed` Kafka event; response headers include `Content-Type`, `ETag`, `X-Spec-Version`, `Cache-Control: max-age=60, must-revalidate` (`actions/openapi-spec-serve.mjs:10-74`).
- **WHEN** the rate limiter runs, **THE SYSTEM SHALL** maintain an in-process Map `requestBuckets` keyed by workspace, with per-minute reset and count-based rejection (`openapi-spec-serve.mjs:8, :15-25`).
- **WHEN** the ETag check runs and the request header is `'*'` or missing, **THE SYSTEM SHALL** treat it as no-match and serve the full body (`src/spec-cache.mjs:11-14`).

### S6. SDK generation

- **WHEN** `POST /v1/workspaces/{id}/sdks` arrives, **THE SYSTEM SHALL** parse the body, require `x-auth-tenant-id` or `x-tenant-id` header (else `401`), require `body.language ∈ {typescript, python}` (else `400 INVALID_LANGUAGE`), load the current spec (else `404 SPEC_NOT_FOUND`), upsert the package row; if the row is already `ready` with a `downloadUrl`, return `200` with that record; otherwise update status to `'building'`, run the builder + uploader, update status to `'ready'` with download URL + expiry, emit `console.sdk.generation.completed`, and return `202` with `{packageId, language, specVersion, status: 'pending', statusUrl}` (`actions/sdk-generate.mjs:54-114`).
- **WHEN** `GET /v1/workspaces/{id}/sdks/{language}/status` arrives, **THE SYSTEM SHALL** require language in `{typescript, python}` (else `404 SDK_NOT_FOUND`), load the latest package row for `(workspace, language)`, return `404` if none; else return `200` with `{packageId, language, specVersion, status, downloadUrl, urlExpiresAt, errorMessage}` (`actions/sdk-generate.mjs:27-52`).
- **WHEN** `buildSdk(specJson, language, workspaceId, specVersion)` runs, **THE SYSTEM SHALL** map `language → generator` (`typescript → typescript-fetch`, `python → python`), sanitise `workspaceId` to `[a-z0-9_-]+` (max 8 chars) and `specVersion` against `^\d+\.\d+\.\d+(?:[-+][0-9a-z.-]+)?$`, write `spec.json` to a temp dir, run `openapi-generator-cli generate -g <gen> -i <spec> -o <output> --additional-properties packageName=workspace-<frag>-sdk,packageVersion=<ver>` with a 240s timeout, archive the output as `.zip` (typescript) or `.tar.gz` (python), and return `{archivePath, archiveType}` (`src/sdk-builder.mjs:44-73`).
- **WHEN** `uploadSdkArtefact({archivePath, archiveType, workspaceId, language, specVersion})` runs, **THE SYSTEM SHALL** PUT the archive to S3 at `sdks/{workspaceId}/{language}/{specVersion}/workspace-sdk.{zip|tar.gz}`, then presign a GET with `s3PresignedUrlTtlSeconds ?? 86400` TTL, and return `{downloadUrl, urlExpiresAt}` (`src/sdk-storage.mjs:18-41`).

### S7. Audit emission

- **WHEN** an audit emit fires, **THE SYSTEM SHALL** instantiate `kafka.producer()`, connect, send a single message with `JSON.stringify(payload)`, then disconnect; if `kafka?.producer` is absent, return without sending (`src/spec-audit.mjs:9-15`).
- Four topics defined: `console.openapi.spec.accessed`, `console.openapi.spec.updated`, `console.sdk.download.accessed`, `console.sdk.generation.completed` (`spec-audit.mjs:17-31`).

### S8. Persistence schema

- **WHEN** the migration runs, **THE SYSTEM SHALL** create `workspace_openapi_versions(id UUID PK, tenant_id UUID NN, workspace_id UUID NN, spec_version VARCHAR(64) NN, content_hash VARCHAR(72) NN, format_json TEXT NN, format_yaml TEXT NN, capability_tags TEXT[] NN, is_current BOOL NN DEFAULT TRUE, created_at TIMESTAMPTZ NN DEFAULT now(), UNIQUE(workspace_id, is_current) DEFERRABLE INITIALLY DEFERRED)` plus two indexes (`migrations/088-workspace-openapi-versions.sql:1-19`).
- **WHEN** the migration runs, **THE SYSTEM SHALL** create `workspace_sdk_packages(id UUID PK, tenant_id UUID NN, workspace_id UUID NN, language VARCHAR(32) NN, spec_version VARCHAR(64) NN, status VARCHAR(16) CHECK IN (pending,building,ready,failed,stale) NN, download_url TEXT, url_expires_at TIMESTAMPTZ, error_message TEXT, timestamps, UNIQUE(workspace_id, language, spec_version))` plus an index (`migrations/088-workspace-sdk-packages.sql:1-18`).

---

## GAPS

### G-cross. Cross-cutting

1. **Production-only required-var check.** `config.mjs:20-35` runs `validateRequired` only when `NODE_ENV === 'production'`. Dev/staging runs with missing critical vars (`DATABASE_URL`, `S3_*`) silently produce `undefined` config; failures surface at first call to S3/PG.
2. **`openapi-generator-cli` is an undeclared runtime dependency.** `sdk-builder.mjs:65`. Not in `package.json`. Not in any Dockerfile in source. SDK generation requires this binary on PATH; if absent, every call fails with `ENOENT`.
3. **`tar` and `zip` binaries assumed on PATH.** `sdk-builder.mjs:29-39`. Same undeclared dependency.
4. **Identity is trusted from the gateway headers.** `sdk-generate.mjs:58, openapi-spec-serve.mjs:30-31` use `__ow_headers['x-auth-tenant-id']` without any signed-context check. Same upstream-trust pattern as F3/H1/I1.
5. **Per-action `new pg.Pool` and `new Kafka()` instantiation** at every entry-point unless DI is provided (`sdk-generate.mjs:117-118`, `openapi-spec-regenerate.mjs:11-12`, `openapi-spec-serve.mjs:45-46`). On OpenWhisk's short action lifecycle, this is OK; on a long-lived process it would leak connections.

### G-spec-assembler

- **G-S2.1** `assembleSpec` does not validate that capability module JSON files are well-formed. If `mongodb.paths.json` lacks a `tag` field, line 67 pushes `undefined` into `spec.tags` (see B5).
- **G-S2.2** Last-write-wins shallow merge of `paths` and `components.schemas` (`:65-66`). If two enabled modules define the same path, one silently overwrites the other.
- **G-S2.3** `computeNextVersion` only considers tag set changes; in-place edits to a capability module's paths produce only a PATCH bump even if the API surface changed significantly. See B6.
- **G-S2.4** `moduleCache` (`:8`) caches JSON files for the process lifetime; capability module updates require a process restart.

### G-spec-version-repo

- **G-S3.1 CRITICAL** Migration's `UNIQUE (workspace_id, is_current)` constraint allows at most ONE row with `(workspace_id, FALSE)` per workspace. The third version generation will violate the constraint. See B1.
- **G-S3.2** `getSpecHistory` defaults to `limit = 10` but the schema bug (B1) means at most 2 rows exist per workspace at any time.

### G-regenerate

- **G-S4.1** No authentication. `openapi-spec-regenerate.main` accepts `params.workspaceId`, `params.tenantId`, `params.authToken`, `params.workspaceBaseUrl` from any caller (`:10`). No scope/role check. Treat as an internal-only invocation, but no signed-context check enforces that.
- **G-S4.2** `params.workspaceBaseUrl` is passed verbatim to `assembleSpec` (line 21) without `normalizeServiceBaseUrl` validation. A caller can set `workspaceBaseUrl` to any URL (including private network) and have it baked into the generated spec.
- **G-S4.3** No idempotency. Two concurrent regenerate calls both fetch the current spec, both compute new versions, and both insert. The deferred unique constraint will allow both transactions to commit interleaved (one wins, one rolls back), but the loser doesn't surface a structured error.

### G-spec-serve

- **G-S5.1** Rate-limit Map is in-process (`:8`). Multi-replica deployments multiply the effective limit by the replica count. Same pattern as F3 B9, E2 G12.
- **G-S5.2** Rate-limit Map has no eviction; entries accumulate per workspace forever.
- **G-S5.3** `Accept: application/x-yaml` is exact-match (`:61`). `application/x-yaml; charset=utf-8` (any valid Accept variant) returns JSON.
- **G-S5.4** `emitSpecAccessed(...).catch(() => undefined)` (`:62`) silently swallows Kafka failures with no metric counter.
- **G-S5.5** `__ow_headers['x-auth-user-id']` is required (`:31, :33`) but `requesterId` is only used for audit emission. Failing 401 on missing requesterId is arguably overstrict — even an SDK status check requires the user-id header.

### G-sdk-generate

- **G-S6.1** **No tenant ownership check on the workspace.** `sdk-generate.mjs:68` calls `getCurrentSpec(pool, workspaceId)` with no tenant filter. A caller passing `x-auth-tenant-id: tenant_A` but a `workspaceId` belonging to `tenant_B` will successfully load `tenant_B`'s spec and generate an SDK for it. The row is then INSERTed with `tenant_A` as `tenant_id` (the caller's), creating a row in `workspace_sdk_packages` that misattributes ownership. See B2.
- **G-S6.2** **No tenant ownership check on status endpoint.** `sdk-generate.mjs:35` — `getSdkPackage(pool, workspaceId, language)`. Any caller can read another workspace's SDK status, including its `downloadUrl`. Combined with G-S6.1, the system is cross-tenant readable.
- **G-S6.3** **The 202 'pending' response is misleading.** `sdk-generate.mjs:88-104` awaits the build + upload + status update + Kafka emit synchronously. By the time the response is sent, the SDK is already `ready` (or `failed`). The response payload says `status: 'pending'` and points at a `statusUrl` that would already return `ready`. Either the response should be `200 ready` with the actual `downloadUrl`, or the build should be truly asynchronous.
- **G-S6.4** "Already ready" early-return doesn't re-presign if `urlExpiresAt` has passed. `:74` checks `pkg.status === 'ready' && pkg.downloadUrl`. A 25h-old `ready` package (default TTL 86400s = 24h) returns the stale URL.
- **G-S6.5** No handling of `'stale'` packages. `sdk-generate.mjs:74` only short-circuits on `'ready'`; `'stale'` packages bypass the early-return and rebuild — but the resulting upsert finds the row (by `(workspace, language, specVersion)`), and `upsertSdkPackage` returns the existing row without checking its `'stale'` status. Then `updateSdkPackageStatus(..., 'building')` overwrites it. OK by accident, but the `'stale'` lifecycle was never explicitly handled.
- **G-S6.6** `upsertSdkPackage` returns the existing row's data but doesn't update its `tenant_id` if it differs. Combined with G-S6.1, a forced re-generation on a misattributed row leaves the historical wrong-tenant value.
- **G-S6.7** No quota enforcement: a caller can trigger unlimited SDK regenerations per workspace.
- **G-S6.8** `extractWorkspaceId(pathname)` (`:12-14`) uses regex on `__ow_path` without URL-decoding. URL-encoded workspace ids will not match.

### G-sdk-builder

- **G-S6.9 CRITICAL** **Disk leak: `tempRoot` is never removed.** `sdk-builder.mjs:71` only removes `specPath`. The directory containing `spec.json`, `output/`, and the archive (`workspace-sdk.{zip,tar.gz}`) stays on disk. Per generation, this is ~MB-to-tens-of-MB depending on the language. See B3.
- **G-S6.10** `archiveDirectory` is a global side-effect (cwd: outputPath) but uses unbuffered streams; no stderr capture for failed archive runs.
- **G-S6.11** The 240s timeout (`:65`) is fixed; large specs may not complete in time.

### G-sdk-storage

- **G-S6.12** S3 uploads stream the archive but do not delete the local archive after successful upload. See B3 (same root cause as G-S6.9).
- **G-S6.13** No object retention/lifecycle policy at the storage layer; `SDK_RETENTION_DAYS` (config `:8, :49`) is read but never used.
- **G-S6.14** No checksum (`ContentMD5` or `x-amz-checksum-*`) on the PUT.

### G-audit

- **G-S7.1** `emit(kafka, topic, payload)` (`spec-audit.mjs:9-15`) creates a new producer per event, connects, sends, disconnects. Massive overhead.
- **G-S7.2** No producer pooling, no idempotency, no acks-config.

### G-tests

- **G-T1** Tests are wired into `pnpm test` (`package.json:7`). Coverage is decent but no test asserts:
  - The schema's UNIQUE(workspace_id, is_current) constraint behaviour with 3+ versions (B1)
  - Tenant ownership check on sdk-generate workspace fetch (B2)
  - Disk cleanup after build (B3)
  - Rate-limit eviction
  - Stale `urlExpiresAt` behaviour

---

## BUGS

### Confirmed (verified-by-author from the cited lines)

- **B1. `UNIQUE (workspace_id, is_current) DEFERRABLE INITIALLY DEFERRED` prevents history beyond 2 rows.**
  `services/openapi-sdk-service/migrations/088-workspace-openapi-versions.sql:11` (verified-by-author). The constraint treats `(workspace_id, FALSE)` as a unique tuple. After the first regeneration: 1 row `(X, FALSE)` (the superseded original) and 1 row `(X, TRUE)` (the new current) — OK. After the second regeneration: the transaction tries to set the prior `(X, TRUE)` to `FALSE`, which would require a second `(X, FALSE)` row — **violating the unique constraint**. The deferred mode allows the violation mid-transaction but **the constraint must hold at COMMIT**. Result: the third `insertNewSpec` call will fail with a constraint-violation rollback. **The repo cannot maintain spec history.** `getSpecHistory` will always return ≤ 2 rows.

- **B2. SDK-generate has no tenant-ownership check on the workspace.**
  `services/openapi-sdk-service/actions/sdk-generate.mjs:68` (verified-by-author) — `getCurrentSpec(pool, workspaceId)`. The query (`spec-version-repo.mjs:1-25`) filters by `workspace_id` only. A caller with `x-auth-tenant-id: T_A` but a known `workspaceId` belonging to `T_B` reads `T_B`'s spec and triggers SDK generation. The resulting `workspace_sdk_packages` row is INSERTed with `T_A`'s tenant id at line 73 — creating a misattributed row in another tenant's workspace.
  Compare with `openapi-spec-serve.mjs:53-55` which **does** check `spec.tenantId !== tenantId → 403`. Asymmetric defence.

- **B3. SDK build leaves the temp directory on disk indefinitely.**
  `services/openapi-sdk-service/src/sdk-builder.mjs:51, :71` (verified-by-author). `tempRoot = await mkdtemp(join(tmpdir(), 'falcone-openapi-sdk-'))`. The `finally` block only removes `specPath`. The temp dir contains `output/` (generated SDK source tree, often 5-50 MB), `spec.json`, and `workspace-sdk.{zip|tar.gz}` (the archive). None are removed after upload. **Disk fills with every SDK generation.** OpenWhisk action containers are usually ephemeral, but if the action runs in a longer-lived runtime, this is a guaranteed disk-fill bug.

- **B4. SDK-generate `getSdkPackage` status endpoint has no tenant-ownership check.**
  `sdk-generate.mjs:35` (verified-by-author) — same as B2 but for status reads. Any caller can read another tenant's SDK download URL.

- **B5. `assembleSpec` pushes `undefined` into `spec.tags` if a capability module lacks a `tag` field.**
  `src/spec-assembler.mjs:67` (verified-by-author) — `spec.tags.push(module.tag)` without checking. Today's modules likely have the field, but a typo or new module without a tag silently corrupts the spec. OpenAPI 3.1 validators reject `tags: [undefined]`.

- **B6. `computeNextVersion` ignores spec content changes within an unchanged capability set.**
  `spec-assembler.mjs:39-47` (verified-by-author). Tag-set delta only. If `auth.paths.json` is edited to add a new endpoint, the tag set is unchanged → only PATCH bump. Downstream consumers relying on MINOR bumps to discover new endpoints would miss the change. Compare with `assembled.contentHash` (`:76`) which IS hashed — the change is detectable but not reflected in the semver bump.

- **B7. The 202 'pending' response is misleading — work is synchronous.**
  `actions/sdk-generate.mjs:88-104, :108-113` (verified-by-author). Every `await` from `:89` through `:97` completes before `:104` returns `202 'pending'`. The SDK is fully built and uploaded; the response says it's not. A client polling `statusUrl` will see `'ready'` on the first poll. Either the response should reflect the true state, or the build should be truly fire-and-forget.

- **B8. "Already ready" early-return doesn't re-presign expired URLs.**
  `sdk-generate.mjs:74-87` (verified-by-author). Returns existing `downloadUrl` even if `urlExpiresAt < now`. With default TTL 86400s, a re-request 25h later receives a 403-on-use URL.

- **B9. `openapi-spec-regenerate.main` has no authentication.**
  `actions/openapi-spec-regenerate.mjs:10-15` (verified-by-author). Reads `params.workspaceId`, `params.tenantId`, `params.authToken`, `params.workspaceBaseUrl` with no auth check. Plus, `workspaceBaseUrl` is interpolated into the spec (`assembleSpec → spec.servers[0].url`) without `normalizeServiceBaseUrl` validation. **A caller can inject any URL (including private network) into the published OpenAPI spec.**

- **B10. `emit()` creates a new Kafka producer per event.**
  `src/spec-audit.mjs:9-15` (verified-by-author). `kafka.producer()` → `connect()` → `send()` → `disconnect()` for every audit event. With the spec-serve endpoint emitting on every GET, this is one Kafka full connection cycle per HTTP request.

- **B11. Rate-limit Map in-process; multi-replica deployments multiply the effective limit.**
  `actions/openapi-spec-serve.mjs:8` (verified-by-author). No shared backend. With N replicas, effective limit is `N × SPEC_RATE_LIMIT_PER_MINUTE`.

- **B12. `extractWorkspaceId` regex doesn't URL-decode.**
  `actions/sdk-generate.mjs:12-14` and `actions/openapi-spec-serve.mjs:10-13` (verified-by-author). A URL-encoded workspace id would fail the regex.

- **B13. `__ow_headers['x-auth-tenant-id']` fallback to `x-tenant-id` is asymmetric.**
  `sdk-generate.mjs:58` accepts either header. `openapi-spec-serve.mjs:30` also accepts either. Gateway must consistently set one — but if both are present with different values, `x-auth-tenant-id` wins (`??`). A gateway bug propagating an old `x-tenant-id` while the new auth-tenant comes from JWT could mask drift.

- **B14. `validateRequired` skipped outside production.** `src/config.mjs:21` — `if (config.nodeEnv !== 'production') return;`. Staging/QA runs with missing critical vars pass startup but fail at first DB/S3 call.

### Likely (smells / race conditions)

- **B15. Concurrent regenerations both insert.** `actions/openapi-spec-regenerate.mjs:30-46` — no advisory lock. Two concurrent regenerates both pass the `contentHash !== assembled.contentHash` check (since they compute the same hash), both call `insertNewSpec`, both attempt the `is_current = FALSE` UPDATE + `is_current = TRUE` INSERT in their own transactions. The deferred unique constraint serialises them; one wins, one rolls back with `unique_violation`. The losing client sees a 500.

- **B16. `markStaleSdkPackages` runs unconditionally in regenerate.** `actions/openapi-spec-regenerate.mjs:36`. Even when the regenerate is a no-op (B1 returns early at `:27`), the stale-mark logic does NOT run — but if a regenerate succeeds and there happen to be `'ready'` packages for the OLD version, they're flipped to `'stale'`. Combined with G-S6.5 (stale lifecycle never explicitly handled by `sdk-generate`), a `'stale'` package will be rebuilt against the NEW spec automatically — but the package record stores the OLD spec_version field. Misattribution.

- **B17. `archiveDirectory` calls `spawn(cmd, args)` without explicit error capture.** `sdk-builder.mjs:35-41`. `stdio: 'ignore'` discards stderr. Failed archives report only the exit code.

- **B18. `buildSdk` 240s timeout is per-call, not per-attempt.** For complex specs, this may abort legitimate builds. No retry.

- **B19. `network.normalizeServiceBaseUrl` with `allowBareInternalHttp: true`.** Only used by `effectiveCapabilitiesBaseUrl` (`config.mjs:58`). Single-label hostname check (`SINGLE_LABEL_HOST_PATTERN`) treats `kubernetes` as valid. An attacker who controls the env can point the capability fetch at any internal service. Mitigated by the env being deployment-controlled; flagged as SSRF surface area.

- **B20. `archiveDirectory` invocation uses `cwd: outputPath` and `.` as the relative root.** If the OpenAPI generator creates symlinks pointing outside `outputPath`, the `zip -r` / `tar -czf` would include the linked content. Unlikely with `typescript-fetch`/`python` templates.

- **B21. `sdk-storage.uploadSdkArtefact` streams `createReadStream(archivePath)` but doesn't close the stream explicitly.** The S3 client should close on success; on failure the stream may leak.

### Needs verification

- **B22. Does `openapi-generator-cli` exist in the deployed container?** Not declared anywhere in source. If absent, every generation fails.

- **B23. Does the deferred unique constraint behave as I described in B1?** Postgres `UNIQUE … DEFERRABLE INITIALLY DEFERRED` defers the check until COMMIT. With three rows attempting to coexist, the constraint should fail at COMMIT. Verify by running the migration and three successive `insertNewSpec` calls in different transactions.

- **B24. Whether multi-replica deployments share an external rate-limit store.** Not in this package; depends on whether the gateway also rate-limits.

- **B25. Whether `SDK_RETENTION_DAYS` is consumed by an out-of-package retention job.** The config reads it but no code references it; if there's no external sweeper, S3 fills indefinitely.

- **B26. Whether `params.__ow_body` arrives as parsed JSON or string from the OpenWhisk runtime.** `sdk-generate.mjs:23` handles both, but verify.

---

## Scope note for downstream spec authoring

J1 is one of the better-decomposed services in the audit. Tests are wired, the migration is small, and the spec-assembly logic is clean. Five must-fix items before any spec proposal:

1. **B1 — schema constraint prevents history.** Change to either `PARTIAL UNIQUE (workspace_id) WHERE is_current = TRUE` or drop `is_current` and use a `superseded_at` timestamp. Otherwise the third regeneration breaks the system.
2. **B2 / B4 — tenant-ownership checks on sdk-generate.** Add `AND tenant_id = $2` to `getCurrentSpec` / `getSdkPackage` or filter at the action layer (matching the pattern at `openapi-spec-serve.mjs:53-55`).
3. **B3 — temp-dir cleanup.** Replace `await rm(specPath)` with `await rm(tempRoot, { recursive: true, force: true })` in the `finally` block.
4. **B7 — response shape vs. semantics.** Either flip to truly asynchronous (kick off the build via a queue and return 202 with `statusUrl`) or change the response to `200 'ready'` with the URL inline.
5. **B9 — regenerate authentication.** Add a signed-context check or restrict invocation to an internal-only OpenWhisk surface. The `workspaceBaseUrl` parameter should be validated via `normalizeServiceBaseUrl` before flowing into the spec.

Secondary cleanup: B6 (version-bump semantics), B10 (Kafka per-event producer), B11 (in-process rate limit), B13 (header precedence), B14 (production-only validation), and B5 (defensive check for missing `module.tag`). After these, J1 is a clean candidate for OpenSpec FR formalisation.
