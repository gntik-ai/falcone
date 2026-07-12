/**
 * Per-issue document-store E2E runner — change: add-ferretdb-document-store-e2e (#464).
 *
 * Entry point for `bash tests/e2e/run-issue.sh add-ferretdb-document-store-e2e`, which deploys the
 * stack to an ephemeral namespace (E2E_FERRETDB=true → in-falcone chart's documentdb + ferretdb
 * sub-charts) and runs this spec, then ALWAYS tears the namespace down via the mandatory trap.
 *
 * Re-imports every document-store spec block so a single Playwright run exercises the full suite:
 * create, list, update, delete, query, auth, aggregation, vector-index, transaction (unsupported),
 * and cross-tenant isolation. The same blocks also live under `specs/document-store/` and run under
 * the `other` Playwright project in the normal sweep. All specs carry a live-gate (`probeDocumentApi`)
 * that skips gracefully when the stack/route/backend is not available.
 *
 * OUT OF SCOPE — Realtime/CDC suite (`tests/e2e/realtime/`): this is a SEPARATE, pgoutput-based
 * suite owned by add-ferretdb-realtime-cdc-remediation (#460, MERGED). That change re-architected
 * realtime onto a Postgres pgoutput logical-replication slot — `apps/control-plane-executor/src/runtime/
 * realtime-executor.mjs` no longer calls `collection.watch()` (it consumes a WalReplicationClient).
 * This document-store change neither runs nor modifies those specs.
 *
 * Scenarios: DOC-E2E-001..006, DOC-E2E-AGG-001..005, DOC-E2E-IDX-001..002,
 *            DOC-E2E-TXN-001..002, DOC-E2E-XT-01..03.
 */
import '../document-store/document-create.spec'
import '../document-store/document-list.spec'
import '../document-store/document-update.spec'
import '../document-store/document-delete.spec'
import '../document-store/document-query.spec'
import '../document-store/document-auth.spec'
import '../document-store/document-aggregation.spec'
import '../document-store/document-vector-index.spec'
import '../document-store/document-transaction.spec'
import '../document-store/document-cross-tenant.spec'
