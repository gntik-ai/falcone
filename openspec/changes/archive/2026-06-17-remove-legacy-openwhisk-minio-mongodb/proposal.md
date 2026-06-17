## Why

Three backing products were replaced but their residual artifacts, dead deployments, and stale
documentation remain: **OpenWhisk → Knative** (serverless functions), **MinIO → SeaweedFS** (S3
object storage), and the **MongoDB server → FerretDB + DocumentDB** (document store; FerretDB
speaks the MongoDB wire protocol over DocumentDB-on-PostgreSQL). The code is the source of truth,
and an exhaustive inventory found the three migrations at **different stages**:

- **MinIO**: cut over at the chart default (`storage.enabled: false` → SeaweedFS is the default;
  MinIO retained only as an opt-in rollback toggle). Residual: the disabled MinIO subchart/values
  block, provider-default fallbacks to `'minio'`, naming.
- **OpenWhisk**: the **runtime** moved to Knative (`function-executor.mjs` creates ksvcs; the
  `openwhisk:` chart stanza is DISABLED), but an **entire vendored OpenWhisk deployment**
  (`deploy/kind/openwhisk/openwhisk-deploy-kube/`), OpenWhisk ESO secrets, and a `backup-status`
  chart that renders real `openwhisk.apache.org/v1 Action` CRDs are dead/orphaned. The functions
  **API model** (`openwhisk-admin.mjs` + OpenAPI/route-catalog/domain-model) is OpenWhisk-VOCABULARY
  (action/package/trigger/rule) and is load-bearing — it is KEPT as Falcone's functions model; only
  the OpenWhisk **product** is purged (decision 3a).
- **MongoDB server**: NOT cut over at the chart default — `mongodb.enabled: true` while
  `ferretdb.enabled: false` / `documentdb.enabled: false`; `deploy/kind` points
  `MONGO_HOST → falcone-mongodb:27017`; the chart calls the repoint *"deferred"*. The MongoDB
  SERVER is still the load-bearing default. Purging it requires **completing the cutover first**.

## What Changes

- **Complete the FerretDB cutover at the chart/kind defaults** (prerequisite to the MongoDB-server
  purge): `ferretdb.enabled: true` + `documentdb.enabled: true` + `mongodb.enabled: false`; repoint
  the default control-plane/kind `MONGO_HOST`/`MONGO_URI` to the FerretDB gateway and
  `REALTIME_DOCUMENTDB_URL` to the DocumentDB engine; retire the #463 rollback-anchor framing
  (rollback windows are confirmed closeable).
- **Purge the MongoDB SERVER**: the `mongodb` subchart/alias + `bitnami/mongodb` image + values
  stanza + `MONGODB_*` server env + `in-falcone-mongodb` secret + replica-set keyfile + `deploy/kind`
  `falcone-mongodb` targets.
- **Purge MinIO**: the disabled `storage` (MinIO) subchart/alias + `minio/minio` image + `MINIO_*`
  config/console env + airgap/kind MinIO overlays; repoint provider-default fallbacks `'minio' →
  'seaweedfs'`, register `seaweedfs` in the default provider/verification lists.
- **Purge the OpenWhisk PRODUCT (decision 3a)**: delete the vendored
  `deploy/kind/openwhisk/openwhisk-deploy-kube/`, the OpenWhisk ESO secret templates, the disabled
  `openwhisk:` chart stanza, and the `backup-status` OpenWhisk-Action CRD template (backup ops no
  longer run as OpenWhisk Actions). KEEP the functions API model vocabulary (action/package/trigger/
  rule) and Knative.
- **KEEP — MongoDB wire-protocol compatibility**: the `mongodb` driver, `services/adapters/src/
  mongodb-data-api.mjs`/`mongodb-admin.mjs`, `mongo-data-executor.mjs`, `MONGO_URI`/`MONGO_BACKEND`,
  the `/v1/collections/*` routes, and `services/mongo-cdc-bridge/` (re-architected onto Postgres
  pgoutput by #460 — load-bearing for FerretDB CDC, does NOT use MongoDB change streams).
- **Exhaustive docs/README rewrite**: bring the whole documentation set + all six READMEs
  (`README.md` + `es/fr/de/zh/ru` — there is NO `it`) in line with the current stack (Knative,
  SeaweedFS, FerretDB/DocumentDB). Rewrite the ~14 docs that describe the old MODEL (MongoDB change
  streams / replica set / pre-images → Postgres logical replication; OpenWhisk-governed →
  Knative-run) and fix two accuracy bugs (ADR-14 has SeaweedFS spike evidence pasted in; seaweedfs.md
  wrongly says compose ships MinIO).

## Capabilities

### Modified Capabilities

- `data-api`: the document-store default backend SHALL be FerretDB + DocumentDB; the MongoDB server
  is removed; MongoDB wire-protocol compatibility is retained.
- `functions`: serverless functions SHALL run on Knative; the OpenWhisk product/deployment is
  removed (the OpenWhisk-derived functions API model is retained as Falcone's own model).
- `storage`: object storage SHALL be SeaweedFS; the MinIO product is removed; generic S3 retained.

## Impact

- `charts/in-falcone/` (Chart.yaml deps, values.yaml mongodb/ferretdb/documentdb/storage/openwhisk
  stanzas, eso secret templates, values.schema.json), `helm/charts/backup-status/`,
  `deploy/kind/` (openwhisk vendored chart, values-kind, mongo targets), `services/adapters/`,
  `apps/control-plane/`, `tests/`, `docs/`, `docs-site/`, all six READMEs.
- No change to Knative, SeaweedFS, FerretDB, DocumentDB, the pg-cdc-bridge, or generic S3.
- Gates: `helm dependency build charts/in-falcone`, `pnpm lint`, `pnpm test`, and a final
  case-insensitive residual search (zero OpenWhisk/MinIO; only justified MongoDB-compatibility).
