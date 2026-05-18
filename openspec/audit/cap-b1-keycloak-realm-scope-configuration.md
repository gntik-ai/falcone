# Capability B1 — Keycloak Realm & Scope Configuration

**Source locus declared by the map:** `services/keycloak-config/scopes/` (4 YAML manifests).

**Method:** Inventoried the directory; verified no `package.json`, `src/`, `tests/`, `README`, or schema file exists (`ls -la` of `services/keycloak-config/` shows only `scopes/`). The directory is not registered in `pnpm-workspace.yaml` and is referenced nowhere outside `AGENTS.md`, `openspec/`, and `01-capability-map.md`. Then traced every scope token and role name declared in the four YAMLs across the rest of the repo to determine what — if anything — consumes the manifests, and located the *actually-executed* Keycloak provisioning path under `charts/in-falcone/`.

The summary up front: **the four YAML files in `services/keycloak-config/scopes/` are dead configuration.** Nothing loads them. The scope strings declared in them happen to also appear as string literals in TypeScript/Mjs source and APISIX route YAMLs, but the YAML→Keycloak provisioning round-trip does not exist. Keycloak is actually configured from `charts/in-falcone/values.yaml::.Values.bootstrap.oneShot.keycloak.*` via the bootstrap job, and that path provisions **none** of the authorization scopes the YAMLs declare.

---

## SPEC (what exists)

These FRs describe what the code/config actually implements today — not what the YAML manifests *claim*.

### Declarative scope manifests

- **WHEN** a reader inspects `services/keycloak-config/scopes/`, **THE SYSTEM SHALL** present four YAML files declaring nine authorization scope names with descriptions:
  - `backup-audit-scopes.yaml:2-15` — `backup-audit:read:global`, `backup-audit:read:own`.
  - `backup-operations-scopes.yaml:2-7` — `backup:write:own`, `backup:write:global`, `backup:restore:global`.
  - `backup-scopes.yaml:2-7` — `platform:admin:config:export`, `platform:admin:config:reprovision`.
  - `backup-status-scopes.yaml:2-7` — `backup-status:read:own`, `backup-status:read:global`, `backup-status:read:technical`.

- **WHEN** a YAML file declares `role_mappings`, **THE SYSTEM SHALL** record which realm role each scope is intended to grant — but only declaratively; no consumer reads or applies these mappings.
  - `backup-operations-scopes.yaml:9-15`, `backup-scopes.yaml:9-18`, `backup-status-scopes.yaml:9-21`.

- **WHEN** `backup-audit-scopes.yaml` describes a scope, **THE SYSTEM SHALL** record the intended role inline on the scope entry as a `roles:` list (different shape than the other three files).
  - `backup-audit-scopes.yaml:6-8, 14-15`.

- **WHEN** `backup-status-scopes.yaml` declares a service account, **THE SYSTEM SHALL** record `service_account_collector` with `scopes: []` and a description (no other YAML uses this section).
  - `backup-status-scopes.yaml:23-27`.

### Scope enforcement (what actually runs, even though it doesn't consume the YAMLs)

- **WHEN** an HTTP request hits a `/v1/backup-audit/...` route, **THE SYSTEM SHALL** enforce the scope literal at the gateway via APISIX consumer-group `required_scopes`.
  - `services/gateway-config/routes/backup-audit-routes.yaml:8` (`required_scopes: ["backup-audit:read:own"]`).

- **WHEN** an HTTP request hits a `/v1/backup-status/...` route, **THE SYSTEM SHALL** enforce `backup-status:read:own` at the gateway.
  - `services/gateway-config/routes/backup-status-routes.yaml:10`.

- **WHEN** an HTTP request hits backup-operation routes, **THE SYSTEM SHALL** enforce `backup:write:own` (initiate) and `backup-status:read:global` / `backup:restore:global` (admin) at the gateway.
  - `services/gateway-config/routes/backup-operations-routes.yaml:10, 32, 71`.

