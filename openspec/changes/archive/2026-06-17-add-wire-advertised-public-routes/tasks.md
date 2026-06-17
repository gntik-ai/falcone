## 1. Failing black-box test

- [x] 1.1 Add a parity test asserting object I/O is wired (not NO_ROUTE) and the catalog advertises the real path. — `tests/blackbox/storage-object-io-routes.test.mjs`: GET/PUT/DELETE `/v1/storage/buckets/{bucketId}/objects/{objectKey}` are registered to tenant-scoped handlers, and the published catalog advertises that path (not the old unwired `/v1/objects/{bucket}/{key}`).

## 2. Reconcile the surface

- [x] 2.1 Enumerate advertised-but-unwired routes. — verified against the runtime: of the gateway-config catalog, the largest real gap was object I/O (handlers existed, no route); MOST other "unwired" routes are **superseded by workspace-scoped paths** already in the runtime (e.g. `/v1/api-keys`→`/v1/workspaces/{id}/api-keys`, `/v1/functions/{id}/invoke`→`/v1/functions/workspaces/{ws}/actions/{name}/invocations`, bare `/v1/schemas`→`/v1/postgres/workspaces/{ws}/data/...`) — i.e. catalog staleness, not missing function. A few had **zero handler** (`/v1/analytics/query`, `/v1/services/configure`, `/v1/functions/{id}/config`).
- [x] 2.2 Wire or remove. — **WIRED** object I/O: `storagePutObject`/`storageGetObject`/`storageDeleteObject` in `deploy/kind/control-plane/storage-handlers.mjs` (using s3 `putObject`/new `getObject`/`deleteObject`, bucket-owner gated) + routes in `routes.mjs`; the catalog's generic `/v1/objects/{bucket}/{key}` is repointed to the real `/v1/storage/...` path. **PRUNED** the 3 zero-handler routes from `services/gateway-config/public-route-catalog.json` (54 routes now). Note: superseded families are left at their workspace-scoped runtime paths (not duplicated at the stale generic paths) — a follow-up may also drop those stale catalog aliases.

## 3. Verify

- [x] 3.1 Re-run — object I/O wired, catalog aligned. — `tests/blackbox/storage-object-io-routes.test.mjs` 2/2; catalog blackbox + `public-api.catalog` contract tests 14/14 after the edits. Live object round-trip (upload→download→delete vs SeaweedFS) proven on test-cluster-b (see batch live gate).
- [x] 3.2 Run `bash tests/blackbox/run.sh` — included in the batch run.
