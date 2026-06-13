## 1. Per-resource generators

- [x] 1.1 `generateFromPostgresSchema(serverId, schema)` → per table: read `query_<table>` (filterable, input schema from columns) + mutating `insert_<table>`, targeting the RLS-bound data API
- [x] 1.2 `generateFromFunctions(serverId, functions)` → `invoke_<fn>` per function (`/v1/functions/{id}/invoke`)
- [x] 1.3 `generateFromStorage(serverId, buckets)` → object get/put/delete (`/v1/objects/{bucket}/{key}`)
- [x] 1.4 `generateFromEvents(serverId, topics)` → `publish_event` / `subscribe_events`
- [x] 1.5 Extensible `GENERATORS` registry keyed by resource type

## 2. Dispatcher + draft manifest

- [x] 2.1 `generateInstantManifest(serverId, resources)` → `{ status: 'draft', requiresCuration: true, tools }`; each tool has name, LLM description, inputSchema, `mutates`, suggested scope, `source`
- [x] 2.2 Deterministic + idempotent (stable order/names; same input → same manifest)

## 3. Verify

- [x] 3.1 Unit tests: schema → query tools (column-derived schema); functions/storage/events tools; mutating flags + suggested scopes; manifest is draft+requiresCuration; determinism
- [x] 3.2 `pnpm lint` + `openspec validate --strict` pass

## 4. Finalize

- [x] 4.1 Confirm the generator cannot emit a published manifest (always draft) and that data tools target the RLS-bound path
