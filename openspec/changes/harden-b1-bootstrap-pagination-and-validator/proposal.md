## Why

The Keycloak bootstrap script's scope-creation helper does not handle paginated
responses from the admin API, and no validator polices the shape, coverage, or
naming of the scope manifests themselves. From
`openspec/audit/cap-b1-keycloak-realm-scope-configuration.md`:

- **B8** (`charts/in-falcone/templates/bootstrap-script-configmap.yaml:191-220`)
  — `ensure_keycloak_client_scope` fetches `/admin/realms/$REALM/client-scopes`
  (`:200`) and does `grep -q '"name":"$scope_name"'` over the response (`:202`)
  to decide whether to POST a new one. The Keycloak admin API supports
  pagination; if a scope ends up on page 2, the helper issues a duplicate POST
  (`:207-211`) and falls through to the error path (`:213-218`) that returns 1
  — but, without `set -e` at the function level, may not abort the calling
  loop at `:376-381`. Fail-open on duplicate detection.
- **G10** — no validator under `scripts/` checks (a) that every scope literal
  referenced in code is declared in a manifest, (b) that every role named in a
  manifest exists in `values.yaml::realmRoles`, or (c) that the manifest shape
  is consistent across files. The root `package.json:scripts` (lines 16-43)
  contains no `validate:scopes` step.
- **G12** — same pagination concern as B8, recorded as a gap in
  `bootstrap-script-configmap.yaml:191-220`.

## What Changes

- Rewrite `ensure_keycloak_client_scope` in
  `charts/in-falcone/templates/bootstrap-script-configmap.yaml:191-220` to
  iterate paginated `?first=&max=` requests, accumulate the full list, and
  search the accumulated set; document that `set -euo pipefail` is set at the
  function level.
- Add a duplicate-detection guard: if the create POST returns 409, log
  structured info and continue; if it returns any other error, abort the
  bootstrap loop unambiguously.
- Add `scripts/validate-scope-manifests.mjs` that enforces the manifest schema,
  cross-checks scope literals against `git grep`-discovered usage, and
  cross-checks roles against `values.yaml::realmRoles`. Wire it into
  `package.json:scripts.validate` so CI fails on drift.

## Capabilities

### Modified Capabilities

- `identity-and-access`: pagination-safe Keycloak bootstrap and a CI-enforced
  validator for the scope manifests.

## Impact

- Affected code:
  `charts/in-falcone/templates/bootstrap-script-configmap.yaml`,
  `scripts/validate-scope-manifests.mjs` (new),
  root `package.json`.
- Migrations: none (idempotent script change).
- Breaking changes: none for end users; deployments that relied on the fail-open
  duplicate-creation path will now fail loud on unexpected admin-API errors.
- Out of scope: the manifest reconciliation itself (covered by
  `fix-b1-scope-manifest-reconciliation`); role-vs-scope separation in
  enforcement code (covered by `harden-b1-role-scope-separation`).
