# Tasks — fix-iam-user-credentials

## Reproduce (test-first)
- [x] `tests/blackbox/iam-user-credentials.test.mjs` — fails on old code: the `credentialPasswordFromBody` export is absent and `iamCreateUser` read only `body.password`, dropping the credentials array.

## Implement (kind runtime AND shippable product as applicable)
- [x] `b-handlers.mjs`: new exported `credentialPasswordFromBody(body)` accepts the password from the flat `password` field OR the standard `credentials: [{type:'password', value, temporary}]` array; `iamCreateUser` uses it (passes the password + temporary flag through to Keycloak).

## Verify
- [x] `node --test tests/blackbox/iam-user-credentials.test.mjs` green; iam-realm-binding + enduser-lifecycle-management unaffected.
- [x] Acceptance: a user created with a password (flat or credentials array) can log in immediately; temporary credentials are preserved.

## Archive
- [ ] `openspec validate fix-iam-user-credentials --strict`; `/opsx:archive fix-iam-user-credentials` after merge.
