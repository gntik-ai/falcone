## 1. OpenWhisk product purge (decision 3a — keep the functions API model)

- [x] 1.1 Delete the vendored OpenWhisk deployment `deploy/kind/openwhisk/` (openwhisk-deploy-kube) — done in `a413916`; directory absent.
- [x] 1.2 Delete the OpenWhisk ESO secret templates `charts/in-falcone/charts/eso/templates/external-secrets/{functions-openwhisk,platform-openwhisk}.yaml` — done in `a413916`; absent.
- [x] 1.3 Delete the disabled `openwhisk:` product subchart stanza + `backup-status` template (done in `a413916`). **DEVIATION (decision 3a):** `pvc_01openwhiskactions`, the `internalNamespaces.openwhisk` block, and the `values.schema.json` `openwhisk` entry are NOT product residue — they are the load-bearing functions API-model vocabulary cross-wired into `services/internal-contracts/src/domain-model.json` and enforced at runtime (`openwhisk-admin.mjs:502,580`). Deleting them breaks the kept functions capability, so they are RETAINED per decision 3a. `native-openwhisk-admin` exists only in an audit review `.md` (no live route).
- [x] 1.4 Delete the `backup-status` OpenWhisk-Action template — done in `a413916`; the whole `helm/charts/backup-status/templates/` dir is absent.
- [x] 1.5 Repoint OpenWhisk prose/comments to Knative — `deploy/kind/values-kind.yaml` header comment + `deploy/kind/README.md` repointed; docs-site already reframed in `a413916`. `mongo-handlers.mjs` comment was already correct.
- [x] 1.6 Verify functions still build/test — unit/contracts/adapters/blackbox green; the Knative executor + kept API model untouched.

## 2. MinIO product purge (cut over; remove the rollback toggle)

- [x] 2.1 Delete the `storage` (MinIO) subchart dependency + values block + schema — done in `a413916`; no `minio/minio` image, no `storage` alias.
- [x] 2.2 Delete MinIO image overlays in airgap/kind + `MINIO_*` env — done in `a413916`; `MINIO_*` references now zero.
- [x] 2.3 Provider defaults are `seaweedfs` (`DEFAULT_STORAGE_PROVIDER_TYPE`, `storage-bucket-object-ops.mjs` fallback); `DEFAULT_PROVIDERS = ['seaweedfs','garage']`; matching tests updated.
- [x] 2.4 Renamed `discoverMinIOBuckets` → `discoverS3Buckets` (reconcilers + commands + test); generic S3 source wording retained. `grep discoverMinIOBuckets` = 0.
- [x] 2.5 **Decision: REMOVE.** Deleted the `minio` provider definition from `storage-provider-profile.mjs` + the per-provider `minio` error-code entries in `storage-provider-verification.mjs`; `SUPPORTED_STORAGE_PROVIDER_TYPES` is now `['ceph-rgw','garage','seaweedfs']`. 14 storage tests updated.

## 3. Complete the FerretDB cutover defaults (prerequisite to the MongoDB-server purge)

- [x] 3.1 `mongodb.enabled` alias removed; `ferretdb.enabled: true`, `documentdb.enabled: true` — done in `a413916`.
- [x] 3.2 Default doc-store env repointed to FerretDB/DocumentDB across chart + `values-kind.yaml` + `executor-demo.yaml` — done in `a413916`.
- [x] 3.3 `mongo-handlers.mjs` comment already describes the FerretDB gateway (wire-protocol compatible); driver + handler logic unchanged.

## 4. MongoDB SERVER purge (after cutover completion)

- [x] 4.1 `mongodb` component-wrapper alias + server stanza + bitnami image + schema removed — done in `a413916`.
- [x] 4.2 `in-falcone-mongodb` secret/keyfile + `MONGODB_*` server env removed — done in `a413916`; only explanatory "removed" comments remain.
- [x] 4.3 `deploy/kind` `falcone-mongodb` server artifacts removed — done in `a413916`; `MONGO_*` points at FerretDB.
- [x] 4.4 KEPT: `mongodb` driver, `mongodb-data-api.mjs`/`mongodb-admin.mjs`, `mongo-data-executor.mjs`, `mongo-handlers.mjs`, `/v1/collections` routes, `mongo-cdc-bridge` (wire-protocol compatibility) — untouched.

## 5. Documentation & READMEs (exhaustive)

- [x] 5.1 docs-site old-model rewrite — the bulk was done in `a413916`; verified each remaining mention is an accurate "new vs old" contrast / "former component removed" / kept wire-protocol or functions vocabulary. One residual fixed: `operations/secret-management.md` stale `in-falcone-mongodb` → `in-falcone-documentdb`.
- [x] 5.2 Accuracy bugs: `adrs.md` ADR-14 duplicate/misplaced SeaweedFS-spike Evidence paragraph removed (its two unique facts folded into the surviving FerretDB Evidence); `seaweedfs.md` "compose still ships MinIO" was already corrected in `a413916`.
- [x] 5.3 All five translated READMEs (es/fr/de/zh/ru) + English README.md Events row: "CDC change streams" → "CDC streams fed by PostgreSQL logical replication" (incl. hyphenated/CJK variants). Backends/license table already correct.
- [x] 5.4 KEPT MongoDB wire-protocol/compatibility wording everywhere it is accurate.

## 6. Gates and evidence

- [x] 6.1 `helm dependency build charts/in-falcone` resolves (14 charts); `helm template` renders with full schema validation.
- [x] 6.2 `pnpm lint` passes — `validate:repo` (incl. `validate:domain-model`) + `lint:md` (0 errors) + `validate:openapi` all clean.
- [x] 6.3 Tests pass — unit 707/0, contracts 232/0, adapters 142/0, blackbox 632/0, provisioning-orchestrator reconcile 10/0 (web-console baseline unchanged, not run in this gate).
- [x] 6.4 Residual search: ZERO OpenWhisk-PRODUCT artifacts (vendored deploy, ESO secrets, backup-status template, subchart deps, product images) and ZERO MinIO subchart/image/`MINIO_*` config. Remaining `openwhisk` matches are the kept functions API-model vocabulary (`openwhisk-admin`, `data.openwhisk.actions`, `pvc_01openwhiskactions`, `openwhisk_action`, event/collector functions code); remaining `minio` matches are migration-source naming + "former component removed" notes + the retained external-S3 provider context.
- [x] 6.5 `openspec validate remove-legacy-openwhisk-minio-mongodb --strict` clean.