- **WHEN** `query-audit.action.ts` receives a token, **THE SYSTEM SHALL** return audit rows only when the token carries `backup-audit:read:global` or `backup-audit:read:own`.
  - `services/backup-status/src/operations/query-audit.action.ts:62-63`.

- **WHEN** `backup-status.action.ts` handles a status request, **THE SYSTEM SHALL** return 403 if the caller lacks `backup-status:read:own`; if `?tenant_id` is omitted, **THE SYSTEM SHALL** require `backup-status:read:global` to permit a global view; technical infrastructure identifiers **SHALL** appear only when the caller carries `backup-status:read:technical`.
  - `services/backup-status/src/api/backup-status.action.ts:86-101`.
  - Technical-field gating reused in `services/backup-status/src/operations/get-operation.action.ts:90`.

- **WHEN** `trigger-backup.action.ts` handles a request, **THE SYSTEM SHALL** require at least `backup:write:own`; the requester role recorded with the operation **SHALL** be `'sre'` when the token carries `backup:write:global`, otherwise `'tenant_owner'`.
  - `services/backup-status/src/operations/trigger-backup.action.ts:55-57, 129`.

- **WHEN** `trigger-restore.action.ts`, `initiate-restore.action.ts`, or `confirm-restore.action.ts` receive a request, **THE SYSTEM SHALL** require the caller to carry either `backup:restore:global` OR the literal `superadmin` in the token's `scopes` array.
  - `services/backup-status/src/operations/trigger-restore.action.ts:279`; `services/backup-status/src/api/initiate-restore.action.ts:20`; `services/backup-status/src/api/confirm-restore.action.ts:21`; `services/backup-status/src/confirmations/second-factor/second-actor-verifier.ts:10`.

- **WHEN** `confirmations.service.ts` evaluates a restore confirmation, **THE SYSTEM SHALL** permit an actor different from the original requester only if that actor carries `backup:restore:global`.
  - `services/backup-status/src/confirmations/confirmations.service.ts:503`.

- **WHEN** `tenant-config-identifier-map.mjs` (and other `tenant-config-*` actions in `services/provisioning-orchestrator/src/actions/`) authorize a request, **THE SYSTEM SHALL** require `platform:admin:config:reprovision` in the caller's `auth.scopes` and return `403 Forbidden` otherwise; an actor with `payload.azp && !roles.includes('tenant_owner') && scopes.includes('platform:admin:config:reprovision')` is classified `actor_type = 'service_account'`.
  - `services/provisioning-orchestrator/src/actions/tenant-config-identifier-map.mjs:27, 53, 55-56`.

### Keycloak provisioning (the path actually executed at install time)

- **WHEN** the Helm release runs with `bootstrap.enabled = true`, **THE SYSTEM SHALL** synthesise per-resource JSON payload files into a ConfigMap from `.Values.bootstrap.oneShot.keycloak.{realm, superadmin, tenantRealmTemplate, realmRoles[], clientScopes[], clients[]}`.
  - `charts/in-falcone/templates/bootstrap-payload-configmap.yaml:15-32`.

- **WHEN** the bootstrap job runs, **THE SYSTEM SHALL** call Keycloak's admin API to (1) ensure the realm, (2) create every `role-*.json` payload as a realm role, (3) create every `client-scope-*.json` payload as a Keycloak client-scope, (4) create every `client-*.json` payload as a client, and (5) create the superadmin user and assign it the `superadmin` realm role.
  - `charts/in-falcone/templates/bootstrap-script-configmap.yaml:121-152` (realm), `:155-188` (roles), `:191-220` (client scopes), `:223-252` (clients), `:255-327` (superadmin user + role mapping), `:366-378` (driver loop).

- **WHEN** the bootstrap creates realm roles, **THE SYSTEM SHALL** create the 16 roles listed at `charts/in-falcone/values.yaml:274-289` (superadmin, platform_admin, platform_operator, platform_auditor, tenant_owner, tenant_admin, tenant_developer, tenant_viewer, workspace_owner, workspace_admin, workspace_developer, workspace_operator, workspace_auditor, workspace_viewer, workspace_service_account).

