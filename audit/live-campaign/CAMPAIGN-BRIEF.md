# Live campaign — subagent brief (READ FIRST)

You are empirically testing the **running, fresh-from-HEAD** Falcone stack on the local kind
cluster (ns `falcone`). Test against the LIVE system; capture ACTUAL responses (status + body
excerpts) as evidence. NEVER assert "should work". This is a code+runtime audit — ignore repo docs.

## Environment / harness
```bash
cd /home/andrea/gntik/falcone
export KUBECONFIG="$(pwd)/kubeconfig-test-cluster-b.yaml"
source tests/live-audit/lib/lib.sh     # cp/exk/exh/mint_key/sa_token/ksecret + show/body_of/code_of
source tests/live-audit/context.env    # TA_*/TB_* fixtures (acme=A, globex=B), TA_OPS/TB_OPS, CAMPAIGN_PW
```
Port-forwards (already running; may briefly drop on pod restart — RETRY on 000):
- **GW** APISIX real-user REST `http://localhost:9080`  (Bearer JWT → control-plane; `apikey: flc_…` → executor)
- **CP** control-plane direct `http://localhost:18080` (lib.sh `$CP`, `cp` helper)
- **EXEC** cp-executor direct `http://localhost:18082` (lib.sh `$EXEC`, `exk`/`exh`) — serves data-plane + flows + mcp + realtime
- **KC** Keycloak `http://localhost:8080` (realm `in-falcone-platform`)
- **PG** `localhost:15432` (psql NOT installed — use `node -e` with `pg`, or `kubectl -n falcone exec falcone-postgresql-0 -- psql`)
- **FerretDB** `mongodb://localhost:17017` (mongo wire; use `node -e` with `mongodb`, directConnection)
- **S3** SeaweedFS `http://localhost:18333` (use `node -e` with `@aws-sdk/client-s3`, forcePathStyle)
  (node_modules has pg, mongodb, @aws-sdk/client-s3 at repo root.)

## Tokens / credentials (secret-safe — NEVER print key/password/token values; redact to prefixes)
- superadmin JWT (platform): `STOK=$(curl -s $GW/v1/auth/login-sessions -H 'Content-Type: application/json' -d "{\"username\":\"superadmin\",\"password\":\"$(ksecret in-falcone-superadmin password)\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["tokenSet"]["accessToken"])')`
- tenant-operator JWT (tenant_owner, tenant_id): login `acme-ops` / `globex-ops` with `$CAMPAIGN_PW` the same way.
- Data-plane API keys: already minted per workspace in `tests/live-campaign/.fixtures.json` (`.tenants[].workspaces[].apiKey.key`), OR mint fresh: `K=$(mint_key "$TA_TENANT" "$TA_WS" service)`.
- Direct-datastore creds via `ksecret`: PG `ksecret in-falcone-postgresql POSTGRESQL_PASSWORD` (user falcone, db in_falcone); DocumentDB `ksecret in-falcone-documentdb POSTGRES_PASSWORD` (user from POSTGRES_USER); S3 `ksecret in-falcone-storage s3_access_key`/`s3_secret_key`.

## Fixtures (≥2 tenants, multi-project, multi-env)
- A = acme `$TA_TENANT`; staging ws `$TA_WS` db `$TA_DB` (wsdb_acme_app_staging); prod ws `$TA_WS_PROD` db `$TA_DB_PROD`.
- B = globex `$TB_TENANT`; staging ws `$TB_WS` db `$TB_DB`; prod ws `$TB_WS_PROD` db `$TB_DB_PROD`.
- Tenant users: owner@{slug}.test, alice@{slug}.test, bob@{slug}.test (in the per-tenant realm = `$TA_TENANT`/`$TB_TENANT`), pw `$CAMPAIGN_PW`.
- App end-user: enduser@{slug}.test in the per-tenant realm.

## Stack facts (verified this run — use, don't re-derive)
- Doc DB = **FerretDB v2 / DocumentDB** (mongo-wire); NO MongoDB server. Storage = **SeaweedFS** (`falcone-seaweedfs-s3:8333`); NO MinIO. Functions = **Knative** on-demand ksvc; NO OpenWhisk. Vault NOT deployed (cert-manager absent).
- Per-workspace PG databases are REAL separate DBs `wsdb_<tenant>_<ws>` (placement shared on one server). **Verify empirically whether the executor data-plane routes to the per-ws DB (good) or falls back to shared `in_falcone` (leak).**
- **Flows + MCP + realtime are served by the EXECUTOR DIRECT (18082), NOT the gateway** (APISIX has no /v1/flows or /v1/mcp route). Temporal dev server + workflow-worker are up (namespace falcone-flows, taskQueue flows-main). `GET $EXEC/v1/flows/workspaces/{ws}/task-types` → 200 catalog; `GET $EXEC/v1/mcp/workspaces/{ws}/servers` → 200. Use trust-header (`-H "x-tenant-id: $TA_TENANT" -H "x-workspace-id: $TA_WS"`) or an apikey on EXEC.
- Executor auth on EXEC direct: apikey (`exk`), JWT (Bearer), or trust-header (`exh`, dev-mode trusted since GATEWAY_SHARED_SECRET unset on the executor). Cross-workspace IDOR guard: a credential bound to ws B cannot touch ws A (403). API-key issuance now rejects cross-tenant (CROSS_TENANT_VIOLATION).

## Deliverables (per subagent)
1. Write `audit/live-campaign/evidence/<NN>-<cap>.md`: a **status line per functionality**
   (Active/Working · Broken · Not-deployed) + real response excerpts (status + body) + the
   **cross-tenant/cross-project isolation probe result** for your surface.
2. Return a concise structured summary: per-functionality status, BUGS (severity P0/P1/P2 + 1-line
   repro), what's NOT-DEPLOYED (don't file as bugs), what you couldn't test + why, isolation verdict.

## Rules
- UNIQUE resource names: prefix `lc<cap><rand>`. Clean up what you create. Don't disrupt the other tenant's data.
- NEVER print/commit secret values. Redact (prefixes ok).
- Distinguish genuine FAILURES from NOT-DEPLOYED. A 404/501 for an unrouted/disabled feature is NOT a bug.
- Isolation probes are TOP PRIORITY: for every resource you create as A, try to reach it as B (and vice-versa); record the exact status.
</content>
