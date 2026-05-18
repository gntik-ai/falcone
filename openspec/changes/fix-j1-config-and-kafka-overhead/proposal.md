## Why

The audit emitter creates a fresh Kafka producer for every event, the spec-
serve rate-limit Map lives in-process so multi-replica deployments multiply
the effective limit, and required-env validation runs only in production.
From `openspec/audit/cap-j1-openapi-sdk-builder.md`:

- **B10** (`services/openapi-sdk-service/src/spec-audit.mjs:9-15`) — `emit`
  runs `kafka.producer()` → `connect()` → `send()` → `disconnect()` per
  event. With spec-serve emitting on every GET, one HTTP request creates
  one full Kafka connection cycle.
- **B11** (`actions/openapi-spec-serve.mjs:8`) — `requestBuckets` Map is
  in-process; N replicas multiply the effective per-workspace limit by N.
- **B14** (`src/config.mjs:21`) — `validateRequired` returns early when
  `nodeEnv !== 'production'`. Staging/QA runs with missing critical vars
  pass startup but fail at first DB/S3 call.
- **G1, G14, G32, G33** — same surfaces flagged as gaps; in-process Map
  has no eviction so entries accumulate per workspace forever.

## What Changes

- Introduce a process-singleton Kafka producer in `src/spec-audit.mjs`:
  connect once at module load, reuse across emits, register a
  `SIGTERM` handler that disconnects cleanly. `emit` becomes a single
  `send` call.
- Move the rate-limit counter to Redis (shared across replicas) keyed by
  `openapi-spec-rate:{tenantId}:{workspaceId}` with `EXPIRE 60`. The in-
  process Map is removed.
- Run `validateRequired` always; on non-production, log a warning instead
  of throwing so dev workflows continue, but still surface the missing
  vars at startup rather than at first call.
- Add an eviction LRU bound (or relevant TTL on Redis) so memory does not
  grow unbounded per workspace.

## Capabilities

### Modified Capabilities

- `gateway-and-public-surface`: audit emission uses a singleton Kafka
  producer; rate limiting is enforced via a shared Redis counter;
  required-env validation warns in development and fails fast in
  production.

## Impact

- Affected code: `services/openapi-sdk-service/src/spec-audit.mjs`,
  `services/openapi-sdk-service/actions/openapi-spec-serve.mjs`,
  `services/openapi-sdk-service/src/config.mjs`, new
  `services/openapi-sdk-service/src/rate-limit-redis.mjs`.
- Migrations: none.
- Breaking changes: development environments now log warnings on missing
  env vars at startup (was silent); deployments without Redis access for
  the rate-limit key now fall back to in-process with a logged warning
  rather than silently allowing multi-replica drift.
- Coordination: Redis URL must be set in deployment config
  (`REDIS_URL`) for the shared rate limiter to engage.
