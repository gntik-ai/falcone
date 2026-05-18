## Why

`services/adapters/src/mongodb-data-api.mjs` — 2543 LOC, 89 KB — sits next
to `mongodb-admin.mjs` and is the analogous data-plane CRUD adapter for
Mongo, but it is **not mapped to any capability** in the OpenSpec catalogue.
The D1 entry bundles PostgreSQL admin and data-API adapters under one
capability; the equivalent Mongo data-API has no E1' or E3 entry. From
`openspec/audit/cap-e1-mongodb-admin.md`:

- **G1 (cross-cutting)** — `mongodb-data-api.mjs` (2543 LOC) is not in any
  capability-map entry. The Phase-2 audit explicitly flagged this as a
  capability-map gap and constrained its own scope to E1 (admin only). The
  data-API adapter is therefore untracked: no spec governs its surface, no
  proposal exists for its bugs, and any consumer treating the capability
  map as the source of truth misses 100% of the data-plane CRUD path.

This proposal does not implement new code. It adds the data-API adapter to
`data-services` as a tracked surface so that subsequent `fix-`/`harden-`
proposals can target it through normal OpenSpec workflow.

## What Changes

- Add a `mongoDataApiRequestContract`, `mongoDataApiResultContract`, and
  `mongoDataApiEventContract` re-export in `apps/control-plane/src/mongo-data-api.mjs`
  (new façade file mirroring the existing `mongo-admin.mjs` shape) that
  surface what the 2543-LOC adapter already does: CRUD ops (find/insert/
  update/delete/aggregate), bulk-write, transactions, change-stream init.
- Add the `mongo-data-api` family to
  `apps/control-plane/openapi/families/mongo.openapi.json` documenting the
  request/response shapes that the adapter already validates internally.
- Add a `summarizeMongoDataApiSurface(context)` aggregator on the façade
  matching the `summarizeMongoAdminSurface` pattern, so console and
  audit-pipeline consumers can discover the surface.
- Record the capability in the OpenSpec capability map under `data-services`
  with the same scope semantics as Mongo Admin (compiler/validator, no
  driver code).

## Capabilities

### Modified Capabilities

- `data-services`: Mongo data-API compiler/validator capability surface,
  contract exports, and the capability-map entry.

## Impact

- **Affected code**: `apps/control-plane/src/mongo-data-api.mjs` (new
  façade — 50-100 LOC), `apps/control-plane/openapi/families/mongo.openapi.json`
  (new tag and operation entries), `apps/control-plane/src/index.mjs`
  (re-export added).
- **Migration required**: none — the underlying 2543-LOC adapter ships
  unchanged. This proposal makes its surface discoverable.
- **Breaking changes**: none — the existing adapter remains callable as
  today; this proposal adds a documented entry-point alongside it.
- **Out of scope**: rewriting any of the 2543 LOC; fixing bugs in
  `mongodb-data-api.mjs` (a separate Phase-2 audit `cap-e1b-mongo-data-api.md`
  would generate dedicated `fix-`/`harden-` proposals).
