## Why

Falcone's current document store is MongoDB, deployed as an in-chart StatefulSet
(`charts/in-falcone/values.yaml:1792`, image `mongo`). The MongoDB Community Server
licence restricts SaaS redistribution and the chart carries no HA topology.
The DocumentDB engine (`ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0`,
digest `sha256:2386795ec2aa7ae559304361979f1dc5708d383ee9020ae63dadc2940dfe58f7`,
PostgreSQL 17.6) is a MongoDB-wire-compatible Postgres extension stack (Apache-2.0, LF
governance) that replaces the document store backend. Unlike pgvector — which is bundled
into the existing Postgres image with no server-level configuration — DocumentDB requires
`shared_preload_libraries='pg_cron,pg_documentdb_core,pg_documentdb'` (a SERVER-START
setting, not session-settable) to be present in `postgresql.conf` before the postmaster
starts; these cannot be applied via the existing `postgres-applier.mjs` extension CREATE
path (`services/provisioning-orchestrator/src/appliers/postgres-applier.mjs:111`,
`pg_available_extensions` check). The ADR spike (#455 / `add-ferretdb-adr-spike`)
confirmed that DocumentDB must run on a **dedicated** Postgres instance: the
`pg_documentdb` extension stack ships only in the engine image and is absent from
`docker.io/bitnami/postgresql:17.2.0` (the relational Postgres), `shared_preload_libraries`
is a restart-level GUC that cannot be patched at session scope, and the engine image
carries an extended extension surface (PostGIS 3.6.0, RUM 1.3, pgvector 0.8.1,
pg_cron 1.6, tsm_system_rows) that is unwanted on the relational tier. RLS coexists
cleanly on the DocumentDB engine — the non-BYPASSRLS `falcone_app` role and
`app.tenant_id` GUC enforcement are not a reason to separate instances. This change
deploys that dedicated DocumentDB-enabled Postgres as a chart-managed StatefulSet with
PVCs, internal-only networking, and OpenShift SCC/non-root/fsGroup handling consistent
with the existing Postgres deployment (`charts/in-falcone/values.yaml:1759-1791`).

## What Changes

- Add a `documentdb` StatefulSet section to `charts/in-falcone/values.yaml` (gated by
  `documentdb.enabled`) using image
  `ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0`, with a PVC for data
  persistence.
- Add a Helm-rendered ConfigMap carrying a `custom.conf` snippet applied as a startup-time
  `postgresql.conf`/`conf.d` include (before postmaster start) with exactly:
  `shared_preload_libraries='pg_cron,pg_documentdb_core,pg_documentdb'` and
  `cron.database_name='postgres'`. The engine image already preloads these libraries via
  its bundled config; the ConfigMap makes the settings explicit and Helm-managed. No
  additional mandatory `documentdb.*` GUCs are required at startup (spike ADR-14
  confirmed). Mount it as the Postgres override config directory so settings survive pod
  restart. No `POSTGRES_EXTRA_ARGS` environment variable or session-level GUC delivery
  is used — `shared_preload_libraries` is SERVER-START only.
- Add a Helm hook init Job (or initContainer) that runs `CREATE EXTENSION IF NOT EXISTS
  documentdb` in the target database after the engine is Ready, guarded by an
  `pg_available_extensions` check consistent with the
  `postgres-applier.mjs::_validateExtensionAvailable` pattern.
- Expose the DocumentDB engine as a ClusterIP-only Service (port 5432); no
  Ingress/Route/NodePort exposed outside the cluster — tenants reach DocumentDB only
  via the FerretDB gateway (separate change `add-ferretdb-gateway`).
- Apply OpenShift SCC/non-root/fsGroup pattern matching
  `charts/in-falcone/values.yaml:1759-1791`: `podSecurityContext.fsGroup: 1001`,
  `securityContext.runAsNonRoot: true`, `fsGroupChangePolicy: OnRootMismatch`.
- Add HA replica target (StatefulSet replicas, anti-affinity) to the HA profile
  (`charts/in-falcone/values/profiles/ha.yaml`).
- Extend `tests/env/docker-compose.yml` with a `documentdb` service using the pinned
  image (tag + digest: `17-0.107.0-ferretdb-2.7.0@sha256:2386795ec2aa7ae559304361979f1dc5708d383ee9020ae63dadc2940dfe58f7`)
  so real-stack integration tests can target the engine.
- Implement the colocated-vs-dedicated decision from ADR-14 (#455): dedicated instance,
  not the shared `postgresql` StatefulSet.
- Enforce startup order: the DocumentDB engine (with `documentdb_api` schema present)
  MUST be ready before any FerretDB gateway Pod connects — cross-ref `add-ferretdb-gateway`.

## Capabilities

### New Capabilities

- none

### Modified Capabilities

- `data-api`: ADDED requirements for the DocumentDB engine platform component —
  dedicated Postgres 17.6 StatefulSet (image pinned by tag + digest), startup-time
  `shared_preload_libraries` and `cron.database_name` applied via ConfigMap conf.d
  include (no `POSTGRES_EXTRA_ARGS`, no session GUCs), `documentdb` extension present in
  the target DB before FerretDB gateway connects, PVC persistence, HA target, OpenShift
  SCC compliance (runAsNonRoot / fsGroup 1001 / fsGroupChangePolicy OnRootMismatch),
  internal-only ClusterIP networking, and a tests/env service for real-stack tests.
  RLS coexistence on the DocumentDB engine is confirmed clean and is NOT a driver for
  the dedicated-instance decision.

## Impact

- `charts/in-falcone/values.yaml` — new `documentdb.*` stanza (dedicated StatefulSet,
  PVC, ConfigMap ref, Service, SecurityContext).
- `charts/in-falcone/templates/` — new templates: documentdb StatefulSet, ConfigMap
  (GUCs), init Job (extension creation), ClusterIP Service, PVC.
- `charts/in-falcone/values/profiles/ha.yaml` — DocumentDB HA replica count appended.
- `deploy/openshift/values-openshift.yaml` — DocumentDB fsGroup null / runAsNonRoot /
  seccompProfile entries following existing Postgres pattern.
- `tests/env/docker-compose.yml` — new `documentdb` service (image pinned by tag +
  digest `17-0.107.0-ferretdb-2.7.0@sha256:2386795ec2aa7ae559304361979f1dc5708d383ee9020ae63dadc2940dfe58f7`,
  port 5433 on host to avoid colliding with shared Postgres on 5432).
- No changes to `services/provisioning-orchestrator/src/appliers/postgres-applier.mjs`
  in this change (the extension-creation init Job uses the same guard idiom; a new
  applier for DocumentDB provisioning is a downstream change).
- DEPENDS ON: `add-ferretdb-adr-spike` (#455) for the colocated-vs-dedicated decision
  and the startup GUC list (confirmed: `shared_preload_libraries` + `cron.database_name`
  only; no additional mandatory `documentdb.*` GUCs).
- STARTUP ORDER: `add-ferretdb-gateway` (#457) MUST NOT connect until this change's
  engine is Ready and `documentdb_api` schema is present; the gateway change's
  readiness probe / init-container MUST gate on the engine.
- BLOCKS: `add-ferretdb-gateway` (#457), `add-ferretdb-tenant-isolation-credentials`
  (#458).
