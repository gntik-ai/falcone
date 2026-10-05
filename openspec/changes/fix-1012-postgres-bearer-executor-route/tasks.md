# Tasks

- [x] Verify the assigned clean source worktree and issue/run branch.
- [x] Add the anchored executor route at priority 285, preserving routes 2005 and 2005-key.
- [x] Copy route 2006's verifier and gateway hardening, including identity rejection, credential stripping, and Secret interpolation.
- [x] Add source route-selection, suffix-exclusion, header-policy, and optional chart parity coverage.
- [x] Record bounded source test results and include this handoff in one local source commit.
- [ ] Deployment maker: mirror the standalone route table in the assigned deployment repository and verify deterministic rendering.
- [ ] Hermes: set both workflow chart pins to the final deployment HEAD and run Mongo pin/parity checks plus Postgres byte parity.
- [ ] PR CI / integration: verify live bearer authentication failures return 401 instead of control-plane `404 NO_ROUTE` after #1051.

Deployment and integration tasks are handoff items outside this source implementation.

## Source verification

- PASS: scoped Postgres routing/hardening (4), Mongo bearer routing/hardening (3), and LLM route contract (3). Command: `timeout 45s node --test --experimental-test-isolation=none --test-name-pattern='^(Postgres |Mongo bearer route|ctr-llm)' tests/blackbox/postgres-gateway-route.test.mjs tests/blackbox/mongo-gateway-route.test.mjs tests/contracts/llm-task-type-catalog.contract.test.mjs`.
- PASS: JavaScript syntax check, PyYAML parsing of the route table, Secret placeholder preservation, and a byte comparison proving removal of the new route restores the original table exactly.
- FAIL (deployment handoff): Postgres byte parity against the assigned deployment chart. The deployment checkout at `6e87dc7c06b0851600db99ad3f570fa2371ee485` still lacks route `2005-data`. Set `FALCONE_CHART_PATH` to the assigned `charts/in-falcone` directory and rerun the Postgres parity test after the deployment maker mirrors the table.
- SKIPPED: structural-write executor regression cannot run because the sandbox denies `listen` on localhost with `EPERM`. Rerun in PR CI.
- SKIPPED: gateway-policy validator cannot load the existing `yaml` dependency because repository dependencies are not installed. Rerun after CI installs dependencies; no manifest or lockfile update is needed.
- SKIPPED: Mongo chart render, pod mount, and workflow-pin checks await the deployment maker and Hermes. Live authentication round trips require the integration environment after #1051.

Both workflow pins remain owned by Hermes. No deployment files were edited, and no merge, push, deploy, credential retrieval, or cluster mutation was performed.
