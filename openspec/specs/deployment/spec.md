# deployment Specification

## Purpose
TBD - created by archiving change fix-install-health-gate-probes. Update Purpose after archive.
## Requirements
### Requirement: Install health gate probes paths/clients that reflect real health

The install health gate SHALL probe endpoints and use clients that reflect the platform's
actual health, so it passes when the platform is healthy:

- The gateway health probe SHALL hit a gateway route that returns 200 when the gateway is up
  and routing to the control plane (the gateway `/health` route is rewritten to the
  control-plane health endpoint it actually serves, `/healthz`).
- A datastore reachability probe behind a NetworkPolicy that admits only specific app
  components SHALL run from a client the policy admits (the smoke pod is labelled as an
  admitted component), so a reachable datastore is not reported unreachable.

#### Scenario: the gateway health probe passes when the gateway is up

- **WHEN** the gate probes the gateway `/health` route and the platform is healthy
- **THEN** it receives 200 (the route resolves to the control-plane `/healthz`), not a 404

#### Scenario: a NetworkPolicy-protected datastore probe reflects real reachability

- **WHEN** the gate probes a datastore whose NetworkPolicy admits only named app components
- **THEN** the probe runs from a client admitted by the policy and reports the datastore reachable

### Requirement: The kind executor manifest MUST wire the realtime CDC connection

The system SHALL set `REALTIME_DOCUMENTDB_URL` on the executor deployed by
`deploy/kind/executor-demo.yaml`, sourced from the `in-falcone-documentdb-replication` secret's
`realtime-url` key with `optional: true`, identical to the `controlPlane.env` stanza in
`tests/live-campaign/values-campaign.yaml`. The realtime executor activates only when
`REALTIME_DOCUMENTDB_URL` is present (`createRealtimeExecutor` is gated on it); without it every
`/v1/realtime/*` request fails closed with `501 REALTIME_DISABLED`. Because the source is `optional`,
a deployment whose replication secret/key is absent still starts (realtime simply stays disabled),
so non-realtime profiles are unaffected.

#### Scenario: Realtime enabled on kind when the replication credential exists

- **WHEN** the kind stack is installed and the `in-falcone-documentdb-replication` secret holds
  `realtime-url`
- **THEN** the `falcone-cp-executor` container runs with `REALTIME_DOCUMENTDB_URL` set and
  `GET /v1/realtime/.../changes` opens an SSE stream (HTTP 200) rather than returning
  `501 REALTIME_DISABLED`

#### Scenario: The demo manifest and the campaign Helm values agree on realtime wiring

- **WHEN** the executor env is defined in both `deploy/kind/executor-demo.yaml` and the
  `controlPlane.env` stanza of `tests/live-campaign/values-campaign.yaml`
- **THEN** both source `REALTIME_DOCUMENTDB_URL` from the same secret
  (`in-falcone-documentdb-replication`) and key (`realtime-url`) with `optional: true`, so there is
  no silent drift between the two executor definitions

#### Scenario: Realtime stays disabled without drift when the credential is absent

- **WHEN** the replication secret or its `realtime-url` key is absent on a profile that does not run
  realtime
- **THEN** the `optional: true` reference leaves `REALTIME_DOCUMENTDB_URL` unset, the executor still
  starts, and `/v1/realtime/*` returns `501 REALTIME_DISABLED` consistently (a deliberate disabled
  state, not a drift between two executor definitions)

### Requirement: Temporal MUST connect using a secret-sourced password without leaking it

The system SHALL allow the Temporal server datastore password to be supplied from a Kubernetes Secret
(`temporal.persistence.existingSecret` + `passwordSecretKey`) such that the server authenticates
successfully AND the password never appears literally in a ConfigMap.

The plain `temporalio/server` image does NOT expand `${...}` env references in its config file, so a
rendered `password: "${POSTGRES_PWD}"` is used verbatim and authentication fails
(`no usable database connection found`). When `existingSecret` is set the chart SHALL therefore render
a literal `"__TEMPORAL_DB_PASSWORD__"` placeholder (for both the default and visibility datastores) in
the config ConfigMap, and the server start wrapper SHALL substitute it from the `POSTGRES_PWD` env
(injected via `secretKeyRef`) into a writable in-pod copy of the config before start. The substituted
value SHALL be escaped so any generated password is injected literally, and the password SHALL exist
only in the in-pod copy, never in the ConfigMap. With no `existingSecret` the inline password is
rendered as before (dev/sandbox default).

#### Scenario: existingSecret with a generated password

- **WHEN** `temporal.persistence.existingSecret` + `passwordSecretKey` are set and the Postgres
  password is a generated (non-default) value
- **THEN** the Temporal frontend/history/matching pods start (no `no usable database connection`) and
  the rendered config ConfigMap does NOT contain the plaintext password

#### Scenario: placeholder rendered, not plaintext, when existingSecret is set

- **WHEN** the config ConfigMap is rendered with `existingSecret` configured
- **THEN** both datastore `password` fields render `"__TEMPORAL_DB_PASSWORD__"` (a placeholder), and
  neither the plaintext password nor an unexpanded `${POSTGRES_PWD}` literal appears in the ConfigMap

#### Scenario: start wrapper substitutes the secret-sourced password

- **WHEN** a Temporal server pod starts with `existingSecret` configured
- **THEN** its start wrapper substitutes `__TEMPORAL_DB_PASSWORD__` from the `POSTGRES_PWD` env (which
  is sourced from the existingSecret via `secretKeyRef`) into the writable in-pod config copy, with
  the value injected literally even when it contains shell/sed-special characters

#### Scenario: default inline password unchanged

- **WHEN** no `existingSecret` is configured
- **THEN** the config renders the inline `persistence.password` and no placeholder is emitted, so the
  dev/sandbox default is unchanged

