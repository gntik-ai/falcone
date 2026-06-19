# Tasks — add-vault-secret-consumption

## Reproduce (test-first)
- [x] Add a black-box test (`tests/blackbox/vault-workspace-secrets.test.mjs`) driving the new Vault
  KV v2 store against a faithful fake Vault — fails before the client/store exist.

## Implement (kind runtime AND shippable product as applicable)
- [x] `deploy/kind/control-plane/vault-secrets.mjs`: Vault KV v2 client + per-tenant/per-workspace
  workspace-secret store (set/getMeta/getValue/list/delete/resolveEnv) + `vaultStoreFromEnv` factory.
- [x] WRITE API: `secretSet`/`secretList`/`secretGet`/`secretDelete` in `fn-handlers.mjs`,
  workspace-ownership gated (cross-tenant → 404); routes in `routes.mjs`.
- [x] READ path: function deploy resolves declared secret refs from Vault and injects them as env
  (`fn-handlers.mjs` `fnDeploy`; `function-executor.mjs` `ksvcManifest` secretEnv).
- [x] `Dockerfile` COPY for `vault-secrets.mjs` (build fails on missing module otherwise).
- [x] kind: wire the control-plane to consume Vault in `values-kind-vault.yaml` (additive
  `envFromSecrets` + CA volume); the default `values-kind.yaml` render stays Vault-free.

## Verify
- [x] New black-box suite green (8 tests): write/read, version, list/delete, per-tenant isolation,
  env resolution, auth header, factory, auth failure.
- [x] Chart invariants hold: default kind render has zero Vault footprint (`bbx-562-vault-02`);
  the overlay renders the control-plane Vault consumption; `helm template` exits 0.
- [x] Acceptance: a secret set via the API is stored in Vault and injected (isolated per env) into a
  function.

## Archive
- [ ] `openspec validate add-vault-secret-consumption --strict`; `/opsx:archive add-vault-secret-consumption` after merge.
