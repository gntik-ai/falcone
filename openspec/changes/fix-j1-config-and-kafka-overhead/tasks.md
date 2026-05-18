## 1. Failing tests

- [ ] 1.1 [test] Add a case to
      `services/openapi-sdk-service/tests/unit/spec-audit.test.mjs` that
      invokes `emit` ten times and asserts `kafka.producer()` is called
      exactly once (singleton), proving B10 at
      `spec-audit.mjs:9-15`.
- [ ] 1.2 [test] Add a case to
      `services/openapi-sdk-service/tests/integration/openapi-spec-serve.test.mjs`
      that runs two parallel "replica" handler instances sharing a single
      mocked Redis, fires N+1 requests against the same workspace, and
      asserts the second handler returns `429`, proving B11 at
      `openapi-spec-serve.mjs:8`.
- [ ] 1.3 [test] Add a case to
      `services/openapi-sdk-service/tests/unit/config.test.mjs` that loads
      `config.mjs` with `NODE_ENV: 'staging'` and `DATABASE_URL` unset,
      and asserts a warning is logged naming the missing var, proving
      B14 at `config.mjs:21`.

## 2. Implementation

- [ ] 2.1 [fix] Refactor `spec-audit.mjs:9-15` so `kafka.producer()` is
      called once at module load, the producer is connected lazily on
      first use, and a SIGTERM handler disconnects on shutdown. `emit`
      becomes `producer.send(...)`.
- [ ] 2.2 [impl] Create `src/rate-limit-redis.mjs` with
      `checkRateLimit(redis, key, limit, windowSeconds)` using `INCR` +
      `EXPIRE`; return `{allowed, remaining, retryAfter}`.
- [ ] 2.3 [fix] Replace `requestBuckets` Map in
      `openapi-spec-serve.mjs:8,15-25` with a call to
      `checkRateLimit(redis, ${tenantId}:${workspaceId}, limit, 60)`; on
      `redis === undefined`, fall back to the in-process Map with a
      logged warning.
- [ ] 2.4 [fix] Rewrite `config.mjs:20-35`: `validateRequired` always
      iterates; in `production` it throws on missing, in other envs it
      logs a warning naming each missing key.
- [ ] 2.5 [impl] Add `REDIS_URL` to the env contract in `config.mjs:37-62`
      (optional, no production-throw).

## 3. Validation

- [ ] 3.1 [docs] Document the Redis dependency, the singleton-producer
      lifecycle, and the dev-warning behaviour in
      `services/openapi-sdk-service/README.md`.
- [ ] 3.2 [test] Re-run
      `corepack pnpm --filter openapi-sdk-service test`; green before merge.
