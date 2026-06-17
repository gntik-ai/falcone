# Evidence — LIVE re-proof after deploying the P0 isolation fixes

The P0 fixes (A1–A6) were built into new images and deployed to the running kind `falcone` namespace,
then the original cross-tenant probes were re-run against the live system.

## Deployment

- Executor `falcone-cp-executor` → `localhost:30500/in-falcone-control-plane-executor:0.9.6-p0`
  (A1 gateway gate + A2 credential↔path binding), with `GATEWAY_SHARED_SECRET` set.
- Control-plane `falcone-control-plane` → `localhost:30500/in-falcone-control-plane:0.6.3-p0`
  (A4 storage ownership, A5 function tenant scope, A6 signup→tenant realm).
- A3 migration `20260616-007-revoke-data-role-control-table-grants.sql` applied to live `in_falcone`.
- Both deployments rolled out successfully.

## Re-proof results (before → after)

| Finding | Original (vuln) | Live after fix |
|---|---|---|
| **A1** direct executor: spoofed `x-tenant-id`, no creds → mint key | 201 (key minted) | **401** ✅ |
| **A1** through PUBLIC APISIX gateway: spoof, no creds | 201 (key minted) | **401** ✅ |
| **A2** Tenant B key → Tenant A postgres rows | 200 (read A's data) | **403** ✅ |
| **A2** Tenant B key → Tenant A events/topics | 200 (list/publish) | **403** ✅ |
| **A2** Tenant B key → Tenant A functions/actions | 200 (invoke) | **403** ✅ |
| **A2** positive control: A key → A events | 200 | **200** (no regression) ✅ |
| **A3** `SET ROLE falcone_service; SELECT workspace_api_keys` | rows returned | **permission denied** ✅ |
| **A3** data API: A key → `workspace_api_keys` rows | 3 rows | **404** (no privilege) ✅ |
| **A6** signup for Ops tenant → which realm? | platform realm | **tenant realm `ffd33d99`**, not platform ✅ |

(Legit gateway path still works: keys minted via the authenticated path; A's key on A's own path → 200.)

## Not re-proved live (constraint, not a gap)

- **A4 (storage)** and **A5 (control-plane Knative function)** cross-tenant re-proof needs a
  **non-superadmin tenant-scoped JWT**, which can't be minted on the live realm because tenant logins
  are blocked by **B3/#496** ("Account is not fully set up"). These are **deployed (0.6.3-p0) and
  verified by the black-box tests** (RED→GREEN: 10 storage IDOR cases, 9 function-scope cases). The
  original audit also established A4/A5 via source + tests for the same reason.

## Notes

- The live `falcone` namespace now runs the **fixed images** (`0.9.6-p0` / `0.6.3-p0`). Rollback:
  `kubectl -n falcone set image deploy/falcone-cp-executor control-plane=…:0.9.5` and
  `deploy/falcone-control-plane control-plane=…:0.6.2` (the A3 migration is an idempotent REVOKE and
  safe to leave). Setting `GATEWAY_SHARED_SECRET` only closes the header-spoof; legit API-key/JWT
  traffic (which self-authenticates) is unaffected — the standalone APISIX injects no identity headers.
