## Context

Exhaustive code-grounded inventory (read-only) preceded this change. Verified backend integrations:
functions → Knative (`function-executor.mjs` → ksvc), storage → SeaweedFS (`charts/in-falcone/charts/
seaweedfs`), document store → FerretDB gateway over DocumentDB-on-Postgres. The dev compose stack
(`tests/env/docker-compose.yml`) already runs all three; the production Helm chart does not fully
default to them yet (MongoDB server is still `enabled: true`).

## Safety verifications (done before classifying anything for deletion)

- **`mongo-cdc-bridge` — KEEP (load-bearing).** Re-architected onto Postgres pgoutput logical
  replication by #460: `ChangeStreamWatcher.mjs` consumes a `WalReplicationClient` (pg-logical-
  replication) instead of `collection.watch()`. It does NOT depend on MongoDB change streams.
- **`openwhisk-admin.mjs` — KEEP (load-bearing API model, not a live client).** Pure builder for the
  functions API model (`OPENWHISK_ADMIN_RESOURCE_KINDS=['action','package','trigger','rule']`, quota
  guardrails); no fetch/wsk/invoke client. Imported by functions-admin/console/workflows. The
  OpenWhisk *product* is purged; this *model* stays (decision 3a).
- **MongoDB adapter/driver/API — KEEP (wire-protocol compatibility).** Clients speak MongoDB wire to
  FerretDB; this is accurate compatibility, not a server reference.
- **MongoDB SERVER is still the chart/kind default — must complete the cutover before purging.**
- **MinIO is `storage.enabled: false` (rollback toggle); OpenWhisk vendored deploy + ESO + backup-
  status Action CRDs are orphaned.** Rollback windows confirmed closeable (decision 2).

## Confirmed decisions

- **D1 (=1):** complete the FerretDB cutover defaults, THEN purge the MongoDB server.
- **D2 (=2):** rollback windows can close → delete the MinIO/MongoDB/OpenWhisk rollback toggles and
  retire "retained during cutover" framing.
- **D3 (=3a):** purge the OpenWhisk *product* + prose; KEEP the functions API model vocabulary and
  the literal internal identifiers where renaming would break the contract (rename only safe prose;
  do NOT rebrand action/package/trigger/rule across OpenAPI/domain/tests).
- **D4 (=4):** remove the `backup-status` OpenWhisk-Action template (backup ops are not OpenWhisk
  Actions on the current stack).

## Non-Goals

- Rebranding the functions API model to Knative terms (no breaking OpenAPI/domain/contract rename).
- Touching Knative, SeaweedFS, FerretDB, DocumentDB, the pg-cdc-bridge, or generic S3 terminology.
- Removing the MongoDB wire-protocol driver/adapter/`/v1/collections` API or `mongo-cdc-bridge`.

## Risks

- Completing the cutover changes the chart default backend; `helm dependency build` + the chart
  schema must still resolve. Mitigation: flip enabled flags + repoint env atomically; validate the
  chart renders.
- The `data.openwhisk.actions` plan-capability strings are contract-coupled; left as internal keys
  unless safely repointable across gateway-config + internal-contracts + tests together.
- Translation prose: keep all six READMEs in sync; mirror the already-correct English README.
