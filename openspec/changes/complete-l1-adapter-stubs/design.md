## Context

`services/backup-status/` ships a coherent `BackupAdapter` interface
(`adapters/types.ts:28-36`) and a real PostgreSQL implementation
(`postgresql.adapter.ts`, ~323 LOC) that walks Velero VolumeSnapshot →
Barman API → K8s annotation. The other four registered adapters
(`mongodb`, `s3`, `kafka`, `keycloak`) return `not_available` on `check`
and throw `not_implemented` on every mutation. The shared Kafka
producer used by both `shared/audit.ts` and the audit-trail fallback
worker is a console-log stub. The managed-instances source is a
literal stub returning six demo rows.

This is a `complete-*` change because no production implementation
exists for these surfaces — there is no buggy code path to repair.

## Goals

- Stand up real `check`, `triggerBackup`, `triggerRestore`, and
  `listSnapshots` for each of the four stub adapters, using the same
  shape and fallback-chain philosophy as the PostgreSQL adapter.
- Stand up a real Kafka producer used by both `shared/audit.ts` and
  the audit-trail fallback worker so `published_at` is actually set on
  audit-trail rows.
- Stand up a real managed-instances source backed by
  `DEPLOYMENT_PROFILE_API_URL`; keep the existing stub as a dev-only
  fallback gated on `NODE_ENV !== 'production'`.

## Non-goals

- Designing the orchestration of backup schedules; the collector and
  dispatcher already exist.
- Replacing the `BackupAdapter` interface or the registry; both are
  fine as-is.
- Building UI surfaces for adapter configuration.

## Decisions

### Decision 1: MongoDB adapter strategy chain

`mongodb.adapter.ts` MUST try in order:

1. **Percona Operator backup CRD** (`PerconaServerMongoDBBackup`):
   query for the most recent `Succeeded` backup whose
   `spec.clusterName` matches the instance; `lastSuccessfulBackupAt`
   from `status.completed`.
2. **Velero VolumeSnapshot** of the StatefulSet's PVCs, matching the
   `cnpg`-style label selector adapted for MongoDB.
3. **K8s annotation fallback** on the StatefulSet
   (`backup.in-falcone.example.com/last-success`).

Staleness threshold `BACKUP_STALENESS_HOURS` (already an env var on
the PostgreSQL adapter) MUST be reused for consistency.

### Decision 2: S3 adapter strategy chain

`s3.adapter.ts` MUST try in order:

1. **Bucket versioning + lifecycle replication audit**: list the
   latest replication-status events to the configured backup region.
2. **Velero PVC snapshot** of the upload-staging volumes (MinIO /
   Ceph RGW deployments only).
3. **Object-tag fallback** scanning a sentinel prefix
   (`/_backups/last-success`).

### Decision 3: Kafka adapter strategy chain

`kafka.adapter.ts` MUST try in order:

1. **MirrorMaker2 status**: read the MM2 connector's last successful
   sync timestamp against the configured DR cluster.
2. **Strimzi `KafkaTopic` annotation** carrying the last-snapshot
   timestamp.
3. **Topic-introspection fallback**: highest offset of a sentinel
   `__falcone_backup_marker` topic.

### Decision 4: Keycloak adapter strategy chain

`keycloak.adapter.ts` MUST try in order:

1. **Velero VolumeSnapshot** of the Keycloak Postgres PVC.
2. **Realm-export sentinel**: a JSON file in the configured backup
   bucket under `/keycloak/realm-exports/{realm}/latest.json`.

### Decision 5: Kafka producer

A single `getProducer(): Promise<Producer>` factory MUST live in
`shared/kafka-producer.ts`. Both `shared/audit.ts` and the audit-trail
fallback worker MUST import it. The producer MUST be lazily
constructed, idempotent on producer-id, and respect
`KAFKA_BROKERS` / `KAFKA_CLIENT_ID_PREFIX`. The console-log
implementation MUST be removed entirely (no env-flag fallback to
preserve it).

### Decision 6: Managed-instances source

`shared/deployment-profile.ts:getManagedInstances` MUST issue
`GET ${DEPLOYMENT_PROFILE_API_URL}/v1/managed-instances` with the
service's own service-account token. Caching: 5-minute TTL, in-process.
When `DEPLOYMENT_PROFILE_API_URL` is unset:

- `NODE_ENV === 'production'` → throw `MANAGED_INSTANCES_UNAVAILABLE`.
- otherwise → return the existing 6-instance stub.

## Risks / Trade-offs

- Per-adapter Kubernetes API access broadens the service's RBAC
  surface; the production deployment must grant `list/watch` on
  `PerconaServerMongoDBBackup`, `MirrorMaker2`, `KafkaTopic`,
  `VolumeSnapshot`, and `Backup` CRDs.
- The Kafka producer adds a startup dependency; the existing
  fallback-worker design already assumes Kafka exists, so this only
  removes the safety net for environments that lacked Kafka entirely.

## Migration plan

1. Land `shared/kafka-producer.ts` and switch `shared/audit.ts` first;
   verify audit-trail rows transition `published_at IS NULL → set`.
2. Land the managed-instances client; verify the collector iterates a
   real instance list under a non-prod environment.
3. Land the four adapters one at a time behind component-type-keyed
   feature flags so a regression in (say) the MongoDB adapter does not
   take down PostgreSQL.
4. Remove the stubs and feature flags once all four adapters have run
   green for one collection cycle in staging.
