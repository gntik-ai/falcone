# Tasks — add-audit-write-and-scope-enforcement-store

## Reproduce (test-first)
- [ ] Add a failing black-box / live probe that reproduces: Live: created users/workspaces then queried audit → 0 entries; scope-enforcement audit → 500 (missing table).

## Implement (kind runtime AND shippable product)
- [ ] Deploy/wire an audit writer + the `scope_enforcement_denials` store so actions and denials are recorded with correlation ids — kind + product.
- [ ] Apply the same fix in both `deploy/kind/control-plane/*` and `apps/control-plane`/`services/*` as applicable.

## Verify
- [ ] Black-box suite green; the live 2-tenant probe now passes.
- [ ] Acceptance: An action appears in audit-records with its correlation id.

## Archive
- [ ] `openspec validate add-audit-write-and-scope-enforcement-store --strict`; `/opsx:archive add-audit-write-and-scope-enforcement-store` after merge.
