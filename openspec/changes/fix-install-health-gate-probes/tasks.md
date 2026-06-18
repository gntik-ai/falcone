# Tasks — fix-install-health-gate-probes

## Reproduce (test-first)
- [ ] Add a failing black-box / live probe reproducing: Live: gate FAILs on apisix /health (but POST /v1/auth/login-sessions -> 400, GET /v1/tenants -> 401) and ferretdb TCP (but ferretdb TCP OK from the executor pod).

## Implement (kind runtime AND shippable product as applicable)
- [ ] Probe paths/clients that reflect real health (e.g. a known-routed `/v1/*` path; an allowed client for ferretdb).

## Verify
- [ ] Black-box suite green; the live 2-tenant probe now passes.
- [ ] Acceptance: The health gate passes when the platform is actually healthy.

## Archive
- [ ] `openspec validate fix-install-health-gate-probes --strict`; `/opsx:archive fix-install-health-gate-probes` after merge.
