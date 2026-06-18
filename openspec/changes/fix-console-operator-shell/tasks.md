# Tasks — fix-console-operator-shell

## Reproduce (test-first)
- [x] `tests/blackbox/console-session-endpoint.test.mjs` — fails on old code: `consoleSession` handler / route do not exist, so `GET /v1/console/session` is a 404.

## Implement (kind runtime AND shippable product as applicable)
- [x] `b-handlers.mjs`: new `consoleSession` handler — authenticated whoami returning the verified principal (never body/header identity).
- [x] `routes.mjs`: register `GET /v1/console/session` (`auth: 'authenticated'`).
- [x] Operator plan pages already use operator-authorized routes (the my-plan page reads `/v1/tenant/plan/effective-entitlements` via `getEffectiveEntitlements(undefined)`); superadmin `plans` / `tenants/:id/plan` routes are already `RequireSuperadminRoute`-gated (#569) — no SPA change needed.

## Verify
- [x] `node --test tests/blackbox/console-session-endpoint.test.mjs` green; no web-console source changed (broken vitest baseline untouched).
- [x] Acceptance: `/v1/console/session` resolves for authenticated principals (no dead 404); operator pages use own-scope routes; superadmin pages role-gated.

## Archive
- [ ] `openspec validate fix-console-operator-shell --strict`; `/opsx:archive fix-console-operator-shell` after merge.
