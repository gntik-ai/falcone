# Architecture & Change Design — Replace HashiCorp Vault with OpenBao

**Stage:** ARCHITECT (design only — no source changes here). Builds on the authoritative
`loop-state/system-changes/replace-vault-with-openbao/impact-map.md`. The implementer takes this
plan + the OpenSpec change `replace-vault-with-openbao` and edits the product files.

**Primary outcome:** every FUTURE install of Falcone provisions and uses **OpenBao** instead of
HashiCorp Vault, baked into the source of truth (the vendored Helm subchart, the opt-in overlay, the
init/bootstrap Jobs, the dev compose), with no `hashicorp/vault` image reference left as a default in
any install path — while the proven default render (`vault.enabled=false`) stays secret-store-free
and unbroken, and the persisted/public contracts (`secretBackend:"vault"` enum, `vault_version` DB
columns, `vaultMount`/`vaultRequestId`/`vaultVersion` contract fields) are preserved.

Code-only rule (CLAUDE.md): every decision below is grounded in source/charts/build files cited as
`path` / `path::symbol`. Repo docs are listed only as "doc-only — update later", never as truth.

---

## 1. Context (current state, condensed from the impact map)

- **Install source of truth** = the **vendored** Helm subchart `charts/in-falcone/charts/vault/`
  (17 template/values files), declared in `charts/in-falcone/Chart.yaml` as
  `- name: vault, version: 0.1.0, repository: file://./charts/vault, condition: vault.enabled`,
  packaged as `charts/in-falcone/charts/vault-0.1.0.tgz`, locked in `charts/in-falcone/Chart.lock`.
  **There is NO remote Vault chart and no `helm install hashicorp/vault`** — the only image pins are
  `charts/in-falcone/charts/vault/values.yaml::vault.image.repository=hashicorp/vault` (`tag 1.15.0`)
  and `tests/env/docker-compose.yml::vault.image=hashicorp/vault:1.18`.
- **Disabled by default**: `charts/in-falcone/values.yaml` sets `vault.enabled:false` + `eso.enabled:false`.
  Opt-in via `deploy/kind/values-kind-vault.yaml` (self-signed TLS, `eso.enabled:true`, control-plane
  consumer wiring). The default render is Vault-free and proven by
  `tests/blackbox/deploy-completeness-vault-prometheus.test.mjs`.
- **Bootstrap** = `templates/vault-init-job.yaml` shelling out to the `vault` CLI: `operator init`
  (5/3 Shamir), `operator unseal` x3, `auth enable kubernetes` + `auth/kubernetes/config`,
  `secrets enable -path=secret kv-v2`, `audit enable file`, `policy write` x5, create k8s auth roles,
  seed 7 dummy KV paths. `templates/vault-migration-job.yaml` is a no-op stub.
- **Consumer** = ESO subchart `charts/in-falcone/charts/eso/` → `ClusterSecretStore/vault-backend`
  (`provider.vault`, `path:secret`, `version:v2`, k8s auth, caProvider→`vault-server-tls`) feeding 6
  platform ExternalSecrets (postgresql/documentdb/kafka/s3/apisix/keycloak).
- **Code** = ONE raw-HTTP KV v2 client `deploy/kind/control-plane/vault-secrets.mjs`
  (`createVaultKvClient`/`createWorkspaceSecretStore`/`vaultStoreFromEnv`), used by
  `fn-handlers.mjs::fnDeploy`; rotation actions in `services/provisioning-orchestrator` use an
  INJECTED `vaultClient` (default no-op stub — backend-agnostic, NO change); audit parser
  `services/secret-audit-handler/src/vault-log-reader.mjs::parseVaultEntry` is schema-coupled to
  Vault's file-audit JSON.
- **Data** = KV v2 mount `secret/`: 7 platform/app paths (`secret/{platform,gateway,iam}/*`) +
  per-tenant function secrets `secret/data/falcone/workspace-secrets/{tenantId}/{workspaceId}/{name}`.
  **No transit / encryption-as-a-service** → migration is a KV-v2 data copy, not a key re-wrap.
- **No Enterprise / auto-unseal / Raft / Consul / transit / Vault-namespaces in use** — only OSS
  features OpenBao provides.

---

## 2. Goals / Non-Goals

**Goals**
1. A fresh install (the opt-in path `deploy/kind/values-kind-vault.yaml` + the umbrella chart)
   provisions **OpenBao**, never `hashicorp/vault`, with zero manual steps.
2. The KV v2 secrets API still works end-to-end (workspace secret set/get/list/delete + tenant
   isolation) against OpenBao via the unchanged `vault-secrets.mjs` REST client.
3. ESO syncs the 6 platform credentials from OpenBao via the existing `vault:` provider type.
4. The audit pipeline still parses OpenBao's file-audit JSON (the unit test stays green).
5. The default render (`vault.enabled=false`) stays secret-store-free and the two render-asserting
   blackbox tests + the KV contract test stay green.
6. Existing running Vault deployments have a concrete, idempotent, verifiable migration +
   backup + rollback runbook.

**Non-Goals (explicitly out of scope, with rationale)**
- **Renaming the public/persisted contract identifiers**: the API enum value `secretBackend:"vault"`
  (`apps/control-plane/openapi/control-plane.openapi.json`, `families/workspaces.openapi.json`,
  `families/auth.openapi.json`), the DB columns `vault_version`
  (`services/provisioning-orchestrator/src/repositories/secret-rotation-repo.mjs`,
  `secret_version_states`/`secret_propagation_events`), and the contract fields `vaultMount`
  (`internal-contracts/secrets/secret-metadata-v1.yaml`), `vaultRequestId`
  (`internal-contracts/secrets/secret-audit-event-v1.yaml`), `vaultVersion`/`vault_version_new|old`
  (rotation actions + web-console). Renaming these is a **breaking API/DB change orthogonal to the
  backend swap** (it would force a DB migration, an OpenAPI contract bump, and console changes that
  the CI quality gate `validate:public-api` polices) and is NOT required for OpenBao to work — the
  values are backend-neutral integers/strings/enum tokens. **Deferred to a separate follow-up.**
- **The injected `vaultClient` seam** in `services/provisioning-orchestrator/src/actions/secret-rotation-*.mjs`
  — it is a no-op stub by default, never a real client; backend-agnostic; no change.
- At-rest envelope changes, auto-unseal/KMS seal, Raft/HA storage — none are in use; not introduced.
- Documentation rewrites of the doc-only files (`README*`, `docs/`, `docs-site/`) — flagged for a
  later doc pass; per CLAUDE.md they are not a source of truth and are not edited as part of the
  functional swap (one optional cleanup task is listed).

---

## 3. Decisions

### D1 — Image and version

