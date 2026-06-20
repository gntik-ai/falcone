## Why

Today no application code path enables TLS to any datastore: every `pg.Pool`/`pg.Client` is built from `PGHOST`/`PGUSER`/… with no `sslmode` and no `ssl` option, every `MongoClient` is created from a bare `mongodb://` URI with no `tls`, and the main Kafka clients carry no `ssl`/`sasl`. `PGSSLMODE` is effectively unsupported. There is no production values profile, so an operator cannot enable in-transit encryption end to end even though the chart already exposes some TLS toggles. This is the in-transit half of issue #645 (intra-cluster plaintext) and is an insecure posture for production.

## What Changes

- Add shared, env-driven, pure transport-security helpers (`resolvePostgresSsl`, `resolveMongoTls`, `resolveKafkaSecurity`) in `@in-falcone/internal-contracts`, plus a behavior-identical local copy for the self-contained kind control-plane runtime.
- Wire those helpers into **every** datastore connection site (Postgres `ssl`, Mongo `tls`, Kafka `ssl`/`sasl`) across the `apps/control-plane` runtime, the standalone services, and the `deploy/kind/control-plane` runtime. Default behavior with no TLS env set is **unchanged** (plaintext) so dev/kind/tests stay green.
- **Fail closed**: in `NODE_ENV=production`, a `verify-ca`/`verify-full` request without a readable CA throws rather than silently connecting plaintext (mirrors the existing webhook/flow-trigger secret-key fail-closed idiom, #636).
- Add a real, render-tested production hardening overlay (`deploy/kind/values-production.yaml`) that enables in-transit encryption coherently: `PGSSLMODE=verify-full`, `MONGO_TLS`, `KAFKA_SSL`, https Keycloak + S3 endpoints, and the existing datastore TLS chart toggles (`ferretdb.tls.enabled`, `seaweedfs.enableSecurity` + `seaweedfsTls.bootstrap`), with CA material mounted from a configurable secret.
- Add chart templating to mount the CA bundle into the control-plane/executor/worker pods and inject the `PGSSLROOTCERT`/`KAFKA_SSL_CA_FILE`/`MONGO_TLS_CA_FILE`/`NODE_EXTRA_CA_CERTS` env.

Out of scope (deferred, with rationale): at-rest envelope encryption of tenant **documents** (breaks FerretDB query/index) and **objects** (gateway-PUT path, limited SeaweedFS SSE support). Secret material is already AES-256-GCM envelope-encrypted at rest, and tenant-provided provider keys are `secretRef`-only.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `data-plane-connectivity`: ADD a requirement that datastore connections are TLS-capable and configured from the environment, with fail-closed verification in production and an unchanged plaintext default.
- `deployment`: ADD a requirement that a production deployment profile enables in-transit encryption to all datastores (TLS env + chart toggles + mounted CA).

## Impact

- **Code**: new `services/internal-contracts/src/transport-security.mjs` (+ `index.mjs` export) and `deploy/kind/control-plane/transport-security.mjs`; edits to `apps/control-plane/src/runtime/{main.mjs,connection-registry.mjs,postgres-realtime-executor.mjs,mongo-data-executor.mjs,events-executor.mjs}`, `deploy/kind/control-plane/{server.mjs,pg-handlers.mjs,mongo-handlers.mjs,kafka-handlers.mjs,dataplane.mjs,Dockerfile}`, and the standalone services (`mongo-cdc-bridge`, `pg-cdc-bridge`, `billing-export`, `backup-status`, `workflow-worker`, `provisioning-orchestrator` collectors).
- **Deploy**: new `deploy/kind/values-production.yaml`; new/edited chart templates under `charts/in-falcone/templates/` for CA mounting + env; `charts/in-falcone/values.yaml` adds a `transportSecurity` stanza.
- **Tests**: new black-box contract for the resolvers + overlay assertion; existing blackbox/unit/contracts suites stay green.
- **Behavior**: no change unless TLS env is set; with the production overlay, all app→datastore connections are encrypted.
