## 1. Failing tests proving the bugs

- [ ] 1.1 [test] Add `services/pg-cdc-bridge/tests/unit/HealthServer.staleness.test.mjs`
      simulating a listener with `isRunning=true` but `lastEventAt` older than
      `PG_CDC_HEALTH_STALE_SECONDS` while the upstream publication has commits;
      assert `/readyz` returns 503 — fails today (returns 200).
- [ ] 1.2 [test] Add an integration test that points `DATABASE_URL` at an
      unreachable host and asserts `index.mjs` logs a JSON error and exits with
      code 1, not an unhandled rejection.
- [ ] 1.3 [test] Add a shutdown test that triggers `SIGTERM` while two
      `publish()` promises are pending; assert both promises resolve before
      `pool.end()` is called and `process.exit(0)` runs only after Kafka flush.
- [ ] 1.4 [test] Add a test asserting `/healthz` returns 200 whenever the
      process is alive, even when listeners are unhealthy (liveness vs.
      readiness distinction).

## 2. Implementation

- [ ] 2.1 [impl] Stamp `lastEventAt` and `lastAckedLsn` on each `PgWalListener`
      from inside `processMessage`; expose them via a getter.
- [ ] 2.2 [impl] Add `/healthz` (always 200 when process is up) and `/readyz`
      (200 only when every listener is fresh per
      `PG_CDC_HEALTH_STALE_SECONDS`) to `HealthServer`; keep `/health` as an
      alias for `/readyz`.
- [ ] 2.3 [fix] Wrap `await manager.start()` in `index.mjs:14-16` in a
      top-level `.catch` that logs structured JSON and calls
      `gracefulShutdown(1)`.
- [ ] 2.4 [fix] Rewrite the SIGTERM handler in `index.mjs:17` to: (1)
      `manager.beginDrain()` (stop consuming new messages), (2) `await
      manager.awaitInFlight()` with `PG_CDC_SHUTDOWN_TIMEOUT_SECONDS` timeout,
      (3) `publisher.disconnect()`, (4) `manager.closeClients()`, (5)
      `pool.end()`, then `process.exit(0)`.
- [ ] 2.5 [migration] Update `helm/pg-cdc-bridge/templates/deployment.yaml`
      readiness probe to `/readyz` and liveness probe to `/healthz`.

## 3. Docs and validation

- [ ] 3.1 [docs] Document the `/healthz` vs `/readyz` semantics and the
      drain sequence in `services/pg-cdc-bridge/README.md`.
- [ ] 3.2 [test] Re-run `corepack pnpm test:unit` and `openspec validate
      harden-d2-health-and-shutdown --strict`; both green before merge.
