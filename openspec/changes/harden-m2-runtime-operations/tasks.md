## 1. Failing tests

- [ ] 1.1 [test] Add
      `services/secret-audit-handler/test/map-operation.test.mjs`
      asserting `mapOperation('list')` throws
      `UnknownVaultOperationError` (it does NOT silently return
      `'read'`), proving B13 from `vault-log-reader.mjs:33-37`.
- [ ] 1.2 [test] Add a `kafka-publisher.test.mjs` case asserting the
      producer is constructed with `idempotent: true` and a
      `logLevel` higher than `NOTHING`, proving B15/B16 from
      `kafka-publisher.mjs:7, :10`.
- [ ] 1.3 [test] Add an `index.test.mjs` case asserting SIGTERM with
      a rejecting `disconnect()` triggers `process.exit(1)` (not
      `exit(0)`), proving B18 from `index.mjs:23-25`.
- [ ] 1.4 [test] Add a case asserting the handler processes events
      with a bounded concurrency window and surfaces an
      `vault_audit_in_flight_publishes` gauge that grows when Kafka
      is slow, proving B17 from `index.mjs:31-34`.

## 2. Implementation

- [ ] 2.1 [fix] Replace the `'read'` fallback in `mapOperation` at
      `vault-log-reader.mjs:33-37` with
      `throw new UnknownVaultOperationError(op)`; the bootstrap loop
      routes the error to the parse-error DLQ.
- [ ] 2.2 [fix] Raise KafkaJS `logLevel` at
      `kafka-publisher.mjs:7` from `NOTHING` to `INFO`; supply a
      `logCreator` that bridges into the service's pino logger.
- [ ] 2.3 [fix] Add `idempotent: true` and a stable
      `transactionalId` (e.g., `${HOSTNAME}-secret-audit`) to the
      KafkaJS producer config at `kafka-publisher.mjs:10`.
- [ ] 2.4 [fix] Replace the sequential for-await at
      `index.mjs:31-34` with a `p-limit(SECRET_AUDIT_CONCURRENCY ??
      8)` window; expose an `vault_audit_in_flight_publishes` gauge.
- [ ] 2.5 [fix] Update the SIGTERM handler at `index.mjs:23-25` to
      `try { await publisher.disconnect(); process.exit(0) } catch
      { process.exit(1) }`.

## 3. Validation

- [ ] 3.1 [test] Run
      `pnpm --filter @in-falcone/secret-audit-handler test` and
      `openspec validate harden-m2-runtime-operations --strict`;
      both green.
