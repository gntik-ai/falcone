# Tasks — fix-iam-route-wiring

## Reproduce (test-first)
- [x] `tests/blackbox/iam-route-wiring.test.mjs`: asserts the six catalogued IAM operations resolve to a
      handler and that each handler behaves (driven with a stub pool + injected ctx.kcAdmin).

## Implement (kind runtime AND shippable product as applicable)
- [x] `deploy/kind/control-plane/b-handlers.mjs`: add `iamGetUser`, `iamGetRole`, `iamDeleteRole`,
      `iamListRealms`, `iamGetRealm`, `iamUpdateRealm` (reusing existing kc-admin + tenant-store helpers);
      export them in `LOCAL_HANDLERS`.
- [x] `deploy/kind/control-plane/routes.mjs`: register the six route entries with the right auth gate
      (list = superadmin; realm get/update + user get = owner-or-superadmin; role get/delete = superadmin).
      (IAM is kind-runtime only; the shippable executor does not serve IAM.)

## Verify
- [x] `node --test tests/blackbox/iam-route-wiring.test.mjs` green (8/8).
- [x] Route-resolution check: all 121 kind routes resolve to a registered handler.
- [x] Acceptance: catalogued IAM routes resolve to their handlers (no 404 NO_ROUTE).

## Archive
- [ ] `openspec validate fix-iam-route-wiring --strict`; `/opsx:archive fix-iam-route-wiring` after merge.