- **WHEN** the bootstrap creates client-scopes, **THE SYSTEM SHALL** create the four identity-context scopes (`tenant-context`, `workspace-context`, `plan-context`, `workspace-roles`) each carrying an OIDC user-attribute mapper.
  - `charts/in-falcone/values.yaml:290-359`.

- **WHEN** the bootstrap creates clients, **THE SYSTEM SHALL** create the bearer-only `in-falcone-gateway` client and the public `in-falcone-console` client, each with the four identity-context scopes as default client scopes.
  - `charts/in-falcone/values.yaml:360-398`.

---

## GAPS

1. **The four YAML manifests are dead — no consumer loads them.**
   `grep -rn "backup-audit-scopes\|backup-status-scopes\|backup-operations-scopes\|backup-scopes.yaml" services scripts charts helm tests` returns zero hits. No loader, no validator, no schema. `services/keycloak-config/` has no `package.json`, no `README`, no consumer; it is not listed in `pnpm-workspace.yaml`. The audit-map's "Declarative Keycloak scope definitions consumed by the gateway and downstream RBAC checks" is wrong about the consumption claim: the YAMLs are not consumed, the literal strings are simply re-typed in each enforcer's code.

2. **None of the nine authorization scopes is created in Keycloak.**
   Bootstrap's `client-scope-*.json` files are generated only from `.Values.bootstrap.oneShot.keycloak.clientScopes` (`bootstrap-payload-configmap.yaml:25-28`), which contains only the four identity-context scopes (`values.yaml:290-359`). Keycloak therefore knows nothing about `backup-audit:read:*`, `backup-status:read:*`, `backup:write/restore:*`, or `platform:admin:config:*`. Any token issued by Keycloak will lack these scopes; every enforcer in `services/backup-status/src/` and `services/provisioning-orchestrator/src/actions/tenant-config-*.mjs` will reach its 403 branch unless tokens are externally minted or scopes are added by an out-of-band step that is not in this repo.

3. **The `sre` role is referenced everywhere but declared nowhere.**
   - `backup-audit-scopes.yaml:7`, `backup-operations-scopes.yaml:10`, `backup-scopes.yaml:13`, `backup-status-scopes.yaml:14` all assert `sre` as a role.
   - `services/backup-status/src/operations/trigger-backup.action.ts:129` records `'sre'` as a requesterRole; tests across `tests/e2e/workflows/restore/*.test.mjs` use `actor_type: 'sre'`.
   - **But** the realm roles list at `charts/in-falcone/values.yaml:274-289` (the only path that actually creates roles in Keycloak) does **not** include `sre`. There are `platform_admin`, `platform_operator`, `platform_auditor` instead — none of which appear in the scope YAMLs or in the enforcement code.
   - Result: `sre` is a phantom role. A real SRE in a deployed system has no realm role by that name to assign.

4. **YAML schema inconsistency.** The four files use three different shapes — `backup-audit-scopes.yaml` puts roles inline on each scope; `backup-operations-scopes.yaml` and `backup-scopes.yaml` use a separate `role_mappings:` map at the bottom; `backup-status-scopes.yaml` adds a `service_accounts:` section. No schema, no `validate:scope-manifests` script, no normalisation. Drift is not detectable.

5. **`backup:write:own` has no role mapping in `backup-scopes.yaml`.**
   `backup-scopes.yaml:9-15` lists `role_mappings:` only for `sre` and `superadmin`, both bound to the `:global` and `:restore:global` scopes. `backup:write:own` is declared (`:2-3`) but mapped to no role, despite `trigger-backup.action.ts:55-57` requiring it for the per-tenant write path. Compare with `backup-status-scopes.yaml:10-13` which correctly maps `backup-status:read:own` to `tenant_owner` and `workspace_admin`.

