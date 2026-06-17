# fix-helm-wait-documentdb-hook-ordering

## Change type
bug-fix

## Capability
tenant-provisioning (cap-tenant-provisioning)

## Priority
P2

## Why (Problem Statement)
`helm install --wait` deadlocks: the FerretDB deployment (a main resource) waits for
the `documentdb_api` schema to be created, but that schema is created by a
*post-install hook* — which only runs after main resources are ready. This creates a
circular dependency.

**Evidence (live campaign 2026-06-17):**
- `helm install --wait` hangs with: `falcone-ferretdb not ready … Progress deadline exceeded`

## What Changes
Break the circular dependency by making the DocumentDB extension/schema creation a
prerequisite that completes before FerretDB starts — e.g. by using an init-container
(against the DocumentDB engine) or a pre-install hook with proper ordering. The
resulting setup MUST converge with `helm install --wait`.

## Impact
- **Operational:** `helm install --wait` (used in CI and automation) currently never
  completes on a fresh install.
- **Breaking change:** none (restructures hook ordering only).
- **Dependencies:** C.1 (FerretDB host fix) should land first.
