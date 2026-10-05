# Tasks

- [x] Verify the assigned clean source worktree and issue/run branch.
- [x] Add the anchored executor route at priority 285, preserving routes 2005 and 2005-key.
- [x] Copy route 2006's verifier and gateway hardening, including identity rejection, credential stripping, and Secret interpolation.
- [x] Add source route-selection, suffix-exclusion, header-policy, and optional chart parity coverage.
- [x] Record bounded source test results and include this handoff in one local source commit.
- [x] Confirm the pinned deployment standalone table mirrors the source and renders deterministically.
- [x] Verify both Hermes-managed workflow pins match deployment HEAD and run Mongo pin/parity checks plus Postgres byte parity.
- [x] Add Postgres gateway and structural-write regressions to the existing CI gateway step.
- [x] Check route selection against all standalone routes and use the served GET method for introspection regression samples.
- [x] Cover every control-plane Postgres introspection endpoint, including database listing, indexes, policies, security, views, and materialized views.
- [ ] PR CI / integration: verify live bearer authentication failures return 401 instead of control-plane `404 NO_ROUTE` after #1051.

Live integration remains a handoff item outside this source implementation.

## Source verification

Reviewed from assigned clean source HEAD `d2c15e446c8e05be810c4711bad3651dbcd0297c` on branch `agent/falcone/1012/43b4dc63-a831-5d42-8b1a-f5186dcf7283`. The assigned source worktree and branch match the supplied lease; previous committed work is preserved. The current checks below were rerun on 2026-10-05.

- PASS: all 14 scoped Postgres (5), Mongo (6), and LLM contract (3) tests, including byte parity, chart rendering, verifier mounts, and workflow pins. Command: `FALCONE_CHART_PATH=/srv/engineering/worktrees/falcone-charts/43b4dc63-a831-5d42-8b1a-f5186dcf7283/charts/in-falcone timeout 45s node --test --experimental-test-isolation=none tests/blackbox/postgres-gateway-route.test.mjs tests/blackbox/mongo-gateway-route.test.mjs tests/contracts/llm-task-type-catalog.contract.test.mjs`.
- PASS: two Helm renders of `templates/apisix-standalone-routes.yaml` with kind values and `--set apisix.manageStandaloneRoutes=true` are identical. The ConfigMap route content matches the source with the template's leading block-scalar newline; parsed routes match exactly.
- PASS: JavaScript syntax, PyYAML parsing of the route table and CI workflow, unique route IDs, scoped CI test command, and `git diff --check`. Parsed routes 2005 and 2005-key are unchanged from approved base `05faa58d84772256fc12b87fe09ac3219ed82282`.
- SKIPPED: `timeout 30s node --test --experimental-test-isolation=none tests/blackbox/structural-write-role-gates-executor.test.mjs` was attempted; every case stops at sandbox-denied localhost `listen` with `EPERM`. Rerun in the updated PR CI gateway step.
- SKIPPED: `timeout 15s node scripts/validate-gateway-policy.mjs` cannot load the existing `yaml` dependency because repository dependencies are not installed. Rerun after CI installs dependencies; no manifest or lockfile update is needed.
- SKIPPED: live gateway bearer/no-token authentication round trips require the integration environment after #1051.

Both workflow pins remain owned by Hermes and match current deployment HEAD `e0b276425634b484c8fbab7d3beab5bb68ff0293`. The byte-identical source/chart standalone table has SHA256 `7ed75f2db07e5718f7a8b16e56584ef28eef3c9d91754d8b49b651837cc46c0b`. No workflow pins, deployment files, dependency manifests, or lockfiles were edited in this continuation. No merge, push, deploy, credential retrieval, or cluster mutation was performed.
