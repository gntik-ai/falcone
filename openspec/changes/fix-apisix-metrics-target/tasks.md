# Tasks — fix-apisix-metrics-target

## Reproduce (test-first)
- [ ] Add a failing black-box / live probe reproducing: Live: `/api/v1/targets` shows the APISIX target DOWN; other targets UP; Grafana dashboards otherwise show real data.

## Implement (kind runtime AND shippable product as applicable)
- [ ] Expose an APISIX metrics endpoint and point the scrape config at it.

## Verify
- [ ] Black-box suite green; the live 2-tenant probe now passes.
- [ ] Acceptance: The APISIX scrape target is UP.

## Archive
- [ ] `openspec validate fix-apisix-metrics-target --strict`; `/opsx:archive fix-apisix-metrics-target` after merge.
