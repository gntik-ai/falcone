# Tasks — fix-data-api-contract-mismatches

## Reproduce (test-first)
- [ ] Add a failing black-box / live probe reproducing: Live: each mismatch reproduced against the executor (400 / invoke error / 404 / inconsistent JSON).

## Implement (kind runtime AND shippable product as applicable)
- [ ] Align the handlers with the OpenAPI-documented shapes (or correct the catalog/docs) + contract tests.

## Verify
- [ ] Black-box suite green; the live 2-tenant probe now passes.
- [ ] Acceptance: The documented shapes work; the catalog path resolves; response casing is consistent.

## Archive
- [ ] `openspec validate fix-data-api-contract-mismatches --strict`; `/opsx:archive fix-data-api-contract-mismatches` after merge.
