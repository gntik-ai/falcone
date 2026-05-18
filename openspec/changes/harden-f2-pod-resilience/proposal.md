## Why

The `charts/realtime-gateway/` Deployment is shipped with operational
defaults that guarantee crash-loops and lost sessions even if the
transport binary works. From
`openspec/audit/cap-f2-realtime-subscriptions-transport.md`:

- **B10** (`charts/realtime-gateway/values.yaml:19`) — hard-codes
  `KEYCLOAK_INTROSPECTION_CLIENT_ID = 'realtime-gateway'`, but the
  Keycloak bootstrap in `charts/in-falcone/values.yaml:360-398`
  creates only `in-falcone-gateway` and `in-falcone-console`. The
  introspection client doesn't exist; calls 401.
- **B11** (`charts/realtime-gateway/templates/deployment.yaml:61-68`) —
  probes hit `/healthz/ready` and `/healthz/live`. Other services in
  this repo expose `/health` and `/metrics`. If the transport binary
  ends up matching sibling conventions, the probes 404 and pods
  restart-loop.
- **B12** (same `deployment.yaml`, full read) — no `resources:` block.
  The pod runs unbounded until the node evicts it.
- **B13** (`charts/realtime-gateway/values.yaml:6`) — `replicaCount:
  1` for a stateful WS session manager (B2 session manager is
  in-memory). Pod restart drops every active subscription with no
  recovery loop.
- **B14** (`charts/realtime-gateway/templates/deployment.yaml:61-68`)
  — liveness and readiness use the same probe path. If the endpoint
  has ready-only semantics, liveness fails on slow start; if
  liveness-only, readiness returns 200 before the WS server is
  accepting upgrades.

## What Changes

- Add a `realtime-gateway` Keycloak client to
  `charts/in-falcone/values.yaml:360-398` and document the secret as
  required via ESO (separate file from B4 fix).
- Adopt two distinct probe paths: `/healthz/live` returns 200 as soon
  as the process is up; `/healthz/ready` returns 200 only when Kafka
  consumer, B2 Postgres, and Keycloak introspection round-trip all
  succeed.
- Add `resources.requests/limits` block to
  `charts/realtime-gateway/templates/deployment.yaml` with sensible
  defaults (256Mi / 1Gi memory; 100m / 500m CPU) overridable from
  `values.yaml`.
- Raise `replicaCount` default to `2` and add a `PodDisruptionBudget`
  with `minAvailable: 1`. (Cross-pod session durability remains a
  follow-up — covered by B2 audit's session-recovery item.)

## Capabilities

### Modified Capabilities

- `realtime-and-events`: the realtime-gateway pod can no longer be
  installed in a configuration that guarantees crash-loops or single
  point of failure.

## Impact

- **Affected code**:
  `charts/realtime-gateway/values.yaml`,
  `charts/realtime-gateway/templates/deployment.yaml`,
  `charts/realtime-gateway/templates/poddisruptionbudget.yaml` (new),
  `charts/in-falcone/values.yaml` (Keycloak client bootstrap).
- **Migration**: ops must populate the new Keycloak client secret;
  document in PR.
- **Breaking changes**: doubling the replica count doubles per-pod
  Kafka consumer-group membership. Cross-pod session affinity is not
  added by this change.
- **Out of scope**: session durability across pod restart (B2 follow-up).
