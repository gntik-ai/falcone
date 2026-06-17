# fix-stale-migration-components-in-running-release

## Change type
bug-fix

## Capability
tenant-provisioning (cap-tenant-provisioning / deployment hygiene)

## Priority
P2

## Why (Problem Statement)
The running (pre-campaign) deployment still contained a `falcone-mongodb` StatefulSet,
a `lan-minio-console` NodePort, an `openwhisk` svc-stub, and the control-plane/executor
were pointed at **MongoDB (not FerretDB)** — an incomplete migration in the live
environment.

**Evidence (live campaign 2026-06-17):**
- `helm get values` (rev 47): `MONGO_HOST: falcone-mongodb`, `mongodb`/`openwhisk`/
  `storage(minio)` stanzas present.
- D8 in the campaign report.

## What Changes
1. Re-deploy from current chart (which drops the legacy components).
2. Add a CI/deploy guard (Helm `helm template | grep` check or a pre-deploy script)
   that fails if any of the legacy resource names render in the chart output.

## Impact
- **Operational:** the live environment was running a broken hybrid state.
- **Breaking change:** none (removal of already-superseded components).
- **Dependencies:** C.1–C.5 (the install hardening fixes) to ensure the new deploy
  converges cleanly.
