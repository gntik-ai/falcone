# Live-stack empirical audit — agent brief (READ FIRST)

You are testing the **running** Falcone stack on the local kind cluster (ns `falcone`, Helm
`in-falcone-0.3.0`). Test EMPIRICALLY against the live system — never assert "should work".
Capture ACTUAL responses (status + body excerpts) as evidence. This is an open-source CODE+RUNTIME
audit; do not rely on repo docs/READMEs.

## Port-forwards (already running at 127.0.0.1 — do NOT start your own; reuse these)
18080 control-plane · 18081 keycloak · 18082 cp-executor · 15432 postgres ·
18333 seaweedfs-s3 · 27018 mongodb(legacy) · 17017 ferretdb. (If one is down, you may start it:
`KUBECONFIG=./kubeconfig-test-cluster-b.yaml kubectl -n falcone port-forward svc/<svc> <local>:<remote>` in background.)

## Harness
```bash
cd /home/andrea/gntik/falcone
source tests/live-audit/lib/lib.sh        # wrappers + auth (secret-safe; reads cluster secrets at runtime)
source tests/live-audit/context.env       # TA_* (Ops Demo) and TB_* (DataPlane Demo) fixtures
```
- Mgmt/control-plane API (Bearer JWT, superadmin):  `TOK=$(sa_token); cp GET /v1/tenants "$TOK" | show`
- Data-plane via **API key** (real credential path):  `K=$(mint_key "$TA_TENANT" "$TA_WS" service); exk GET <path> "$K" | show`
- Data-plane via **trust-header** (gateway-bypass; admin/DDL + isolation probes): `exh GET <path> "$TA_TENANT" "$TA_WS" | show`
- Helpers: `show` (body+STATUS), `body_of`, `code_of`. `cp`/`exk`/`exh` already pass `curl -g` (brackets ok).
- 501 with code `*_DISABLED` (e.g. `FLOWS_DISABLED`, `MCP_DISABLED`) ⇒ **NOT DEPLOYED**, not a bug.

## Fixtures (≥2 tenants, each a realm-backed tenant with one provisioned workspace)
- Tenant A: `$TA_TENANT` ws `$TA_WS` dbpath `$TA_DB` (Ops Demo)
- Tenant B: `$TB_TENANT` ws `$TB_WS` dbpath `$TB_DB` (DataPlane Demo)

## Known facts (verified) — use, don't re-derive
- Data-plane DB is shared `in_falcone` for ALL workspaces (resolveConnection ignores workspaceId).
- Document/Mongo API points at **legacy `falcone-mongodb`**; FerretDB is deployed but NOT wired into the API.
- Storage uses **SeaweedFS** (`falcone-seaweedfs-s3:8333`); creds in secret `in-falcone-seaweedfs-s3-creds` (keys s3AccessKey/s3SecretKey) — read with `ksecret`.
- NOT deployed live: Temporal/flows, MCP, OpenBao. Confirm via 501 codes; classify as not-deployed.
- Executor data-plane routes live (server.mjs): `/v1/postgres/...`, `/v1/mongo/workspaces/{ws}/data/{db}/collections/{c}/documents`, `/v1/events/workspaces/{ws}/topics`, `/v1/functions/workspaces/{ws}/actions`, `/v1/realtime/...`. Mgmt routes proxy to control-plane.
- Public route catalog (intended surface, 392 routes, superset of what's wired):
  `services/internal-contracts/src/public-route-catalog.json` — filter by your family to find paths/shapes.

## Your deliverables
1. `tests/live-audit/evidence/<NN>-<cap>.md` — findings with a status line per functionality
   (Active/Working · Broken · Not-deployed), real response excerpts, and any cross-tenant result.
2. `tests/live-audit/specs/<NN>-<cap>.sh` — a re-runnable bash spec (source lib.sh+context.env; PASS/FAIL).
3. A **cross-tenant isolation probe** for your surface (can A reach B's resource? capture the result).
4. Return a concise structured summary: per-functionality status, bugs (severity + 1-line repro), what's not-deployed, what you couldn't test (why).

## Rules
- Use UNIQUE resource names: prefix `la<cap><rand>`. Clean up what you create. Don't disrupt other tenants' real data.
- NEVER print/commit secret values (keys/passwords/tokens). Redact in evidence (prefixes ok).
- Distinguish genuine FAILURES from NOT-DEPLOYED features. Don't file not-deployed as bugs.
