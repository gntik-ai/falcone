# Tasks — fix-workspace-quota-enforcement

## Reproduce (test-first)
- [ ] Add a failing black-box / live probe that reproduces: Live: `POST /v1/tenants/{id}/workspaces` succeeds past the tenant's workspace limit.

## Implement (kind runtime AND shippable product)
- [ ] Gate workspace creation on the tenant's resolved workspace-count entitlement; 4xx on breach — kind `b-handlers.mjs::createWorkspace` + product workspace command.
- [ ] Apply the same fix in both `deploy/kind/control-plane/*` and `apps/control-plane`/`services/*` as applicable.

## Verify
- [ ] Black-box suite green; the live 2-tenant probe now passes.
- [ ] Acceptance: Creating past the limit → 402/409 quota error; live probe.

## Archive
- [ ] `openspec validate fix-workspace-quota-enforcement --strict`; `/opsx:archive fix-workspace-quota-enforcement` after merge.
