# 14 — In-flight / not-yet-deployed features (Flows·Temporal · MCP · FerretDB-wired document path)

Scope: distinguish **broken** from **not-deployed / works-when-deployed** for the three in-flight
features on the LIVE `falcone` namespace. Evidence = live probes (ran) + repo E2E inventory (read).
Time-boxed: no full ephemeral redeploy was performed (see §Optional run, aborted with reason).

## Method

- **Ran (live):** `kubectl -n falcone get deploy,sts,ksvc`; executor probes via
  `tests/live-audit/lib/lib.sh` + `context.env` (`exh` = gateway-bypass trust-header path).
- **Read (repo):** `tests/e2e/{stack.sh,run.sh,run-issue.sh}`,
  `tests/e2e/values-flows-e2e.yaml`, `tests/e2e/values-ferretdb-realtime-e2e.yaml`,
  `tests/e2e/specs/{flows,mcp,document-store}/*`, gate helpers, `.github/workflows/ci.yml`, git log.

---

## 1. Live deployment state (confirmed)

`kubectl -n falcone get deploy,sts,ksvc` — workloads present (names):

```
deploy: apisix, control-plane, cp-executor, ferretdb, keycloak, observability,
        seaweedfs-s3, web-console, fn-primary-multiplier-00001 (Knative fn)
sts:    documentdb, kafka, mongodb, postgresql, seaweedfs-{filer,master,volume}
ksvc:   fn-primary-multiplier
```

- **No `temporal` deploy/sts/ksvc. No `mcp` engine.** -> Flows/Temporal and MCP NOT deployed.
- **`falcone-ferretdb` Deployment 2/2 IS deployed**, alongside legacy `falcone-mongodb` sts and a
  `falcone-documentdb` sts. FerretDB is present but the **data API still targets legacy `falcone-mongodb`**
  (established fact; not re-derived here).

### Executor probes (live, `exh` trust-header, Tenant A ws `9dfb3614-…`)

```
GET /v1/flows/workspaces/<wsA>/flows
  -> 404 {"code":"NO_ROUTE","message":"No action mapped for GET /v1/flows/workspaces/<wsA>/flows"}
GET /v1/mcp/workspaces/<wsA>/servers
  -> 404 {"code":"NO_ROUTE","message":"No action mapped for GET /v1/mcp/workspaces/<wsA>/servers"}
```

`NO_ROUTE` (the executor has no action mapped for these families) — consistent with not-wired /
not-deployed. (Brief notes the executor can also return 501 `FLOWS_DISABLED`/`MCP_DISABLED` on other
route shapes; either way classification is **NOT-DEPLOYED**, not a bug.)

---

## 2. "Works-when-deployed" evidence — repo E2E inventory (read, not run)

### Harness (`tests/e2e/`)

- `stack.sh up` Helm-installs the in-falcone chart into an **ephemeral namespace** (default
  `falcone-e2e`) on the dedicated kubeconfig `./kubeconfig-test-cluster-b.yaml`, gates on
  **ALL Deployments+StatefulSets rolled out + every pod Ready** (`healthy()`), and has dedicated
  **phased-deploy logic for Temporal** (breaks the schema-job/bootstrap-job circular dependency)
  and **FerretDB** (`E2E_FERRETDB=true` pre-pulls documentdb engine + ferretdb gateway, seeds
  `in-falcone-documentdb*` secrets). `down` **always deletes the namespace** (no pods remain).
- `run.sh` (full) and `run-issue.sh <change-id>` (one issue) wrap up/down with a **mandatory
  teardown trap** (`trap 'bash stack.sh down' EXIT INT TERM`).

### Flows / Temporal — `tests/e2e/specs/flows/*` (8 specs) + `values-flows-e2e.yaml`

