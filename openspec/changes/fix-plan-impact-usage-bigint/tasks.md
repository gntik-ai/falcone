# Tasks — fix-plan-impact-usage-bigint

## Reproduce (test-first)
- [ ] Add a failing black-box / live probe reproducing: Live: every plan assignment returns 500; both seeded tenants ended with plan=None.

## Implement (kind runtime AND shippable product as applicable)
- [ ] Change `observed_usage` (and sibling usage columns) to BIGINT.

## Verify
- [ ] Black-box suite green; the live 2-tenant probe now passes.
- [ ] Acceptance: Plan assign -> 2xx; entitlements reflect the plan; large byte usage stored without error.

## Archive
- [ ] `openspec validate fix-plan-impact-usage-bigint --strict`; `/opsx:archive fix-plan-impact-usage-bigint` after merge.
