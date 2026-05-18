# Capability K1 — Workspace Docs Service

**Source locus:** `services/workspace-docs-service/` — **596 LOC** across 9 source files + 1 migration + 7 tests.

| File | LOC | Role |
|---|---|---|
| `actions/workspace-docs.mjs` | 132 | HTTP-shaped action: `GET /docs`, `POST /docs/notes`, `PUT/DELETE /docs/notes/{id}` |
| `src/doc-assembler.mjs` | 88 | Compose docs from upstream API surface + capabilities + notes, with 2s timeout per upstream |
| `src/snippet-context-builder.mjs` | 79 | Substitute capability templates from `internal-contracts/src/snippet-catalog-data.json` |
| `src/rotation-procedure-section.mjs` | 59 | Hard-coded API-key rotation markdown section |
| `src/note-repository.mjs` | 54 | `insertNote`, `updateNote`, `softDeleteNote`, `listNotes` |
| `src/config.mjs` | 33 | Env loading (`WORKSPACE_DOCS_DB_URL`, `KAFKA_BROKERS`, `INTERNAL_API_BASE_URL`, `WORKSPACE_DOCS_NOTE_MAX_LENGTH`) |
| `src/doc-audit.mjs` | 29 | Daily-dedup access log + Kafka emit on `console.audit` topic |
| `src/note-sanitiser.mjs` | 21 | Decode 3 HTML entities, strip tags, strip control chars, length check |
| `src/capability-catalog-builder.mjs` | 101 | (Used by C2 capability — not by K1's main path; cross-service consumer) |
| `migrations/087-workspace-doc-notes.sql` | 26 | 2 tables: `workspace_doc_notes`, `workspace_doc_access_log` |

Tests: 7 files covering doc-assembler, doc-audit, note-repository, note-sanitiser, rotation-procedure-section, workspace-docs.action, workspace-docs.integration. All wired into `pnpm test` (`package.json:11`).

**Method.** Read every file end-to-end (no file > 132 LOC). Did not consult `docs/`, `openspec/`, or `01-capability-map.md`.

**Up-front observations:**
- Same OpenWhisk-style `main(params)` shape as other action services. No HTTP/WS server in this package.
- Same upstream-trust pattern as F3/H1/I1/J1: `auth.tenantId/workspaceId/actorId` from `params` with no signed-context check.
- `capability-catalog-builder.mjs` (101 LOC) is in this package's `src/` but **does not belong to K1's main code path**. It's imported across service boundaries by the C2 workspace-capability-catalog action (`services/provisioning-orchestrator/src/actions/workspace-capability-catalog.mjs:1`). The cross-service relative import is flagged in the C2 audit; not repeated here.
- `WORKSPACE_DOCS_DB_URL` and `KAFKA_BROKERS` default to empty strings (`config.mjs:11-12`), meaning a dev-mode startup with no env vars set will succeed but DB/Kafka operations will fail at first call. Same anti-pattern as J1 B14.

---

## SPEC (what exists)

### S1. Configuration

- **WHEN** the module is loaded, **THE SYSTEM SHALL** read env vars: `WORKSPACE_DOCS_DB_URL` (default `''`), `KAFKA_BROKERS` (comma-split, default `[]`), `INTERNAL_API_BASE_URL` (default `''`), `WORKSPACE_DOCS_NOTE_MAX_LENGTH` (default `4096`) (`src/config.mjs:11-20`).
- **WHEN** `WORKSPACE_DOCS_NOTE_MAX_LENGTH` is non-positive or non-finite, **THE SYSTEM SHALL** throw at module load (`config.mjs:22-24`).
- **WHEN** `validateRuntimeConfig()` is called, **THE SYSTEM SHALL** return all four values (`config.mjs:26-33`). (No call sites visible.)

### S2. HTTP-shaped action entry

- **WHEN** `main(params)` runs, **THE SYSTEM SHALL** require `auth.tenantId`, `auth.workspaceId`, `auth.actorId` (else `403 FORBIDDEN`) (`actions/workspace-docs.mjs:27-32, :63-64`).
- **WHEN** `X-API-Version` header is present and not equal to `'2026-03-01'`, **THE SYSTEM SHALL** return `400 UNSUPPORTED_API_VERSION`; missing version is accepted (`actions/workspace-docs.mjs:6, :34-40, :66-67`).
- **WHEN** the action runs, **THE SYSTEM SHALL** read `correlationId = headers['X-Correlation-Id'] ?? headers['x-correlation-id'] ?? 'corr-missing'` and stamp it on every response header (`:69, :81, :86`).
- **WHEN** an error throws, **THE SYSTEM SHALL** map by `error.code`: `INVALID_NOTE_CONTENT → 422`, `WORKSPACE_NOT_FOUND` or `statusCode === 404 → 404`, `UPSTREAM_UNAVAILABLE` or `statusCode === 503 → 503`, otherwise `500 INTERNAL_ERROR` (`:120-131`).
- **WHEN** no route matches, **THE SYSTEM SHALL** return `501 NOT_IMPLEMENTED` (`:119`).

### S3. Doc retrieval (`GET /docs`)

- **WHEN** `GET /docs` is invoked, **THE SYSTEM SHALL** require the caller to have at least one role in `{workspace_viewer, workspace_admin, workspace_owner, developer_external}` (else `403`) (`:8, :79-82`).
- **WHEN** the role check passes, **THE SYSTEM SHALL** call `assembleWorkspaceDocs(ctx, db, internalClient)` and `recordAccess(...)` then return the assembled docs (`:84-86`).
- **WHEN** `assembleWorkspaceDocs` runs, **THE SYSTEM SHALL** invoke `internalClient.getApiSurface(workspaceId, ctx)` and `internalClient.getEffectiveCapabilities(workspaceId, ctx)` in parallel with a 2-second timeout per call (`src/doc-assembler.mjs:39-42, :5-23`).
- **WHEN** both upstream calls succeed, **THE SYSTEM SHALL** return `{workspaceId, tenantId, generatedAt, baseUrl, authInstructions{method, tokenEndpoint, clientIdPlaceholder, clientSecretPlaceholder, scopeHint, consoleRef}, enabledServices, customNotes, rotationProcedureSection, stale: false}` (`:47-61`).
- **WHEN** an upstream call returns `statusCode === 404`, **THE SYSTEM SHALL** re-throw with `code: 'WORKSPACE_NOT_FOUND'` (`:62-66`).
- **WHEN** an upstream call times out or returns 503, **THE SYSTEM SHALL** return a degraded doc with `stale: true`, empty `enabledServices`, empty `baseUrl`, default auth instructions, AND the current notes from DB (`:68-83`).
- **WHEN** `recordAccess(db, kafkaProducer, workspaceId, actorId, correlationId, tenantId='unknown')` runs, **THE SYSTEM SHALL** `INSERT INTO workspace_doc_access_log` with `ON CONFLICT DO NOTHING`; on a successful insert AND if `kafkaProducer.send` is defined, send `{eventType: 'workspace.docs.accessed', workspaceId, tenantId, actorId, accessDate, correlationId}` to topic `'console.audit'` (`src/doc-audit.mjs:1-29`).
- **WHEN** the access log primary key `(workspace_id, actor_id, access_date)` already has a row for today, **THE SYSTEM SHALL** dedup — no second Kafka event fires (`:5, migration line 22`).

### S4. Note CRUD

- **WHEN** `POST /docs/notes` runs, **THE SYSTEM SHALL** require role in `{workspace_admin, workspace_owner}`, sanitise content, insert, and return `201` with the new note (`actions/workspace-docs.mjs:7, :89-95`).
- **WHEN** `PUT /docs/notes/{id}` runs, **THE SYSTEM SHALL** require admin role, sanitise content, update the row (filtering `tenant_id, workspace_id, id, deleted_at IS NULL`), and return `200` with the updated note or `404 NOTE_NOT_FOUND` if not found (`:97-106`).
- **WHEN** `DELETE /docs/notes/{id}` runs, **THE SYSTEM SHALL** require admin role, soft-delete (`UPDATE ... SET deleted_at = now(), updated_at = now() WHERE tenant_id = $1 AND workspace_id = $2 AND id = $3 AND deleted_at IS NULL`), and return `204` or `404` (`:108-117`).
- **WHEN** content is sanitised, **THE SYSTEM SHALL** decode `&lt;`, `&gt;`, `&amp;` in that order, strip `/<[^>]+>/g`, strip control chars `[\x00-\x08\x0B\x0C\x0E-\x1F]`, trim, and throw `INVALID_NOTE_CONTENT` if the result is empty or longer than `WORKSPACE_DOCS_NOTE_MAX_LENGTH` (`src/note-sanitiser.mjs:6-21`).

### S5. Snippet context substitution

- **WHEN** `buildSnippetContexts(apiSurface, effectiveCapabilities)` runs, **THE SYSTEM SHALL** read `enabledServices` (or `capabilities.filter(c => c.enabled !== false)`) from the capabilities payload, normalise each via `normalizeCapability`, and return only those whose `serviceKey` is in `SERVICE_META = {postgres-database, mongo-collection, storage-bucket, serverless-function, realtime-subscription, webhooks, scheduling}` (`src/snippet-context-builder.mjs:3-11, :69-79`).
- **WHEN** a capability is normalised, **THE SYSTEM SHALL** filter `snippet-catalog-data.json` entries by `serviceKey`, substitute `{HOST, PORT, RESOURCE_NAME, RESOURCE_EXTRA_A, RESOURCE_EXTRA_B, REALTIME_ENDPOINT, WORKSPACE_ID, CHANNEL_TYPE}` placeholders in `codeTemplate`, and return `{serviceKey, category, label, endpoint, port, resourceName, snippets[]}` (`:35-67`).
- **WHEN** a capability's `serviceKey` is `'webhooks'`, **THE SYSTEM SHALL** force endpoint to `${baseUrl}/v1/webhooks`; for `'scheduling'`, `${baseUrl}/v1/schedules`; else the capability's own endpoint/host/url field or baseUrl (`:40-44`).
- **WHEN** `realtimeEndpoint` is absent, **THE SYSTEM SHALL** default to `baseUrl.replace(/^http/, 'ws')` (`:29`).

### S6. Rotation procedure section

- **WHEN** `buildRotationProcedureSection(workspaceContext)` runs, **THE SYSTEM SHALL** return a hard-coded Markdown string interpolating `baseUrl ?? 'https://api.example.test'` into 14 example URLs and a console URL (`src/rotation-procedure-section.mjs:1-59`).

### S7. Persistence schema

- **WHEN** the migration runs, **THE SYSTEM SHALL** create `workspace_docs_service.workspace_doc_notes(id UUID PK, tenant_id TEXT NN, workspace_id TEXT NN, content TEXT NN, author_id TEXT NN, created_at TIMESTAMPTZ NN DEFAULT now(), updated_at TIMESTAMPTZ NN DEFAULT now(), deleted_at TIMESTAMPTZ)` with a partial index on `(tenant_id, workspace_id) WHERE deleted_at IS NULL` (`migrations/087-workspace-doc-notes.sql:3-16`).
- **WHEN** the migration runs, **THE SYSTEM SHALL** create `workspace_docs_service.workspace_doc_access_log(workspace_id TEXT NN, actor_id TEXT NN, access_date DATE NN DEFAULT current_date, PRIMARY KEY (workspace_id, actor_id, access_date))` plus an index on the same triple (`:18-26`).

---

## GAPS

### G-cross. Cross-cutting

1. **Identity trusted from `params.auth`.** `actions/workspace-docs.mjs:27-32`. Same upstream-trust pattern as F3/H1/I1/J1: any `auth` object satisfying `{tenantId, workspaceId, actorId}` passes. No JWT signature check.
2. **`WORKSPACE_DOCS_DB_URL` and `KAFKA_BROKERS` have empty-string fallbacks.** `config.mjs:11-12`. Dev startup succeeds; first DB/Kafka call fails. Compare with J1's production-only check.
3. **No quota or rate limit** on note creation or update. A workspace admin can create unlimited notes; `listNotes` returns ALL of them on every `GET /docs`.
4. **`capability-catalog-builder.mjs` lives in this package but is consumed cross-service.** Imported by `services/provisioning-orchestrator/src/actions/workspace-capability-catalog.mjs:1` (see C2 audit, B5). Layering smell flagged there; not repeated here.
5. **Cross-service import of `snippet-catalog-data.json`.** `src/snippet-context-builder.mjs:1` imports `'../../internal-contracts/src/snippet-catalog-data.json'`. The same JSON is also imported by `capability-catalog-builder.mjs` and used by C2's catalog endpoint. Two consumers, one source.

### G-S2. Action entry

- **G-S2.1** `ensureVersion` accepts missing `X-API-Version` (only rejects if explicitly set to a different value) (`:34-40`). Compare with C2 / J1 which require the version. Inconsistent client contract.
- **G-S2.2** `correlationId` defaults to literal `'corr-missing'` (`:69`). All requests without the header share this id in audit. Same pattern as C2's B2.
- **G-S2.3** Unmatched routes return `501 NOT_IMPLEMENTED` (`:119`). Most APIs would return `404`; `501` implies "we plan to support this".
- **G-S2.4** Path matching uses unanchored regex (e.g., `/\/docs$/.test(path)`). `/foo/docs` would match. Probably OK if upstream gateway normalises; no defence in this code.
- **G-S2.5** No `GET /docs/notes/{id}` handler — only the bulk doc retrieval includes notes.

### G-S3. Doc retrieval

- **G-S3.1** Graceful-degradation branch (`:68-84`) reads `listNotes(db, ...)` from DB without re-checking that the upstream timeout was not an auth failure. Notes are returned even if the upstream is failing because of an authentication issue.
- **G-S3.2** `rotationProcedureSection` is rendered with `baseUrl ?? ''` in the stale branch (`:77-81`); the resulting markdown contains URLs like `/v1/...` (no host), unusable for copy-paste.
- **G-S3.3** 2-second timeout (`:40-41`) is hard-coded. No env override.
- **G-S3.4** `withTimeout` (`:5-23`) creates a timer that does not `unref`. Inside an OpenWhisk activation, that's fine (the activation ends when the handler returns), but in a long-lived process it would block exit.
- **G-S3.5** `assembleWorkspaceDocs` calls `internalClient.getApiSurface(workspaceId, ctx)` — but **`internalClient` is supplied by the caller and may be missing those methods.** If undefined, `withTimeout(undefined)` would throw "promise.then is not a function" → caught at outer `catch` → re-thrown as 500. Generic error path swallows the specific cause.
- **G-S3.6** `enabledServices` is an unbounded list of records; no truncation if upstream returns thousands.
- **G-S3.7** `customNotes` list is unbounded; no pagination on `listNotes` (`note-repository.mjs:44-54`). A workspace with 10k notes returns a multi-MB doc.

### G-S4. Notes

- **G-S4.1** `note-sanitiser.mjs:6-12` does a **single-pass** HTML entity decode. A doubly-encoded payload like `&amp;lt;script&amp;gt;` becomes `&lt;script&gt;` after one pass; the tag regex doesn't fire (still escaped); the stored note is XSS-safe within a text-rendering context but a downstream that decodes again can recover `<script>`. See B1.
- **G-S4.2** Only 3 HTML entities decoded (`&lt;`, `&gt;`, `&amp;`). Numeric (`&#60;`, `&#x3c;`) and named (`&quot;`, `&nbsp;`) entities pass through. If a consumer renders the field as HTML, they decode and may bypass the tag-strip.
- **G-S4.3** Tag-stripping regex `/<[^>]+>/g` (`:12`) doesn't handle quoted attributes with `>`. A tag like `<a href="x>y">malicious</a>` is partially stripped — the regex matches `<a href="x>` (stops at first `>`) and leaves `y">malicious</a>` in the cleaned text. Low impact for plain-text rendering.
- **G-S4.4** `cleaned.length > WORKSPACE_DOCS_NOTE_MAX_LENGTH` (`:14`) checks UTF-16 code units, not bytes. A 4096-char note of 4-byte emoji is ~16 KB. Postgres `TEXT` accepts it, but if downstream has a byte-length cap it slips through.
- **G-S4.5** `INVALID_NOTE_CONTENT` is the same error code for both "empty" and "too long" (`:14-17`). Callers can't distinguish.
- **G-S4.6** `updateNote` / `softDeleteNote` (`note-repository.mjs:22-42`) re-validate via `tenant_id + workspace_id + id` — good tenant isolation. But the GET path on the assembler is only via `listNotes(tenant, workspace)` — no per-note read.
- **G-S4.7** `noteIdFromPath` (`:46-49`) does no UUID validation. Whatever string follows `/notes/` is passed to the SQL with `id = $3`. PG will reject malformed UUIDs at the cast layer with an error caught by the outer `catch` → 500 (not 400).

### G-S5. Snippets

- **G-S5.1** `SERVICE_META` (`:3-11`) is a closed list of 7 service keys. A capability with a new `serviceKey` is silently dropped (`:38: if (!meta) return null`).
- **G-S5.2** Webhooks endpoint hardcoded to `/v1/webhooks` and scheduling to `/v1/schedules`. Independent of any catalog mapping. If the public API moves those routes, the snippets break.
- **G-S5.3** `realtimeEndpoint` defaults to `baseUrl.replace(/^http/, 'ws')`. If `baseUrl` is `https://api.example.com`, the result is `wss://api.example.com` — and the snippet asks the client to connect to the API host, not the dedicated realtime host. The F2 audit established that realtime traffic should land on a separate hostname.
- **G-S5.4** All snippets are emitted regardless of the workspace's plan tier. There's no plan-aware filtering of code samples (e.g., showing JS only if a JS SDK is generated).

### G-S6. Rotation procedure

- **G-S6.1** The rotation markdown is hard-coded and references specific operation IDs / paths. If those paths change, the doc becomes stale.
- **G-S6.2** Example values (`wrk_123`, `svc_123`, `usr_123`, `idem_rotate_123`) are literal placeholders. Customers copy-pasting will use these literal ids unless they substitute.
- **G-S6.3** Console URL falls back to `https://api.example.test/console/service-accounts` — visible to customers.

### G-S7. Audit

- **G-S7.1** `recordAccess` (`doc-audit.mjs:1-29`) inserts and emits, in that order. If the Kafka send throws, the access row is committed but no event fires. Same pattern as F3 B7.
- **G-S7.2** Default `tenantId: 'unknown'` (`:1`) — if the caller forgets to pass tenantId, audit records `'unknown'`. The action *always* passes `ctx.tenantId` (`actions/workspace-docs.mjs:85`), but the default is a foot-gun if any other caller invokes the helper.
- **G-S7.3** Access dedup is daily by UTC date. A user in UTC-12 accessing at 23:00 local sees their access logged twice in two adjacent "days".
- **G-S7.4** Topic is hard-coded to `'console.audit'`. No env override.

### G-DB

- **G-DB.1** `migration` uses `SET search_path TO workspace_docs_service` (`:1`). This is a session-scoped change; if the migration runner doesn't run in a fresh session, subsequent migrations may pollute the wrong schema. Per-statement `workspace_docs_service.` prefix would be safer.
- **G-DB.2** `workspace_doc_notes` lacks `CHECK (LENGTH(content) <= …)` — server-side enforcement of max length absent. Relies entirely on the sanitiser at the action layer.
- **G-DB.3** No FK on `workspace_id` / `tenant_id` — but those are TEXT, so no obvious target table from this migration alone.
- **G-DB.4** `workspace_doc_notes` has no `(tenant_id, workspace_id, deleted_at)` partial index for the listNotes query. The existing partial index at `:14-16` is on `(tenant_id, workspace_id)` only — fine for the WHERE filter but doesn't accelerate the ORDER BY `created_at ASC`. Sequential scan on large workspaces.

---

## BUGS

### Confirmed (verified-by-author from cited lines)

- **B1. Single-pass HTML entity decoding leaks double-encoded payloads.**
  `services/workspace-docs-service/src/note-sanitiser.mjs:6-12` (verified-by-author). The sanitiser does `.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')` then strips tags. A payload `&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;` decodes after one pass to `&lt;script&gt;alert(1)&lt;/script&gt;`. The tag regex doesn't match (no literal `<`/`>`), so the stored note is `&lt;script&gt;alert(1)&lt;/script&gt;`. **A consumer that HTML-decodes again at render time recovers an executable `<script>` tag.** Whether exploitable depends entirely on the rendering layer; the sanitiser itself does not defend against the double-encoded case.

- **B2. `noteIdFromPath` returns whatever string follows `/notes/`; no UUID validation.**
  `actions/workspace-docs.mjs:46-49` (verified-by-author). `update`/`softDelete` then pass the string to a parameterised SQL with `id = $3`. PG casts to UUID and throws a "invalid input syntax for type uuid" error which the outer `catch` (`:120-131`) maps to `500 INTERNAL_ERROR`. The correct response is `400 INVALID_NOTE_ID`.

- **B3. `correlationId` falls back to literal `'corr-missing'`.**
  `actions/workspace-docs.mjs:69` (verified-by-author). Every request without the header shares the same string in audit. Same defect as C2 B2.

- **B4. `recordAccess` default `tenantId: 'unknown'`.**
  `src/doc-audit.mjs:1` (verified-by-author). The action always passes a real tenantId (`:85`), but the helper's default is a foot-gun if any other caller invokes it.

- **B5. `withTimeout` swallows the late-arriving upstream value.**
  `src/doc-assembler.mjs:5-23` (verified-by-author). Once the 2-second timer fires and rejects, the upstream promise's eventual resolve/reject is consumed by `.then`/`.catch` which call `clearTimeout` but do nothing else. The real response is discarded. Inside OpenWhisk that's acceptable; in a long-lived process it leaks the upstream's connection until the underlying timeout.

- **B6. Graceful-degradation path falls through to `listNotes` even if the upstream timeout was an auth failure.**
  `src/doc-assembler.mjs:68-83` (verified-by-author). The catch branch matches any error whose `code === 'UPSTREAM_UNAVAILABLE'` or `statusCode === 503`. A 503 from the upstream because the caller's bearer token is malformed would also flow into this branch, returning the customer's notes anyway.

- **B7. `enabledServices` and `customNotes` are returned without pagination.**
  `src/doc-assembler.mjs:44, :45` (verified-by-author) and `note-repository.mjs:44-54`. A workspace with 10k notes or 100s of capabilities yields a multi-MB response.

- **B8. Unmatched routes return 501 instead of 404.**
  `actions/workspace-docs.mjs:119` (verified-by-author). `NOT_IMPLEMENTED` implies the route is planned; 404 would be standard for an unknown path.

- **B9. `X-API-Version` is optional.**
  `actions/workspace-docs.mjs:34-40` (verified-by-author). Rejects only if explicitly mismatched; missing header is silently accepted. Compare with C2/J1 which require the pin.

- **B10. `webhooks` and `scheduling` snippet endpoints hard-coded.**
  `src/snippet-context-builder.mjs:40-44` (verified-by-author). `${baseUrl}/v1/webhooks` and `${baseUrl}/v1/schedules`. If the public API moves those routes (F3 uses `/v1/webhooks/subscriptions` per its audit), the snippet's bare path is wrong.

- **B11. `realtimeEndpoint` defaults to API hostname.**
  `src/snippet-context-builder.mjs:29` (verified-by-author). `baseUrl.replace(/^http/, 'ws')` substitutes scheme but not host. The F2 audit established the realtime surface lives on `realtime.dev.in-falcone.example.com`, not the API host. Snippets point at the wrong host unless `capability.realtimeEndpoint` is explicitly supplied.

- **B12. Empty-string fallbacks for required env vars at module load.**
  `src/config.mjs:11-12` (verified-by-author). `WORKSPACE_DOCS_DB_URL` and the `KAFKA_BROKERS` list default to `''`/`[]`. Production runs without the env vars succeed at startup; first DB/Kafka call fails.

### Likely (smells / fragile patterns)

- **B13. Only 3 HTML entities decoded; numeric & named entities (`&#60;`, `&quot;`, `&nbsp;`) pass through to storage.**
  `note-sanitiser.mjs:8-10`. A consumer rendering as HTML may decode them and bypass the tag-strip.

- **B14. Tag-stripping regex doesn't handle `>` in attribute values.**
  `note-sanitiser.mjs:12`. `<a href="x>y">payload</a>` partially stripped to `y">payload</a>`. Low-impact for plain text rendering.

- **B15. `cleaned.length > MAX_LENGTH` counts UTF-16 code units.**
  `note-sanitiser.mjs:14`. 4-byte emoji count as 2 each; a 4096-char note can be ~16 KB.

- **B16. `INVALID_NOTE_CONTENT` ambiguous between "empty" and "too long".**
  `note-sanitiser.mjs:14-17`. Same code, two semantic cases.

- **B17. Path matching uses unanchored regex.**
  `actions/workspace-docs.mjs:79, :89, :97, :108`. `/foo/docs/notes/abc` would match handlers intended for `/docs/notes/abc`.

- **B18. `setSearchPath` in migration affects session state.**
  `migrations/087-workspace-doc-notes.sql:1` — `SET search_path TO workspace_docs_service`. The runtime queries explicitly schema-qualify (`workspace_docs_service.workspace_doc_notes`), so the search_path is incidental. But the migration runner inherits the session change; subsequent migrations could be affected.

- **B19. `recordAccess` Kafka emit is non-transactional with the access-log INSERT.**
  `doc-audit.mjs:1-26`. The INSERT commits before the Kafka send; a Kafka outage logs the access in DB without emitting the event. Same pattern as F3 B7 and J1 B10.

- **B20. `assembleWorkspaceDocs` assumes `internalClient` has `.getApiSurface` and `.getEffectiveCapabilities` methods.**
  `doc-assembler.mjs:40-41`. If absent, the resulting TypeError is caught by the outer try and returned as `500 INTERNAL_ERROR`. No structured `INTERNAL_CLIENT_MISCONFIGURED` code.

- **B21. `listNotes` ORDER BY `created_at ASC` is not covered by the existing partial index.**
  Migration `:14-16` indexes `(tenant_id, workspace_id) WHERE deleted_at IS NULL`. The query at `note-repository.mjs:44-54` adds `ORDER BY created_at ASC` requiring a sort. Workspaces with thousands of notes pay an in-memory sort cost.

- **B22. The 2-second `withTimeout` ceiling is not configurable.**
  `doc-assembler.mjs:5-23`. Operators cannot tune it per environment.

- **B23. `rotationProcedureSection` baseUrl fallback `'https://api.example.test'` ships to customers in the stale branch.**
  `rotation-procedure-section.mjs:2`. Combined with B7's stale-branch behaviour, customers may see `https://api.example.test/...` URLs in their docs.

### Needs verification

- **B24. Whether any consumer of `notes.content` renders as HTML.** If yes, B1 + B13 are real XSS vectors.
- **B25. Whether `internalClient` is supplied by the OpenWhisk wrapper or by a test harness.** Source doesn't show the wiring; B20 hinges on this.
- **B26. Whether the `console.audit` topic is consumed by any audit pipeline.** Topic name is generic; no consumer in source.
- **B27. Whether the `capability-catalog-builder.mjs` consumed by C2 is also reachable from K1's main code path.** It's exported but the action handler imports `doc-assembler` instead. Confirm by grep within the package.

---

## Scope note for downstream spec authoring

K1 is among the simplest and best-tested action services in the audit — clean state machine, real test wiring, defensive timeout-and-degrade behaviour. Five items to address before formalising FRs:

1. **B1 — Note sanitiser leaks double-encoded HTML.** Either run the entity decode in a loop until stable, or use a tested HTML sanitiser library (`sanitize-html`, etc.). Today's hand-rolled implementation invites consumer-rendering bugs.
2. **B2 — UUID validation on note ids.** `400 INVALID_NOTE_ID` is the right response for malformed ids, not `500`.
3. **B11 — Realtime endpoint default is wrong.** Either remove the default (require explicit `capability.realtimeEndpoint`) or wire it from a documented config field.
4. **B7 — Pagination on `customNotes` and `enabledServices`.** Today's "return everything" pattern doesn't scale.
5. **B12 — Make required env vars actually required.** Mirror J1's production-only check or unconditionally fail at startup.

Secondary cleanup: B3 (correlationId fallback), B4 (`recordAccess` default tenantId), B8 (501 → 404 for unknown routes), B9 (X-API-Version policy aligned across capabilities), B10 (webhooks/scheduling endpoint construction), B17 (anchored path regex), B19 (transactional access-log + Kafka), B21 (compound index for listNotes ORDER BY). After those, K1 is a clean candidate for OpenSpec FR formalisation.
