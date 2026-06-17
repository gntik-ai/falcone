## 1. Failing black-box test

- [x] 1.1 Add a test: subscribe to a collection, delete a doc, assert a `delete` frame reaches the owning tenant's subscriber. — covered by the live-path real-stack test `tests/env/executor/realtime-executor.test.mjs` (lines 74–92): a tenant-A delete is delivered as a `delete` event carrying the prior tenant-A document (the pre-image). NOTE: the original Mongo change-stream bug is **superseded** — that engine was replaced by Postgres logical replication (#460); the proposal's premise (`$match` drops deletes because `fullDocumentBeforeChange` is unpopulated) no longer applies to the live path.
- [x] 1.2 Cross-tenant probe: another tenant's subscriber does NOT receive the delete. — same test (line 85): tenant B's delete never reaches tenant A's subscriber.

## 2. Fix delete delivery

- [x] 2.1 Deliver `delete` events keyed off the pre-image, tenant-scoped. — already satisfied by the live CDC realtime executor (`apps/control-plane/src/runtime/realtime-executor.mjs::dispatch`): `REPLICA IDENTITY FULL` on the DocumentDB engine populates the delete pre-image (`fullDocumentBeforeChange`), and `dispatch` filters on `record.tenantId` before emitting. No new code required — the change-stream path that had the bug was removed by #460.

## 3. Verify

- [x] 3.1 Re-run the realtime test — owning tenant receives its own `delete`s, cross-tenant deletes not delivered. — `tests/env/executor/realtime-executor.test.mjs` GREEN (2/2) against the live DocumentDB engine WAL.
- [x] 3.2 Run `bash tests/blackbox/run.sh` — no regressions (no code change; behavioral spec recorded).
