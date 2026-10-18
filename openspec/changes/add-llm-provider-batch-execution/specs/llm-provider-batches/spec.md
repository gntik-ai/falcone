## ADDED Requirements

### Requirement: Provider-neutral batch execution

The system SHALL submit, poll, cancel and reconcile provider batches through
`resolveBatchDriver(providerType)`. This change implements Anthropic and the
provider-neutral state machine, storage, idempotency, leases and finalization.
OpenAI, Gemini, Flow tasks, cost attribution and budgets remain out of scope.
Routes SHALL remain under `/llm/completions/batches`; gateway and chart changes
are out of scope. Existing complete/completeStream behavior and
conformance-manifest.json SHALL remain unchanged.

#### Scenario: Validate before provider I/O

- **WHEN** the adapter has no batch driver or the model has `batch: false`
- **THEN** submission returns 422 `LLM_BATCH_UNSUPPORTED` or
  `MODEL_CAPABILITY_UNAVAILABLE`, respectively, without fetching
- **AND** disallowed models use the existing model admission errors
- **WHEN** there are zero or more than 1,000 items, invalid or duplicate
  `customId` values, streaming fields, or unsupported structured output
- **THEN** submission returns 400 before fetching
- **AND** each custom id matches `^[A-Za-z0-9_-]{1,64}$`

### Requirement: Submission is idempotent and uncertainty is durable

The system SHALL look up a principal-scoped hashed idempotency binding before
validation or prepare(), compare the canonical input SHA-256, and prepare once
for a new submission. The batch snapshot and pending items SHALL be inserted in
one transaction. Every submission write SHALL fence on status and lease_version;
a zero-row write SHALL stop that worker before further provider calls.

#### Scenario: Ambiguous creating response

- **WHEN** a creating call fails in the network or body phase, with HTTP 408,
  or with HTTP 500 or higher
- **THEN** submission returns 202 `submit_uncertain` and retains the binding
- **AND** replay returns the stored batch without prepare() or provider I/O,
  including after the connection is deleted
- **AND** uncertain batches are never resubmitted; unresolved uncertainty fails
  after 15 minutes, or five minutes in submitting, with
  `LLM_BATCH_SUBMIT_UNCERTAIN`

#### Scenario: Definite rejection and replay mismatch

- **WHEN** the provider returns HTTP 400–499 other than 408
- **THEN** the batch fails with last_error_code and returns the AdapterError
  status, including 424 for a provider 401
- **AND** HTTP 429 or failedBeforeCreate clears the binding for another attempt
- **WHEN** the same principal and key are reused with a different body
- **THEN** submission returns 422 `IDEMPOTENCY_KEY_MISMATCH`

### Requirement: Partial results and usage survive interrupted ingestion

Each item transition SHALL be guarded by pending status and share a transaction
with client-aware usage recording. Result mapping SHALL be pure. Malformed JSON,
unknown result types and unknown custom ids SHALL raise
`LLM_PROVIDER_RESPONSE_INVALID`.

#### Scenario: Partial failure and resumable results

- **WHEN** some items fail, or a result stream is truncated or malformed
- **THEN** succeeded items retain content and usage; failed items retain their
  own error_code, and committed items survive subsequent attempts
- **AND** results_attempts increments and another pass can ingest the rest
- **AND** usage is recorded once per succeeded item, including after replay
- **AND** finalization waits for no pending items, request_count matching the
  stored item count, and the driver's per-type count agreement

#### Scenario: Incomplete results and overdue provider batches

- **WHEN** results have been attempted ten times or ended_at is 24 hours old
- **THEN** the batch becomes incomplete; pending items become missing and count
  toward missing_count without usage
- **WHEN** a batch has not ended 24 hours after expires_at
- **THEN** it fails with `LLM_BATCH_RECONCILE_TIMEOUT`
- **AND** HTTP 429 and 5xx double polling delays up to ten minutes

### Requirement: Cancellation intent is durable and idempotent

POST cancel SHALL persist intent before trying once. Repeated cancel requests
while canceling or terminal SHALL preserve the intent and polling schedule.
Background reconciliation SHALL resend cancellation until the driver provides
evidence, including after a request crashes or the provider returns 429 or 5xx.

#### Scenario: Cancellation evidence determines final state

- **WHEN** Anthropic reports canceling or a non-null cancel_initiated_at
- **THEN** cancel_acknowledged_at is set and the batch finalizes as cancelled
- **WHEN** the batch ends before any cancellation evidence
- **THEN** it finalizes normally and retains cancel_requested_at

### Requirement: Snapshot guards and leases protect background calls

Only secret_ref SHALL be stored; credential values SHALL never be persisted or
logged. Each background call SHALL revalidate the snapshot endpoint and secret
allow-list and resolve the secret afresh. Leases SHALL claim up to 20 due rows
with FOR UPDATE SKIP LOCKED, a five-minute expiry and incremented lease_version.

#### Scenario: Connection changes and DNS changes

- **WHEN** an in-progress connection is replaced or deleted
- **THEN** the reconciler continues using the snapshotted endpoint
- **WHEN** that endpoint resolves to a private address
- **THEN** no provider call occurs and `BYOK_ENDPOINT_BLOCKED` is recorded
- **AND** batch URLs preserve the endpoint query, encode provider ids, ignore
  provider-supplied URLs, and reject redirects

#### Scenario: Concurrent and stale reconcilers

- **WHEN** two reconcilers race for one batch
- **THEN** only one holds the lease and usage is counted once
- **WHEN** a stale worker writes with an old lease_version
- **THEN** it matches zero rows and stops before further provider calls

### Requirement: Batch routes preserve tenant and scope boundaries

The API SHALL provide submit, list, get, item-list, cancel and terminal-delete
routes, with data_access catalog entries and the existing completion prefix's
data:write API-key scope checks. Item listing SHALL paginate by customId with a
status filter. Items SHALL remain until terminal deletion or tenant purge.

#### Scenario: Isolation, authorization and retention

- **WHEN** a batch id is unknown or belongs to another tenant
- **THEN** the route returns 404 `LLM_BATCH_NOT_FOUND`
- **WHEN** a data:read-only API key requests a batch route
- **THEN** the route returns 403
- **WHEN** a caller deletes a non-terminal batch
- **THEN** it returns 409 `LLM_BATCH_NOT_TERMINAL`
- **WHEN** a tenant is purged
- **THEN** workspace_llm_batch_items is removed before workspace_llm_batches
