# Tasks — fix-quota-read-tenant-scope

## Reproduce (test-first)
- [x] Failing black-box probe: `tests/blackbox/quota-read-tenant-scope.test.mjs` — a tenant operator (kind's underscore `tenant_owner` actor type) read ANOTHER tenant's `/quota/effective-limits` and `/quota/audit` (200). Root: the actions' own-tenant guard checked ONLY the canonical hyphen `tenant-owner`, which the kind never emits; other actor types were unguarded entirely.

## Implement (kind runtime AND shippable product)
- [x] Adopted the sibling `workspace-*` actions' default-deny `authorize` idiom in `services/provisioning-orchestrator/src/actions/quota-effective-limits-get.mjs` and `quota-audit-query.mjs`: superadmin/internal → any tenant; tenant-owner (accepts `tenant-owner`/`tenant_owner`/`tenant_admin`/`tenant`) → own tenant only; everyone else → 403.
- [x] No separate kind change: the kind `/v1/tenants/{id}/quota/*` routes dispatch directly to these product actions (`callercontext-overrides`), so the product fix covers both surfaces. (The other quota-class actions already tolerated both actor-type forms.)

## Verify
- [x] Black-box suite green: bbx-quota-scope-01..08 (cross-tenant effective-limits/audit for underscore + hyphen owner + non-owner → 403; own-tenant + superadmin → 200).
- [x] Contract + integration regression: `tests/contract/103-hard-soft-quota-overrides` + `tests/integration/103-hard-soft-quota-overrides` (13 tests) green.
- [x] Acceptance: cross-tenant quota reads → 403.

## Archive
- [x] `openspec validate fix-quota-read-tenant-scope --strict`; archived with the P2 batch.
