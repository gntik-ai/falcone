## Why

The workspace-docs action's request dispatching layer matches paths
loosely, returns the wrong HTTP code for unknown routes, and forwards
unvalidated note ids into SQL. From
`openspec/audit/cap-k1-workspace-docs-service.md`:

- **B2** (`actions/workspace-docs.mjs:46-49`) — `noteIdFromPath` returns
  whatever string follows `/notes/`; PG rejects the malformed UUID with
  `invalid input syntax for type uuid`, which the outer catch maps to
  `500 INTERNAL_ERROR` instead of `400 INVALID_NOTE_ID`.
- **B8** (`actions/workspace-docs.mjs:119`) — unmatched routes return
  `501 NOT_IMPLEMENTED`; the canonical response for an unknown path is
  `404 NOT_FOUND`.
- **B17** (`actions/workspace-docs.mjs:79, :89, :97, :108`) — path
  matching uses unanchored regex (`/\/docs$/.test(path)`); inputs like
  `/foo/docs/notes/abc` match handlers intended for `/docs/notes/abc`.
- **G8** (`G-S2.3`) — `501` is semantically wrong for unknown routes
  (same as B8, raised to requirement).
- **G9** (`G-S2.4`) — unanchored regex matching is a defence-in-depth
  failure (same as B17, raised to requirement).
- **G18** (`G-S4.7`) — `noteIdFromPath` does no UUID validation; cited
  same line range as B2.

## What Changes

- Add UUID validation in `noteIdFromPath`; return `400 INVALID_NOTE_ID`
  for malformed values before any SQL is issued.
- Change the unmatched-route response from `501 NOT_IMPLEMENTED` to
  `404 NOT_FOUND` at `actions/workspace-docs.mjs:119`.
- Anchor every path regex with `^` and `$`, or migrate to a router that
  parses paths structurally (`/docs/notes/:id`).
- Add a route-table test covering the matrix of `/docs`,
  `/docs/notes`, `/docs/notes/{id}`, and known unknowns.

## Capabilities

### Modified Capabilities

- `workspace-management`: requirements on note-id validation, unknown-
  route response code, and exact-path route matching.

## Impact

- **Affected code**: `services/workspace-docs-service/actions/workspace-docs.mjs`.
- **Migration required**: none.
- **Breaking changes**: clients that polled unknown paths and observed
  `501` will see `404`; clients that exploited the unanchored regex (if
  any) will receive `404`.
- **Cross-cutting**: error budgets / alerting that key on `500
  INTERNAL_ERROR` for invalid UUIDs will see those errors disappear.
