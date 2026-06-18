# Tasks — fix-events-topic-tenant-scope

## Reproduce (test-first)
- [x] Add a failing black-box probe that reproduces the cross-tenant Events IDOR: `tests/blackbox/events-topic-tenant-scope.test.mjs` (tenant B reads/publishes/streams tenant A's topic).

## Implement (kind runtime AND shippable product)
- [x] Scope every topic-id route by the caller's verified `tenant_id` (resolve topic→tenant, 404 on mismatch), mirroring the executor's workspace-ownership guard, in `deploy/kind/control-plane/kafka-handlers.mjs` (`resolveTopic` + `eventsTopicStream`). Workspace routes (`eventsInventory`/`eventsProvisionTopic`) gated by `resolveOwnedWorkspace`.
- [x] Shared `callerTenantScope` helper in `deploy/kind/control-plane/tenant-scope.mjs`. The shippable product path (executor data-plane) already scopes events by workspace ownership; the kind control-plane glue was the unscoped site, so the fix is confined there.

## Verify
- [x] Black-box suite green (`bash tests/blackbox/run.sh` → 718 pass); new probe `events-topic-tenant-scope` 8/8.
- [x] Acceptance: Cross-tenant topic detail/metadata/publish/stream → 404; same-tenant + superadmin unaffected (200).

## Archive
- [ ] `openspec validate fix-events-topic-tenant-scope --strict` (passing); `/opsx:archive fix-events-topic-tenant-scope` after merge.
