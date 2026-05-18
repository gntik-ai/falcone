## Why

The function-admin audit façade silently drops every audit event when the
caller does not wire a publisher, and the audit-query loader silently
returns empty results when the loader is unwired. From
`openspec/audit/cap-h1-openwhisk-function-admin-invocation.md`:

- **B6** (`apps/control-plane/src/functions-audit.mjs:34-37`) —
  `publishAuditEvent` defaults to
  `((payload, meta = {}) => ({ topic: meta.topic, eventId: toEventId(payload) }))`,
  a no-op that *returns* a fake `{topic, eventId}` mimicking a successful
  publish. The four exported `emit*` functions return `toEventId(event)` and
  never throw. Callers that don't wire a real publisher silently drop every
  audit event.
- **B7** (`functions-audit.mjs:91`) — the audit-query loader defaults to
  `(() => ({ items: [], page: { size: query.limit, nextCursor: undefined } }))`.
  Queries return empty silently.
- **G20** (`functions-audit.mjs:34-37, :91`) — no production wiring of a
  real publisher or loader.

## What Changes

- Replace the silent stub at `functions-audit.mjs:34-37` with a fail-closed
  default: when `context.publishAuditEvent` is unset, the helper MUST throw
  `FUNCTION_AUDIT_PUBLISHER_MISSING`. The previous "return fake metadata"
  behaviour is removed.
- Replace the silent loader at `functions-audit.mjs:91` with a fail-closed
  default: when `context.queryAuditRecords` is unset, the helper MUST throw
  `FUNCTION_AUDIT_LOADER_MISSING`.
- Add a façade-level `withFunctionAuditWiring(context)` invariant that
  callers can use to assert both wiring slots are populated at startup.
- Wire the production publisher and loader at the gateway-facing factory so
  the default factory is no longer a stub.

## Capabilities

### Modified Capabilities

- `functions-runtime`: requirement that the function audit emitter and
  query loader fail closed when unwired and that the production factory
  provides real implementations.

## Impact

- **Affected code**:
  `apps/control-plane/src/functions-audit.mjs:34-37, :91, :114-118`,
  the gateway-facing factory in `apps/control-plane/src/functions-admin.mjs`,
  `tests/unit/functions-audit.test.mjs`.
- **Migration required**: none in schema; deployment runtime must inject
  a real publisher and loader.
- **Breaking changes**: deployments that ran without a publisher will now
  fail at the first audit-emitting call rather than silently dropping
  audit traffic. This matches the compliance contract.
- **Out of scope**: contract-version fallbacks (covered by
  `fix-h1-public-url-and-contract-versions`); the actual invocation
  handler (covered by `complete-h1-invocation-handler`).
