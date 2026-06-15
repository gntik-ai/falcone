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
- [x] 1.2 Image pull + entrypoint conf.d honour-check is LIVE verification — DEFERRED
      (no container runtime in this audit workspace; owned by the downstream E2E /
      kind change, same deferral as 8.3). The chart delivers the GUCs as an explicit,
      Helm-managed `custom.conf` ConfigMap mounted at the Postgres `conf.d` override
      directory; the running engine additionally preloads the libraries via the image's
      own bundled config (ADR-14 confirmed). `POSTGRES_EXTRA_ARGS` / session GUCs are NOT
      used. The exact bundled-`postgresql.conf` include path is the live-check item.
- [x] 1.3 Host port 5433 is free in `tests/env/docker-compose.yml`, BUT the established
      convention there publishes datastore ports in the `5xxxx` band (postgres `55432:5432`,
      mongodb `57017:27017`). DocumentDB therefore publishes **`55433:5432`** to follow the
      convention and avoid colliding with the shared Postgres (`55432`).

## 2. Chart — DocumentDB component (component-wrapper subchart)

> ARCHITECTURE NOTE (code-verified): the umbrella chart NEVER hand-writes StatefulSets /
> Services. Every datastore (`postgresql`, `mongodb`, `kafka`, …) is a `component-wrapper`
> subchart alias declared in `Chart.yaml` + a values stanza. DocumentDB follows the same
> pattern. The wrapper renders the StatefulSet, ClusterIP Service, standalone PVC, and
> ServiceAccount; only the `custom.conf` ConfigMap and the extension init Job are
> hand-written umbrella templates (precedent: `seaweedfs-*` templates).

- [x] 2.1 Add a `documentdb` alias dependency (`component-wrapper`, `condition:
      documentdb.enabled`) to `charts/in-falcone/Chart.yaml`, and add the full
      `documentdb:` values stanza to `charts/in-falcone/values.yaml` (`enabled: false`,
      `wrapper.componentId: documentdb` / `workload.kind: StatefulSet`, image pinned by
      tag **and digest**, ClusterIP Service on 5432, 20 Gi PVC, podSecurityContext
      fsGroup 1001 + fsGroupChangePolicy OnRootMismatch + runAsNonRoot, container
      securityContext, resources, env + envFromSecrets, `extraVolumes`/`extraVolumeMounts`
      for the conf.d ConfigMap, and a `documentdb.initJob` block).
- [x] 2.2 StatefulSet rendering is delivered by the `component-wrapper` subchart via the
      values stanza (NOT a bespoke `templates/documentdb-statefulset.yaml`): the wrapper
      emits a StatefulSet with a **standalone PVC** (`<release>-documentdb-data`,
      `persistentVolumeClaim` reference — the wrapper does not use `volumeClaimTemplates`)
      and the pod security context from values. PGDATA is set to a subdirectory
      (`/var/lib/postgresql/data/pgdata`) to keep the data dir clean on the mounted PVC.
- [x] 2.3 Service rendering is delivered by the wrapper (`service.type: ClusterIP`,
      `port: 5432`); no NodePort, LoadBalancer, Ingress, or Route is created.
- [x] 2.4 Add `templates/documentdb-configmap.yaml` (hand-written umbrella template, gated
      by `documentdb.enabled`) rendering a ConfigMap with key `custom.conf` containing:
      `shared_preload_libraries = 'pg_cron,pg_documentdb_core,pg_documentdb'` and
      `cron.database_name = 'postgres'` (confirmed mandatory set; no additional
      `documentdb.*` GUCs per ADR-14). The StatefulSet mounts it via
      `documentdb.extraVolumes`/`extraVolumeMounts` as a `conf.d` override file applied
      before postmaster start. NOT delivered via the wrapper's `config.inline` (that path
      renders an env-var ConfigMap consumed by `envFrom`, not a file) nor via
      `POSTGRES_EXTRA_ARGS` / session GUCs.

## 3. Extension Creation Init Job

- [x] 3.1 Add `templates/documentdb-init-job.yaml` — a Helm **post-install/post-upgrade**
      hook Job (CORRECTION vs. the original "pre-install" note: a pre-install hook runs
      BEFORE the release's StatefulSet exists, so `pg_isready` could never succeed; the
      engine must be created first) that:
      - waits for `pg_isready` on the DocumentDB ClusterIP Service before proceeding
      - runs `SELECT 1 FROM pg_available_extensions WHERE name = 'documentdb'` (mirrors
        `services/provisioning-orchestrator/src/appliers/postgres-applier.mjs:111`)
      - if present, executes `CREATE EXTENSION IF NOT EXISTS documentdb CASCADE` in the
        target database; if absent, exits non-zero (the guard fails closed)
      - sets `backoffLimit: 5` and `activeDeadlineSeconds`; reuses the pinned engine image
        (it ships `psql`/`pg_isready`); credentials via the `in-falcone-documentdb` secret
