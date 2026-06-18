# Tasks — fix-events-topic-tenant-scope

## Reproduce (test-first)
- [ ] Add a failing black-box / live probe that reproduces: As `acme-ops`: `GET /v1/events/topics/{globexTopicId}`→200; `POST .

## Implement (kind runtime AND shippable product)
- [ ] Scope every topic-id route by the caller's verified `tenant_id` (resolve topic→workspace→tenant, 403/404 on mismatch), mirroring the executor's workspace-ownership guard, in both `deploy/kind/control-plane/kafka-handlers.mjs` and the product events handler.
- [ ] Apply the same fix in both `deploy/kind/control-plane/*` and `apps/control-plane`/`services/*` as applicable.

## Verify
- [ ] Black-box suite green; the live 2-tenant probe now passes.
- [ ] Acceptance: Cross-tenant topic detail/metadata/publish/stream → 403/404; same-tenant unaffected; covered by a black-box + live 2-tenant probe.

## Archive
- [ ] `openspec validate fix-events-topic-tenant-scope --strict`; `/opsx:archive fix-events-topic-tenant-scope` after merge.
