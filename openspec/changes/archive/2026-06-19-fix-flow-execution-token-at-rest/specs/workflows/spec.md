# workflows — spec delta for fix-flow-execution-token-at-rest

## ADDED Requirements

### Requirement: Flow execution credentials are not persisted in plaintext in workflow history

The system SHALL NOT write the per-execution flow auth token (the HMAC bearer credential
minted by `mintExecutionToken` and used by worker activities to authorise data-plane
operations) into any Temporal workflow memo, search attribute, or visibility field. Because
no `PayloadCodec`/`DataConverter` is configured on the Temporal client or worker, memo
payloads are serialised as `json/plain` and stored unencrypted in Temporal workflow history
and the visibility store; placing a bearer credential there would expose a live,
tenant-scoped secret to every operator or tooling process with Temporal UI or API access.
The token SHALL travel exclusively in the Temporal workflow args (the `InlineWorkflowInput`
tenant envelope at `args[0].tenant.executionToken`), which is where the workflow-worker
worker reads it to authorise each activity. This constraint applies to both the initial
execution start (`startExecution`) and every retry start (`retryExecution`).

#### Scenario: Temporal memo contains no execution token on start

- **WHEN** a flow execution is started and the resulting `workflow.start()` options are
  inspected
- **THEN** the `memo` field is absent, `null`, or an empty object — it contains no key
  named `falconeExecutionToken` and the plaintext token value does not appear in the
  serialised memo

#### Scenario: Execution token is still carried in the workflow args

- **WHEN** a flow execution is started
- **THEN** `args[0].tenant.executionToken` is a non-empty string (the HMAC bearer token),
  so the worker can validate it before every data-plane activity

#### Scenario: Temporal memo contains no execution token on retry

- **WHEN** a flow execution is retried and the resulting `workflow.start()` options for the
  new run are inspected
- **THEN** the `memo` field is absent, `null`, or an empty object — the freshly minted
  retry token is not written to the memo and travels only in the workflow args
