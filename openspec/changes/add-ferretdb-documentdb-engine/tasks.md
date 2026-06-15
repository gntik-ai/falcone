## 1. Prerequisites

- [x] 1.1 Confirmed from `add-ferretdb-adr-spike` (ADR-14, #455) evidence:
      - colocated-vs-dedicated: **dedicated** (pg_documentdb absent from bitnami image;
        shared_preload_libraries is SERVER-START; engine extension surface unwanted on
        relational tier; RLS coexistence is CLEAN and NOT a driver)
      - mandatory startup GUCs: **`shared_preload_libraries='pg_cron,pg_documentdb_core,
        pg_documentdb'`** and **`cron.database_name='postgres'`** only — no mandatory
        `documentdb.*` GUCs
      - image: `ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0` /
        digest `sha256:2386795ec2aa7ae559304361979f1dc5708d383ee9020ae63dadc2940dfe58f7` /
        PostgreSQL 17.6
      - bundled extensions: documentdb 0.107-0, documentdb_core 0.107-0, pg_cron 1.6,
        postgis 3.6.0, rum 1.3, vector 0.8.1, tsm_system_rows
      Recorded in design.md D1 and D2.
- [ ] 1.2 Verify the pinned image
      `ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0@sha256:2386795ec2aa7ae559304361979f1dc5708d383ee9020ae63dadc2940dfe58f7`
      is pullable and its entrypoint honours a mounted `conf.d/` directory for GUC
      injection at startup. NOTE: `POSTGRES_EXTRA_ARGS` is NOT used for
      `shared_preload_libraries` delivery — it is a SERVER-START GUC and must be in
      `postgresql.conf` / `conf.d` before postmaster starts.
- [ ] 1.3 Confirm host port 5433 is free in `tests/env/docker-compose.yml` and no
      existing service uses it; update if occupied

## 2. Chart — DocumentDB StatefulSet and PVC

- [ ] 2.1 Add `documentdb.enabled: false` to `charts/in-falcone/values.yaml` with a
      comment marking it as the FerretDB engine; add the full `documentdb.*` values
      stanza (image, replicas, PVC size, Service port, podSecurityContext, securityContext,
      resources, envFromSecrets)
- [ ] 2.2 Add a `templates/documentdb-statefulset.yaml` Helm template (gated by
      `documentdb.enabled`) rendering a StatefulSet with the pinned image, a
      `volumeClaimTemplates` entry for data persistence (default 20 Gi), and the
      security context from values (runAsNonRoot, fsGroup 1001,
      fsGroupChangePolicy OnRootMismatch)
- [ ] 2.3 Add a `templates/documentdb-service.yaml` Helm template rendering a ClusterIP
      Service on port 5432 only; no NodePort, LoadBalancer, Ingress, or Route
- [ ] 2.4 Add a `templates/documentdb-configmap.yaml` Helm template rendering a
      ConfigMap with `custom.conf` containing:
      `shared_preload_libraries = 'pg_cron,pg_documentdb_core,pg_documentdb'` and
      `cron.database_name = 'postgres'` (confirmed mandatory set; no additional
      `documentdb.*` GUCs required at startup per ADR-14); mount the ConfigMap in the
      StatefulSet as a `conf.d` override directory applied before postmaster starts.
      Do NOT deliver these settings via `POSTGRES_EXTRA_ARGS` or session-level GUCs.

## 3. Extension Creation Init Job

- [ ] 3.1 Add a `templates/documentdb-init-job.yaml` Helm pre-install/pre-upgrade hook
      Job that:
      - waits for `pg_isready` on the DocumentDB ClusterIP before proceeding
      - runs `SELECT 1 FROM pg_available_extensions WHERE name = 'documentdb'` (mirrors
        `services/provisioning-orchestrator/src/appliers/postgres-applier.mjs:111`)
      - if present, executes `CREATE EXTENSION IF NOT EXISTS documentdb` in the target
        database
      - sets `backoffLimit: 5` and appropriate `activeDeadlineSeconds`
- [ ] 3.2 Confirm the init Job completes successfully in a `helm template` dry-run and
      that the Job manifest sets no elevated privileges (non-root, no hostNetwork)

## 4. HA Profile Overrides

- [ ] 4.1 Append DocumentDB HA overrides to
      `charts/in-falcone/values/profiles/ha.yaml`: `documentdb.replicas: 2`,
      `documentdb.persistence.size: 50Gi`, and pod anti-affinity
      (`requiredDuringSchedulingIgnoredDuringExecution`, topology key `kubernetes.io/hostname`)
- [ ] 4.2 Verify via `helm template --values profiles/ha.yaml` that the StatefulSet
      renders `replicas: 2` and the VolumeClaimTemplate shows `storage: 50Gi`

## 5. OpenShift SCC Compliance

- [ ] 5.1 Add a `documentdb:` section to `deploy/openshift/values-openshift.yaml`
      following the existing Postgres pattern at lines 1759-1791 of values.yaml:
      `podSecurityContext.fsGroup: null`, `securityContext.runAsNonRoot: true`,
      `securityContext.seccompProfile.type: RuntimeDefault`
- [ ] 5.2 Verify via `helm template --values deploy/openshift/values-openshift.yaml`
      that the DocumentDB StatefulSet PodSpec contains no non-null `fsGroup`,
      `runAsNonRoot: true`, and `seccompProfile.type: RuntimeDefault`; and that no
      Ingress or Route is rendered

## 6. tests/env Integration

- [ ] 6.1 Add a `documentdb` service to `tests/env/docker-compose.yml` using image
      pinned by tag + digest:
      `ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0@sha256:2386795ec2aa7ae559304361979f1dc5708d383ee9020ae63dadc2940dfe58f7`,
      host port 5433, environment variables for `POSTGRES_DB`, `POSTGRES_USER`,
      `POSTGRES_PASSWORD`, and a mounted `conf.d/custom.conf` for startup GUC injection
      (`shared_preload_libraries`, `cron.database_name`). Do NOT use `POSTGRES_EXTRA_ARGS`
      for GUC delivery.
- [ ] 6.2 Confirm `docker compose -f tests/env/docker-compose.yml up documentdb` starts
      the service, Postgres reaches ready state, and `\dx` in the target database shows
      `documentdb` in the extension list

## 7. Startup Order Documentation (cross-change gate)

- [ ] 7.1 Record in `add-ferretdb-gateway` tasks: the gateway Helm chart MUST implement
      an initContainer or readiness probe that waits for `pg_isready` on the DocumentDB
      ClusterIP Service AND verifies `documentdb_api` schema exists before the gateway
      container starts its main process.
- [ ] 7.2 Verify in Helm hook ordering that the `documentdb-init-job` (pre-install/
      pre-upgrade) completes (i.e., `documentdb_api` schema present) before the gateway
      Deployment/StatefulSet is applied; document deferral to `add-ferretdb-gateway` if
      cross-chart ordering cannot be enforced here.

## 8. Validation

- [ ] 8.1 Run `helm lint charts/in-falcone/` with `--set documentdb.enabled=true`;
      fix any lint errors
- [ ] 8.2 Run `helm template charts/in-falcone/ --set documentdb.enabled=true` and
      verify: ClusterIP-only Service on port 5432, ConfigMap with
      `shared_preload_libraries` and `cron.database_name` (no `POSTGRES_EXTRA_ARGS`,
      no session GUCs), init Job with no elevated privileges, PVC 20 Gi in base profile,
      SecurityContext runAsNonRoot + fsGroup 1001
- [ ] 8.3 Deploy to local kind cluster with `documentdb.enabled=true`; confirm the
      StatefulSet Pod reaches Ready and `\dx` shows `documentdb`
      (DEFERRED if no kind cluster available — live verification owned by downstream
      E2E change; record deferral here)
- [ ] 8.4 Run `openspec validate add-ferretdb-documentdb-engine --strict` and confirm
      clean pass before marking this change ready for apply
