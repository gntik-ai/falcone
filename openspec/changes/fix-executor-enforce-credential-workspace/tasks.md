## 1. Failing black-box test

- [ ] 1.1 Add a black-box test that uses Tenant B's service key against Tenant A's path on each data-plane surface (postgres, mongo, events, functions, realtime, api-keys), asserting HTTP 403. Confirm RED on the current executor.
- [ ] 1.2 Add a positive black-box test: B's key on B's own path succeeds (200/201).

## 2. Fix executor authorization

- [ ] 2.1 Add a centralized authorization helper that resolves the path `workspaceId`/`databaseName`/`bucketId` to its owning tenant/workspace and compares it to the credential identity.
- [ ] 2.2 Wire the helper into every data-plane handler (postgres, mongo, events, functions, realtime, api-keys) so a mismatch returns HTTP 403 before any side effect.

## 3. Verify

- [ ] 3.1 Re-run the cross-tenant black-box tests — confirm 403 on every verb and surface.
- [ ] 3.2 Re-run the positive same-tenant tests — confirm still GREEN.
- [ ] 3.3 Run `bash tests/blackbox/run.sh` to confirm no regressions.