- **Image repository:** `openbao/openbao` (Docker Hub canonical; the implementer may switch to
  `ghcr.io/openbao/openbao` or `quay.io/openbao/openbao` if a registry-mirror/pull-secret policy
  requires it — all three publish the same artifact).
- **Tag:** target a recent stable 2.x release, **`2.3.1`** as the design target, with the explicit
  instruction that the implementer **live-verifies the exact pullable tag** at fresh-install time and
  pins whatever current 2.x stable resolves on the chosen registry (e.g. `2.2.0`/`2.3.x`). Set the
  subchart `Chart.yaml::appVersion` to the same tag.
- **Dev image** (`tests/env/docker-compose.yml`): `openbao/openbao:2.3.1` (same pin), `bao server -dev`.
- **Rationale:** OpenBao is a Vault fork; the `file` storage backend, KV v2, k8s auth, file audit
  device, and HCL config format we use are all OSS features carried forward. No Enterprise tag needed.

### D2 — CLI binary `vault` → `bao`, and env `VAULT_*` → `BAO_*`

OpenBao ships the **`bao`** binary (it deliberately does NOT ship a `vault` binary). Every shelled-out
`vault …` invocation must become `bao …`; subcommands/flags are identical
(`bao operator init/unseal`, `bao auth enable kubernetes`, `bao secrets enable -path=secret kv-v2`,
`bao audit enable file`, `bao policy write`, `bao kv put/get/list`, `bao token lookup`,
`bao status -format=json`).

OpenBao's canonical CLI/server env is `BAO_*` (`BAO_ADDR`, `BAO_TOKEN`, `BAO_CACERT`, `BAO_API_ADDR`,
`BAO_SKIP_VERIFY`; dev `BAO_DEV_ROOT_TOKEN_ID`, `BAO_DEV_LISTEN_ADDRESS`). OpenBao retains `VAULT_*` as
a backward-compat fallback, but **we design for the canonical `BAO_*`** in the StatefulSet env, the
init/migration Jobs, the dev compose, and `tests/env/up.sh`, so the swap does not rely on an
undocumented fallback. The StatefulSet `args` stay `["server","-config=/<dir>/openbao.hcl"]` (server
config flag is the same).

### D3 — REST API and the code client are UNCHANGED

OpenBao's REST API is byte-compatible: paths stay `/v1/{mount}/data|metadata/...`, the request token
header stays `X-Vault-Token`, `?list=true` works, `/v1/sys/health` works. **Therefore
`deploy/kind/control-plane/vault-secrets.mjs` needs NO behavioral change** — it keeps sending
`x-vault-token` and reading `VAULT_ADDR/VAULT_TOKEN/VAULT_KV_MOUNT/VAULT_NAMESPACE` from env.

