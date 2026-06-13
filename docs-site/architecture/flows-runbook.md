# Flows Runbook (Temporal Operations)

Operational procedures for the **flows** capability — deploying and enabling the internal Temporal
engine and the DSL interpreter worker, upgrading the Temporal schema, accessing the operator-only
Web UI, managing the namespace and search attributes, scaling the worker, and recovering from the
common failure modes. For the design see [Flows Architecture](/architecture/flows); for tenant
usage see [Flows](/guide/flows).

Temporal is **internal-only**: no Ingress / Route / APISIX route is rendered for it anywhere, and
its Web UI is reachable **only** by an operator `kubectl port-forward`.

## Deploy & enable

Flows are **off by default**. Enable two components in the umbrella chart
(`charts/in-falcone`): the Temporal engine and the interpreter worker.

```yaml
temporal:
  enabled: true            # default: false
workflowWorker:
  enabled: true            # default: false
controlPlane:
  # the flow API only registers when TEMPORAL_ADDRESS is set on the control plane
  env:
    - { name: TEMPORAL_ADDRESS,    value: <release>-temporal-frontend:7233 }
    - { name: TEMPORAL_NAMESPACE,  value: falcone-flows }
    - { name: TEMPORAL_TASK_QUEUE, value: flows-main }
  podLabels:
    app.kubernetes.io/component: flows-api      # required: admitted by the Temporal NetworkPolicy
workflowWorker:
  podLabels:
    app.kubernetes.io/component: flows-worker    # required: admitted by the Temporal NetworkPolicy
```

Key `temporal.*` values (`charts/in-falcone/values.yaml`):

| Value | Default | Notes |
| --- | --- | --- |
| `temporal.image` | `temporalio/server:1.31.1` | server (PostgreSQL SQL visibility build) |
| `temporal.schemaTool.image` / `adminTools.image` | `temporalio/admin-tools:1.31.1` | schema + bootstrap Jobs |
| `temporal.ui.{enabled,image}` | `true`, `temporalio/ui:2.51.0` | Web UI — ClusterIP-only, port-forward access |
| `temporal.persistence.{host,port,user,password,database,visibilityDatabase}` | platform PostgreSQL, `temporal` / `temporal_visibility` | **dedicated databases**, kept separate from `in_falcone` to avoid migration coupling; production sets `existingSecret` + `passwordSecretKey` |
| `temporal.bootstrap.namespace` | `falcone-flows` | the single shared namespace (ADR-11) |
| `temporal.bootstrap.retentionDays` | `7` | run-history retention |
| `temporal.bootstrap.searchAttributes` | `tenantId`, `workspaceId`, `flowId`, `flowVersion`, `triggerType` (all `Keyword`) | registered by the bootstrap Job |
| `temporal.networkPolicy.allowedComponents` | `flows-api`, `flows-worker` | only these labels may reach the frontend on `7233` |
| `temporal.{frontend,history,matching,worker}.{replicas,resources}` | 1 replica each, modest requests | server role sizing |
| `workflowWorker.replicas` | `2` | interpreter worker pool |

`workflowWorker` env (defaults, override the address per environment):
`TEMPORAL_ADDRESS` (frontend gRPC, e.g. `<release>-temporal-frontend:7233`),
`TEMPORAL_NAMESPACE=falcone-flows`, `TEMPORAL_TASK_QUEUE=flows-main`, `WORKER_HEALTH_PORT=8080`
(serves `/livez` + `/readyz`). The worker is stateless — all durable state lives in Temporal
history — so it has no persistence and no inbound business traffic.

### OpenShift overlay

`deploy/openshift/values-openshift.yaml` carries a Temporal stanza (commented `enabled: true`).
It nulls `podSecurityContext.{runAsUser,runAsGroup,fsGroup}` so restricted-v2 injects the
namespace-range UID/GID; it asserts `runAsNonRoot` + `seccompProfile`. The chart default pins
`runAsUser/runAsGroup: 1000` (for plain-Kubernetes / kind non-root verification, since the
Temporal image declares a non-numeric `temporal` user); the overlay removes those pins. The
`temporalio/server` and `admin-tools` images must be mirrored into Harbor (rewritten via
`global.imageRegistry`).

## Temporal schema setup & upgrades

Schema is applied by a `temporal-sql-tool` **Job** (`templates/temporal/schema-job.yaml`), wired
as a Helm `pre-install,pre-upgrade` hook so persistence + visibility schemas are ready **before**
the server pods start. It creates both databases and runs `setup-schema` then `update-schema`
against the versioned schema directories (PostgreSQL SQL visibility — no Elasticsearch). The
exact commands the Job runs (and that an operator runs to verify/upgrade by hand):

