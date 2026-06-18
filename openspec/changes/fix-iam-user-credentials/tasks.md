# Tasks — fix-iam-user-credentials

## Reproduce (test-first)
- [ ] Add a failing black-box / live probe reproducing: Live: register -> 201, but `GET .

## Implement (kind runtime AND shippable product as applicable)
- [ ] Pass the credentials through to Keycloak on create (or expose a set-password sub-route).

## Verify
- [ ] Black-box suite green; the live 2-tenant probe now passes.
- [ ] Acceptance: A user created with a password can immediately log in.

## Archive
- [ ] `openspec validate fix-iam-user-credentials --strict`; `/opsx:archive fix-iam-user-credentials` after merge.