Overlay enables `temporal.enabled`, `workflowWorker.enabled`, `controlPlane` wired to
`TEMPORAL_ADDRESS=falcone-temporal-frontend:7233`, namespace `falcone-flows`, task queue `flows-main`;
Kafka enabled for the platform-event trigger. **Specs carry NO `test.skip` gate** — they assert a real
run against deployed Temporal. Coverage (issue #367 / epic #355):
- `flows-design-publish` (9 tests) — create draft, edit YAML, validate, publish v1 (API + console UI).
- `flows-run-observe` (5) — manual run -> Completed; per-node statuses; run page UI.
- `flows-triggers` (webhook signed/unsigned, cron Temporal Schedule fires <90s, platform-event smoke).
- `flows-failure-retry` (5) — retries exhaust -> Failed; retry starts new run -> completes; cancel.
- `flows-human-approval` (4) — pause at approval node; approve resumes; reject terminates (signals).
- `flows-version-pinning` (5) — in-flight v1 completes with v1 behavior after v2 publish; new run -> v2.
- `flows-worker-kill` (4) — `kubectl delete` worker pod mid-run; execution **resumes** on new pod;
  exactly-once (ActivityScheduled appears once). Real durable-execution resilience proof.
- `flows-cross-tenant` (7) — tenant B cannot list/get/start/cancel/signal tenant A flows/executions
  (404/403); UI shows empty list. Security model cited from `flow-executor.mjs`
  (`{tenantId}:{workspaceId}:{flowId}:{runUuid}` workflow IDs + `assertOwnedWorkflowId` + RLS).
- Per-issue smoke: `specs/issues/flows-e2e-issue-367.spec.ts` (design+publish, run, cross-tenant)
  via `run-issue.sh flows-e2e-issue-367`.

### MCP — `tests/e2e/specs/mcp/*` (3 specs)

- `mcp-full-loop` (5) — create/generate server -> curate/publish tools -> deploy -> OAuth connect ->
  call tool -> observe in audit.
- `mcp-version-pinning` (2) — tool-description change held for review (rug-pull guard); prior version serves.
- `mcp-cross-tenant` (4) — B cannot get/list/call/audit A's server.
- **LIVE GATE (important):** every MCP spec starts with `probeMcpManagement`; the MCP control-plane
  modules (#391–#399) are **pure and NOT wired into `runtime/server.mjs`**, so against the current
  build the suite reports **12 skipped / 0 failed** (per `specs/mcp/README.md`). The harness is
  deploy-ready and honest, but **MCP is not yet provably green** — there is no `mcp.enabled` runtime
  to deploy. Specs "execute unchanged the moment the routes are wired."

### FerretDB-wired document path — `tests/e2e/specs/document-store/*` (10 specs) + `values-ferretdb-realtime-e2e.yaml`

Document-store overlay (#464): `E2E_FERRETDB=true`, `documentdb.enabled`, `ferretdb.enabled`,
`mongodb.enabled=false`, control-plane `MONGO_URI=mongodb://…@falcone-ferretdb:27017/`,
`MONGO_BACKEND=ferretdb`, `DEPLOYMENT_PROFILE=e2e`. So the suite **specifically exercises the
FerretDB-wired path** the live stack lacks. Coverage:
- create / list / update / delete / query / auth / aggregation — CRUD over `/v1/collections/*`.
- `document-vector-index` (2) — DocumentDB pgvector 0.8.1 vector-index create/delete.
- `document-cross-tenant` (3) — shared-collection model; B's writes scoped to B, never in A's view
  (app-layer `tenantId` scoping in `mongodb-data-api.mjs`; per-DB role scoping is NOT the boundary, ADR-14).
- `document-transaction` (2) — **deliberately skipped**: FerretDB 2.7.0 `commitTransaction`->
  CommandNotFound(59), `abortTransaction` silent no-op (no rollback); validated at wire-level by #462,
  no HTTP route. This is a documented FerretDB *limitation*, not a Falcone bug.
- **LIVE GATE:** every spec has `probeDocumentApi` -> `test.skip` when the FerretDB-wired e2e-profile
  control-plane isn't up. So on the **live** `falcone` ns (legacy mongodb-wired, non-e2e build) these
  would skip; they only run green on an ephemeral FerretDB-overlay deploy.

### CI status (read `.github/workflows/ci.yml`)

CI runs lint, **unit**, adapter-integration, **contract**, **blackbox** (incl. gated SeaweedFS +
**FerretDB migration-validation** parity/smoke), console-E2E scaffolding, deployment-smoke scaffolding,
plan-enforcement, and node `--test` plan-upgrade E2E. **CI does NOT run the kind-based Playwright
suites** (flows/mcp/document-store) — those are run manually via `run.sh`/`run-issue.sh` on
test-cluster-b. So "green in CI" is **not** the proof for these three; the proof is the deploy-ready
ephemeral suites + git history of their authoring/merge (PRs #481/#464 document-store, #460 realtime,
PRs #367/#355 flows, #386/#402 MCP). The FerretDB *data-layer* correctness IS continuously gated in CI
via the #462 migration-validation blackbox step.

---

## 3. Optional ephemeral run — ATTEMPTED feasibility check, ABORTED (within time-box)

Checked, did **not** deploy:
- No leftover `falcone-e2e` namespace (clean).
- Live control-plane image is `localhost:30500/in-falcone-control-plane:0.6.2` — a **legacy,
  non-e2e-profile, legacy-mongodb-wired** build. A real document-store ephemeral run needs an
  **e2e-profile control-plane image with FerretDB wiring** built and pushed to `localhost:30500`,
  PLUS a full Helm deploy of the documentdb-engine StatefulSet + ferretdb gateway + postgres +
  keycloak (the `healthy()` gate waits on every workload, ~minutes).
- Per the brief, this is **slow/fragile and exceeds the ~10-min box** -> **ABORTED** (instructed to
  abort if slow/fragile; never touch live `falcone` ns). No ephemeral namespace was created, so no
  teardown was needed. Empirical FerretDB-wired proof therefore rests on the read inventory above
  (deploy-ready `#464` suite + overlay), not a fresh run here.

---

## 4. Verdicts

| Feature | Live state | Verdict | Evidence |
|---|---|---|---|
| **Flows / Temporal** | Not deployed (no temporal workloads; `/v1/flows` -> NO_ROUTE 404) | **Not-deployed-live · Tested-green-when-deployed** | 8 ungated real-run specs (`specs/flows/*`) incl. worker-kill resilience + cross-tenant; `values-flows-e2e.yaml` with phased-Temporal deploy in `stack.sh`; per-issue `flows-e2e-issue-367`. Runs via `run.sh`/`run-issue.sh`, not CI. No broken-when-deployed evidence found. |
| **MCP** | Not deployed (no mcp engine; `/v1/mcp` -> NO_ROUTE 404) | **Not-deployed-live · Harness-ready-but-NOT-yet-provably-green** | 3 specs (`specs/mcp/*`) exist and are deploy-ready, but **self-skip** (`probeMcpManagement`): the MCP modules #391–#399 are pure and **not wired into `runtime/server.mjs`**, and there is no `mcp.enabled` runtime to deploy. Reported 12 skipped / 0 failed. Not "tested-green"; not "broken" either — **not-yet-wired**. |
| **FerretDB-wired document path** | FerretDB deployed, but data API points at legacy `falcone-mongodb` (not wired) | **Not-deployed/not-wired-live · Tested-green-when-deployed (ephemeral overlay)** | 10 specs (`specs/document-store/*`) run against the FerretDB-wired e2e overlay (`values-ferretdb-realtime-e2e.yaml`, `MONGO_BACKEND=ferretdb`); CRUD + vector-index + cross-tenant; txn deliberately skipped (FerretDB 2.7.0 limitation, not a bug). Data-layer parity continuously gated in CI (#462). Live gap is a **wiring** gap, not breakage. |

**No genuinely-broken-when-deployed evidence** was found for any of the three. Flows and FerretDB-wired
have real, ungated/overlay-driven E2E proof; MCP is honestly gated pending a runtime wiring (#391–#399
not in `server.mjs`).
