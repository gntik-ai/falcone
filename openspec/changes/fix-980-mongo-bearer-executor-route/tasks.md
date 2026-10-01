## Source addendum 12 handoff (2026-10-01)

Assigned clean starting HEAD: `c73b5049ab1721329d5f1d6aab540cf57940e577`, branch `agent/falcone/980/5fcefe28-5a92-5e96-a3cd-6b1369cd20d6`. Worktree and Git metadata match the supplied lease path. R2, source repository only; prior committed #980 work is preserved.

### Completed source work

- [x] Preserve executor routing, issuer verification, gateway-policy requirements, Secret-backed gateway trust, identity-header rejection/removal, body caps, correlation and 429 behavior.
- [x] Preserve route 2006-key byte-for-byte against source base `3a7306f20454db8a90f95a93a4049305efd1bce1`.
- [x] Executor: when `KEYCLOAK_ENFORCE_TENANT_AUDIENCE=true`, require nonempty `KEYCLOAK_TENANT_AUDIENCE` in tenant token `aud` (exact string or array member). Reject `azp` substitution; preserve platform audience semantics. Reject invalid flags and missing audience/JWKS configuration at startup. Absent/false flag keeps the migration behavior. The shared verifier covers every executor tenant-token route.
- [x] Source kind route 2006 and executor overlay specify `falcone-data-api` and enforcement true. Chart standalone parity is pending the matching deployment repair.
- [x] Add `kcAdmin.ensureTenantAudienceMapper`: GET mapper list first, POST only when the stable name is absent, no-op on a matching mapper, fail visibly on conflicting/duplicate named mappers. Do not reuse `addHardcodedClaimMapper` for the audience.
- [x] Add the helper after `createTenantAppClient` in the control-plane saga and an `ensureTenantAppAudience` dependency after realm creation in WF-CON-002. The existing realm-creation adapter remains unchanged; audience setup failures stop the workflow before its tenant record. Mapper/client helper retries create no duplicates.
- [x] Add `scripts/backfill-tenant-realm-audience.mjs`: dry-run by default, `--apply`, repeat no-op, existing registered realms/tenant-app clients only, same kc-admin helper and Secret-backed environment. Missing clients and conflicting mappers fail visibly. Raw provider errors and OAuth values are never logged.
- [x] Ship the shared admin helper and reconciliation script in the executor and control-plane images so repository-relative imports and operator commands resolve.
- [x] Extend CI's disposable Mongo client with an audience mapper, add an azp-only negative client, and test 401 at gateway/direct executor. Keep CRUD, exact workspace B 403, API-key scopes/mixed credentials and per-key rate limits.
- [x] Extend proposal/spec with addendum 12 and mandatory reconciliation-before-enforcement rollout order. Keep prod placeholder hosts as a release gate and public Keycloak egress as an explicit prerequisite.
- [x] Correct the prior handoff's baseline hash mismatch using the committed deployment fixtures, without changing any fixture.

### Pin state and paired deployment work

**pin pending deployment repair**. The paired deployment HEAD remains `ef5a926bcfadf3a2e6d9136dd44bda1db221eca6`. Both workflow `FALCONE_CHARTS_REF` pins stay at that head as required by addendum 9 while deployment repairs are outstanding. This record supersedes the previous completed-pin record. The next source attempt must pin both workflows to the final deployment head and rerun full parity.

- [ ] Deployment maker: add Lua schema and exact tenant-audience enforcement, with the same string/array/no-azp and fail-closed configuration matrix.
- [ ] Deployment maker: render `gateway.mongoBearer.tenantAudience` and `enforceTenantAudience` into route 2006 and the executor ConfigMap (`KEYCLOAK_TENANT_AUDIENCE`, `KEYCLOAK_ENFORCE_TENANT_AUDIENCE`); pass the audience to both provisioning runtimes. Match source standalone routes. Default/kind true, staging false pending reconciliation; prod inherits true.
- [ ] Deployment maker: add profile render/Lua tests and update only the permitted umbrella/default and flow-audit baselines, with justifications. Preserve APISIX numeric identities, OpenShift contracts, staging `gatewayPolicy.oidc`, deterministic Helm, External Secrets/OpenBao and BusyBox registry/digest handling.

### Bounded validation

