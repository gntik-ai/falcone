# Source #980 handoff (2026-10-01)

Assigned starting HEAD: `49d18d6aa44885aac1ffca373a01bd1910a74425`, branch `agent/falcone/980/5fcefe28-5a92-5e96-a3cd-6b1369cd20d6`. The worktree was clean; its path, Git metadata and branch match the assigned lease. R2, source repository only. All previous committed #980 work is preserved. The execution contract, OpenSpec, acceptance criteria and risk policy were supplied in the instruction bundle; there are no additional local agent instructions.

## Checker repairs in this attempt

- [x] Pin both `.github/workflows/ci.yml` and `integration.yml` to the verified final deployment HEAD `13fcbfee738d2dd49da3928831871fa0da469ace`. This supersedes the previous **pin pending deployment repair** state. Source/chart standalone route parity passes at that head.
- [x] Align WF-CON-002 tenant-app clients with the saga's hardcoded `tenant_id` claim. The shared helper lists identity mappers first, creates a missing mapper once, and rejects a conflicting or duplicate named mapper. The audience mapper still uses its separate read-before-POST helper, never the hardcoded-claim helper. Tests cover new/existing clients, retry, conflicting identity and audience setup before the tenant record.
- [x] Reject custom tenant audiences in source deployment validation until the chart passes the value to the control-plane provisioner and kind routes. The pinned chart's control-plane environment falls back to `falcone-data-api`, and kind mounts a canonical route table with that audience. This ChangeSet supports that default only. `scripts/validate-deployment-chart.mjs` accepts ordered, repeated `--values` layers so rollout preflight can reject a custom audience in environment/customer/local overrides. Do not bypass this gate using Helm overrides. A future paired chart change must complete both wiring paths before removing it.
- [x] Preserve the shared executor verifier's enforcement on all tenant-token executor routes, including events and functions. Document required audience preparation for non-app clients and prod reconciliation before rollout. Only tenant-app clients receive automatic provisioning/reconciliation mappers.

## Previously implemented work retained

- [x] Bearer route 2006 targets the executor through the issuer-allowlisted JWKS plugin. Gateway authentication, body cap, correlation, identity-header removal, Secret-backed trust, and 429 behavior remain mandatory. Bearer routes strip API-key headers; route 2006-key remains unchanged against base `3a7306f20454db8a90f95a93a4049305efd1bce1`.
- [x] Executor tenant audience matching is exact `aud` string/array membership, never `azp`. Enforcement rejects missing/empty audience, invalid flags and missing JWKS/topology configuration. Platform audience semantics and the control-plane verifier remain unchanged.
- [x] Both provisioners ensure one `falcone-data-api-audience` mapper. Reconciliation uses the existing kc-admin environment, defaults to dry run, supports `--apply` and re-apply no-op, and redacts raw provider errors. The helper and script are included in both runtime images.
- [x] CI Mongo fixtures carry the audience and include an azp-only negative client. The kind round trip retains CRUD, gateway/direct-executor 401, workspace B 403, API-key scopes/mixed credentials and rate-limit coverage.
- [x] Paired deployment `13fcbfee` contains the Lua schema/verifier, audience values and executor ConfigMap. Default/kind/prod enforce; staging stays false pending reconciliation. Source/chart canonical routes match. No deployment files were edited by this source attempt.

## Bounded validation

