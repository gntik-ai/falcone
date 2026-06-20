## 1. Failing Tests (write before any implementation)

- [x] 1.1 `tests/blackbox/audit-trail-integrity.test.mjs` — `audit-hash.mjs` pure helpers: `auditCanonical` deterministic + key-order/camel-snake stable; `computeRowHash` stable sha-256 hex; `verifyAuditChain` valid for an untampered chain, detects content tamper (brokenAt index), detects broken link (brokenAt index), genesis prevHash ''. Failed before the module existed.
- [x] 1.2–1.4 `auditEventForRoute` outcome: 403→`denied` (non-null, was null), 4xx→`failed`, 5xx→`error`, 2xx→`succeeded`; read route → null.
- [x] 1.5 `recordAuditEvent` against the in-memory pool writes `outcome`/`prev_hash`/`row_hash`; N inserts for a tenant form a chain that `verifyAuditChain` validates.
- [x] 1.6 `auditRowToRecord` reads `outcome` from the row (null→`unknown`); exposes `rowHash`/`prevHash`.
- [x] 1.7 `secretSet/secretGet/secretList/secretDelete` present in `AUDITABLE_LOCAL_HANDLERS`.
- [x] 1.8 Existing `audit-write-and-scope-enforcement.test.mjs` snapshotted (was green pre-change).

## 2. Implementation — audit-hash.mjs (new module)

- [x] 2.1–2.3 `deploy/kind/control-plane/audit-hash.mjs`: `auditCanonical` (stable, key-sorted, ISO-normalized created_at, JSONB-order-safe), `computeRowHash` (sha-256 hex), `verifyAuditChain` (per-tenant link + content re-derivation, returns `{valid, brokenAt}`).

## 3. Implementation — tenant-store.mjs schema migration

- [x] 3.1 `ensureSchema`: idempotent `ALTER TABLE plan_audit_events ADD COLUMN IF NOT EXISTS outcome VARCHAR(32) / prev_hash TEXT / row_hash TEXT`.

## 4. Implementation — audit-writer.mjs

- [x] 4.1 `auditEventForRoute`: removed the `status >= 400` short-circuit; derives `outcome` via new exported `outcomeFromStatus` and includes it. Failures/denials are now recorded (distinguished by outcome); the `scope_enforcement_denials` write is unchanged.
- [x] 4.2 `secretSet/secretGet/secretList/secretDelete` added to `AUDITABLE_LOCAL_HANDLERS`.

## 5. Implementation — audit-store.mjs

- [x] 5.1 `recordAuditEvent`: generates `id`+`created_at` in-app; runs a per-tenant transaction holding `pg_advisory_xact_lock(hashtext('audit:'||tenantId)::int8)`; reads the tenant's latest `row_hash` as `prev_hash` (genesis ''); computes `row_hash`; INSERTs all columns incl. `outcome`/`prev_hash`/`row_hash`.
- [x] 5.2 `auditRowToRecord`: reads `outcome` (null→`unknown`); surfaces `rowHash`/`prevHash`. `queryAuditEvents` SELECTs the new columns.

## 6. Update existing tests

- [x] 6.1 Updated the in-memory pool stub (BEGIN/COMMIT no-ops, advisory-lock no-op, latest-row_hash SELECT, new INSERT column list); refreshed the one assertion whose behaviour changed by design (a failed mutation is now audited with `outcome='failed'`, not dropped).
- [x] 6.2 `bash tests/blackbox/run.sh` — 1008 pass / 0 fail; `openspec validate --strict` clean.

## 7. Verification — live kind probe

- [x] 7.1–7.4 Live kind verification (test-cluster-b): the idempotent `ALTER TABLE` ran at boot (`schema ready`). A failed `createWorkspace` (400) and a cross-tenant service-account create (403) by `acme-ops` produced audit records with `outcome=failed` and `outcome=denied` — distinct outcomes observed `["denied","failed","unknown"]` (legacy rows read as `unknown`, was hardcoded `"succeeded"`). The hashed suffix `verifyAuditChain(window) -> {valid:true}`; tampering a hashed record's `outcome` -> `{valid:false, brokenAt:<idx>}`. `globex` reading `acme`'s audit -> 403 (isolation). Live verification also caught a missing `audit-hash.mjs` COPY in the CP Dockerfile (fixed). `verifyAuditChain` updated to skip the pre-migration (NULL-hash) prefix so a paged read of a mixed legacy/new log verifies its hashed suffix. Reverted the deployment afterward.

## 8. Archive

- [ ] 8.1 `/opsx:archive add-audit-trail-integrity` after merge.
