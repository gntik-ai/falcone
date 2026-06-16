## 1. Failing black-box test

- [ ] 1.1 Add a black-box test: create a tenant with a workspace/DB/realm/bucket/topic, then `POST /v1/tenants/{t}/purge`, asserting 2xx and that every owned resource (registry rows, DB, realm, bucket, topic, keys) is gone. Confirm RED (404 NO_ROUTE today).
- [ ] 1.2 Add a test asserting no orphaned `workspace_databases`/`async_operations` rows remain after purge.

## 2. Wire delete/purge saga

- [ ] 2.1 Add the `DELETE /v1/tenants/{t}` and `POST /v1/tenants/{t}/purge` routes.
- [ ] 2.2 Implement a cascading cleanup saga (workspaces, databases, realms, buckets, topics, keys, registry rows, async-op rows).

## 3. Verify

- [ ] 3.1 Re-run the purge black-box test — confirm every owned resource is removed and no orphans remain.
- [ ] 3.2 Run `bash tests/blackbox/run.sh` to confirm no regressions.