- PASS: `timeout 45s node --test --experimental-test-isolation=none tests/unit/control-plane-jwt-verify.test.mjs tests/unit/tenant-data-api-audience.test.mjs tests/blackbox/tenant-realm-token-issuance.test.mjs tests/blackbox/kind-control-plane-multirealm-jwt.test.mjs` (32/32). Covers the signed audience matrix, unchanged control-plane tenant behavior, issuer isolation, mapper retries/conflicts and reconciliation dry-run/apply/reapply/redaction.
- PASS: `FALCONE_CHART_PATH=<assigned deployment>/charts/in-falcone timeout 45s node --test tests/blackbox/mongo-gateway-route.test.mjs`. Covers source/chart byte parity, bearer/API-key upstream selection, policy, audience and kind mounts at the finalized pin.
- PASS, supplemental: gateway-policy unit suite using the pre-existing read-only `/tmp/falcone-980-readonly-loader.mjs` to resolve installed toolchain YAML and the assigned chart path. The native frozen-dependency run remains a CI check.
- PASS, supplemental: `timeout 60s node --experimental-loader=/tmp/falcone-980-readonly-loader.mjs --test --experimental-test-isolation=none tests/blackbox/staging-infrastructure/mongo-bearer-route-chart.test.mjs tests/flow-audit-chart.test.mjs` in the assigned deployment worktree (20/20). Verifies profiles, audience/flag parity and rejection, BusyBox digest/registry handling, staging issuers, route preservation, APISIX numeric identities/OpenShift contracts and the approved default/flow-audit baselines. This loader only resolves installed YAML and read paths; it does not stub runtime dependencies.
- PASS: changed JavaScript syntax, both workflow pins equal the deployment HEAD, workflow YAML/Bash syntax and `git diff --check`.
- SKIPPED: native saga/slug-conflict, WF-CON-002, deployment-chart/custom-audience validation and gateway-policy contract suites cannot import installed repository dependencies (`yaml`, `kafkajs`, `cel-js`). Loader-assisted deployment-chart/contract runs still cannot import `cel-js`. PR CI must run these with frozen dependencies; no added/updated dependency is needed.
- SKIPPED: control-plane JWT/API-key identity HTTP suites fail setup because the sandbox rejects local listeners with `listen EPERM`. An initial combined run cancelled its sibling tests; the socket-free suites were rerun separately and passed as recorded above. CI must rerun the HTTP suites.
- SKIPPED: LuaJIT is absent; live kind CRUD/isolation/API-key/401/429 and image builds/scans need container images/network/a configured stack. Managed-knative package-extraction checks remain in CI/release gates. No unavailable check is counted as passing.

## Deployment baseline evidence

No fixture was re-baselined by this source attempt. At pinned deployment `13fcbfee`, the only permitted updated fixtures are:

- Umbrella default render: prior deployment `f74e1c505429b9823f5a352488ffafa674aa4af0d48b85b88cead3154cdba4fa` to `5ca1986297dc0c39ebd98ce720d3d352ddb7b2bacc79555bc1c0c3eeb1d3579a`. Justification: add tenant-audience enforcement configuration and executor environment wiring to the already-reviewed verifier/mounts/BusyBox overlay, preserving APISIX numeric identities and OpenShift contracts.
- Flow-audit baseline: prior deployment `362fb0be45c9d0cdbc6982367ce82a5319f4a43ae6c138e3aaf0a21069e38cca` to `11bba368262a4c704b0d2ebc84d14f8d316632e1af53bf5c8718c11601247034`. Justification: the same audience configuration changes with flow-audit additions removed; flow-audit behavior is unchanged.

BusyBox remains `sha256:9db7b59979c38555a39def84a31fb98b5296952f9e3afd4f6f11f05b07adfab0`. Staging's public issuer base remains `https://iam.baas.musematic.ai` without `/auth`, its JWKS base `http://falcone-keycloak:8080`, and its gatewayPolicy OIDC settings remain unchanged. Prod host placeholders remain an operator release gate. External Secrets/OpenBao and deterministic Helm rendering are preserved.

## Mandatory operator rollout order

1. Keep staging enforcement false. Keep `tenantAudience` at `falcone-data-api` and validate all ordered values layers with `node scripts/validate-deployment-chart.mjs --values <layer> ...`. Gateway, executor, provisioners and reconciliation must use the same audience. Admin/DB credentials must come from existing Secret-backed environment, never code/logs.
2. In an operator window, run reconciliation dry-run, apply, then apply again. Retain redacted evidence of zero failures and zero second-run repairs. Repair absent tenant-app clients or conflicting mappers before proceeding.
3. Audit required console/service-account callers for every executor-served route and prepare their audiences. Reconcile prod too, supply real prod hosts, and confirm executor egress to the public issuer host.
4. Enable staging enforcement only after that evidence in a subsequent values revision. Record the live ConfigMap SHA256/diff and rollback content, then verify Mongo and another executor-served family after the operator-gated sync.
5. Roll back by disabling enforcement or reverting the ChangeSet; added mappers may remain.

Remaining release follow-ups: run all skipped suites with frozen dependencies in CI; confirm the truncated addendum contains no further requirements; review non-tenant realm names including master, shared-IP bearer buckets/unknown-kid refresh and airgap BusyBox mirror inventory. Custom audience support requires a later paired chart repair. No deploy, merge, push, approval, credential retrieval or cluster mutation was performed. This attempt records one additional local source commit only.