6. **Code mixes "role" and "scope" as if they're the same token bucket.**
   `services/backup-status/src/operations/trigger-restore.action.ts:279` — `token.scopes.includes('backup:restore:global') || token.scopes.includes('superadmin')`. `superadmin` is a *realm role*, not a scope. The same conflation appears in `initiate-restore.action.ts:20`, `confirm-restore.action.ts:21`, `second-actor-verifier.ts:10`, `tests/unit/backup-restore-sandbox.test.mjs:121` (`scopes: ['backup:read:global', 'backup-status:read:technical']` — the test then passes `backup:read:global` which is not declared in any scope YAML).

7. **Scope literal `backup:read:global` is enforced/tested but not declared anywhere.**
   - Used in `tests/unit/backup-restore-sandbox.test.mjs:121` and `services/backup-status/test/integration/backup-operations-api.test.ts:26` (token fixture).
   - Not in `backup-scopes.yaml`, not in `backup-operations-scopes.yaml`, not in `backup-status-scopes.yaml`.
   - Either the tests are asserting against a non-existent scope, or the scope is missing from the manifests. Either way, the manifests are not the source-of-truth they claim to be.

8. **`service_account_collector` is declared but unreferenced.**
   `backup-status-scopes.yaml:23-26` declares it with `scopes: []` and a comment "no public API scopes". `grep -rn service_account_collector` returns hits only in `AGENTS.md` and `openspec/`. There is no code that creates this Keycloak user/service account.

9. **Asymmetric authorization-scope vs. role-claim handling in the gateway.**
   `charts/in-falcone/templates/bootstrap-payload-configmap.yaml:140-141` propagates `$jwt_claim_scope` and `$jwt_claim_realm_access_roles` as separate headers (`X-Auth-Scopes` and the roles header). Downstream code uses *either* depending on the file — `backup-status.action.ts:88` reads `claims.scopes`, but `platform-admin-routes.yaml:11` declares `required_roles: ["superadmin", "sre"]` (role-based). No central policy says which authorisation taxonomy (scopes vs. realm roles) wins for which endpoint family.

10. **No tests for the scope manifests themselves.**
    No `tests/contracts/scope-manifests.test.mjs` or equivalent. No script under `scripts/` validates that (a) every scope literal referenced in code is declared in a manifest, (b) every role named in a manifest exists in `values.yaml::realmRoles`, or (c) the manifest shape is consistent across files. The full validator list in `package.json:scripts` (lines 16-43 of root `package.json`) does not include any `validate:scopes` step.

11. **External-secrets pulls Keycloak credentials but does not seed scopes.**
    `charts/in-falcone/charts/eso/templates/external-secrets/iam-keycloak.yaml` is the only ESO Keycloak resource; it provides credentials for the bootstrap job to call the admin API. It does not load `services/keycloak-config/scopes/*.yaml`.

12. **Bootstrap fail-open on scope creation.**
    `bootstrap-script-configmap.yaml:191-220` (`ensure_keycloak_client_scope`) does a simple `grep -q '"name":"$scope_name"'` over the list response to detect existence. If the list response is paginated and the scope happens to be on page 2, the function will issue a duplicate-create POST (`:207-211`) and log an error (`:215-218`), but not abort. No pagination handling is visible.

---

## BUGS

### Confirmed (logic clearly wrong / declared resource missing)

- **B1. Phantom `sre` role.**
  `services/keycloak-config/scopes/backup-audit-scopes.yaml:7`, `backup-operations-scopes.yaml:10`, `backup-scopes.yaml:13`, `backup-status-scopes.yaml:14` all bind scopes to a realm role named `sre`. The chart-driven realm-role creator at `charts/in-falcone/values.yaml:274-289` creates `platform_admin`, `platform_operator`, `platform_auditor` — not `sre`. Confirmed by direct grep: `grep -n '^\s*- sre' charts/in-falcone/values.yaml` returns nothing. Any token-issuance flow that tries to assign `sre` will fail; code that records `'sre'` as a requesterRole (`trigger-backup.action.ts:129`) writes a string that doesn't correspond to a Keycloak realm role.

