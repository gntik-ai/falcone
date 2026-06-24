# Tasks: add-console-secrets-management

> Implementation breakdown for a separate build step. All boxes UNCHECKED (this is a proposal).
> Backend changes edit **existing** kind-CP modules only — **no new `.mjs` file**, so the kind-CP
> Dockerfile COPY list MUST stay unchanged.

## 1. Backend — kind control-plane runtime (`secrets` MODIFIED)

- [x] 1.1 `deploy/kind/control-plane/routes.mjs`: register one new route
  `PUT /v1/functions/workspaces/{workspaceId}/secrets/{secretName}` → `localHandler:'secretReplace'`,
  `auth:'authenticated'` (alongside the existing `secretSet`/`secretList`/`secretGet`/`secretDelete`).
- [x] 1.2 `deploy/kind/control-plane/fn-handlers.mjs`: add `secretReplace(ctx)` — mirror `secretSet`
  (the `vaultStore` `501` guard, `ownedWorkspace` `404`, `validName` + non-empty/`maxLength 65535`
  value validation), reading `secretName` from the path and the value from `b.secretValue ?? b.value`;
  perform the **replace** (write at the same path, prior value superseded) and return the metadata shape
  (no value).
- [x] 1.3 `deploy/kind/control-plane/fn-handlers.mjs`: make `secretSet` (`POST`) **create-only** — before
  writing, check the secret does not already exist for the workspace (via `getMeta`); if it exists return
  `409` (e.g. `SECRET_ALREADY_EXISTS`) and do **not** overwrite. The create-vs-replace split is `POST` =
  create-only (`409` on conflict), `PUT` = replace-only — backing the console's `409`-on-duplicate
  behavior and the advertised POST `409`. (No new route; `POST`/`PUT` already in the catalog.)
- [x] 1.4 `deploy/kind/control-plane/fn-handlers.mjs`: widen `secretSet`, `secretList`, `secretGet`, and
  the new `secretReplace` responses to **exactly** the advertised `FunctionWorkspaceSecret` metadata
  (`secretName` — keep `name` as an alias —, `tenantId = ws.tenant_id`, `workspaceId = ws.id`,
  `resolvedRefCount`, `timestamps {createdAt, updatedAt}`, optional `description`), with
  `tenantId`/`workspaceId` taken from the resolved workspace, never the body. The schema is
  `additionalProperties: false`, so do **not** add any field outside it — in particular **no** KV `version`
  in any response body (KV-v2 versioning stays internal).
- [x] 1.5 `deploy/kind/control-plane/vault-secrets.mjs`: extend `createWorkspaceSecretStore` to
  (a) read KV v2 **metadata** times (`{mount}/metadata/{path}`) for `timestamps`; (b) accept and persist
  a non-secret `description` (reserved key in the KV `data` map, e.g. `_desc`, **or** KV custom-metadata)
  and return it from `getMeta`/`list`; (c) add the `replace` path used by `secretReplace` and an
  existence check used by the create-only `secretSet` (PUT and POST share the KV write; the distinction is
  the pre-write conflict check). The read path MUST **whitelist** returned keys so it returns
  `_desc`/metadata but **never** `value` — keep `getValue` the sole value-returning method and server-only.
- [x] 1.6 `resolvedRefCount`: compute best-effort from the workspace's function registry — scan the
  workspace's `fn_actions` rows' declared secret refs (`b.execution.secrets`) for `secretName` via the
  existing Postgres store; return `0` when not cheaply computable. It is **advisory** (used only for the
  pre-delete warning), never a hard delete gate.
- [x] 1.7 Confirm `name`/`secretName` and `value`/`secretValue` aliasing on the write side stays
  backward-compatible (existing callers reading `{name, version}` keep working); add `secretName` without
  removing `name`.
- [ ] 1.8 Live-verify on kind with the secrets backend enabled (`deploy/kind/values-kind-vault.yaml`,
  OpenBao): real POST(create + `409`-on-duplicate)/PUT(replace)/GET-list/GET-meta/DELETE round-trip against
  a real KV v2 instance, asserting the KV-metadata timestamp fields and `description` storage are correct,
  and that **no response body carries a value or a `version` field** (fetch-seam unit tests cannot validate
  real OpenBao field names — verify against the live backend, per #668/#676/#683). This live check (not the
  codegen step) is the real runtime↔contract convergence guard. Revert any deploy after verification.
  > DEFERRED: the OpenBao backend is **not deployed** in the running `falcone` namespace (routes return
  > `501`) and the shared kind cluster must not be disrupted. Mitigation: the blackbox tests
  > (`tests/blackbox/console-workspace-secrets.test.mjs`, `vault-workspace-secrets.test.mjs`) drive a
  > fetch-seam fake that mirrors the **real** OpenBao KV-v2 wire shapes — data read `{data:{data,metadata}}`
  > and metadata read `{data:{created_time, updated_time, current_version}}` (the actual snake_case field
  > names) — so the `created_time`/`updated_time → timestamps.{createdAt,updatedAt}` mapping, the `_desc`
  > description round-trip, the create-only `409`, the PUT replace, and the no-value/no-version invariant are
  > exercised with the correct field names. A reviewer with the backend enabled can run the live round-trip.
- [x] 1.9 Verify `npm run generate:public-api` produces **no diff** — this confirms only that **no contract
  edit** was made (the generator round-trips the OpenAPI doc and never inspects the kind runtime); actual
  runtime↔contract agreement is proven by Task 1.8. If a diff appears, the runtime (not the contract) is
  what must change.

## 2. Frontend — web console (`web-console` ADDED)

