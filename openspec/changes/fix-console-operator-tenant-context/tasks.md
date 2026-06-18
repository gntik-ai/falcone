# Tasks — fix-console-operator-tenant-context

## Reproduce (test-first)
- [ ] Add a failing black-box / live probe that reproduces: Live: logged in as `acme-ops` (tenant_owner), the console loads no tenant context; My-plan/Members 403.

## Implement (kind runtime AND shippable product)
- [ ] Drive operator context from `/v1/workspaces` / `/v1/tenant/*` (own-scope) instead of the superadmin tenant list; fix the singular `/v1/tenant/plan` route authz — `apps/web-console` + the control-plane plan routes.
- [ ] Apply the same fix in both `deploy/kind/control-plane/*` and `apps/control-plane`/`services/*` as applicable.

## Verify
- [ ] Black-box suite green; the live 2-tenant probe now passes.
- [ ] Acceptance: An operator logs in and sees their own tenant/workspaces/plan.

## Archive
- [ ] `openspec validate fix-console-operator-tenant-context --strict`; `/opsx:archive fix-console-operator-tenant-context` after merge.