- **B2. None of the nine declared authorization scopes is actually provisioned in Keycloak.**
  Bootstrap reads scopes from `.Values.bootstrap.oneShot.keycloak.clientScopes` (`charts/in-falcone/templates/bootstrap-payload-configmap.yaml:25-28`). That list contains only `tenant-context`, `workspace-context`, `plan-context`, `workspace-roles` (`charts/in-falcone/values.yaml:290-359`) — all identity-context mappers, none of the nine authorisation scopes the YAML manifests declare. End-to-end consequence: a fresh install issues tokens that never carry `backup-audit:read:global`, `backup-status:read:own`, `platform:admin:config:reprovision`, etc. Every protected endpoint reaches its 403 path. Confirmed by inspection of both source paths.

- **B3. Test fixtures use a scope that doesn't exist in any manifest.**
  `tests/unit/backup-restore-sandbox.test.mjs:121` and `services/backup-status/test/integration/backup-operations-api.test.ts:26` pass `'backup:read:global'` in the token's `scopes` array. No YAML declares this scope. Either the test is fabricating an undeclared scope (false positive) or the manifests are missing a real scope (production gap). Confirmed mismatch.

- **B4. YAML shape is not normalised.**
  `backup-audit-scopes.yaml` uses inline `roles:` per scope (`:6-8, :14-15`). The other three files use a separate top-level `role_mappings:` block. Any consumer that tried to parse both forms would need divergent logic; no consumer exists, so the bug is invisible — but the schemas are objectively incompatible.

### Likely (smells, fail-open behaviours, asymmetric checks)

- **B5. Realm-role propagation conflated with scope propagation in enforcement code.**
  `services/backup-status/src/operations/trigger-restore.action.ts:279` —
  ```ts
  if (!token.scopes.includes('backup:restore:global') && !token.scopes.includes('superadmin')) { ... }
  ```
  `superadmin` is a realm role, not a scope. If the gateway propagates roles into `realm_access.roles` (per `bootstrap-payload-configmap.yaml:141`) and scopes into a separate header, then `token.scopes.includes('superadmin')` will be `false` for an actual superadmin and this code degrades to scope-only enforcement — meaning a superadmin without `backup:restore:global` is denied. Likely a real defect; same pattern in `initiate-restore.action.ts:20`, `confirm-restore.action.ts:21`, `second-actor-verifier.ts:10`.

- **B6. `backup:write:own` has no documented role binding.**
  `backup-scopes.yaml:9-15` maps `role_mappings:` only for `sre` and `superadmin` (both to the `:global` scopes). `backup:write:own` (`:2-3`) has no role binding in the file. Compare with `backup-status-scopes.yaml:10-13` which correctly binds `backup-status:read:own` to `tenant_owner` and `workspace_admin`. Tenant_owner is therefore *intended* to do per-tenant writes (per `trigger-backup.action.ts:129` recording `requesterRole: 'tenant_owner'` when not global), but the manifest doesn't say so. Likely a missing entry.

- **B7. `query-audit.action.ts` enforces no tenant scoping on `backup-audit:read:own`.**
  `services/backup-status/src/operations/query-audit.action.ts:62-63` only checks `hasGlobal`/`hasOwn` boolean. The YAML at `backup-audit-scopes.yaml:11-13` describes `:read:own` as redacting sensitive fields and limiting to the authenticated tenant, but the code's tenant filter logic isn't visible in this two-line excerpt. Need to read the rest of `query-audit.action.ts` to verify the tenant filter is applied when `hasOwn && !hasGlobal`. Smell; needs verification.

- **B8. Pagination not handled in `ensure_keycloak_client_scope`.**
  `charts/in-falcone/templates/bootstrap-script-configmap.yaml:191-220` — the function fetches `/admin/realms/$REALM/client-scopes` (`:200`) and does `grep -q '"name":"$scope_name"'` on the response (`:202`). Keycloak admin API returns a JSON array; default behaviour does not paginate, but for very large realms this is undocumented. If a future scope ends up on page 2, the duplicate-create at `:207-211` returns 409 from Keycloak, the error path at `:213-218` logs and *returns 1* (`:218: echo ... ; return 1`), and the calling loop at `:376-381` calls this inside `for scope_file in "$PAYLOAD_DIR"/client-scope-*.json; do`. Without `set -e` at the function level, `return 1` propagates only if the loop is also `&& exit 1`. Worth a careful read of the script's error policy — fail-open if `set -e` is absent.

