## 1. Failing black-box test

- [x] 1.1 Add a black-box test that uses Tenant B's service key against Tenant A's path on each data-plane surface (postgres, mongo, events, functions, realtime, api-keys), asserting HTTP 403. Confirm RED on the current executor.
- [x] 1.2 Add a positive black-box test: B's key on B's own path succeeds (200/201).

## 2. Fix executor authorization

- [x] 2.1 Add a centralized authorization helper that resolves the path `workspaceId`/`databaseName`/`bucketId` to its owning tenant/workspace and compares it to the credential identity.
      Implemented via `credentialWorkspaceId` field in identity objects (set for API keys and workspace-scoped JWTs) and a regex check on the URL path in the dispatcher.
- [x] 2.2 Wire the helper into every data-plane handler (postgres, mongo, events, functions, realtime, api-keys) so a mismatch returns HTTP 403 before any side effect.
      Check runs centrally in the request dispatcher after the 401 gate, before any handler or executor is invoked. Applies to all workspace-scoped routes (postgres data, mongo, events, functions, realtime, api-keys, embedding, flows, mcp). DDL routes (database-scoped) are excluded from the path check as designed.

## 3. Verify

- [x] 3.1 Re-run the cross-tenant black-box tests — confirm 403 on every verb and surface.
- [x] 3.2 Re-run the positive same-tenant tests — confirm still GREEN.
- [x] 3.3 Run `bash tests/blackbox/run.sh` to confirm no regressions. (600/600 pass)
