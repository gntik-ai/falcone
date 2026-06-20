## 1. Shared transport-security resolvers

- [x] 1.1 Create `services/internal-contracts/src/transport-security.mjs` with `resolvePostgresSsl(env)`, `resolveMongoTls(env)`, `resolveKafkaSecurity(env)`, `withPostgresSsl(config, env)` per design D3/D4 (pure, env-driven, fail-closed in production on verify-without-CA)
- [x] 1.2 Re-export the resolvers from `services/internal-contracts/src/index.mjs`
- [x] 1.3 Write the failing black-box contract `tests/blackbox/transport-security.test.mjs` covering the full PGSSLMODE matrix, Mongo/Kafka resolvers, fail-closed, plaintext default, and parity between the shared and kind-local copies

## 2. Kind control-plane local copy

- [x] 2.1 Create behavior-identical `deploy/kind/control-plane/transport-security.mjs`
- [x] 2.2 Add it to the COPY list in `deploy/kind/control-plane/Dockerfile`

## 3. Wire the apps/control-plane runtime

- [x] 3.1 `main.mjs`: apply `resolvePostgresSsl` to `keyPool`; pass Mongo tls options into the Mongo executor; apply `resolveKafkaSecurity` to the flow-trigger Kafka consumer
- [x] 3.2 `connection-registry.mjs`: apply `resolvePostgresSsl` to per-workspace pools
- [x] 3.3 `postgres-realtime-executor.mjs`: apply `resolvePostgresSsl` to the admin + listener clients
- [x] 3.4 `mongo-data-executor.mjs`: apply `resolveMongoTls` to the `MongoClient`
- [x] 3.5 `events-executor.mjs`: apply `resolveKafkaSecurity` to the events Kafka client

## 4. Wire the kind control-plane runtime

- [x] 4.1 `server.mjs`: apply `resolvePostgresSsl` to the DI `Pool`
- [x] 4.2 `pg-handlers.mjs` + `dataplane.mjs`: apply `resolvePostgresSsl` to the `Client`/pool construction
- [x] 4.3 `mongo-handlers.mjs`: apply `resolveMongoTls` to the `MongoClient`
- [x] 4.4 `kafka-handlers.mjs`: apply `resolveKafkaSecurity` to the Kafka client

## 5. Wire the standalone services

- [x] 5.1 `services/mongo-cdc-bridge`: pg pools (metadata + engine), Mongo client config, Kafka client
- [x] 5.2 `services/pg-cdc-bridge`: pg pool + replication `Client`, Kafka client
- [x] 5.3 `services/billing-export`: pg pool + Kafka client
- [x] 5.4 `services/backup-status`: pg pool
- [x] 5.5 `services/workflow-worker`: pg pool(s)
- [x] 5.6 `services/provisioning-orchestrator` collectors: postgres + mongo (kafka collector already has SASL — fold into the shared resolver without regressing it)

## 6. Production overlay + chart CA mounting

- [x] 6.1 Add a `transportSecurity` stanza (CA secret ref + env defaults) to `charts/in-falcone/values.yaml`
- [x] 6.2 Template the CA volume mount + TLS env (`PGSSLROOTCERT`/`KAFKA_SSL_CA_FILE`/`MONGO_TLS_CA_FILE`/`NODE_EXTRA_CA_CERTS`) into the control-plane/executor/worker pods
- [x] 6.3 Create `deploy/kind/values-production.yaml` enabling `PGSSLMODE=verify-full`, `MONGO_TLS`, `KAFKA_SSL`, https Keycloak + S3, and `ferretdb.tls.enabled`/`seaweedfs.enableSecurity`/`seaweedfsTls.bootstrap`
- [x] 6.4 Add a black-box assertion that the overlay sets the hardened env/toggles, and `helm template` renders cleanly with the overlay

## 7. Verify

- [x] 7.1 Run `bash tests/blackbox/run.sh` green (new contract passes; default path unchanged)
- [x] 7.2 Run the unit + contracts suites (CI `quality` job) green
- [x] 7.3 Live-relevant verification: kind control-plane image builds (all 47 route modules resolve); all wired modules import cleanly at runtime; `helm template` renders the TLS env + CA mount onto exactly the 3 app pods. Full mTLS live verify on kind is NOT feasible (the bundled Postgres/FerretDB/Kafka present no server certs and there is no cert-manager) and the change is default-off (plaintext), so there is no new live behavior to exercise without provisioning a PKI — documented limitation.
