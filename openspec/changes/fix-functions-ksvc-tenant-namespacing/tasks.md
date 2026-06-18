# Tasks — fix-functions-ksvc-tenant-namespacing

## Reproduce (test-first)
- [ ] Add a failing black-box / live probe that reproduces: A deploys action `x` in its `app-staging`; B deploys action `x` in its `app-staging` (new revision on the SAME ksvc); A invokes its own function → receives B's code output (`OWNED_BY:tenantB`).

## Implement (kind runtime AND shippable product)
- [ ] Include tenant id + workspace id (or a hash) in the ksvc name and/or a per-tenant namespace; resolve invoke to the caller-scoped ksvc — in the kind `function-executor.mjs` and the product functions runtime.
- [ ] Apply the same fix in both `deploy/kind/control-plane/*` and `apps/control-plane`/`services/*` as applicable.

## Verify
- [ ] Black-box suite green; the live 2-tenant probe now passes.
- [ ] Acceptance: Two same-named workspaces across tenants get distinct ksvcs; cross-tenant invoke isolated; live probe.

## Archive
- [ ] `openspec validate fix-functions-ksvc-tenant-namespacing --strict`; `/opsx:archive fix-functions-ksvc-tenant-namespacing` after merge.
