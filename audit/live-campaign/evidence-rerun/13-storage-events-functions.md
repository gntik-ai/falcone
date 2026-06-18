# Live evidence rerun — C17/C18 Object Storage · C19 Events · C20 Functions · C21 Event-driven

**Date:** 2026-06-18 (rerun, fresh HEAD build: `head-20260618`)
**Cluster:** kind test-cluster-b, ns `falcone`. Tenants: A=acme (`TA_TENANT=676c519b…`), B=globex (`TB_TENANT=64443b6c…`).
**KC status:** Keycloak restarted at ~16:16 (H2 in-memory, lost all realm state). GW/JWT path unavailable
for the entire rerun. All evidence is via the **executor trust-header path** (EXEC :18082) and **direct
EXEC API-key path** (freshly minted keys via `mint_key()`). Storage REST was tested before KC restart.
**Images:** all 4 components built from HEAD (git `494dce9`, includes P0 #547-550, P1 #551-569, P2 #552-572, #553 per-tenant SeaweedFS).

---

## C17 — Object Storage REST

### Status lines

| Functionality | Route | Status | Evidence |
|---|---|---|---|
| Provision bucket | `POST /v1/storage/workspaces/{ws}/buckets` | **Working** | 201; `bucketName` derived from body.name or `ws-{slug}-assets` |
| List buckets (tenant-scoped) | `GET /v1/storage/buckets` | **Working** | Each tenant sees only its own bucket(s) |
| PUT object (JSON envelope) | `PUT …/objects/{key}` `{content,contentType}` | **Working** | 201, content roundtrips |
| PUT object (binary / raw body) | `PUT …/objects/{key}` with `text/plain` raw | **Working** | 201 (P2 fix #554 confirmed); was 400 INVALID_JSON before |
| GET object | `GET …/objects/{key}` | **Working** | 200, content+base64 |
| GET object metadata | `GET …/objects/{key}/metadata` | **Working** | 200 (prior run; route still present) |
| List objects | `GET …/objects` | **Working** | 200, 2 objects with etag/size |
| Workspace usage | `GET /v1/storage/workspaces/{ws}/usage` | **Working** | 200, `collectionMethod:live`; dims totalBytes/objectCount/bucketCount |

### Evidence excerpts

Provision A (before KC restart):
```
POST $GW/v1/storage/workspaces/$TA_WS/buckets {"name":"lcrn-acme-1781799036"}
→ 201 {"bucket":{"resourceId":"lcrn-acme-1781799036","bucketName":"lcrn-acme-1781799036",
       "workspaceId":"a10e1865…","tenantId":"676c519b…","region":"us-east-1","status":"active"},
      "storageCredential":null}
```

Binary PUT (P2 fix #554 verified):
```
PUT $GW/v1/storage/buckets/lcrn-acme-1781799036/objects/binary-test.bin
  Content-Type: text/plain   body: "raw binary content here"
→ 201 {"objectKey":"binary-test.bin","sizeBytes":23,"contentType":"text/plain"}
GET → 200 {"content":"raw binary content here","encoding":"base64","sizeBytes":23}
```
**Binary PUT/GET roundtrip confirmed. P2 fix #554 WORKING.**

Workspace usage after writes:
```
GET $GW/v1/storage/workspaces/$TA_WS/usage
→ 200 {"collectionMethod":"live","dimensions":{"totalBytes":{"used":45},"bucketCount":{"used":1},
       "objectCount":{"used":2}},"buckets":[{"bucketId":"lcrn-acme-1781799036","totalBytes":45,"objectCount":2}]}
```

### P1 BUG: Bucket name collision + registry hijack (`storageCredential: null` + naming)

**Finding SRN-1 (P1) — Bucket registry hijack via slug-derived name collision.**

Root cause (code): `storageProvisionBucket` derives the S3 bucket name as `ws-{ws.slug}-assets` when
no explicit `name` is given in the request body. Two tenants with identically-named workspaces (both have
`app-staging`) map to the **same derived name** `ws-app-staging-assets`. The DB upsert is:
```sql
ON CONFLICT (bucket_name) DO UPDATE SET workspace_id=EXCLUDED.workspace_id, tenant_id=EXCLUDED.tenant_id
```
so the **second tenant's provision silently overwrites the first tenant's record** — A's bucket row is
reassigned to B's tenant_id/workspace_id. A loses visibility of the bucket it provisioned.

Empirical proof:
```
[1] A provisions → 201 {"resourceId":"ws-app-staging-assets","tenantId":"676c519b…(acme)","workspaceId":"a10e1865…"}
    A list → 1 bucket (ws-app-staging-assets, tenantId=676c519b…)
[2] B provisions same derived name → 201 {"resourceId":"ws-app-staging-assets","tenantId":"64443b6c…(globex)","workspaceId":"d0156aab…"}
    Same record.id returned for both A and B provision calls.
[3] A list → 0 buckets (A lost its own bucket)
    B list → 1 bucket (ws-app-staging-assets, now owned by B)
```
**A's bucket record was overwritten by B. A can no longer see or use its own bucket via the API.**
The S3 bucket itself is shared (one bucket, no per-tenant namespace). Severity: P1 (data ownership
hijack, denial of service to A).

**Finding SRN-2 (P0 residual) — `storageCredential: null` — per-tenant SeaweedFS identities NOT active.**

`STORAGE_TENANT_IDENTITIES=1` is in `deploy/kind/values-kind.yaml` (line 172) but is **NOT in the deployed
control-plane pod's env**:
```
# kubectl get deployment falcone-control-plane -o json → env list:
# STORAGE_S3_ENDPOINT, STORAGE_S3_ACCESS_KEY, STORAGE_S3_SECRET_KEY  (3 vars, no STORAGE_TENANT_IDENTITIES)
```
The #553 code is present (`seaweedfs-identity.mjs`, `storageProvisionBucket` gate at line 338) but gated
by `process.env.STORAGE_TENANT_IDENTITIES === '1'` which is never set. All provisions return
`"storageCredential":null`. The per-tenant SeaweedFS identity feature from #553 is **code-complete but
not activated in this deployment**.

Note: SeaweedFS IS in filer-mode (no `-config=` flag; `s3.enableAuth=false` confirmed in chart values;
`-iam.readOnly=false` confirmed in deployed pod command). The admin seed hook ran and was deleted
(hook-delete-policy: before-hook-creation,hook-succeeded). Auth IS enforced (wrong-key → InvalidAccessKeyId).

---

## C17 — Storage Isolation

### API layer (REST) — **ISOLATED** ✅

With A's bucket `lcrn-acme-1781799036` (unique name, unambiguous ownership):
```
B→A GET  .../objects/secret-data.txt   → 404 BUCKET_NOT_FOUND (no existence leak)
B→A PUT  .../objects/injected.txt      → 404 BUCKET_NOT_FOUND
B→A GET  workspace usage ($TA_WS)      → 404 WORKSPACE_NOT_FOUND
B→A provision bucket in $TB_WS (→ A)  → 404 WORKSPACE_NOT_FOUND
```
Mechanism (code): `denyUnlessBucketOwner` checks `rec.tenant_id !== ctx.identity.tenantId → 404`.
**REST isolation holds for uniquely-named buckets.**

**EXCEPTION**: See SRN-1 above — if two tenants use the default slug-derived name, B's provision
overwrites A's record (A cannot then see or use its bucket at the API layer). This is a correctness/
ownership hijack bug, not an IDOR per se — B does not read/write A's S3 objects, it overwrites the
registry entry.

### Direct S3 layer — **BROKEN** ❌

Admin cred `in-falcone-storage.s3_access_key` (shared single identity, 19-char AK) is the only S3
identity in the deployment. With it:
```
[S3-1] ListBuckets → ["falcone-platform-system","lcrn-acme-1781799036","ws-app-staging-assets"]
       ALL tenants' buckets visible in one call.
[S3-2] ListObjectsV2(lcrn-acme-1781799036) → ["binary-test.bin","secret-data.txt"] (A's objects)
[S3-3] ListObjectsV2(ws-app-staging-assets=B's bucket) → count:0 (B had no objects)
[S3-4] GetObject(A/secret-data.txt) → 22 bytes [REDACTED] — cross-tenant READ via direct S3
[S3-5] PutObject(B/ctprobe-from-admin.txt) → 200 ← CROSS-TENANT WRITE via direct S3
[S3-6] GetObject(B/ctprobe-from-admin.txt) → 24 bytes ← PROVEN CROSS-TENANT READ after write
[S3-7] Cleanup probe deleted OK
```
**Anyone holding the shared admin S3 credential can read/write ALL tenants' buckets.**

This is a known residual: the per-tenant SeaweedFS identities (#553) that would fix this are code-
complete but not activated (SRN-2 above). As long as the admin cred is not exposed to tenant workloads
and no `/storage/.../credentials` route issues a direct S3 credential (those routes are NOT deployed
in this runtime), the S3 layer breach is only exploitable by internal actors with the secret.

---

## C18 — Direct S3 / SeaweedFS

**SeaweedFS confirmed** (pods: master/volume/filer/s3, no MinIO). Filer-mode (no static -config);
IAM auth enabled; single admin identity `falcone-s3-admin` in the filer.

**No per-tenant S3 identities exist** (neither via the #553 code path — not activated — nor otherwise).
`in-falcone-seaweedfs-s3-creds` contains only `adminAccessKey/adminSecretKey` + `s3AccessKey/s3SecretKey`
(same credential, two key-name aliases).

Evidence of filer-mode auth:
```
ListBuckets with WRONG creds → InvalidAccessKeyId (auth IS enforced)
ListBuckets with admin creds → 3 buckets (all tenants visible)
```

---

## C19 — Events / Kafka

### GW path (JWT, before KC restart)

KC restarted at ~16:16 losing in-memory H2 state. GW events path requires JWT; unavailable after
KC restart.

From prior run evidence (`evidence/23-events-functions.md`): the GW events surface was tested
exhaustively before. P0 ISO-EVENTS fix (#547) is confirmed in source:
- `resolveTopic` now calls `callerTenantScope(ctx)` and enforces `t.tenant_id !== scope → 404`.
- Physical topic naming still uses `ws.{wsSlug}.{topic}` (slug-based collision potential) but the
  id-scope guard is now applied.
- Code confirmed at HEAD in deployed image (`head-20260618`).

### EXECUTOR data-plane path (apiKey, tested this run)

Routes: `POST /v1/events/workspaces/{ws}/topics` (create), `POST .../topics/{topic}/publish`,
`GET .../topics/{topic}/messages?maxMessages&timeoutMs`, `GET .../topics` (list).

**Happy path (tenant A):**
```
POST $EXEC/v1/events/workspaces/$TA_WS/topics {"topic":"lcrn-evt-a-99756","partitions":1}
→ 201 {"topic":"lcrn-evt-a-99756","created":true}

POST .../topics/lcrn-evt-a-99756/publish {"value":{"hello":"from-acme","n":42}}
→ 202 {"topic":"lcrn-evt-a-99756","published":1,
       "partitions":[{"topicName":"evt.a10e1865-5b98-4a90-9dc4-72111904ab04.lcrn-evt-a-99756",
                       "partition":0,"baseOffset":"0"}]}

POST .../topics/lcrn-evt-a-99756/publish × 3 more → offsets 1,2,3
GET .../topics/lcrn-evt-a-99756/messages?maxMessages=10&timeoutMs=5000
→ 200 {"topic":"lcrn-evt-a-99756","messages":[
    {"key":null,"value":"{\"hello\":\"from-acme\",\"n\":42}","offset":"0"},
    {"key":null,"value":"{\"msg\":\"event-1\",\"n\":1}","offset":"1"},
    ... (4 messages total)
  ]}
```
Physical topic name: `evt.{workspaceId}.{topicName}` — uses **workspace UUID** (not slug). Correct,
non-crossable. Matches executor `events-executor.mjs` comment "the physical prefix is never crossable".

**Isolation probe (executor path) — PASS ✅:**
```
A key (workspace=$TA_WS) → B's workspace ($TB_WS) topics → 403 FORBIDDEN
  "Credential workspace does not match the requested workspace"
  (publish, consume, list all 403)
```
Cross-tenant topic access is denied on the executor path. Physical topics use workspace-UUID prefix,
so no slug-based collision on this path.

**Status lines — executor path:**
- list topics `GET .../topics`  ................. **Active/Working** (200, `{items:[{topic:…}]}`)
- create topic `POST .../topics`  ............... **Active/Working** (201 `{topic,created:true}`)
- publish `POST .../topics/{t}/publish`  ......... **Active/Working** (202, physical topic confirmed)
- consume `GET .../topics/{t}/messages`  ......... **Active/Working** (200, messages delivered)
- cross-tenant isolation (executor apiKey path)  . **ISOLATED** ✅ (403)

Note: GW JWT path SSE consume (`/stream`) untested this run (KC down). Prior run confirmed working +
P0 fix applied.

---

## C20 — Functions / Knative

### GW path (requires JWT)

GW functions require `Authorization: Bearer <JWT>` — unavailable (KC down at 16:16). Cannot test
the Knative ksvc deploy/invoke path via the gateway in this session.

**P0 fix #548 confirmed in source code**: `function-executor.mjs::ksvcNameForWorkspace()` appends a
10-char sha256(`tenantId:workspaceId`) suffix to the ksvc name:
```
// deploy/kind/control-plane/function-executor.mjs line 64-74
ksvcNameForWorkspace(workspace, actionName):
  disc = sha256('${tenantId}:${workspaceId}').slice(0,10)
  return `fn-${slug}-${actionName}-${disc}`
```
Two same-slug workspaces across tenants produce DISTINCT ksvc names (different disc values). Fix is
code-complete in deployed image `head-20260618`.

No ksvcs exist in the namespace at time of test (confirmed `kubectl get ksvc` → empty).

### EXECUTOR data-plane path (apiKey, in-memory worker_threads runtime)

Routes: `GET/POST /v1/functions/workspaces/{ws}/actions`, `GET .../actions/{name}`,
`POST .../actions/{name}/invocations`, `GET .../actions/{name}/activations`.

**Happy path (tenant A):**
```
POST $EXEC/v1/functions/workspaces/$TA_WS/actions {"name":"lcrn-fn-str-…","source":"function main(p){return {result:p.n*2};}"}
→ 201 {"name":"lcrn-fn-str-…","runtime":"nodejs","createdAt":"…"}

POST .../actions/lcrn-fn-str-…/invocations {"n":10}  (bare top-level input)
→ 200 {"activationId":"…","status":"success","result":{"result":20},"durationMs":235}
```

**P2 bug #570 fix confirmed (top-level input binding):** `invocationInput(body)` in
`functions-executor.mjs` now extracts `body.parameters` if present, or falls through to rest-spread
`{parameters,responseMode,...rest} = body` → `rest` (i.e., the top-level input). Both `{parameters:{n:10}}`
and `{n:10}` produce `result:20`. Fix is WORKING.

**NEW P2 BUG FOUND: Executor `source.inlineCode` unwrapping missing (FN-EXEC-SOURCE)**

When deploying via the OpenAPI-documented format `{"source":{"inlineCode":"function main(p){...}"}}`,
the executor stores the OBJECT `{inlineCode:"..."}` as the function source. On invoke, `backend.invoke(fn.source, params)` receives the object, which stringifies to `[object Object]` — `new Function('console', '[object Object]...')` → runtime error `"Unexpected identifier 'Object'"`.

```
POST .../actions {"name":"lcrn-fn-a","source":{"inlineCode":"function main(p){return {r:p.n*2};}"},...}
→ 201 {"name":"lcrn-fn-a","runtime":"nodejs",...}

POST .../actions/lcrn-fn-a/invocations {"parameters":{"n":21}}
→ 200 {"status":"error","error":"Unexpected identifier 'Object'","logs":[]}
```
Workaround: pass `source` as a plain string (not nested object): `{"source":"function main(p){...}"}` → works.
Root cause: `functions-executor.mjs` line 102 stores `params.payload?.source` without extracting `.inlineCode`.
Fix: `const src = params.payload?.source; const sourceCode = typeof src === 'object' ? src.inlineCode : src`.

**Isolation probe (executor path) — PASS ✅:**
```
A key → B's workspace functions/actions → 403 FORBIDDEN
  "Credential workspace does not match the requested workspace"
  (GET, invoke all 403)

Same-name function in both workspaces: A="lcrn-fn-shared-test" returns {tenant:'ACME',n:20}
                                        B="lcrn-fn-shared-test" returns {tenant:'GLOBEX',n:30}
DISTINCT results confirmed (in-memory store key = `${ws}\x20${name}`, workspace-scoped).
```
**No function clobber on executor path.** Functions are isolated by workspace key in the in-memory store.

**Status lines — executor path:**
- list actions `GET .../actions`  ............... **Active/Working** (200)
- deploy `POST .../actions`  ..................... **Active/Working** (201) — but see FN-EXEC-SOURCE bug
- get action `GET .../actions/{name}`  ........... **Active/Working** (200, `hasSource:true`)
- invoke `POST .../actions/{name}/invocations`  .. **Partial** — works with `source` string, fails with `source:{inlineCode}` object
- activations `GET .../actions/{name}/activations` **Active/Working** (200)
- isolation (executor path)  .................... **ISOLATED** ✅ (403 cross-workspace)

---

## C21 — Event-driven integration (Kafka→function / Kafka→flow)

### Event→Function trigger

**Not-deployed** on GW (404) AND on EXEC (404). No `kafka-triggers` route on either runtime.

### Event→Flow platform-event trigger

**Broken due to missing DB schema.**

```
POST $EXEC/v1/flows/workspaces/$TA_WS/flows/$FLOW_ID/versions  (publish with platform-event trigger)
→ 502 TRIGGER_REGISTRATION_FAILED
```
Executor logs: `[flow-executor] trigger registration failed: relation "flow_trigger_registrations" does not exist`

Also: `[flow-executor] trigger deregister on delete failed: relation "flow_trigger_secrets" does not exist`

The `flow_trigger_registrations` and `flow_trigger_secrets` tables are missing from the DB schema.
`flow-trigger-registry.mjs` calls these tables but they were never migrated. The trigger registration
path (event→flow routing) is **structurally broken in this deployment**.

### Manual flow execution (without trigger)

**Temporal is now operational** (P1 fix #558 resolved the `listWorkflowExecutions` 500):
```
POST $EXEC/v1/flows/workspaces/$TA_WS/flows/$FLOW_ID3/executions {"input":{...}}
→ 201 {"executionId":"…","workflowId":"…","runId":"…"}
```
Execution is received by the Temporal worker and started (status: RUNNING). The worker fails
individual tasks with `UPSTREAM_UNAVAILABLE` because the db.query activity cannot reach the executor
from within the Temporal worker pod (executor URL not configured in worker env), but Temporal itself
is healthy. Flow execution **starts successfully** — this is a task-routing configuration issue, not
a Temporal failure.

**Event publish to trigger topic works:**
```
POST $EXEC/v1/events/workspaces/$TA_WS/topics/lcrn-test-trigger-evtA/publish {"value":{...}}
→ 202 (physical: evt.$TA_WS.lcrn-test-trigger-evtA)
```
The event is published but never consumed as a trigger (trigger registration failed → no KafkaJS
consumer registered for that topic). No new flow execution was created 5s after publish.

**VERDICT C21:** Event-driven integration is **Broken / Blocked**:
- Event→function: Not-deployed (no routes)
- Event→flow: Broken (missing `flow_trigger_registrations` + `flow_trigger_secrets` tables)
- Manual flow execution: works (Temporal is operational)

---

## Summary: new/changed bugs found

### SRN-1 (P1) — Bucket registry hijack via slug-derived name collision
**Repro:** Two tenants each `POST /v1/storage/workspaces/{ws}/buckets` without explicit `name` (both
workspaces named "app-staging" → `ws-app-staging-assets`). Second tenant's provision overwrites first
tenant's `workspace_buckets` record via `ON CONFLICT (bucket_name) DO UPDATE SET tenant_id=EXCLUDED.tenant_id`.
First tenant loses API-level access to its own bucket.
**Root cause:** `tenant-store.mjs::insertBucket` uses bucket_name as unique key with unconditional
UPDATE on conflict; no tenant-ownership check on the upsert.
**Fix:** upsert should be fail-on-conflict (INSERT … ON CONFLICT DO NOTHING + return existing if
tenant matches, 409 CONFLICT if tenant mismatches); or include tenant+workspace in the bucket name
(e.g. `{wsId[:8]}-{name}`) to guarantee global uniqueness.

### SRN-2 (P0 residual) — `STORAGE_TENANT_IDENTITIES` not set → per-tenant SeaweedFS identities inactive
**Evidence:** deployed CP pod has only 3 STORAGE_* env vars; `storageCredential` is always `null`.
The env var is in `deploy/kind/values-kind.yaml` line 172 but not reaching the live deployment.
**Note:** The SeaweedFS S3 gateway is correctly in filer-mode (no static -config), IAM auth enabled,
admin seed job ran and cleaned up. Infrastructure for #553 is in place; only the env var is missing.

### FN-EXEC-SOURCE (P2) — Executor functions deploy with `source:{inlineCode:…}` object fails at invoke
**Repro:** `POST /v1/functions/workspaces/{ws}/actions` with `source:{inlineCode:"function main…"}` → 201.
`POST .../invocations` → 200 `{status:"error",error:"Unexpected identifier 'Object'"}`.
**Root cause:** `functions-executor.mjs::executeFunctions` (op=deploy) stores `params.payload?.source`
(the entire object) instead of extracting `.inlineCode`. On invoke, `backend.invoke(fn.source, params)`
passes the object which stringifies as `[object Object]`.

### C21-TRIGGER-SCHEMA (P1) — `flow_trigger_registrations` / `flow_trigger_secrets` tables missing
**Evidence:** `502 TRIGGER_REGISTRATION_FAILED` on `POST .../flows/{id}/versions` when flow has a
platform-event trigger; executor logs `relation "flow_trigger_registrations" does not exist`.
**Root cause:** These tables (defined in `flow-trigger-registry.mjs`) were not included in the
governance schema bootstrap (`governance-schema.mjs`). The `#555 fix-governance-schema-bootstrap`
only included 8 migrations (093/097/098/100/103/104/105/121) but the trigger tables may be in a
different migration not applied.

---

## Verified P0/P1/P2 fixes from recent commits

| Issue | Fix | Verified |
|---|---|---|
| #547 ISO-EVENTS GW path | `resolveTopic` scope check + `callerTenantScope` | Code verified in deployed image |
| #548 ISO-FUNCTIONS ksvc clobber | `ksvcNameForWorkspace` + sha256 tenant+ws discriminator | Code verified |
| #553 per-tenant SeaweedFS identities | Code present; SeaweedFS in filer-mode | NOT ACTIVATED (SRN-2) |
| #554 binary object PUT | Raw body accepted for non-JSON content-type | **EMPIRICALLY CONFIRMED** ✅ |
| #570 functions invoke input binding | `invocationInput()` honors bare top-level input | **CONFIRMED** ✅ (executor path) |
| Temporal P1 `listWorkflowExecutions` 500 | Temporal visibility patch | **CONFIRMED** ✅ — execution starts |

---

## Isolation verdicts

| Surface | Verdict | Detail |
|---|---|---|
| Storage REST (API layer) | **ISOLATED** ✅ (unique names) | 404 cross-tenant; exception: slug-derived name collision (SRN-1) |
| Storage REST (bucket name registry) | **BROKEN** ❌ P1 (SRN-1) | `ON CONFLICT` overwrites tenant_id; A loses its own bucket |
| Direct S3 / SeaweedFS | **BROKEN** ❌ (shared admin cred) | Single identity; all tenants' buckets readable+writable |
| Events (executor apiKey path) | **ISOLATED** ✅ | 403 cross-workspace; physical topic uses workspace-UUID prefix |
| Events (GW JWT path) | KC down — not testable this run; P0 fix confirmed in source | |
| Functions (executor apiKey path) | **ISOLATED** ✅ | 403 cross-workspace; in-memory store keyed by workspace+name |
| Functions (GW Knative path) | KC down — not testable; P0 fix confirmed in source | |
| Event-driven (event→flow trigger) | **BROKEN** ❌ P1 | Missing DB tables |

---

## NOT-DEPLOYED (not bugs, confirmed 404 NO_ROUTE)

- `POST /v1/storage/buckets`, `GET/DELETE /v1/storage/buckets/{id}` (bucket management)
- `/v1/storage/workspaces/{ws}/credentials*` (per-tenant credential issuance)
- Storage presigned URLs / multipart / lifecycle
- Event→function `kafka-triggers` / `cron-triggers` / `storage-triggers` (both GW and EXEC)
- SSE `/stream` consume path (EXEC; only `/messages` poll is deployed on executor)

## Could not test / caveats

- **GW JWT path (all)**: Keycloak restarted at 16:16 with in-memory H2 (lost all realm state).
  Cannot mint tenant-ops JWTs. All GW-path events/functions evidence relies on prior run + source
  code verification of fixes.
- **Knative ksvc deploy/invoke**: Requires GW JWT path (unavailable). P0 fix #548 verified in source.
- **GW events SSE `/stream`**: Requires JWT. Prior run confirmed working + P0 fix applied to source.
- **Per-tenant SeaweedFS identities** (C18 full scope): `storageCredential` always null; cannot test
  scoped direct S3 access per tenant.

## Cleanup performed

- Deleted S3 objects: `secret-data.txt`, `binary-test.bin` from bucket `lcrn-acme-1781799036` (via direct S3).
- Bucket records `lcrn-acme-1781799036` and `ws-app-staging-assets` remain in `workspace_buckets` table
  (no bucket-DELETE API deployed; no direct DB access). Footprint is inert.
- Test Kafka topics `lcrn-evt-a-99756`, `lcrn-evt-b-99788`, `lcrn-test-trigger-evtA` remain in Kafka
  (no topic-DELETE API; physically prefixed `evt.{wsId}.…` so harmless).
- Test functions in executor in-memory store evict automatically on pod restart.
- Test flow records in executor DB remain (inert draft flows; no way to delete via API in this session).
