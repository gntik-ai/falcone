# Tasks — fix-governance-schema-bootstrap

## Reproduce (test-first)
- [ ] Add a failing black-box / live probe that reproduces: Live: the three endpoints 500 with PostgreSQL 42P01; the dimension catalog returns 0 rows so limits can't be defined.

## Implement (kind runtime AND shippable product)
- [ ] Ensure the control-plane schema bootstrap creates+seeds the full governance schema (or the bootstrap Job runs the governance migrations) so all provisioning-orchestrator actions resolve — kind control-plane schema + product migrations.
- [ ] Apply the same fix in both `deploy/kind/control-plane/*` and `apps/control-plane`/`services/*` as applicable.

## Verify
- [ ] Black-box suite green; the live 2-tenant probe now passes.
- [ ] Acceptance: The four endpoints return 200; a limit can be defined against a seeded dimension.

## Archive
- [ ] `openspec validate fix-governance-schema-bootstrap --strict`; `/opsx:archive fix-governance-schema-bootstrap` after merge.
