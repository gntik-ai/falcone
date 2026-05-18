## Why

The workspace-docs assembler has four orthogonal correctness defects in
the timeout helper, the degradation branch, the response sizing, and the
assumed shape of `internalClient`. From
`openspec/audit/cap-k1-workspace-docs-service.md`:

- **B5** (`src/doc-assembler.mjs:5-23`) — `withTimeout` swallows the
  upstream's eventual value once the timer fires; the connection leaks
  until the underlying socket timeout.
- **B6** (`src/doc-assembler.mjs:68-83`) — the graceful-degradation
  branch catches any error with `code === 'UPSTREAM_UNAVAILABLE'` or
  `statusCode === 503`, including auth-failure 503s; customer notes are
  returned even when the upstream is failing for an auth reason.
- **B7** (`src/doc-assembler.mjs:44, :45` and `note-repository.mjs:44-54`)
  — `enabledServices` and `customNotes` are returned without pagination;
  a workspace with 10k notes yields a multi-MB response.
- **B20** (`doc-assembler.mjs:40-41`) — assumes `internalClient` has
  `.getApiSurface` and `.getEffectiveCapabilities`; missing methods
  surface as generic `500 INTERNAL_ERROR` instead of a structured
  `INTERNAL_CLIENT_MISCONFIGURED` code.
- **G11** (`G-S3.1`) — graceful-degradation reads `listNotes` from DB
  without re-checking the upstream timeout cause (same as B6, raised).
- **G13** (`G-S3.3`) — 2s timeout hardcoded; no env override.
- **G14** (`G-S3.4`) — `withTimeout` timer does not `unref`.
- **G15** (`G-S3.5`) — missing `internalClient` methods yield generic
  500 (same as B20, raised).
- **G16** (`G-S3.6`/`G-S3.7`) — `enabledServices` and `customNotes`
  unbounded (same as B7, raised).

## What Changes

- Rewrite `withTimeout` so the upstream promise is properly settled or
  cancelled when the timer fires; clear the timeout via `.finally` and
  expose an `AbortSignal` to the caller so the underlying HTTP request
  can be aborted.
- Tighten the degradation branch to require BOTH `UPSTREAM_UNAVAILABLE`
  and a non-auth root cause; an auth failure MUST propagate as 401/403.
- Add server-side pagination on `customNotes` (default 50, max 200) and
  cap `enabledServices` at a configurable maximum; expose `nextPageToken`.
- Validate at assembler entry that `internalClient` exposes both required
  methods; throw `INTERNAL_CLIENT_MISCONFIGURED` (500) with the method
  list missing.
- Make the timeout configurable via `WORKSPACE_DOCS_UPSTREAM_TIMEOUT_MS`
  (default 2000).

## Capabilities

### Modified Capabilities

- `workspace-management`: requirements on upstream-timeout cancellation,
  degradation-branch correctness, pagination of bulk responses, and
  internal-client method contract.

## Impact

- **Affected code**: `services/workspace-docs-service/src/doc-assembler.mjs`,
  `services/workspace-docs-service/src/note-repository.mjs`,
  `services/workspace-docs-service/src/config.mjs`.
- **Migration required**: none.
- **Breaking changes**: `GET /docs` response now includes
  `nextPageToken` and may not return all notes in one call; clients must
  paginate. Existing degradation behaviour for auth failures changes to
  propagate 401/403.
- **Cross-cutting**: long-lived processes embedding the assembler no
  longer leak per-call timers.
