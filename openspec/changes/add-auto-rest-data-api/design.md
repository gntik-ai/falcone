# Design — add-auto-rest-data-api

## Goals

1. A browser SDK can do `client.from("posts").select("id,title").eq("published",true)`
   and reach Postgres in one round trip with RLS as the security boundary.
2. Tenants opt in tables explicitly; nothing is exposed by default.
3. The filter dialect is byte-for-byte compatible with PostgREST's documented operators,
   so the Supabase JS client (or any PostgREST client) works against Falcone without
   modification.
4. No SQL injection surface — every filter expression is parsed to an AST and lowered to
   parameterised SQL with allowlisted operators only.
5. Performance comparable to a hand-written endpoint at p99: < 30 ms overhead on top of
   the underlying SELECT.

## Non-goals

- **GraphQL.** Tracked separately as `add-graphql-endpoint`; the two surfaces will share
  the same exposure controls and policy authoring.
- **Logical replication-based realtime subscriptions to data-API rows.** Already covered
  by [[realtime-and-events]] D2/F1. The data API publishes the *contract* (filter
  syntax, JWT companion semantics) that realtime channels reuse.
- **Stored-procedure authoring UI.** RPC invocation only; authoring lives in
  [[data-services]] D1 admin.

## Why PostgREST-compatible

Three reasons:

1. **Free SDKs.** `supabase-js`, `postgrest-js`, `postgrest-py`, `supabase-flutter`, etc.
   all speak this dialect. Compatibility means Falcone gets a mature client ecosystem
   day one instead of waiting for SDKs to be written.
2. **Documented surface.** The dialect is a *small, finite, public* contract that's been
   battle-tested for years — we don't have to invent a query language.
3. **Migration path in/out.** Customers can move workloads between Supabase and Falcone
   without rewriting client code. This is a sales differentiator.

We are not adopting PostgREST the binary — we are adopting only its **REST contract**.
The implementation is our own Node adapter so we keep the operational surface uniform
with the rest of Falcone (same logging, same audit, same metrics, same RBAC).

## Filter compiler

A tiny recursive-descent parser over the documented operator set, producing an AST
that's lowered to a parameterised `pg-format` SQL fragment:

```
?filter=age=gt.18,or(name=ilike.*alice*,role=eq.admin)
   ↓ parse
And [ Cmp("age", Gt, 18),
      Or  [ Cmp("name", ILike, "%alice%"),
            Cmp("role", Eq,   "admin") ] ]
   ↓ lower
"age" > $1 AND ("name" ILIKE $2 OR "role" = $3)
```

Column identifiers are quoted via `pg.escapeIdentifier`; values flow through `$N`
parameters; operator tokens map to a finite enum. No string interpolation, ever.

The parser is extracted as `services/adapters/src/postgres-filter-parser.mjs` with
property-based tests (fast-check) seeded by the PostgREST test suite vectors.

## RLS as the security boundary

The data API never sees a user identity directly. It receives `x-falcone-*` headers from
the gateway plugin and translates them into `SET LOCAL` statements at the start of every
transaction:

```sql
BEGIN;
SET LOCAL ROLE        = 'anon' | 'authenticated' | 'service_role';
SET LOCAL request.jwt.claims = '<json>';   -- only when end-user JWT present
SET LOCAL request.tenant_id  = '<uuid>';
SET LOCAL request.workspace_id = '<uuid>';
-- ... query ...
COMMIT;
```

The `service_role` Postgres role is `BYPASSRLS`; the `anon` and `authenticated` roles
are not. Policies tenants write via the policy authoring API are conventional
`CREATE POLICY` statements that reference these GUCs:

```sql
CREATE POLICY "users see own posts" ON posts FOR SELECT TO authenticated
  USING (author_id = (current_setting('request.jwt.claims', true)::jsonb)->>'sub');
```

This is the same shape Supabase uses, so the policy patterns developers already know
transfer directly.

## Exposure model

```sql
CREATE TABLE exposed_data_entities (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL,
  workspace_id   uuid NOT NULL,
  db_name        text NOT NULL,
  schema_name    text NOT NULL,
  entity_name    text NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('table','view','function')),
  operations     text[] NOT NULL DEFAULT '{select}',
  allow_anon     boolean NOT NULL DEFAULT false,
  max_rows       integer NOT NULL DEFAULT 1000,
  column_select  text[],     -- NULL = all
  column_insert  text[],
  column_update  text[],
  created_by     uuid NOT NULL,
  created_at     timestamptz NOT NULL,
  updated_at     timestamptz NOT NULL,
  UNIQUE (workspace_id, db_name, schema_name, entity_name)
);
```

The data API consults a Redis-cached view of this table at request-routing time. Misses
fall back to Postgres. Exposing/unexposing emits a Kafka event so the SDK generator
([[gateway-and-public-surface]]) can rebuild the per-workspace OpenAPI.

## Pagination

- `limit` capped per row at `min(plan.data_api.max_rows_per_request, exposed_entity.max_rows)`,
  default `1000`.
- `Range` and `Content-Range` headers returned (PostgREST-compatible).
- Keyset pagination via `cursor=<opaque>` (base64url of the last row's PK + sort key);
  preferred over offset for tables > 10k rows because offset is O(n).

## Cost / hot-path budget

Target p99 per request, excluding actual SQL execution:

| Stage | Budget |
| --- | --- |
| Gateway plugin (api-key resolve) | 2 ms |
| Route to data-api service | 1 ms |
| Exposure check (Redis hit) | 1 ms |
| Parse + lower filter | 3 ms |
| Open pooled txn + SET LOCAL | 5 ms |
| **Total adapter overhead** | **≤ 12 ms** |

If a request misses the exposure cache and hits Postgres, the budget grows by ~5 ms; the
cache TTL is 60 s with pub/sub invalidation.

## Decision: where do filter compilation and exposure live

| Option | Pros | Cons |
| --- | --- | --- |
| **A. New `services/data-api/`** | Clear bounded context. | Yet another service. |
| **B. Extend `services/adapters/src/postgresql-data-api.mjs`** | Reuses pooling, RBAC, logging. | Adapter package grows. |

**Recommendation: B.** The data API is a thin façade over the same connection pool,
and the existing `postgresql-data-api.mjs` is the right home for both the generic and
the table-scoped surface. Re-evaluate if `/v1/data/...` accumulates more than ~2k LoC.

## Open questions

- **Q-DAT-AR-01.** Should `Prefer: count=exact|estimated` be honoured on `GET`? Required
  for total-row UI badges. Lean **yes**; default `count=estimated` from `pg_class.reltuples`
  to avoid the `SELECT count(*)` cost trap.
- **Q-DAT-AR-02.** Should we expose a `?embed=` join syntax (PostgREST-style relations)?
  High value for SDK ergonomics but increases parser surface 3x. Lean **defer** to a
  follow-up `harden-data-api-embeds` proposal.
- **Q-DAT-AR-03.** What is the canonical name for the per-table "exposure" concept in the
  UI? PostgREST calls these "exposed schemas / functions"; Supabase calls the toggle
  "Enable Realtime / API". Lean toward **"published"** (`POST .../publish` instead of
  `PUT .../exposed-tables/...`) to align with industry vocabulary.
