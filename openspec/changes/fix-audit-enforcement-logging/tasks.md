# Tasks — fix-audit-enforcement-logging

## Reproduce (test-first)
- [ ] Add a failing black-box / live probe reproducing: Live: a 4th-workspace create -> 402 QUOTA_EXCEEDED and a cross-tenant access -> 403, yet both tables have 0 rows.

## Implement (kind runtime AND shippable product as applicable)
- [ ] Write an audit record at each enforcement point with the correlation id.

## Verify
- [ ] Black-box suite green; the live 2-tenant probe now passes.
- [ ] Acceptance: A 402/403 produces a correlated audit row.

## Archive
- [ ] `openspec validate fix-audit-enforcement-logging --strict`; `/opsx:archive fix-audit-enforcement-logging` after merge.