- **B9. Two completely independent Keycloak configuration sources.**
  Source 1 (`services/keycloak-config/scopes/*.yaml`) and source 2 (`charts/in-falcone/values.yaml::bootstrap.oneShot.keycloak.*`) describe overlapping concepts (realm roles, scopes) with no cross-reference and no validator. The fact that source 2 declares roles like `platform_admin/platform_operator/platform_auditor` while source 1 declares `sre` suggests they were authored independently and never reconciled. Likely-to-blow-up: any operator following one file will end up with a broken installation.

### Needs verification (requires running code or larger reads)

- **B10. `services/backup-status/src/operations/query-audit.action.ts` tenant-filter on `hasOwn`.**
  Only lines 62-63 were read. Need to confirm that when `hasOwn && !hasGlobal`, the SQL/HTTP query is constrained to `tenant_id = token.tenantId`, and that sensitive fields are redacted, as the manifest claims (`backup-audit-scopes.yaml:11-13`). If not, B1's "own" tier silently behaves like "global".

- **B11. Token shape — does the gateway actually propagate Keycloak `realm_access.roles` into `token.scopes`?**
  `bootstrap-payload-configmap.yaml:140-141` propagates them as separate headers (`scopes` ← `$jwt_claim_scope`, `roles` ← `$jwt_claim_realm_access_roles`). The downstream `BackupStatusToken` (or equivalent type) imported in `backup-status.action.ts` likely has separate `scopes` and `roles` fields, in which case the `includes('superadmin')` calls in B5 are *certain* to fail. Need to read the token validator at `services/backup-status/src/api/backup-status.auth.ts` to confirm. Listed as "likely confirmed" pending that read.

- **B12. Does any out-of-band job assign `backup-status:read:own`/etc. to Keycloak users at signup?**
  Not visible in `services/keycloak-config/`, not visible in `bootstrap-script-configmap.yaml`. There may be a runtime path (e.g., a console-auth workflow under `apps/control-plane/src/workflows/wf-con-001-user-approval.mjs`) that adds scopes when activating a tenant_owner. Needs a wider grep across `apps/control-plane/src/workflows/`.

---

## Scope note for downstream spec authoring

Capability B1 as drawn in `01-capability-map.md` does not exist as a working subsystem. It is two unrelated artefacts:

- **B1a — Dead YAML manifests.** The four files under `services/keycloak-config/scopes/`. Could be re-purposed as a future single source-of-truth, but currently a documentation fossil. Should not have FRs written against it as if it were a system.
- **B1b — Actual Keycloak provisioning via Helm.** Lives in `charts/in-falcone/{values.yaml,templates/bootstrap-*.yaml,charts/eso/templates/external-secrets/iam-keycloak.yaml}`. This is what runs at install time. Its scope/role taxonomy disagrees with B1a in several places (Bug B1, B2, B3).
- **B1c — Per-service scope enforcement** scattered across `services/backup-status/src/`, `services/provisioning-orchestrator/src/actions/tenant-config-*.mjs`, and `services/gateway-config/routes/`. This *uses* the scope literals but never references either B1a or B1b. Each enforcer hard-codes its required strings.

Any OpenSpec proposal that treats B1 as one coherent capability will inherit those inconsistencies. The right next step is either: (1) write a proposal that promotes the YAMLs to source-of-truth and adds a generator+validator that emits both `values.yaml` clientScopes/realmRoles and a TypeScript const map consumed by the enforcers; or (2) delete the YAMLs and hoist the truth into `values.yaml` plus a generated TypeScript scope-constants module. Either way, the current three-way split must be collapsed before FRs are written.
