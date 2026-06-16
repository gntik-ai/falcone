## 1. OpenWhisk product purge (decision 3a — keep the functions API model)

- [ ] 1.1 Delete the vendored OpenWhisk deployment `deploy/kind/openwhisk/` (openwhisk-deploy-kube)
- [ ] 1.2 Delete the OpenWhisk ESO secret templates `charts/in-falcone/charts/eso/templates/external-secrets/{functions-openwhisk,platform-openwhisk}.yaml`
- [ ] 1.3 Delete the disabled `openwhisk:` stanza in `charts/in-falcone/values.yaml` + `native-openwhisk-admin` + `pvc_01openwhiskactions` + values.schema.json openwhisk entries
- [ ] 1.4 Delete the `backup-status` OpenWhisk-Action template `helm/charts/backup-status/templates/openwhisk-operations-actions.yaml` (decision 4)
- [ ] 1.5 Repoint OpenWhisk PROSE/comments to Knative across deploy/kind (README, values-kind), vault/eso refs; keep the action/package/trigger/rule API model
- [ ] 1.6 Verify functions still build/test (Knative executor + the kept API model)

## 2. MinIO product purge (cut over; remove the rollback toggle)

- [ ] 2.1 Delete the `storage` (MinIO) subchart dependency in `Chart.yaml` + the MinIO `storage:` block in `values.yaml` (minio/minio image, MINIO_* env, providerType: minio) + values.schema.json
- [ ] 2.2 Delete MinIO image overlays in `charts/in-falcone/values/airgap.yaml`, `deploy/kind/values-kind.yaml`, `deploy/kind/credentials.env` MINIO_*
- [ ] 2.3 Repoint provider defaults `'minio' → 'seaweedfs'` (`storage-provider-profile.mjs:33`, `storage-provider-verification.mjs` fallbacks, `storage-bucket-object-ops.mjs`); add `seaweedfs` to DEFAULT_PROVIDERS; update the matching unit tests
- [ ] 2.4 Repoint MinIO naming/comments (`discoverMinIOBuckets`→`discoverS3Buckets`, "standard (MinIO) path" comment) — generic S3 stays
- [ ] 2.5 KEEP MinIO as a provider-CATALOG entry only if multi-cloud is intended; otherwise remove from the catalog (confirm during execution)

## 3. Complete the FerretDB cutover defaults (prerequisite to the MongoDB-server purge)

- [ ] 3.1 `charts/in-falcone/values.yaml`: `mongodb.enabled: false`, `ferretdb.enabled: true`, `documentdb.enabled: true`; retire the #463 rollback-anchor comment block
- [ ] 3.2 Repoint the control-plane default doc-store env: `MONGO_HOST`/`MONGO_URI` → `<release>-ferretdb:27017`, `MONGO_BACKEND=ferretdb`, `REALTIME_DOCUMENTDB_URL` → documentdb engine (chart + `deploy/kind/values-kind.yaml` + `executor-demo.yaml`)
- [ ] 3.3 Update `deploy/kind/control-plane/mongo-handlers.mjs` comment (server → FerretDB gateway); the mongodb driver + handler logic stay

## 4. MongoDB SERVER purge (after cutover completion)

- [ ] 4.1 Delete the `mongodb` component-wrapper alias in `Chart.yaml` + the `mongodb:` server stanza in `values.yaml` (bitnami image, MONGODB_* env, replica-set, mountPath) + values.schema.json
- [ ] 4.2 Delete the `in-falcone-mongodb` secret template + replica-set keyfile + MONGODB_ROOT_PASSWORD/DATABASE/REPLICA_SET refs (charts, eso, vault)
- [ ] 4.3 Remove `deploy/kind` MongoDB-server artifacts (falcone-mongodb StatefulSet/secret); keep MONGO_* pointed at FerretDB
- [ ] 4.4 KEEP: `mongodb` driver, mongodb-data-api.mjs/mongodb-admin.mjs, mongo-data-executor.mjs, mongo-handlers.mjs, /v1/collections routes, mongo-cdc-bridge (wire-protocol compatibility)

## 5. Documentation & READMEs (exhaustive)

- [ ] 5.1 REWRITE docs that describe the old MODEL: `docs-site/architecture/{services,security}.md`, `api/{mongodb,realtime}.md`, `guide/{what-is-falcone,installation,roadmap,third-party-licenses}.md`, `contributing/index.md`, `operations/{environment-variables,helm-configuration,secret-management,backup-restore}.md` (MongoDB change-streams/replica-set/pre-images → Postgres logical replication; OpenWhisk-governed → Knative; FerretDB is the deployed default, not "under evaluation")
- [ ] 5.2 Fix two accuracy bugs: `adrs.md` ADR-14 Evidence paragraph (SeaweedFS spike pasted in) + `seaweedfs.md` "compose still ships MinIO"
- [ ] 5.3 Sync all five translated READMEs to the English gold standard for the Mongo→FerretDB story (architecture diagram backend, QuickStart prose, helper-script line, provisioning-saga row, roadmap "under evaluation", capabilities "change streams", platform license table missing FerretDB row, license-compat note)
- [ ] 5.4 KEEP MongoDB wire-protocol/compatibility wording everywhere it is accurate

## 6. Gates and evidence

- [ ] 6.1 `helm dependency build charts/in-falcone` resolves
- [ ] 6.2 `corepack pnpm lint` passes
- [ ] 6.3 `corepack pnpm test` passes (note the known web-console baseline)
- [ ] 6.4 Final case-insensitive residual search: ZERO OpenWhisk-product + ZERO MinIO; only justified MongoDB wire-protocol/driver/compatibility matches remain — list and confirm each
- [ ] 6.5 `openspec validate remove-legacy-openwhisk-minio-mongodb --strict` clean
