# Tasks

- [x] Verify the assigned clean source worktree and issue/run branch.
- [x] Add rule-based public error-code classification without changing platform constructors.
- [x] Update the central, flow-monitoring and LLM pre-stream catches and preserve original-error logging.
- [x] Add unit and HTTP coverage for fallback codes, platform regressions, 4xx metadata and streaming errors.
- [x] Run bounded available checks and record sandbox limits for CI.
- [ ] PR CI: run all new HTTP cases and the existing flow-control, LLM and Postgres executor regressions with installed dependencies and permitted localhost sockets.
- [ ] Integration/release gate: run real-Postgres data and DDL executor tests.
- [ ] Runtime follow-up: reproduce the API-key row failure, capture the original executor error and assess role provisioning as a separate issue.

## Source verification

Started from clean source HEAD `0645a58dd83bada916c588b141235e84506f5225` on assigned branch `agent/falcone/1013/e163d5d5-2aff-5174-a8c8-049894094de5` in the supplied source worktree. The branch, linked Git worktree and run identifier match the supplied assignment. Checks ran on 2026-10-05.

- PASS: 18 tests covering public error-code classification (3), Postgres data adapter plans (3), Postgres DDL isolation (3) and the existing null-body 400 regressions (9). Command: `timeout 30s node --test --experimental-test-isolation=none tests/unit/executor-public-error-code.test.mjs tests/unit/postgres-ddl-table-isolation.test.mjs tests/adapters/postgresql-data-api.test.mjs tests/blackbox/control-plane-null-body-400.test.mjs`.
- PASS: `node --check` for both changed runtime modules and the new HTTP test file; `git diff --check`.
- PASS: 21 supplementary in-process dispatch assertions against the actual server request listener, using stream-backed request/response doubles without sockets. Covered raw SQLSTATE/errno and status-bearing SQLSTATE failures in all three JSON catches, flow SSE fallback frames, original-error logging, classified 503/500/409 errors and 429/422 metadata. This checks handler behavior; it does not replace the socket-based HTTP regressions in CI.
- SKIPPED: `timeout 15s node --test --experimental-test-isolation=none tests/blackbox/executor-5xx-code-redaction.test.mjs` was attempted; all 25 cases stop before requests at sandbox-denied localhost `listen` with `EPERM`. Rerun in PR CI. These are environment failures, not passing HTTP evidence.
- SKIPPED: `timeout 30s node --test tests/blackbox/flows-execution-control-missing-run.test.mjs tests/blackbox/llm-completion-routes.test.mjs tests/blackbox/executor-ddl-db-ownership-guard.test.mjs` requires the existing uninstalled `pg` dependency and localhost sockets. A grouped attempt with the new redaction and null-body files confirmed module-load failures; the null-body checks pass independently.
- SKIPPED: `timeout 45s node --test tests/unit/postgres-data-api.test.mjs tests/unit/postgres-admin.test.mjs tests/adapters/postgresql-admin-sql.test.mjs tests/adapters/postgresql-admin.test.mjs` requires the existing uninstalled `cel-js` dependency. A grouped attempt including the passing classification, DDL and data-adapter files confirmed these module-load failures.
- SKIPPED: `tests/env/executor/postgres-data-executor.test.mjs` and `tests/env/executor/postgres-ddl-executor.test.mjs` need installed `pg` and a real Postgres/container environment; defer to integration/release checks.
- SKIPPED: live API-key failure reproduction needs runtime access, which is outside this source task.

No dependency manifests or lockfiles need changes. The specified integer-status/upper-snake rule passes a status-bearing `ECONNRESET`; proposal.md records the conflicting acceptance example and the structural classification edge. Deployment files, workflow pins and unrelated source remain untouched.
