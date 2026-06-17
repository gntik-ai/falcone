Tracking issue: gntik-ai/falcone#492

## Why

Control-plane Knative function routes are declared `auth:'authenticated'` with no tenant scope, and `getFnAction(pool, resourceId)` has no `tenant_id` predicate. Any authenticated principal can therefore invoke or read any tenant's function — including its inline source and activation logs — by guessing or enumerating `resourceId`.

(Evidence: `tests/live-audit/evidence/06-functions-events.md` — route authz plus the unscoped query.)

## What Changes

- Add a `tenant_id` predicate to function lookups (`getFnAction` and related queries).
- Add an ownership check on the invoke, get, and activations routes so a principal can only act on functions belonging to its own tenant.

## Capabilities

### New Capabilities

### Modified Capabilities

- `functions`: Function lookup, invoke, get, and activation-log access are scoped to the caller's tenant.

## Impact

- Control-plane Knative function routes (invoke / get / activations).
- `getFnAction(pool, resourceId)` query (add `tenant_id` predicate).