- PASS: `timeout 45s node --test --experimental-test-isolation=none tests/unit/control-plane-jwt-verify.test.mjs tests/unit/tenant-data-api-audience.test.mjs tests/blackbox/tenant-realm-token-issuance.test.mjs tests/blackbox/kind-control-plane-multirealm-jwt.test.mjs` (31/31, final run). Signed audience matrix, unchanged control-plane tenant behavior, mapper read-before-write/idempotence and reconciliation dry-run/apply/reapply/redaction. Enforcement also rejects bare-JWKS legacy configuration without a Keycloak realm topology.
- PASS: source-only `Mongo bearer route` blackbox checks (3/3), preserving upstream selection, API-key precedence and header removal.
- PASS, supplemental: gateway-policy unit and API-key contract checks (14/14), using the pre-existing read-only `/tmp/falcone-980-readonly-loader.mjs` to resolve installed toolchain YAML and chart-relative reads. Native frozen-dependency checks still belong in CI.
- PASS: workflow YAML and all Bash run-block syntax checks, kind route/executor audience configuration parity, byte-unchanged route 2006-key against base, and `git diff --check`.
- SKIPPED: native saga/slug-conflict and WF-CON-002 tests cannot import existing `kafkajs`/`cel-js` dependencies in this sandbox. Tests are implemented; PR CI must run with frozen repository dependencies. No added/updated dependency is required.
- SKIPPED: full source/chart route parity and audience renders until the paired deployment repair; the current chart still lacks the audience fields. This is an expected intermediate paired-repository state, not completion evidence.
- SKIPPED: live kind CRUD/isolation/API-key/401/429 requires Docker, a configured stack and network. LuaJIT is absent. Frozen-dependency gateway-policy/API-key/full staging contracts, image builds/scans and release gates remain PR CI/release checks.

### Prior deployment fixture evidence (corrected)

The independent checker verified the prior deployment repairs, Helm lint/render profiles and BusyBox overlay. Those are checker evidence, not reruns by this source maker. At deployment head `ef5a926b`:

- BusyBox digest: `sha256:9db7b59979c38555a39def84a31fb98b5296952f9e3afd4f6f11f05b07adfab0`, including mirror registry handling in airgap.
- Staging public issuer: `https://iam.baas.musematic.ai` (no `/auth`), in-cluster JWKS base: `http://falcone-keycloak:8080`. Managed standalone ConfigMap removes `llmwiki-s2-mongo-jwt`.
- Umbrella default render: `b18179ef33e096050c236aee0efc87c886f63ceaf06bc61269c4370225d5c15c` → `f74e1c505429b9823f5a352488ffafa674aa4af0d48b85b88cead3154cdba4fa`. Justification: verifier configuration/mounts, bearer API-key header removal and the separately pinned BusyBox overlay, preserving main's pod identities.
- Flow-audit baseline: `26c5dc19ecbb5054fc3a8565852c89def7f2456793010fe320d0fa046e56087b` → `362fb0be45c9d0cdbc6982367ce82a5319f4a43ae6c138e3aaf0a21069e38cca`. Justification: same default-render changes with flow-audit additions removed; flow-audit behavior is unchanged.

### Operator rollout gates

1. Keep staging enforcement false. Configure the same tenant audience for gateway, executor, both provisioners and reconciliation. Existing Keycloak admin/DB values must come from Secret-backed environment; never copy credentials into code/logs.
2. In an announced operator window, run reconciliation dry-run, apply, then apply again; retain redacted reports showing zero failures and zero second-run repairs. A client with a conflicting mapper or no tenant-app client needs repair before proceeding.
3. Audit required console/service-account clients for all executor routes; only tenant-app clients are automatically mapped. Reconcile prod too, supply its real hosts, and confirm executor egress to the public Keycloak host.
4. Enable staging enforcement only after that evidence in a values revision. Record live ConfigMap SHA256/diff and rollback content, then verify Mongo and another executor-served family after the operator-gated sync.
5. Roll back by setting enforcement false or reverting the ChangeSet. Added mappers may stay.

Inherited follow-ups remain: shared-IP bearer 120/min bucket; unknown-kid refresh; release review of non-tenant realm names (including master); airgap BusyBox mirror inventory. The supplied addendum remains truncated after its out-of-scope sentence; no additional requirements were inferred. No deploy, merge, push, credential retrieval or cluster mutation was performed.