- [x] 3.2 `helm template` dry-run renders the Job with no elevated privileges
      (runAsNonRoot, drop ALL, no hostNetwork, readOnlyRootFilesystem) — verified in §8.2.

## 4. HA Profile Overrides

- [x] 4.1 Append DocumentDB HA overrides to `charts/in-falcone/values/profiles/ha.yaml`:
      `documentdb.replicas: 2`, `documentdb.persistence.size: 200Gi` (matches the
      document-store sibling `mongodb` HA size), and pod anti-affinity using
      **`preferredDuringSchedulingIgnoredDuringExecution`** (CORRECTION vs. the original
      "required" note: every component in `ha.yaml` uses `preferred` — `required` would
      make the second replica unschedulable on a single-node cluster), topology key
      `kubernetes.io/hostname`.
- [x] 4.2 Verify via `helm template --values values/profiles/ha.yaml` that the DocumentDB
      StatefulSet renders `replicas: 2` and the PVC shows `storage: 200Gi` — verified in §8.

## 5. OpenShift SCC Compliance

- [x] 5.1 Add a `documentdb:` block to `deploy/openshift/values-openshift.yaml` mirroring
      the existing `postgresql`/`mongodb` blocks: `podSecurityContext.fsGroup: null` +
      `fsGroupChangePolicy: null` (the SCC injects the namespace-range uid/fsGroup;
      `runAsNonRoot: true` + `seccompProfile.type: RuntimeDefault` are inherited from
      `global.podSecurity`). Also null the init-Job's `runAsUser`/`fsGroup` so the SCC
      governs it too.
- [x] 5.2 Verify via `helm template --values deploy/openshift/values-openshift.yaml` that
      the DocumentDB StatefulSet PodSpec contains no non-null `fsGroup`, carries
      `runAsNonRoot: true` and `seccompProfile.type: RuntimeDefault`, and that no Ingress
      or Route is rendered — verified in §8.

## 6. tests/env Integration

- [x] 6.1 Add a `documentdb` service to `tests/env/docker-compose.yml` using the image
      pinned by tag + digest
      (`ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0@sha256:2386795ec2aa7ae559304361979f1dc5708d383ee9020ae63dadc2940dfe58f7`),
      host port **`55433:5432`** (convention-consistent), `POSTGRES_DB`/`POSTGRES_USER`/
      `POSTGRES_PASSWORD` env, a mounted `conf.d/custom.conf` for startup GUC injection
      (`shared_preload_libraries`, `cron.database_name`; NOT `POSTGRES_EXTRA_ARGS`), and a
      `docker-entrypoint-initdb.d` SQL that runs `CREATE EXTENSION IF NOT EXISTS documentdb
      CASCADE` on first boot. A `pg_isready` healthcheck. Files live under
      `tests/env/documentdb/`.
- [x] 6.2 `docker compose up documentdb` + `\dx` live check is DEFERRED (no container
      runtime in this workspace; same deferral as 1.2/8.3). The compose service, conf.d,
      and init SQL are authored so the check can run as-is on a Docker host.

## 7. Startup Order Documentation (cross-change gate)

- [x] 7.1 Recorded in `add-ferretdb-gateway/tasks.md`: the gateway Helm chart MUST
      implement an initContainer / readiness gate that waits for `pg_isready` on the
      DocumentDB ClusterIP Service AND verifies the `documentdb_api` schema exists before
      the gateway container starts its main process.
- [x] 7.2 Helm hook ordering: the `documentdb-init-job` is a post-install/post-upgrade
      hook (weight 5) that installs the extension (creating `documentdb_api`). Cross-chart
      ordering against the gateway cannot be enforced from this change (the gateway is a
      separate change/release); the gateway-side init-container gate (7.1) is the
      authoritative enforcement and is recorded in `add-ferretdb-gateway`.

## 8. Validation

- [x] 8.1 `helm lint charts/in-falcone/` with `--set documentdb.enabled=true` passes.
- [x] 8.2 `helm template charts/in-falcone/ --set documentdb.enabled=true` renders:
      ClusterIP-only Service on port 5432, ConfigMap with `shared_preload_libraries` +
      `cron.database_name` (no `POSTGRES_EXTRA_ARGS`/session GUCs), init Job with no
      elevated privileges, PVC 20 Gi in base profile, podSecurityContext runAsNonRoot +
      fsGroup 1001 + fsGroupChangePolicy OnRootMismatch.
- [x] 8.3 Live kind deploy (StatefulSet Ready + `\dx` shows `documentdb`) DEFERRED —
      no kind cluster in this workspace; live verification owned by the downstream E2E
      change. Render-level verification is complete (8.1/8.2).
- [x] 8.4 `openspec validate add-ferretdb-documentdb-engine --strict` passes.