```sh
SQL="temporal-sql-tool --ep <pg-host> --port 5432 --user temporal --password <pw> --plugin postgres12"

# primary persistence database + schema
$SQL --database temporal create-database || true
$SQL --database temporal setup-schema -v 0.0
$SQL --database temporal update-schema -d /etc/temporal/schema/postgresql/v12/temporal/versioned

# SQL visibility database + schema
$SQL --database temporal_visibility create-database || true
$SQL --database temporal_visibility setup-schema -v 0.0
$SQL --database temporal_visibility update-schema -d /etc/temporal/schema/postgresql/v12/visibility/versioned
```

`update-schema` is **idempotent** — re-running it when the schema is already current is the safe
upgrade check (it reports "found zero updates from current version"). Run it as a one-off
`admin-tools` pod before a server upgrade to confirm the live schema version:

```sh
kubectl run schema-check -n <ns> --rm -i --restart=Never \
  --image=docker.io/temporalio/admin-tools:1.31.1 --command -- /bin/sh -ec '
    SQL="temporal-sql-tool --ep <release>-temporal --port 5432 --user temporal --password <pw> --plugin postgres12"
    $SQL --database temporal update-schema -d /etc/temporal/schema/postgresql/v12/temporal/versioned
    $SQL --database temporal_visibility update-schema -d /etc/temporal/schema/postgresql/v12/visibility/versioned'
```

> [!NOTE]
> The admin-tools `update-schema` in this image build has **no `--dryrun` flag**; the idempotent
> re-run above *is* the dry-run-equivalent check (it makes no change when current).

## Operator-only Web UI access

The Temporal Web UI Service is **ClusterIP-only** — no external exposure. Reach it via
port-forward:

```sh
kubectl port-forward -n <ns> svc/<release>-temporal-web 8233:8080
# then open http://127.0.0.1:8233/  (namespace: falcone-flows)
```

Never expose this UI to tenants — flow authoring/inspection for tenants goes through the Falcone
console/API (the `structural_admin` / `data_access` split). Inbound to the Temporal frontend
(`7233`) is admitted by NetworkPolicy **only** from pods labeled `flows-api` / `flows-worker`.

## Namespace & search-attribute management

The single shared namespace (`falcone-flows`) and the five custom `Keyword` search attributes are
registered by the **bootstrap Job** (`templates/temporal/bootstrap-job.yaml`, a
`post-install,post-upgrade` hook). To inspect or re-apply them from an `admin-tools` pod
(it must carry the `flows-api`/`flows-worker` label to pass the NetworkPolicy):

```sh
export TEMPORAL_ADDRESS=<release>-temporal-frontend:7233
temporal operator namespace describe falcone-flows
temporal operator search-attribute list --namespace falcone-flows
# register a missing attribute (idempotent):
temporal operator search-attribute create --namespace falcone-flows --name tenantId --type Keyword
```

> [!IMPORTANT]
> The five search attributes (`tenantId`, `workspaceId`, `flowId`, `flowVersion`, `triggerType`)
> are **load-bearing for tenant isolation** — the flow API's visibility queries always filter on
> `tenantId`/`workspaceId`. Do not remove them.

## Worker scaling

The interpreter worker is stateless; scale it with replicas (`workflowWorker.replicas`) or
`kubectl scale`:

```sh
kubectl scale deploy/<release>-workflow-worker -n <ns> --replicas=4
```

Workers long-poll the `flows-main` task queue, so adding replicas increases task throughput with
no coordination. Drain is graceful: on `SIGTERM` a worker stops accepting new tasks, finishes the
current poll, and exits 0 within `terminationGracePeriodSeconds`.

## Common failure modes

### Stuck schedules

A cron trigger that never fires usually means the Temporal **Schedule** was not created or was
left from a deleted flow. Schedules are id'd `{tenantId}:{workspaceId}:{flowId}`. Inspect with
`temporal schedule list --namespace falcone-flows` / `temporal schedule describe --schedule-id …`.
Flow delete deregisters all trigger artifacts *before* deleting the definition; if a delete was
interrupted, re-run the delete (idempotent) or remove the orphan schedule directly. Flows use
Temporal Schedules natively — the standalone `scheduling-engine` job table is never involved.

### Poisoned executions

A run wedged on a deterministically-failing activity: the activity classifies auth/schema/SSRF/
payload errors as **non-retryable**, so the run fails fast rather than looping. A run stuck
**retrying** a transient error backs off per its `retryPolicy`. Cancel via the API
(`…/executions/{id}/cancellations`) or `temporal workflow terminate --workflow-id <id>`; retry a
failed run via `…/retries`. A replay-determinism bug (a worker that diverges from recorded
history) surfaces as a non-determinism error — validate the worker image against recorded
histories (the `WorkflowReplayer` test) before rolling it out.

### Quota exhaustion

Starts return `429 { code: QUOTA_EXCEEDED, dimension }`. The five dimensions
(`max_flows`, `max_flow_versions`, `max_concurrent_executions`, `flow_starts_per_minute`,
`flow_signal_rate_per_minute`) are seeded by
`services/provisioning-orchestrator/src/migrations/121-flow-quota-dimensions.sql`; raise a tenant's
limit through the plan/quota administration. The gate **fails closed** — if the quota evaluator is
unreachable, starts are denied rather than allowed unbounded.