- [x] 2.1 New client `apps/web-console/src/services/secretsApi.ts` mirroring `functionsApi.ts`:
  `listSecrets`, `getSecretMeta`, `createSecret`, `updateSecret` (PUT), `deleteSecret` — all on
  `requestConsoleSessionJson`, paths exactly `/v1/functions/workspaces/{workspaceId}/secrets[/{name}]`,
  **no value-returning method**. Read types mirror the OpenAPI `FunctionWorkspaceSecret*` schemas (no
  value field); only the write-request type carries `secretValue`.
- [x] 2.2 New page `apps/web-console/src/pages/ConsoleWorkspaceSecretsPage.tsx` (distinct from the mock
  `ConsoleSecretsPage.tsx`): bound to `console-context` `activeWorkspaceId` / `activeWorkspace.environment`;
  table of `{secretName, env-var name (UPPER_SNAKE), resolvedRefCount, timestamps, description?}` (no
  `version` column — no response carries one);
  create form (name + masked value + optional description); replace (masked value, never pre-filled);
  delete with the reference-safety confirmation; require a selected workspace (else "select a workspace"
  empty state).
- [x] 2.3 Write-only value handling in the UI: masked value input, never pre-populated from any read,
  cleared from component state after submit; no value in the DOM/URL/query/log/telemetry; no
  "reveal"/"show value" affordance.
- [x] 2.4 New route in `apps/web-console/src/router.tsx` (e.g. `path: 'workspace-secrets'`) wrapped in a
  new `RequireWorkspaceSecretsRoute` guard (sibling to `RequireSuperadminRoute`): redirect (e.g. to
  `/console/my-plan`) when the operator is neither a member of the active workspace nor a
  tenant-admin/platform role. Do **not** reuse the existing `/console/secrets` rotation route.
- [x] 2.5 New nav entry "Workspace Secrets" in `apps/web-console/src/layouts/ConsoleShellLayout.tsx`,
  shown only when the same coarse gate is satisfied (add a minimal membership/role predicate or filter the
  `navItems` array against the session). Relabel the existing rotation nav/page to disambiguate
  ("Secret Rotation"); leave the rotation pages/client untouched.
- [x] 2.6 States: distinct loading, empty (naming the active workspace + environment), client-side
  validation (name `^[a-z][a-z0-9_-]{0,62}$`, non-empty value, `maxLength 65535`), and distinct error
  rendering for `400`/`404`(secret)/`404`(workspace → generic "not available")/`409`/`413`/`429`/
  plan-`403`/`403`(authz)/`501 SECRETS_BACKEND_DISABLED`/`502`. Always defer to the server for mutate
  authority (render `403` as a clean auth error; never client-trust). Refresh the list after each mutation.

## 3. The wire / contract

- [x] 3.1 No contract change: confirm the five `function_workspace_secret` routes in
  `services/internal-contracts/src/public-route-catalog.json` and the `FunctionWorkspaceSecret*` schemas in
  `apps/control-plane/openapi/families/functions.openapi.json` already describe the target surface; the
  runtime is brought into agreement with them (the console's contract-faithful TS types are correct only
  after §1 convergence).
- [x] 3.2 Console read types == OpenAPI `FunctionWorkspaceSecret` / `FunctionWorkspaceSecretCollection`;
  write == `FunctionWorkspaceSecretWriteRequest`. Tolerate the runtime `name`↔`secretName` alias only
  during the transition; read `secretName` canonically. Headers (`Idempotency-Key` auto on non-GET,
  `X-API-Version`, `X-Correlation-Id`, `Authorization`) are inherited from the existing console HTTP layer
  — no SDK/codegen change beyond the new TS client.

## 4. Tests (black-box, public interface / real UI only)

- [x] 4.1 Backend black-box (`tests/blackbox/…`): route+handler+catalog wiring for all five ops incl. the
  new PUT; metadata shape on POST/PUT/GET-list/GET-meta is **exactly** `{secretName, tenantId, workspaceId,
  resolvedRefCount, timestamps, description?}` with **no `version`** field (and no value); `POST` on an
  existing name → `409` (create-only, no overwrite — assert the stored value is unchanged) while `PUT`
  replaces the value; `400` on bad name/empty/over-length value; `501` when the backend is disabled.
- [x] 4.2 **Write-only assertion:** assert that **no secret value appears in any response body** of any
  secret op (create/replace/list/metadata/delete), and (UI) that no stored value is ever present in the
  rendered DOM, the URL/query string, or client telemetry.
- [x] 4.3 **Isolation / IDOR denial:** cross-tenant — tenant B targeting tenant A's workspace id →
  `404 WORKSPACE_NOT_FOUND` with no existence leak (and a positive control: A's own access succeeds);
  cross-workspace — tenant A, W1 selected, W2's secrets are not listed; body-supplied
  `tenantId`/`workspaceId` cannot redirect scope.
- [x] 4.4 Console behavior: create clears the value input; list/detail render metadata only; delete shows
  the reference-safety confirmation; server `403` renders as a clean authorization error; `501` renders the
  explicit "backend unavailable" state; the route guard redirects a non-member.
- [x] 4.5 Run `bash tests/blackbox/run.sh` (secrets subset) green; run the console test build where
  applicable (respecting the known-broken web-console baseline — new tests pass, the failing set is
  unchanged).

## 5. Docs / nav

- [x] 5.1 Document the Workspace Secrets console screen and the PUT-replace + metadata runtime convergence
  in the relevant API/console guide (write-only invariant, the `501` default-off state, and the pre-delete
  reference-safety warning).
- [x] 5.2 Confirm the nav relabel cleanly disambiguates the new "Workspace Secrets" screen from the
  existing superadmin "Secret Rotation" pages.
