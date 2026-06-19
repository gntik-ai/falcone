# deployment — spec delta for fix-kind-executor-realtime-url

## ADDED Requirements

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