### glibc / Alpine native-binary trap

The worker image is `node:22-slim` (Debian, glibc) — **deliberately not Alpine**. The Temporal
TypeScript SDK ships a **native Rust core** (`@temporalio/core-bridge`) as a glibc binary; on
Alpine/musl the worker crash-loops at startup with a missing-shared-object / symbol error. This
was hit in the real kind deployment and is why `services/workflow-worker/Dockerfile` pins
`node:22-slim` while the rest of the platform uses `node:22-alpine`. If you change the base image,
keep it glibc and rebuild (don't copy `node_modules` across glibc↔musl bases). The package is
also **TypeScript→CommonJS** (not ESM) by a hard SDK constraint — the Temporal workflow bundler
requires CJS output; do not flip it to `"type":"module"`.

### `numHistoryShards` immutability

> [!WARNING]
> `numHistoryShards` is **baked into the persistence schema at setup and can never change** for an
> existing Temporal database — changing it requires dropping and recreating the `temporal` /
> `temporal_visibility` databases. In this chart it is exposed as the Helm value
> `temporal.persistence.numHistoryShards` (default `512`, rendered into
> `templates/temporal/config.yaml`).
> On small / CPU-constrained clusters (kind), 512 shards can make the history pod time out at
> startup — the E2E values (`tests/e2e/values-flows-e2e.yaml`) use `4`. Pick the production value
> once, up front: set it at first install and never change it for that database.

## Backup & restore of the Temporal database

Temporal's durable state lives entirely in PostgreSQL — the `temporal` (persistence) and
`temporal_visibility` databases, kept **separate** from the platform `in_falcone` database. Back
them up **alongside** the platform PostgreSQL with the same infrastructure tooling (see
[Backup & Restore](/operations/backup-restore)):

- Snapshot/dump **all three** databases at a consistent point — `in_falcone` (platform metadata,
  including `flow_definitions` / `flow_versions` / trigger artifacts), `temporal`, and
  `temporal_visibility`. A flow's metadata and its run history must be restored together or the
  console will show definitions with no runs (or vice-versa).
- After a restore, **do not change `numHistoryShards`** — it must match what the restored
  `temporal` schema was created with.
- The server pods are stateless: restore the databases, then the running server picks them up (or
  roll the server pods).

## E2E suite

The end-to-end Playwright suite for flows lives under `tests/e2e/specs/flows/` with the minimal
stack values `tests/e2e/values-flows-e2e.yaml` (Temporal + control plane + worker + console on the
kind cluster; gateway is bypassed by the specs proxying `/v1/*` directly to the control plane).
Covered flows: design+publish, run+observe, version pinning, failure+retry, human approval,
triggers, worker-kill durability, and cross-tenant isolation. Run per the e2e entrypoints
(`bash tests/e2e/run.sh`, `bash tests/e2e/run-issue.sh <change-id>`), which always tear down the
ephemeral namespace.

## Validated procedures

The procedures below were performed once on the kind cluster (`kubeconfig-test-cluster-b.yaml`,
shared cluster, ephemeral namespace, torn down after) against a minimal Temporal-only stack
(public images, reduced to 4 history shards). Verbatim commands and observed results:

**Temporal schema setup** — the `setup-schema` / `update-schema` Job ran end to end against
PostgreSQL: `Schema updated … 1.13 → 1.14 … UpdateSchemaTask done` (primary), visibility likewise.

**Namespace + search-attribute bootstrap** — the bootstrap Job logged:
`search attribute tenantId registered` … `flowVersion registered` … `triggerType registered` …
`temporal bootstrap complete`.

**(a) Web UI port-forward → HTTP 200**

```sh
kubectl port-forward -n <ns> svc/<release>-temporal-web 8233:8080 &
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8233/                       # → 200
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8233/namespaces/falcone-flows  # → 200
```

**(b) Schema-tool check (idempotent `update-schema`)**

```sh
kubectl run schema-check -n <ns> --rm -i --restart=Never \
  --image=docker.io/temporalio/admin-tools:1.31.1 --command -- /bin/sh -ec '
    SQL="temporal-sql-tool --ep <release>-postgresql --port 5432 --user temporal --password temporal --plugin postgres12"
    $SQL --database temporal            update-schema -d /etc/temporal/schema/postgresql/v12/temporal/versioned
    $SQL --database temporal_visibility update-schema -d /etc/temporal/schema/postgresql/v12/visibility/versioned'
# → "found zero updates from current version 1.19" (primary), "… 1.14" (visibility) — no change
```

**(c) Worker scale 1 → 2 → 1**

```sh
kubectl scale deploy/<release>-temporal-worker -n <ns> --replicas=2   # ready: 2
kubectl scale deploy/<release>-temporal-worker -n <ns> --replicas=1   # back to 1
```

Teardown was the namespace delete (`kubectl delete namespace <ns>`), leaving no pods.
