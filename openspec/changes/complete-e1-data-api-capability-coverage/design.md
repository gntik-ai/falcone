## Goals

1. Make `services/adapters/src/mongodb-data-api.mjs` discoverable through
   the same façade/contract pattern as `mongodb-admin.mjs`, so audit
   consumers, the console, and contract validators can enumerate the
   data-plane CRUD surface they already depend on.
2. Capture the capability under `data-services` so subsequent OpenSpec
   work (bug fixes, audits) can be routed to a real capability slug
   instead of being filed against the admin capability by mistake.

## Non-goals

- **Re-implementing any of the 2543 LOC.** The adapter ships as-is.
- **Auditing the adapter for bugs.** A separate Phase-2 audit file
  (`cap-e1b-mongo-data-api.md`) would do that.
- **Splitting the OpenAPI family file.** The Mongo admin and data-API
  operations live in one family file under one schema namespace; only
  tags and operation paths are added here.

## Why a separate façade rather than extending mongo-admin

`apps/control-plane/src/mongo-admin.mjs` exports its surface specifically
for the admin contract (`mongoAdminRequestContract`,
`mongoAdminResultContract`, `mongoAdminEventContract`). The data-API
adapter has a fundamentally different event contract — it emits per-record
CRUD events, not per-admin-action events — and a different result shape
(documents/cursors vs. validation envelopes). Bundling them would force
every consumer to filter on `family=='mongo'` then re-split by op type;
keeping façades parallel matches the existing `iam-admin.mjs` /
`postgresql-data-api.mjs` split.

## The capability-map gap

The Phase-1 capability map was authored before the data-API adapter
existed at its current size. The audit found:

> `services/adapters/src/mongodb-data-api.mjs` (2543 LOC, 89 KB) is the
> analogous data-plane CRUD adapter. The map's D1 entry bundled the
> PostgreSQL admin and data-API adapters under one capability; the
> equivalent Mongo data-API is *not* surfaced in any capability map
> entry.

Adding it under `data-services` (where `data-services` already houses
the Postgres data-API as part of D1) preserves the convention. A future
split into a dedicated `mongo-data-services` capability is possible but
the current single-cap model matches D1.

## What "complete" means here

The data-API adapter already has internal validators, normalisers, and
event factories. "Complete" in this proposal means the *capability
surface* is complete — the contracts are exported, the OpenAPI tag
exists, the façade is callable, and `summarizeMongoDataApiSurface`
returns useful output. It does NOT mean the adapter has zero bugs or
that every internal helper is documented.

## Out-of-scope notes

The audit's headline scope note (option to split E1 into E1a/E1b/E1c)
is acknowledged but not acted on here; this change makes E1b
discoverable without renaming E1 or restructuring the capability map.
