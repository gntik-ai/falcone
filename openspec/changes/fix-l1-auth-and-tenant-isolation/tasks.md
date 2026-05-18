## 1. Failing tests

- [ ] 1.1 [test] Add a case to
      `services/backup-status/src/api/backup-status.auth.test.ts` that
      submits a JWT with a forged signature but valid base64 payload +
      unexpired `exp`; assert the auth helper rejects it under prod mode.
- [ ] 1.2 [test] Add a case to
      `services/backup-status/src/api/initiate-restore.action.test.ts`
      where the token carries the `superadmin` realm role (via
      `realm_access.roles`) and `backup:restore:global` is absent;
      assert the call succeeds (the role check is no longer dead).
- [ ] 1.3 [test] Add a case where `body.tenant_id` differs from
      `token.tenantId` and the actor does NOT carry `superadmin`;
      assert the call returns `403 TENANT_ISOLATION_VIOLATION`.

## 2. Implementation

- [ ] 2.1 [fix] Implement JWKS fetching + caching + signature
      verification in `backup-status.auth.ts:36-62`; reject tokens
      whose signature does not validate against the published keys.
- [ ] 2.2 [fix] Add `roles: string[]` to `TokenClaims`
      (`backup-status.auth.ts:5-11`); populate from
      `payload.realm_access?.roles ?? []`.
- [ ] 2.3 [fix] Replace `token.scopes.includes('superadmin')` with
      `token.roles.includes('superadmin')` at
      `initiate-restore.action.ts:20`, `:62`, and
      `confirm-restore.action.ts:21`, `:25`.
- [ ] 2.4 [fix] Add a tenant-isolation guard in
      `initiate-restore.action.ts:20-75` and
      `confirm-restore.action.ts`: when `body.tenant_id !==
      token.tenantId` and the actor does NOT carry the `superadmin`
      role, return `403 TENANT_ISOLATION_VIOLATION`.
- [ ] 2.5 [fix] Remove the `role: 'sre'` actor tagging at
      `initiate-restore.action.ts:62`; derive `actor.role` from the
      verified roles array.

## 3. Validation

- [ ] 3.1 [test] Re-run `pnpm test` and `pnpm typecheck` for
      `services/backup-status` and `openspec validate
      fix-l1-auth-and-tenant-isolation --strict`; all green.
- [ ] 3.2 [docs] Update
      `services/backup-status/README.md` (auth + restore sections) to
      reflect the new contract.
