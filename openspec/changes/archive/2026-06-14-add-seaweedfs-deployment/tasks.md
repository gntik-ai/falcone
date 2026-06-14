## 1. Prerequisites and ADR Spike Resolution

- [x] 1.1 Confirm SeaweedFS S3 port (8333), replication notations (`001`/`011`),
      and filer-on-PG validation outcome from `add-seaweedfs-storage-adr-spike`
      before proceeding; record confirmed values in design.md D3 and D5
- [x] 1.2 Identify the official SeaweedFS Helm chart repository URL and the
      version to pin in `charts/in-falcone/Chart.yaml`
      (https://seaweedfs.github.io/seaweedfs/helm, chart 4.33.0 / appVersion 4.33)
- [x] 1.3 Review the upstream chart's `values.yaml` to map Falcone overlay
      field paths for: master replicas, volume replicas, filer PG config,
      S3 port, PVC sizes, securityContext, imagePullSecrets

## 2. Umbrella Chart — Sub-chart Integration

- [x] 2.1 Add the `seaweedfs/seaweedfs` repo to `charts/in-falcone/Chart.yaml`
      as a dependency with `name: seaweedfs`, pinned version, and
      `condition: seaweedfs.enabled`
- [x] 2.2 Run `helm dependency update charts/in-falcone/` and commit the
      updated `Chart.lock` and downloaded chart archive
      (Chart.lock + charts/seaweedfs-4.33.0.tgz written; per task instruction
      they are left in the working tree, NOT committed)
- [x] 2.3 Add `seaweedfs.enabled: false` to `charts/in-falcone/values.yaml`
      (default off) with a comment referencing the cutover toggle
- [x] 2.4 Add the base (dev) SeaweedFS stanza to `charts/in-falcone/values.yaml`:
      master 1 replica, volume 1 server (100 Gi PVC), filer 1 replica (20 Gi PVC),
      S3 gateway 1 replica on port 8333, replication `001`

## 3. Filer-on-PostgreSQL Bootstrap

- [x] 3.1 Add filer `postgres2` backend configuration to the SeaweedFS values
      stanza pointing at the in-cluster PostgreSQL host, database
      `seaweedfs_filer`, and credentials from an existing or new Secret
      (WEED_POSTGRES2_* env + secretExtraEnvironmentVars from in-falcone-postgresql;
      working createTable template carried in WEED_POSTGRES2_CREATETABLE and the
      db-init ConfigMap's filer.toml — per spike evidence/01)
- [x] 3.2 Add an init-container to the filer Pod spec (via chart values override)
      that runs `pg_isready` and creates database `seaweedfs_filer` using the
      PostgreSQL credentials before the filer process starts
      (CORRECTED the task's SQL: PostgreSQL has NO `CREATE DATABASE IF NOT EXISTS`
      — the init-container uses the `SELECT 1 FROM pg_database ... | grep -q 1 ||
      CREATE DATABASE` idempotent idiom, gated on pg_isready)
- [ ] 3.3 Verify in a local kind cluster that the `seaweedfs_filer` database
      and filer tables are present after chart install; record the table names
      DEFERRED: no kind cluster running in this environment. Live verification is
      owned by add-seaweedfs-storage-e2e (#439). Risk is LOW: filer-on-PG table
      creation was already empirically proven by the spike
      (spikes/add-seaweedfs-storage-adr-spike/evidence/08-postgres-filer-ddl.txt:
      filemeta + one table per bucket, schema captured).

## 4. HA Profile Overrides

- [x] 4.1 Add SeaweedFS HA overrides to `charts/in-falcone/values/profiles/ha.yaml`:
      master 3 replicas, volume 3 servers, S3 gateway 2 replicas, replication `011`,
      volume PVC 1 Ti each, filer PVC unchanged at 20 Gi
- [x] 4.2 Verify that `helm template --values profiles/ha.yaml` renders 3 master
      replicas and volume PVCs of 1 Ti
      (verified: master replicas=3, volume replicas=3, s3 replicas=2, volume PVC
      storage: 1Ti, filer PVC storage: 20Gi, -defaultReplication=011)

## 5. S3 Credential Secret

- [x] 5.1 Add a Helm-managed Secret template (or chart values) for
      `in-falcone-seaweedfs-s3-creds` with keys `s3AccessKey` and `s3SecretKey`,
      generated from random values on first install (using `randAlphaNum` or
      chart's built-in credential generation)
      (templates/seaweedfs-s3-creds.yaml — randAlphaNum with a lookup-based
      regeneration guard so re-installs/upgrades do NOT rotate the credentials)
- [x] 5.2 Configure the SeaweedFS S3 gateway to read credentials from
      `in-falcone-seaweedfs-s3-creds` via `envFrom.secretRef` or equivalent
      chart value
      (the gateway loads an identities JSON Secret `in-falcone-seaweedfs-s3-config`
      via seaweedfs.s3.existingConfigSecret; that JSON is built from the SAME
      generated s3AccessKey/s3SecretKey, so the human-facing creds Secret and the
      gateway are a single source of truth)
- [x] 5.3 Confirm no pre-provisioned Secret is required; document the Secret
      name in `charts/in-falcone/README.md` or inline values comment
      (no pre-provisioned Secret required — both Secrets are chart-created;
      documented inline in values.yaml under the `seaweedfsS3Creds` block, incl.
      the #434 consumer-wiring mapping. No README.md exists and per CLAUDE.md the
      audit workspace does not author narrative docs, so the inline-comment option
      was used.)

## 6. Networking — ClusterIP Only and NetworkPolicy

- [x] 6.1 Verify (via `helm template`) that all SeaweedFS Services render as
      `ClusterIP` with no Ingress, Route, or LoadBalancer; override upstream
      defaults if the chart renders a different type
      (verified: s3 Service type=ClusterIP; master/volume/filer Services are
      headless ClusterIP (clusterIP: None, type omitted => ClusterIP); no
      NodePort/LoadBalancer/Ingress/Route for any SeaweedFS component)
- [x] 6.2 Add a `NetworkPolicy` manifest in the umbrella chart (gated by
      `networkPolicy.enabled` AND `seaweedfs.enabled`) that:
      - allows ingress to port 8333 from the Falcone app pod label selector only
      - allows intra-SeaweedFS ingress on master (9333), volume (8080/18080),
        filer (8888/18888) ports
      - denies all other ingress to SeaweedFS pods
      (templates/seaweedfs-networkpolicy.yaml — gated by
      `seaweedfs.enabled && seaweedfs.networkPolicy.enabled`; allows app
      components (controlPlane/controlPlaneExecutor/workflowWorker) -> 8333,
      intra-SeaweedFS master/volume/filer ports, egress DNS + platform namespace
      (PostgreSQL), default-deny otherwise)

## 7. OpenShift SCC Compliance

- [x] 7.1 Add SeaweedFS component entries to `deploy/openshift/values-openshift.yaml`
      following the pattern at lines 135-139:
      `podSecurityContext: { fsGroup: null }` for master, volume, filer, and S3
      (the upstream sub-chart only emits podSecurityContext when
      podSecurityContext.enabled is true, then omits `enabled` — so the overlay
      sets enabled:true and OMITS fsGroup entirely => SCC injects it; verified
      no fsGroup renders on any SeaweedFS pod in the OpenShift overlay)
- [x] 7.2 Add `runAsNonRoot: true` and `seccompProfile: { type: RuntimeDefault }`
      to each SeaweedFS component security context in the OpenShift overlay
      (verified present on master/volume/filer/s3 pod + container security contexts)
- [x] 7.3 Add Harbor pull-secret annotation and airgap image-rewrite stanzas for
      all SeaweedFS images (master, volume, filer, S3) in the OpenShift overlay,
      following the per-component pattern already present for other components
      (seaweedfs.global.imageRegistry -> harbor.example.com/falcone,
      global.imagePullSecrets -> harbor-pull, image namespace rewrite; verified
      pods render image harbor.example.com/falcone/chrislusf/seaweedfs:4.33 +
      harbor-pull pull secret)
- [ ] 7.4 Deploy into an OpenShift test namespace with restricted-v2 SCC; confirm
      all SeaweedFS Pods reach Running with no SCC violation events in the
      namespace event log
      DEFERRED: no OpenShift cluster available in this environment (and none may be
      spun up). Live restricted-v2 admission verification is owned by
      add-seaweedfs-storage-e2e (#439). The overlay was statically verified to
      emit runAsNonRoot + seccompProfile + no fsGroup for all four components.

## 8. TLS Between Components

- [x] 8.1 Enable inter-component TLS in the SeaweedFS chart values
      (master-volume-filer mutual TLS) using the chart's built-in TLS options
      (seaweedfs.global.seaweedfs.enableSecurity=true in the OpenShift overlay;
      base/dev keeps it false — kind has no cert-manager and a single-node dev
      cluster does not need inter-pod TLS)
- [x] 8.2 Determine whether `cert-manager` is available in the target clusters;
      if not, add a Helm hook Job that generates a self-signed CA using `openssl`
      and writes it to a Secret before SeaweedFS Pods start (resolves OQ-3)
      (cert-manager presence is a deploy-time concern not probeable from
      `helm template`; shipped templates/seaweedfs-tls-bootstrap.yaml — a
      pre-install/pre-upgrade hook Job (+ scoped Role/SA/RoleBinding) that
      generates a self-signed CA + master/volume/filer/client leaf certs with
      openssl into the <release>-seaweedfs-*-cert Secrets, with
      certificates.externalCertificates.enabled=true so the sub-chart consumes
      them. Gated by seaweedfsTls.bootstrap.enabled; default OFF, enabled in the
      OpenShift overlay.)
- [x] 8.3 Disable plaintext on the S3 gateway; configure the gateway to use
      the TLS certificate for the in-cluster ClusterIP endpoint
      (OpenShift overlay sets seaweedfs.s3.httpsPort: 8334 with
      enableSecurity=true; verified the s3 deployment renders -port.https=8334 and
      the s3 Service exposes the swfs-s3-tls port backed by the in-cluster cert)

## 9. All-in-One Values (if applicable)

- [x] 9.1 Check whether `charts/in-falcone/values/all-in-one.yaml` exists;
      if so, add minimal SeaweedFS dev overrides (`seaweedfs.enabled: true`,
      minimal resource requests) so the all-in-one profile includes SeaweedFS
      NO-OP: `charts/in-falcone/values/all-in-one.yaml` does NOT exist (only
      airgap/dev/prod/staging/sandbox/profiles/... under values/). Nothing to
      extend; not created (proposal does not require introducing it).

## 10. Validation and Smoke Tests

- [x] 10.1 Run `helm lint charts/in-falcone/` with `seaweedfs.enabled=true`;
       fix any lint errors
       (clean: "1 chart(s) linted, 0 chart(s) failed"; also linted with the
       OpenShift overlay — clean)
- [x] 10.2 Run `helm template charts/in-falcone/ --values values.yaml
       --set seaweedfs.enabled=true` and manually verify: ClusterIP-only
       Services, correct PVC sizes, Secret rendered, SCC fields absent from
       base values
       (verified: ClusterIP-only Services; volume PVC 100Gi / filer PVC 20Gi
       (base); s3 creds Secret with keys s3AccessKey+s3SecretKey + identities
       config Secret rendered; NO fsGroup/SCC fields on any SeaweedFS workload in
       the base render; default (disabled) render emits 0 SeaweedFS resources and
       MinIO remains intact)
- [ ] 10.3 Deploy to local kind cluster with `seaweedfs.enabled=true` and
       `storage.enabled=true`; confirm all pods (MinIO + SeaweedFS) reach Ready
       DEFERRED: no kind cluster running (and none may be spun up here). Live
       full-platform deploy is owned by add-seaweedfs-storage-e2e (#439).
- [ ] 10.4 From a busybox pod, run `aws s3 ls` against SeaweedFS ClusterIP:8333
       using credentials from `in-falcone-seaweedfs-s3-creds`; confirm a valid
       response
       DEFERRED: requires a running in-cluster SeaweedFS S3 gateway (no cluster
       available). Live S3 smoke is owned by add-seaweedfs-storage-e2e (#439).
- [x] 10.5 Run `openspec validate add-seaweedfs-deployment --strict` and confirm
       clean pass before marking this change ready for apply
       ("Change 'add-seaweedfs-deployment' is valid")
