# fix-apisix-gateway-shared-secret-provisioning

## Change type
bug-fix

## Capability
gateway (cap-gateway)

## Priority
P1

## Why (Problem Statement)
The APISIX standalone config references the environment variable
`${{GATEWAY_SHARED_SECRET}}` but the Helm chart (including kind values) never
provisions it. On startup APISIX crashes with:
`can't find environment variable GATEWAY_SHARED_SECRET` — CrashLoopBackOff.

**Evidence (live campaign 2026-06-17):**
- Pod log: `can't find environment variable GATEWAY_SHARED_SECRET`
- CrashLoopBackOff until manually supplied.

## What Changes
1. Provision an `in-falcone-gateway-shared-secret` Kubernetes Secret (or add the key
   to an existing secret) containing a randomly-generated value.
2. Map the secret key to the `GATEWAY_SHARED_SECRET` env var in the APISIX deployment
   template.
3. Map the same value to the executor's env so that the executor-to-gateway trust
   assertion works end-to-end.

## Impact
- **Operational:** without this fix APISIX cannot start at all.
- **Breaking change:** none (new required secret, chart-managed).
- **Dependencies:** none standalone; pairs with C.2 for a fully functional install.