**Decision on `BAO_*` env aliases in `vaultStoreFromEnv`:** **YES, add them additively** (cheap,
non-breaking, keeps the code consistent with the chart's `BAO_*` env). Change
`vaultStoreFromEnv(env)` to read `env.BAO_ADDR ?? env.VAULT_ADDR`, `env.BAO_TOKEN ?? env.VAULT_TOKEN`,
`env.BAO_KV_MOUNT ?? env.VAULT_KV_MOUNT`, `env.BAO_NAMESPACE ?? env.VAULT_NAMESPACE` — **VAULT_* still
works** so the existing contract test `tests/blackbox/vault-workspace-secrets.test.mjs::vaultStoreFromEnv`
(which sets `VAULT_ADDR/VAULT_TOKEN`) stays green unchanged, and a new assertion can cover the
`BAO_*` alias. The header stays `x-vault-token` (do not rename — it is the wire contract OpenBao
honors). This is the ONLY code edit in the swap; if the implementer finds it not cheap, it is
optional and may be dropped (then the chart simply injects `VAULT_*`-named env into the control-plane
Secret — see D5).

### D4 — Rename scope (the load-bearing decision)

The command requires a reviewer to confirm "no old component left as a DEFAULT anywhere" and "the swap
is complete." I split identifiers into three buckets. The guiding principle:

> **What identifies the PRODUCT must change to OpenBao; what is a generic infrastructure name or a
> persisted/public contract token stays — and where it stays, it is justified as backend-neutral.**

#### D4a — DO swap (functional + product-identifying; makes the swap real)
- Subchart image `hashicorp/vault` → `openbao/openbao` and `tag`/`appVersion`
  (`charts/in-falcone/charts/vault/values.yaml`, `charts/in-falcone/charts/vault/Chart.yaml`).
- Subchart `Chart.yaml` `description` "Vault OSS deployment …" → OpenBao wording.
- The CLI `vault`→`bao` and `VAULT_*`→`BAO_*` env in ALL Jobs/scripts/dev-compose
  (`vault-init-job.yaml`, `vault-migration-job.yaml`, `scripts/verify-secret-storage.sh`,
  `tests/env/up.sh`, `tests/env/docker-compose.yml`).
- HCL server config + StatefulSet env: the file `vault.hcl`→`openbao.hcl`, the in-pod paths
  `/vault/{data,audit,config,tls}`→`/openbao/{data,audit,config,tls}`, the audit log
  `/vault/audit/vault-audit.log`→`/openbao/audit/openbao-audit.log`, the StatefulSet env from
  `VAULT_ADDR/VAULT_API_ADDR/VAULT_CACERT/VAULT_SKIP_VERIFY`→`BAO_ADDR/BAO_API_ADDR/BAO_CACERT/BAO_SKIP_VERIFY`
  (`vault-config-configmap.yaml`, `vault-deployment.yaml`, `files/vault-audit-sidecar.yaml`,
  `vault-init-job.yaml`, `vault-migration-job.yaml`).
- The dev image in `tests/env/docker-compose.yml` and its dev-env vars (`VAULT_DEV_*`→`BAO_DEV_*`,
  `BAO_ADDR`/`BAO_TOKEN`), the healthcheck `vault status`→`bao status`, the host audit log filename.
- Regenerate the packaged subchart `.tgz` + `Chart.lock` digest via `helm dependency build`.
- Update the render-asserting blackbox tests (`vault-secrets-backend-kind.test.mjs`,
  `deploy-completeness-vault-prometheus.test.mjs`) to assert the OpenBao image + the (possibly
  renamed) object names, and the KV contract test only insofar as the new `BAO_*` alias.

#### D4b — RENAME the install-layer identifiers to OpenBao (chosen: FULL rename of the secret-store install layer)

**Decision: rename the subchart and its k8s objects, the toggle, the ESO store, the SA/role, the TLS
secret, and the namespace to OpenBao-branded names.** This is the cleaner, unambiguous "no Vault left"
posture and is safe because **all of these names live entirely inside the install layer** — they are
recreated fresh on every install, the only cross-references are within the chart (which we update in
lockstep), and the only external coupling (the control-plane consumer Secret names + the operator
runbook in the overlay header) is also ours to update. Concretely:

| Identifier (current) | Renamed to | Cascades that MUST be updated in lockstep |
|---|---|---|
| Subchart dir `charts/in-falcone/charts/vault/` | `charts/in-falcone/charts/openbao/` | `Chart.yaml` dep `name/repository`, `Chart.lock`, packaged `.tgz` name, umbrella `values.yaml` toggle key |
| Toggle `vault.enabled` | `openbao.enabled` | `charts/in-falcone/values.yaml`, `Chart.yaml` `condition`, `deploy/kind/values-kind-vault.yaml`, both render tests |
| Subchart values root `.Values.vault.*` | `.Values.openbao.*` | every template in the subchart + the overlay's `vault.vault.*`→`openbao.openbao.*` nesting |
| StatefulSet/Service `vault` + `vault-internal` | `openbao` + `openbao-internal` | `serviceName`, TLS SANs, ESO `vaultAddress`, HCL `api_addr`/`cluster_addr`, NetworkPolicies, control-plane consumer `BAO_ADDR` |
| ConfigMap `vault-config` | `openbao-config` | `vault-deployment.yaml` volume ref |
| Job `vault-init` / `vault-migration` | `openbao-init` / `openbao-migration` | self-contained |
| Hook Job/Role/SA/RB `vault-tls-bootstrap` | `openbao-tls-bootstrap` | self-contained |
| TLS Secret `vault-server-tls` | `openbao-server-tls` | subchart `tls.secretName`, ESO `caProvider.name`, init/migration volume |
| ConfigMaps `vault-policy-*` | `openbao-policy-*` | `vault-init-job.yaml` projected volume |
| NetworkPolicy `vault-access-policy` / `eso-to-vault` | `openbao-access-policy` / `eso-to-openbao` | self-contained |
| SA `vault` / ClusterRole(Binding) `vault-kubernetes-auth` | `openbao` / `openbao-kubernetes-auth` | `vault-init-job.yaml`/`vault-migration-job.yaml` `serviceAccountName` |
| ESO store `ClusterSecretStore/vault-backend` | `openbao-backend` | the 6 ExternalSecrets' `secretStoreRef.name` |
| ESO SA `eso-vault-auth` | `eso-openbao-auth` | `eso/values.yaml`, `vault-init-job.yaml` `eso-role` binding, ESO store `serviceAccountRef` |
| ESO auth role `eso-role` | keep `eso-role` (generic, not product-named) OR `eso-openbao-role` — **keep `eso-role`** (it names ESO's role, not the product) |
| Namespace `secret-store` | **KEEP** `secret-store` (generic infra name, see D4c) | n/a |
| Control-plane consumer Secrets `in-falcone-vault-workspace-secrets-{env,tls}` | `in-falcone-openbao-workspace-secrets-{env,tls}` | `deploy/kind/values-kind-vault.yaml` `envFromSecrets`/`extraVolumes`, the header runbook commands |
| Overlay file `deploy/kind/values-kind-vault.yaml` | **KEEP filename** `values-kind-vault.yaml` (it is referenced by the two render tests + memory/runbooks; renaming the file is churn with no functional gain — its CONTENT provisions OpenBao). Optionally add a thin alias symlink/copy `values-kind-openbao.yaml`. **Decision: keep the filename, update its content.** |
| Subchart `templates/vault-*.yaml` filenames | rename to `openbao-*.yaml` for cleanliness | `vault-deployment.yaml`→`openbao-statefulset.yaml` etc.; `.Files.Get "files/vault-audit-sidecar.yaml"` ref must track the file rename |
| Control-plane `vault-secrets.mjs` filename | **KEEP** `vault-secrets.mjs` (renaming forces a `Dockerfile` by-name COPY change + a `fn-handlers.mjs` import change for zero functional gain; the file is an internal module name, not a product reference, and the impact-map memory flags the by-name COPY hazard). **Decision: keep the filename.** |

**Why full rename of the install layer is safe here:** unlike the API enum / DB columns (which are
persisted and public), every renamed object above is **stateless install metadata** regenerated on
each `helm install`; there is no persisted handle to a `vault-`named k8s object that survives a fresh
install. The TLS SANs, ESO `vaultAddress`, HCL addrs, and consumer `BAO_ADDR` are all derived from the
Service name and are updated together. For an **existing** deployment, the rename means new object
names — handled explicitly in the migration runbook (§6) as a parallel cutover, NOT an in-place
relabel (you cannot `kubectl` rename a StatefulSet/Service in place; you stand up the OpenBao-named
objects alongside, migrate data, repoint ESO, then remove the Vault-named objects).

#### D4c — Names that STAY, and why "no old default" still holds
- **Namespace `secret-store`** — a generic, function-describing name ("the store for secrets"), not
  the Vault product. Renaming it cascades into RBAC namespace bindings, ESO `caProvider.namespace`,
  the consumer runbook, NetworkPolicy `namespaceSelector`s, and existing-deployment migration, for no
  branding gain. **Stays.**
- **ESO auth role `eso-role`** — names ESO's role, not the product. **Stays.**
- **`vault-secrets.mjs`** filename and the `x-vault-token` header — internal module name + the wire
  header OpenBao itself honors. **Stay** (header is a compatibility contract, not a default product
  install).
- **Overlay filename `values-kind-vault.yaml`** — referenced by tests/runbooks; content provisions
  OpenBao. **Stays** (content swapped).
- **Contract/DB identifiers** (`secretBackend:"vault"`, `vault_version`, `vaultMount`,
  `vaultRequestId`, `vaultVersion`) — persisted/public, backend-neutral, out of scope (§2 Non-Goals).

**Net:** after the change, the INSTALLED PRODUCT is OpenBao (image, CLI, StatefulSet, ESO store, init
Job, dev server). The handful of retained `vault`-strings are generic infra names, a wire-compat
header, an internal module filename, an overlay filename, and persisted contract tokens — none of
which is "HashiCorp Vault installed as a default." A reviewer grepping for the *image* finds zero
`hashicorp/vault`; grepping for the *product* finds OpenBao.

> **Implementer latitude:** D4b is the recommended full-rename. If, at implementation time, the
> render-test churn or the existing-deployment migration cost proves disproportionate, a defensible
> **reduced-rename** fallback is acceptable PROVIDED the D4a functional swaps (image/CLI/env/HCL/dev)
> are complete and `tests/blackbox/deploy-completeness-vault-prometheus.test.mjs` (default = no
> secret-store workload) plus the OpenBao image assertion stay green. The non-negotiables are: (1) no
> `hashicorp/vault` image as a default anywhere; (2) the opt-in path provisions OpenBao; (3) the
> default render stays secret-store-free. The OpenSpec scenarios are written against those
> non-negotiables, not against specific renamed object names, so either rename depth validates.

### D5 — Consumer wiring (control-plane) under the rename
`deploy/kind/values-kind-vault.yaml` consumes the backend via two operator-supplied Secrets. Under
D4b:
- Rename the Secrets to `in-falcone-openbao-workspace-secrets-{env,tls}` and update the overlay
  `controlPlane.envFromSecrets`/`extraVolumes` + the header runbook commands.
- The env keys inside the Secret become `BAO_ADDR`, `BAO_KV_MOUNT=secret`, `BAO_TOKEN`,
  `NODE_EXTRA_CA_CERTS=/openbao/tls/ca.crt` (D3 makes `vault-secrets.mjs` read `BAO_*` first, falling
  back to `VAULT_*`). `BAO_ADDR=https://openbao.secret-store.svc.cluster.local:8200`.
- The TLS CA mount path moves `/vault/tls`→`/openbao/tls` to match the renamed Service/HCL.

### D6 — Differences summary (target vs current): what stays, what must change

| Dimension | Vault (current) | OpenBao (target) | Verdict |
|---|---|---|---|
| KV v2 REST (`/v1/{mount}/data\|metadata`, `?list=true`, `X-Vault-Token`) | yes | yes (compat) | **same** — `vault-secrets.mjs` unchanged behaviorally |
| `/v1/sys/health` probe | yes | yes | **same** |
| CLI binary | `vault` | `bao` | **change** all Jobs/scripts |
| Canonical env | `VAULT_*` (+ `VAULT_DEV_*`) | `BAO_*` (+ `BAO_DEV_*`); `VAULT_*` fallback exists | **change** to `BAO_*` (don't rely on fallback) |
| HCL config (`storage "file"`, `listener "tcp"`, `api_addr`, lease TTLs, `ui`) | yes | yes (same format) | **same format**, rename file/paths only |
| Seal | Shamir 5/3, manual unseal, keys operator-held | Shamir 5/3, same | **same** |
| k8s auth + ACL identity templating (`identity.entity.aliases.auth_kubernetes_cluster_1.metadata.tenantId`) | yes | yes (supported) — alias name is mount-accessor-derived | **same** — LIVE-VERIFY alias name |
| File-audit JSON schema (`request.path/operation/id`, `auth.metadata.service_account_*`, `error`, `time`) | yes | inherited from Vault | **same** — LIVE-VERIFY byte-compat (unit test is the anchor) |
| ESO `provider.vault` (`version:v2`, k8s auth) | yes | accepted (ESO documents OpenBao) | **same** provider type — LIVE-VERIFY sync on kind |
| Deployment object names / image | Vault-branded | OpenBao-branded (D4b) | **change** install layer |
| Persisted/public contract tokens (`secretBackend:"vault"`, `vault_version`, `vault*` fields) | — | — | **unchanged** (out of scope) |

---

## 4. Per-file change plan (grouped)

Paths absolute under the repo root `/home/andrea/gntik/falcone/`.

### 4.1 Umbrella chart wiring
- `charts/in-falcone/Chart.yaml` — dep entry `name: vault`→`name: openbao`,
  `repository: file://./charts/vault`→`file://./charts/openbao`, `condition: vault.enabled`→`openbao.enabled`.
- `charts/in-falcone/values.yaml` — `vault: { enabled: false }`→`openbao: { enabled: false }` (keep
  `eso: { enabled: false }`). **Default stays disabled.**
- `charts/in-falcone/Chart.lock` — regenerate (digest changes) via `helm dependency build`.
- `charts/in-falcone/charts/vault-0.1.0.tgz` — **delete**; new `charts/in-falcone/charts/openbao-0.1.0.tgz`
  produced by `helm dependency build`. (Same for `eso-0.1.0.tgz` since the ESO subchart changes.)

### 4.2 The secret-store subchart `charts/in-falcone/charts/vault/` → `charts/in-falcone/charts/openbao/`
Rename the directory and within it:
- `Chart.yaml` — `name: vault`→`openbao`, `appVersion: "1.15.0"`→`"2.3.1"` (D1), description reworded.
- `values.yaml` — root key `vault:`→`openbao:`; `image.repository: hashicorp/vault`→`openbao/openbao`,
  `tag: "1.15.0"`→`"2.3.1"`; `tls.secretName: vault-server-tls`→`openbao-server-tls`;
  `eso.serviceAccountName: eso-vault-auth`→`eso-openbao-auth`. Keep `namespace: secret-store`,
  Shamir 5/3, ports 8200/8201, the audit sidecar stanza, `migration.enabled`.
- `templates/vault-deployment.yaml`→`templates/openbao-statefulset.yaml` — StatefulSet `vault`→`openbao`,
  `serviceName: vault-internal`→`openbao-internal`, `args: -config=/openbao/config/openbao.hcl`,
  env `VAULT_ADDR/VAULT_API_ADDR/VAULT_CACERT/VAULT_SKIP_VERIFY`→`BAO_*` with value host
  `openbao.secret-store.svc.cluster.local`, volume mounts `/vault/*`→`/openbao/*`, config volume ref
  `vault-config`→`openbao-config`, TLS secret ref via `.Values.openbao.tls.secretName`, audit sidecar
  include path tracks the renamed file. **Keep** `runAsUser:100`, `readOnlyRootFilesystem:true`,
  `fsGroup:1000`, the `/v1/sys/health` probes.
- `templates/vault-config-configmap.yaml`→`templates/openbao-config-configmap.yaml` — ConfigMap
  `vault-config`→`openbao-config`, key `vault.hcl`→`openbao.hcl`, `storage "file" { path="/openbao/data" }`,
  listener TLS paths `/openbao/tls/*`, `api_addr`/`cluster_addr` host `openbao`/`openbao-internal`.
- `templates/vault-init-job.yaml`→`templates/openbao-init-job.yaml` — Job `openbao-init`,
  `serviceAccountName: openbao`, ALL `vault `→`bao `, `VAULT_ADDR/VAULT_CACERT/VAULT_TOKEN`→`BAO_*`,
  addr host `openbao`, audit `file_path=/openbao/audit/openbao-audit.log`, projected policy ConfigMaps
  `vault-policy-*`→`openbao-policy-*`, TLS volume secret `.Values.openbao.tls.secretName`. **Init
  logic 1:1** (init/unseal/auth/secrets/audit/policies/roles/seed) — `bao` flags identical.
- `templates/vault-migration-job.yaml`→`templates/openbao-migration-job.yaml` — same renames; the body
  stays a no-op stub in the CHART (the real migration is the standalone runbook script in §6, not the
  in-cluster Job). Reword the comment to OpenBao.
- `templates/vault-service.yaml`→`templates/openbao-service.yaml` — Services `openbao` (ClusterIP) +
  `openbao-internal` (headless), ports 8200/8201, selector label `app.kubernetes.io/name: openbao`.
- `templates/vault-networkpolicy.yaml`→`templates/openbao-networkpolicy.yaml` — NetworkPolicy
  `openbao-access-policy`, label `openbao-access`, podSelector `app.kubernetes.io/name: openbao`.
- `templates/vault-rbac.yaml`→`templates/openbao-rbac.yaml` — SA `openbao` (ns secret-store), SA
  `eso-openbao-auth` (ns eso-system), ClusterRole/Binding `openbao-kubernetes-auth`.
- `templates/vault-pvc.yaml`→`templates/openbao-pvc.yaml` — PVCs `openbao-data` (10Gi) + `openbao-audit`
  (2Gi). **NOTE for migration:** renamed PVCs are new volumes; an in-place data carry-over is NOT
  possible by rename — see §6 (parallel cutover + KV copy).
- `templates/vault-tls-bootstrap.yaml`→`templates/openbao-tls-bootstrap.yaml` — hook Job/Role/SA/RB
  `openbao-tls-bootstrap`, `CN=openbao.${NS}.svc.cluster.local`, SANs
  `DNS:openbao,DNS:openbao.${NS},DNS:openbao.${NS}.svc,DNS:openbao.${NS}.svc.cluster.local,DNS:openbao-internal.${NS}.svc.cluster.local`,
  Secret name `.Values.openbao.tls.secretName`. **TLS SANs MUST match the renamed Service DNS** (this
  is the single most error-prone rename — a SAN/host mismatch breaks ESO's TLS to the backend).
- `templates/vault-tls-certificate.yaml`→`templates/openbao-tls-certificate.yaml` — cert-manager
  `Certificate openbao-server-tls`, same renamed DNS SANs (cert-manager mode).
- `templates/vault-policies/*.hcl.yaml`→`templates/openbao-policies/*.hcl.yaml` — ConfigMaps
  `openbao-policy-{platform,tenant,functions,gateway,iam}`. HCL bodies UNCHANGED (KV paths
  `secret/data/...` are the mount, not the product); the tenant policy keeps
  `identity.entity.aliases.auth_kubernetes_cluster_1.metadata.tenantId` (LIVE-VERIFY the alias name
  under OpenBao's k8s auth).
- `files/vault-audit-sidecar.yaml`→`files/openbao-audit-sidecar.yaml` — env
  `VAULT_AUDIT_LOG_PATH=/vault/audit/vault-audit.log`→`/openbao/audit/openbao-audit.log` (the
  audit-handler reads this env; see 4.5), audit volume mount `/openbao/audit`, sidecar still runs the
  secret-audit-handler. Update the `.Files.Get` include in the StatefulSet to the new filename.

### 4.3 ESO subchart `charts/in-falcone/charts/eso/`
- `Chart.yaml` — description reworded "…for Falcone OpenBao-backed secrets" (keep
  `external-secrets 0.9.0` dep — LIVE-VERIFY OpenBao acceptance; if a newer ESO is needed, that is a
  scoped bump the implementer makes after the live check).
- `values.yaml` — `vaultAddress: https://openbao.secret-store.svc.cluster.local:8200`,
  `serviceAccountName: eso-openbao-auth`, `caProvider.name: openbao-server-tls`. Keep
  `vaultAuthPath: kubernetes`, `vaultAuthRole: eso-role`, `caProvider.namespace: secret-store`. (The
  ESO values keys are named `vault*` by ESO's provider type; renaming the keys is cosmetic and would
  force template edits — keep the KEY names, change the VALUES.)
- `templates/cluster-secret-store.yaml` — `ClusterSecretStore` name `vault-backend`→`openbao-backend`;
  **keep `spec.provider.vault`** (the ESO provider type for OpenBao); `caProvider.name` from
  `.Values.eso.caProvider.name` (now `openbao-server-tls`). `path: secret`, `version: v2` unchanged.
- `templates/eso-networkpolicy.yaml` — NetworkPolicy `eso-to-vault`→`eso-to-openbao`, egress to ns
  `secret-store` :8200.
- `templates/external-secrets/*.yaml` (6 files) — each `secretStoreRef.name: vault-backend`→`openbao-backend`.
  KV paths (`platform/postgresql`, …), target k8s Secret names, and namespaces UNCHANGED.

### 4.4 Deploy overlay (the opt-in install path)
- `deploy/kind/values-kind-vault.yaml` (keep filename) — top key `vault:`→`openbao:`, nested
  `vault.vault.tls.mode`→`openbao.openbao.tls.mode: self-signed`; keep `eso.enabled: true`;
  `controlPlane.envFromSecrets`/`extraVolumes` Secret names →
  `in-falcone-openbao-workspace-secrets-{env,tls}`; `extraVolumeMounts.mountPath: /openbao/tls`;
  rewrite the header runbook (create-secret commands) to `BAO_ADDR`,
  `BAO_ADDR=https://openbao.secret-store.svc.cluster.local:8200`, `BAO_KV_MOUNT=secret`,
  `NODE_EXTRA_CA_CERTS=/openbao/tls/ca.crt`, `BAO_TOKEN=…`, and the CA copy from
  `kubectl -n secret-store get secret openbao-server-tls`.
- `deploy/kind/values-kind.yaml`, `deploy/kind/values-production.yaml` — no Vault/ESO keys; **no
  change** (confirmed Vault-free in the impact map). Verify the default render stays secret-store-free.
- `deploy/openshift/values-openshift.yaml` — comments mention "ESO/Vault"; **optional** comment reword
  (doc-comment, not functional).
- `deploy/k8s/encryption-config.yaml` — comment "sourced during Vault bootstrap from
  `secret/platform/encryption/master-key`"; **optional** reword to OpenBao (comment only).

### 4.5 Code
- `deploy/kind/control-plane/vault-secrets.mjs` — **ONLY** change `vaultStoreFromEnv` to accept
  `BAO_*` env aliases first, `VAULT_*` fallback (D3). Keep filename, keep `x-vault-token` header, keep
  `createVaultKvClient`/`createWorkspaceSecretStore` behavior. Update the file's top comment to say
  OpenBao (the code is backend-neutral KV v2).
- `services/secret-audit-handler/src/index.mjs` — reads `VAULT_AUDIT_LOG_PATH`; **make it accept
  `BAO_AUDIT_LOG_PATH ?? VAULT_AUDIT_LOG_PATH`** (the chart now injects `BAO_AUDIT_LOG_PATH` via the
  renamed sidecar) with default `/openbao/audit/openbao-audit.log`. Additive, non-breaking.
- `services/secret-audit-handler/src/vault-log-reader.mjs` — **NO change** (OpenBao's audit JSON is
  Vault-schema-compatible; the unit test is the regression anchor). Keep the filename.
- `services/provisioning-orchestrator/src/actions/secret-rotation-*.mjs` + `secret-path-ownership.mjs`
  + `secret-rotation-repo.mjs` — **NO change** (injected `vaultClient` stub; `vault_version` DB column
  is backend-neutral and out of scope).
- `deploy/kind/control-plane/{fn-handlers.mjs,routes.mjs,Dockerfile,server.mjs}` — **NO change**
  (`vault-secrets.mjs` keeps its filename so the by-name `Dockerfile` COPY + the `fn-handlers.mjs`
  import are untouched; `server.mjs` comment is doc-only).
- API enum / contracts / web-console — **NO change** (out of scope, §2).

### 4.6 Dev environment
- `tests/env/docker-compose.yml` — `vault` service: `image: openbao/openbao:2.3.1`, `command:
  ["server","-dev"]` (binary is `bao`, but `command` is the container entrypoint args — verify the
  image entrypoint is `bao`; if so `["server","-dev"]` works as-is), env
  `BAO_DEV_ROOT_TOKEN_ID: root`, `BAO_DEV_LISTEN_ADDRESS: 0.0.0.0:8200`, `BAO_ADDR: http://localhost:8200`,
  `BAO_TOKEN: root`; healthcheck `bao status`; host audit mount/path
  `./openbao/audit:/openbao/audit`. (Service key may stay `vault:` in compose for least churn, OR be
  renamed `openbao:` — renaming cascades into `up.sh`/`down.sh` `docker compose … vault`/`exec … vault`
  references. **Decision: rename the compose service to `openbao`** and update `up.sh`/`down.sh`, for
  consistency with the chosen full-rename.)
- `tests/env/up.sh` — `docker compose ps openbao`, `exec … openbao bao audit enable file
  file_path=/openbao/audit/openbao-audit.log`, `bao kv get`/`bao token lookup`, env `BAO_ADDR`/`BAO_TOKEN`,
  host audit log path `./openbao/audit/openbao-audit.log`, the echoed dev URL line.
- `tests/env/down.sh`, `tests/env/env.sh` — update any `vault`/`VAULT_*` references (service name,
  audit dir).
- `tests/hardening/lib/fixtures.mjs` — `seedVaultSecrets` does `await import('node-vault')` (not in
  any package.json; resolves only if installed). **No required change** (node-vault targets the same
  HTTP API OpenBao serves; the fixture self-stubs when node-vault is absent). Optional: point its
  `endpoint` at `BAO_ADDR ?? VAULT_ADDR` for consistency.

### 4.7 Tests (render + contract anchors — must stay green)
- `tests/blackbox/vault-secrets-backend-kind.test.mjs` — update render assertions to the renamed
  objects (`ClusterSecretStore/openbao-backend`, the OpenBao StatefulSet/TLS, the self-signed bootstrap
  Job `openbao-tls-bootstrap`) and the OpenBao image; keep asserting the overlay enables self-signed.
- `tests/blackbox/deploy-completeness-vault-prometheus.test.mjs` — keep asserting the DEFAULT render
  has `openbao.enabled=false` and renders NO secret-store workload (rename the toggle key it checks).
- `tests/blackbox/vault-workspace-secrets.test.mjs` — keep the existing `VAULT_*` assertions green
  (D3 fallback) AND add a `BAO_*` alias case for `vaultStoreFromEnv`. The fake KV v2 server, paths,
  isolation, `X-Vault-Token` header assertions are UNCHANGED.
- `services/secret-audit-handler/tests/unit/vault-log-reader.test.mjs` — **NO change**; it is the
  audit-schema regression anchor and must stay green against OpenBao's audit JSON (LIVE-VERIFY).
- All other secret-* tests (rotation, consumer, isolation, redaction) — backend-agnostic, **NO change**.

### 4.8 Packaged-artifact regeneration (mandatory, per memory `[[helm-component-wrapper-tgz-staleness]]`)
After ALL subchart edits: run `helm dependency build charts/in-falcone` (or `helm dependency update`)
to (a) delete `charts/in-falcone/charts/vault-0.1.0.tgz`, (b) produce
`charts/in-falcone/charts/openbao-0.1.0.tgz` + a refreshed `eso-0.1.0.tgz`, and (c) rewrite
`charts/in-falcone/Chart.lock` (new digest + the `openbao` entry replacing `vault`). The packaged
`.tgz` is what actually ships, so the render tests run against it — regenerate BEFORE running the
blackbox suite. Confirm `git status` shows the old `.tgz` deleted and the new one added.

### 4.9 Docs (doc-only — NOT a source of truth; optional cleanup task)
`README*`, `docs/installation/openshift-airgapped-harbor.md`,
`docs/reference/architecture/byok-provider-secret-confinement.md`, `docs-site/**` mention Vault. Per
CLAUDE.md these are not behavioral truth and are not required for the swap. One OPTIONAL task records
that a later doc pass should replace "Vault" with "OpenBao" in user-facing install docs.

---

## 5. Data migration (EXISTING running deployments only — a fresh install needs NONE)

A fresh install seeds OpenBao via the init Job and needs no migration. For an already-running Vault
install the secrets must be carried over. Because there is **no transit/EaaS** (the encryption
master-key is a stored KV value, not a transit key), migration is a **KV-v2 data copy**, not a key
re-wrap. Because the rename (D4b) produces new object names + new PVCs, migration is a **parallel
cutover** (stand up OpenBao alongside Vault, copy, repoint ESO, decommission Vault) — NOT an in-place
relabel.

**State dir for all artifacts:** `loop-state/system-changes/replace-vault-with-openbao/`.

### 5.1 What to migrate
- **(A) 7 platform/app paths** (read by ESO): `secret/platform/{postgresql,documentdb,kafka,s3,encryption}`,
  `secret/gateway/apisix`, `secret/iam/keycloak`.
- **(B) All live per-tenant function secrets:** every key under
  `secret/data/falcone/workspace-secrets/**` (recursively listed via metadata; value shape `{value}`).
- **Auth/policies/roles are RE-CREATED by the OpenBao init Job** (not copied) — they are config, not
  data.
- The DB rows (`secret_version_states`, `secret_metadata`, `vault_version` integers) stay as-is —
  backend-neutral, no migration.

### 5.2 `backup.sh` (operator-run, against the LIVE Vault)
Inputs the operator MUST supply (the init Job does **not** persist them — they are operator-held):
`VAULT_ADDR`, a `VAULT_TOKEN` with read on `secret/*`, and `NODE_EXTRA_CA_CERTS`/`VAULT_CACERT` for the
self-signed CA. Steps:
1. `vault kv list -format=json secret/platform`, `secret/gateway`, `secret/iam` to enumerate; for each
   path `vault kv get -format=json secret/<path>` → write JSON to
   `backup/kv/platform/<name>.json`, `backup/kv/gateway/<name>.json`, `backup/kv/iam/<name>.json`.
2. Recursively `vault kv list secret/falcone/workspace-secrets/...` walking tenant→workspace→name
   (depth 3), `vault kv get -format=json` each leaf → `backup/kv/workspace-secrets/<t>/<w>/<name>.json`.
3. Snapshot rendered manifests + the current chart revision:
   `helm get manifest <release> -n <ns> > backup/manifests/release.yaml`,
   `helm get values <release> -n <ns> > backup/manifests/values.yaml`,
   `helm history <release> -n <ns> > backup/manifests/history.txt`.
4. Copy the existing TLS CA (`kubectl -n secret-store get secret vault-server-tls -o yaml >
   backup/manifests/vault-server-tls.yaml`) so a rollback can restore trust.
5. Write a `backup/MANIFEST.txt` listing every captured path + a count, and `sha256sum` of each JSON,
   so the migration can VERIFY completeness. **Never print secret values to logs**; files live only in
   the operator-controlled state dir.

### 5.3 `migrate.sh` (idempotent, verifiable)
Preconditions: OpenBao installed (D4b objects up), initialized + unsealed, KV v2 mount `secret`
enabled (the OpenBao init Job does steps 1–5 for a fresh OpenBao; for migration the operator supplies
the OpenBao root/admin token and the OpenBao CA). Steps:
1. For every file in `backup/kv/**`, read the JSON `data` map and `bao kv put secret/<same-path>
   key=val …` (reconstruct the KV from the backup; KV v2 versioning starts fresh at v1 in OpenBao —
   acceptable, the app reads "current"). Idempotent: re-running overwrites with the same data
   (`bao kv put` is upsert).
   - Alternative single-pass (no intermediate backup needed for the copy itself, but backup is still
     required for rollback): `vault kv get -format=json secret/<path>` piped into `bao kv put` — the
     runbook prefers reading from the BACKUP so the source Vault can already be quiesced.
2. Re-create auth/policies/roles by letting the OpenBao **init Job** run (fresh OpenBao) OR, if
   OpenBao was init'd manually, run the same `bao auth enable kubernetes` / `bao policy write` /
   `bao write auth/kubernetes/role/*` block the init Job uses (the runbook can extract it).
3. **Verify:** for every backed-up path, `bao kv get -format=json secret/<path>` and compare the
   `data` map (and key count) to the backup JSON; assert ESO `ClusterSecretStore/openbao-backend` is
   `Ready` and each of the 6 `ExternalSecret`s reports `SecretSynced`; run
   `scripts/verify-secret-storage.sh` (now `bao kv list secret/platform`) to assert the 4 platform
   paths exist. Print a PASS/FAIL summary with counts; exit non-zero on any mismatch.
4. **Re-point ESO:** with the rename, ESO already targets the new names once the chart is upgraded
   (its `vaultAddress`/`caProvider`/store name changed in 4.3). Trigger a re-sync (delete the synced
   k8s Secrets so ESO re-creates them, or bump `refreshInterval`); confirm the 6 `*-credentials`
   Secrets are repopulated FROM OpenBao.

### 5.4 Encryption master-key special case
`secret/platform/encryption/master-key` feeds `deploy/k8s/encryption-config.yaml` (k8s at-rest aescbc
key). The migration MUST carry this value byte-identically (it is the at-rest key for already-encrypted
etcd data) — a changed master-key would make existing encrypted data unreadable. `backup.sh` captures
it; `migrate.sh` writes it verbatim; the verify step asserts the `master-key` value matches the
backup. **This is the single highest data-loss risk** — call it out in the runbook header.

---

## 6. Rollout to an existing cluster (optional, for running instances)

Scoped to the Falcone namespaces (`secret-store`, `eso-system`, and the 6 app namespaces). TEST
cluster first (`./kubeconfig-test-cluster-b.yaml`; never the default ctx — per memory the default
kubectl ctx is the musematic prod-ish cluster).

**Strategy: parallel cutover** (the rename precludes in-place; also safer — Vault stays readable until
OpenBao is verified).

1. **Dry-run:** `helm template`/`helm diff upgrade` the new chart revision against the live release;
   confirm the diff is exactly the secret-store rename + OpenBao image + ESO repoint, and that no
   non-secret-store object churns. `kubectl diff` the rendered manifest.
2. **Backup:** run `backup.sh` (§5.2) — gate: `backup/MANIFEST.txt` shows the expected path count and
   checksums.
3. **Stand up OpenBao alongside Vault:** `helm upgrade` with `openbao.enabled=true` (Vault objects are
   gone from the new chart, but the OLD Vault StatefulSet/PVCs still exist in-cluster from the prior
   revision until deleted — they coexist because names differ). Wait for the OpenBao pod Ready
   (`/v1/sys/health`), the `openbao-init` Job Complete.
   - Health gate: OpenBao initialized + unsealed; `bao status` sealed=false; the init Job seeded the 7
     platform paths (these will be OVERWRITTEN by the migration with real values).
4. **Migrate data:** run `migrate.sh` (§5.3) reading the backup → `bao kv put` → verify. Gate: the
   verify step passes (every path present, counts match, master-key identical).
5. **Cut ESO over:** the upgraded chart already points `openbao-backend` at OpenBao; force a re-sync;
   gate: `ClusterSecretStore/openbao-backend` Ready + all 6 ExternalSecrets `SecretSynced` + the 6
   `*-credentials` Secrets match their pre-cutover values (compare to the backup — they must be
   identical because the KV data was copied verbatim).
6. **Repoint the control-plane consumer:** create the renamed Secrets
   `in-falcone-openbao-workspace-secrets-{env,tls}` (per the new overlay runbook) with the OpenBao
   addr/token/CA; the control-plane picks up `BAO_*` env; gate: a `POST …/secrets` then
   `GET …/secrets` round-trips against OpenBao, and `fnDeploy` resolves a workspace secret.
7. **Decommission Vault:** only after all gates pass — delete the old Vault StatefulSet/Service/PVCs
   (`vault`, `vault-internal`, `vault-data`, `vault-audit`, `vault-server-tls`) and the old consumer
   Secrets. Keep the backup in the state dir.

**Health gates (each step blocks the next):** OpenBao Ready+unsealed → migrate verify PASS → ESO
SecretSynced + values match backup → consumer round-trip OK → only then delete Vault.

### 6.1 `rollback.sh` (any gate fails)
1. `helm rollback <release> <prior-revision> -n <ns>` — restores the prior chart (Vault objects + ESO
   `vault-backend` + `vault.enabled=true`). Vault PVCs/data were never deleted (decommission is the
   LAST step), so Vault returns intact.
2. Re-create the original consumer Secrets `in-falcone-vault-workspace-secrets-{env,tls}` from
   `backup/manifests/` if they were already swapped.
3. If OpenBao was partially stood up, `helm`-disable `openbao.enabled` (or delete the OpenBao objects)
   — its PVCs hold only copied data, safe to delete.
4. Verify: ESO `vault-backend` Ready, the 6 `*-credentials` Secrets present, the consumer round-trips
   against Vault again. Because the source Vault was never mutated by the migration (read-only copy)
   and never decommissioned before the final gate, rollback is lossless.

---

## 7. Compatibility items to LIVE-VERIFY at fresh-install time (implementer)

These are assumed-true (OpenBao is a Vault fork) but the implementer MUST confirm on the kind path
before declaring done:
1. **Pullable image tag** — `openbao/openbao:2.3.1` (or the current 2.x stable) actually pulls on the
   chosen registry; pin the verified tag in subchart `values.yaml` + `Chart.yaml appVersion` + dev
   compose.
2. **`bao` is the entrypoint/CLI** in the image — every `bao …` in the init/migration Jobs, the dev
   `command: ["server","-dev"]`, the `bao status` healthcheck, and `up.sh`'s `bao audit enable` work
   (the image does NOT provide a `vault` binary; confirm `bao` resolves on PATH).
3. **ESO `provider.vault` against OpenBao** — `ClusterSecretStore/openbao-backend` reaches `Ready` and
   at least one `ExternalSecret` reports `SecretSynced` syncing from OpenBao (k8s auth via `eso-role`,
   `version:v2`, caProvider trust to `openbao-server-tls`). If ESO 0.9.0 rejects it, bump ESO to a
   version documenting OpenBao (scoped follow-up).
4. **k8s-auth ACL identity templating** — the tenant policy's
   `identity.entity.aliases.auth_kubernetes_cluster_1.metadata.tenantId` resolves under OpenBao; the
   `auth_kubernetes_cluster_1` alias name is mount-accessor-derived and could differ — confirm via
   `bao read sys/auth` / `bao token capabilities` against a templated path.
5. **File-audit JSON byte-compat** — enable the OpenBao file audit device, capture a line, and confirm
   `services/secret-audit-handler/src/vault-log-reader.mjs::parseVaultEntry` parses it (the unit test
   `vault-log-reader.test.mjs` is the anchor; if OpenBao changed a field, the parser is the only code
   needing a tweak).
6. **KV v2 REST surface** — `vault-secrets.mjs` set/get/list/delete round-trips against OpenBao (the
   contract test uses a fake server; a live smoke confirms the real backend).
7. **HCL config accepted** — OpenBao starts with `openbao.hcl` (`storage "file"`, TLS listener,
   `api_addr`/`cluster_addr`, lease TTLs, `ui=true`).
8. **Default render unchanged** — `helm template` with no overlay renders NO secret-store workload and
   no `hashicorp/vault` AND no `openbao/openbao` image (default disabled); the opt-in overlay renders
   OpenBao and zero `hashicorp/vault`.

---

## 8. Risks & mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| **Encryption master-key not carried verbatim** → existing at-rest-encrypted etcd data unreadable | HIGH (data loss) | §5.4: backup captures it, migrate writes verbatim, verify asserts byte-equality; runbook header flags it; never rotate it during migration |
| **TLS SAN / Service-name mismatch after rename** → ESO/control-plane TLS to OpenBao fails | MEDIUM | §4.2: SANs derived from the renamed `openbao`/`openbao-internal` Service; the render test asserts the bootstrap Job SANs; live ESO `Ready` gate catches it |
| **ESO `provider.vault` rejects OpenBao at v0.9.0** | MEDIUM | LIVE-VERIFY #3; fallback = scoped ESO version bump; ESO documents OpenBao support |
| **Audit JSON schema drift** → audit pipeline mis-parses | LOW-MED | LIVE-VERIFY #5; the unit test is the regression anchor; parser is the only code to adjust if needed |
| **Stale packaged `.tgz`** → render is non-deterministic / still shows Vault | MEDIUM | §4.8: mandatory `helm dependency build`; verify `git status` shows old `.tgz` deleted, new added; render tests run against the packaged chart |
| **Existing-deployment downtime during cutover** | LOW | Parallel cutover (Vault stays up until OpenBao verified); ESO-synced Secrets are unchanged values (apps don't restart unless the Secret content changes — it doesn't, data is copied verbatim) |
| **Secret exposure during migration** | MEDIUM | backup/migrate write only to the operator-controlled state dir, never to logs; operator-held unseal keys/root token supplied at runtime, not persisted; `x-vault-token` over TLS only |
| **Tenant isolation regression** | HIGH | Path derivation (`{t}/{w}/{name}`) and the tenant ACL policy are UNCHANGED; the cross-tenant blackbox tests + the workspace-secrets contract test stay green; isolation is path+credential-derived, backend-independent |
| **Default render regression** (the proven Vault-free baseline breaks) | MEDIUM | `deploy-completeness-vault-prometheus.test.mjs` gates the default-off render; toggle stays `enabled:false` |
| **`bao` binary absence / dev image entrypoint differs** | LOW | LIVE-VERIFY #2 before relying on `command:["server","-dev"]`; if the entrypoint is not `bao`, prefix the command |
| **Reduced-rename leaves a `vault`-named object a reviewer flags** | LOW | D4b full rename removes them; the retained generic names (`secret-store`, `eso-role`, `x-vault-token`, contract tokens) are justified in D4c as non-product |

---

## 9. Mapping to the OpenSpec change

The OpenSpec change `replace-vault-with-openbao` captures this design as spec deltas:
- **MODIFIED capability `secrets`** — the existing requirement "Workspace secrets are stored in and
  consumed from Vault" is reworded to "…in and consumed from OpenBao" with scenarios proving: KV v2
  set/get/list/delete still work + tenant/workspace isolation; the backend stays optional
  (`*_ADDR`/`*_TOKEN` unset → 501, default render has no secret-store workload).
- **ADDED requirements to capability `deployment`** — fresh install provisions OpenBao (no
  `hashicorp/vault` image, default render secret-store-free); ESO syncs the 6 platform credentials
  from OpenBao; the audit pipeline parses OpenBao's audit log; and an existing-deployment migration
  preserves all secrets (KV copy + verify + master-key byte-equality).
- `design.md` + `tasks.md` in the change carry the implementation detail and ordered work.

The OpenSpec scenarios are written against the NON-NEGOTIABLES (OpenBao provisioned, no Vault image,
KV API + isolation intact, ESO + audit intact, migration lossless), not against specific renamed
object names — so either rename depth (D4b full or the D4 reduced fallback) satisfies them.
