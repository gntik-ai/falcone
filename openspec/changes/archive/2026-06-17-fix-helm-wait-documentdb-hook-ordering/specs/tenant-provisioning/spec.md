# tenant-provisioning — spec delta for fix-helm-wait-documentdb-hook-ordering

## ADDED Requirements

### Requirement: helm install --wait converges without deadlock

The FerretDB gateway SHALL be self-sufficient for the documentdb_api schema it depends
on — its init container SHALL create the `documentdb` extension itself (idempotently,
failing closed if the engine image lacks it) rather than only waiting for a post-install
hook — so that `helm install --wait` on a fresh cluster converges to Ready within the
standard Helm timeout with no circular dependency between main resources and hooks.

#### Scenario: helm install --wait completes on a fresh kind cluster

- **WHEN** `helm install --wait` is executed on a fresh kind cluster
- **THEN** all main resources (including FerretDB) MUST reach Ready state and the
  install MUST complete without a `Progress deadline exceeded` timeout

#### Scenario: the gateway creates its own schema dependency

- **WHEN** the FerretDB gateway pod starts
- **THEN** its init container MUST run `CREATE EXTENSION IF NOT EXISTS documentdb` against
  the engine and verify the `documentdb_api` schema before the gateway container starts,
  and MUST NOT depend on the post-install hook Job for that critical-path schema
