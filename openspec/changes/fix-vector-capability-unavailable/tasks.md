# Tasks and source handoff

- [x] Verify clean assigned worktree, linked Git worktree, and issue/run branch.
- [x] Reproduce the KNN failure before runtime edits and implement each source slice after a failing regression.
- [x] Gate all specified vector surfaces on the resolved connection, preserving identity, scope, RLS, and dedicated-database gates.
- [x] Reuse the catalog query, retain reprovision behavior, and cache only positive host:port results for sixty seconds.
- [x] Add safe capability errors and the narrow undefined-vector type/operator backstop.
- [x] Cover absence, no DDL/DML, probe failures, recovery, cache isolation/expiry, plain-route behavior, positive execution, and image imports.
- [x] Add a negative real-stack HTTP case and include it in the executor runner.
- [ ] PR CI: run socket-based executor error, authorization, mapping, and gateway suites with installed dependencies.
- [ ] Integration: run unchanged KNN/RLS and auto-embedding suites against the existing pgvector fixture.
- [ ] Integration: point the existing DB_URL/PG* fixture settings at `bitnamilegacy/postgresql:17.2.0` and run the new negative case (the standard pgvector fixture intentionally skips it).
- [ ] Deployment maker: correct only the two specified comment blocks and compare default, staging, and kind-vector Helm renders byte for byte.

## Assignment and evidence

Source base: `b71aa66b79197db3010282972adcbe13d761c876`. Branch: `agent/falcone/983/b675666e-1311-5dfb-9fe9-bf50b8b445bf`. Worktree and Git linkage match the supplied run identifier. No unrelated dirty files were present.

Reproduction: `node --test --experimental-test-isolation=none tests/unit/vector-capability-unavailable.test.mjs`; initial minimal KNN regression failed twice with `SYNTAX_OR_ACCESS` instead of `CAPABILITY_UNAVAILABLE`. It now passes. Tests run without timeout wrappers; in-process dispatch and image-import cases avoid sandbox socket/subprocess restrictions.

PASS: 90 tests across the new capability (17) and image-import (2) cases, public-error classification, DDL isolation, data adapter plans, unchanged vector DDL/embedding/KNN/quota/route suites, and unchanged reprovision/preflight suites. Command:

`node --test --experimental-test-isolation=none tests/unit/vector-capability-unavailable.test.mjs tests/unit/vector-capability-image.test.mjs tests/unit/executor-public-error-code.test.mjs tests/unit/postgres-ddl-table-isolation.test.mjs tests/adapters/postgresql-data-api.test.mjs tests/blackbox/vector-search-ddl.test.mjs tests/blackbox/vector-search-embedding.test.mjs tests/blackbox/vector-search-knn-plan.test.mjs tests/blackbox/vector-search-quota.test.mjs tests/blackbox/vector-search-route-catalog.test.mjs packages/provisioning-orchestrator/src/appliers/postgres-applier.preflight.test.mjs packages/provisioning-orchestrator/tests/reprovision/postgres-applier.test.mjs`

PASS: `node --check` for every changed/new JavaScript module and test, `bash -n tests/env/executor/run.sh`, and `git diff --check`. Review confirmed that DDL still requires a dedicated database, auth/scope/RLS gates are intact, the applier export preserves its query semantics, and no debug instrumentation remains. Both image-file import checks passed after the worker COPY additions. No new dependencies or lockfile changes are needed.

## Sandbox limits

- Real-stack KNN, auto-embedding, and negative capability tests were attempted with `node --test --experimental-test-isolation=none tests/env/executor/vector-search-knn-rls.test.mjs tests/env/executor/vector-capability-unavailable.test.mjs tests/env/executor/auto-embedding-write.test.mjs`. SKIPPED: existing `pg` dependency is absent (`ERR_MODULE_NOT_FOUND`) and the sandbox has no network to install it. No database assertion ran.
- Existing worker Dockerfile suite was attempted. SKIPPED: its fixture refers to missing `services/workflow-worker/src/worker-deps.mjs` after the repository's app-path migration (`ENOENT`), before any assertions. The new image-import checks exercise the current app paths; the stale suite requires a separate fixture update.
- Full container builds and image scans need dependency/image downloads outside this offline source task. Defer to publication CI and release gates.
- Helm parity belongs to the separately assigned deployment worktree and maker; no chart changes are made here.
