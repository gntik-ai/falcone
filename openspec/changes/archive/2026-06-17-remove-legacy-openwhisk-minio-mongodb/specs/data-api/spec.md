## ADDED Requirements

### Requirement: Document store runs on FerretDB + DocumentDB by chart default; the MongoDB server is removed

The system SHALL default the document-store backend to the FerretDB gateway over the DocumentDB
engine in the umbrella chart (`ferretdb.enabled: true`, `documentdb.enabled: true`,
`mongodb.enabled: false`) and in the kind deploy, with the control-plane's default `MONGO_URI` /
`MONGO_HOST` pointed at the FerretDB gateway. The MongoDB **server** product (the `mongodb`
subchart/alias, `bitnami/mongodb` image, `MONGODB_*` server env, `in-falcone-mongodb` secret, and
replica-set keyfile) SHALL be removed. MongoDB **wire-protocol** compatibility — the `mongodb`
driver, the data-API adapter/executor, the `/v1/collections/*` routes, and the `mongo-cdc-bridge`
(Postgres pgoutput logical replication) — SHALL be retained.

#### Scenario: Chart default deploys FerretDB, not the MongoDB server

- **WHEN** the umbrella chart is rendered with default values
- **THEN** the FerretDB gateway and DocumentDB engine are deployed and the MongoDB server is not,
  and the control-plane's default document-store connection targets the FerretDB gateway

#### Scenario: MongoDB wire-protocol compatibility is preserved

- **WHEN** a client uses a MongoDB driver against the configured `MONGO_URI`
- **THEN** the document-store data API behaves correctly against FerretDB, and no residual reference
  describes a deployed MongoDB **server** product
