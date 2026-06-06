## 1. Black-box tests (write before fix)

- [ ] 1.1 Author black-box test scenario A: migration does not fetch already-classified rows (SQL-level WHERE guard confirmed via query log or row count)
- [ ] 1.2 Author black-box test scenario B: large table processed in multiple batches of bounded size
- [ ] 1.3 Author black-box test scenario C: batch size is configurable via `APIKEY_DOMAIN_MIGRATION_BATCH_SIZE`
- [ ] 1.4 Author black-box test scenario D: idempotent rerun issues no UPDATEs and no duplicate events
- [ ] 1.5 Author black-box test scenario E: all unclassified rows are eventually classified after migration completes
- [ ] 1.6 Author black-box test scenario F: event emission via `buildAssignedEvent` is preserved for `pending_classification` rows

## 2. SQL-level filter

- [ ] 2.1 Add `WHERE privilege_domain IS NULL` to the SELECT in `services/provisioning-orchestrator/src/actions/api-key-domain-migration.mjs::main:13`
- [ ] 2.2 Remove the in-application filter at `main:17-20` that discards already-classified rows (no longer needed)

## 3. Keyset-paginated batch loop

- [ ] 3.1 Replace the single global SELECT with a keyset-paginated loop: `WHERE privilege_domain IS NULL AND id > $lastId ORDER BY id ASC LIMIT $batchSize`
- [ ] 3.2 Read `APIKEY_DOMAIN_MIGRATION_BATCH_SIZE` from environment with default 500 and validate it is a positive integer

## 4. Batched UPDATE with idempotency guard

- [ ] 4.1 Replace per-row UPDATEs at `main:25` with a single multi-row UPDATE per batch
- [ ] 4.2 Ensure the batched UPDATE includes `AND privilege_domain IS NULL` to preserve idempotency on rerun

## 5. Verification

- [ ] 5.1 Run `bash tests/blackbox/run.sh` and confirm all six scenarios (A–F) pass and existing tests are unaffected
