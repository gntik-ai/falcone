## 1. Failing tests

- [ ] 1.1 [test] Add
      `services/secret-audit-handler/test/publish-errors.test.mjs`
      asserting that when an injected producer's `send` rejects:
      (a) `vault_audit_publish_failures_total` increments;
      (b) the failed event is published to
      `audit.dlq.secret-audit-publish`;
      (c) `publishAuditEvent` re-throws (not silent), proving B8 from
      `kafka-publisher.mjs:30-32`.
- [ ] 1.2 [test] Add a `parser.test.mjs` case asserting an entry with
      `auth.metadata.service_account_namespace: 'unknown'` (literal
      string) yields `requestorIdentity.type: 'service'`, proving B11
      from `vault-log-reader.mjs:22`.
- [ ] 1.3 [test] Add a case asserting that when
      `entry.request.id` is absent, `event.eventId ===
      event.vaultRequestId`; both share one `randomUUID()`, proving
      B12 from `vault-log-reader.mjs:15, :29`.

## 2. Implementation

- [ ] 2.1 [fix] Rewrite the catch at `kafka-publisher.mjs:30-32` to:
      increment `vault_audit_publish_failures_total`, publish the
      failed event to `audit.dlq.secret-audit-publish`, re-throw the
      original error.
- [ ] 2.2 [fix] Replace the literal-`'unknown'` heuristic at
      `vault-log-reader.mjs:22` with a presence check on the
      namespace field; a real namespace literally `'unknown'`
      classifies as `'service'`.
- [ ] 2.3 [fix] Bind `eventId` and `vaultRequestId` in
      `vault-log-reader.mjs:15, :29` to a single `const vaultId`
      computation so both fields carry the same value when
      `entry.request.id` is missing.
- [ ] 2.4 [fix] Update the for-await body in `index.mjs:31-34` to
      catch the re-thrown publish error and continue the loop (the
      event is already DLQ'd by the publisher); a publish error MUST
      NOT crash the process.

## 3. Validation

- [ ] 3.1 [test] Run `pnpm --filter @in-falcone/secret-audit-handler test`
      and `openspec validate fix-m2-kafka-errors-and-id-binding --strict`;
      both green.
