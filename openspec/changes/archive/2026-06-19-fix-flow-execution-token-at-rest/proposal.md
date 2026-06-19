# fix-flow-execution-token-at-rest

## Change type
bugfix

## Capability
workflows

## Priority
P2

## Why
The per-execution flow auth token — an HMAC-SHA256 bearer credential minted by
`mintExecutionToken` and validated by the worker before every data-plane activity — was
mirrored into the Temporal workflow memo under the key `falconeExecutionToken` at BOTH
`startExecution` and `retryExecution` call sites in
`apps/control-plane/src/runtime/flow-executor.mjs`. An inline comment falsely claimed the
memo was "encrypted by Temporal"; in practice no `PayloadCodec`/`DataConverter` is
configured on either the control-plane client or the worker, so the memo is serialised as
`json/plain` and stored in Temporal visibility and workflow history in cleartext.

The credential is a bearer token: possession is sufficient to authorise data-plane
activities for a tenant/workspace pair for the lifetime of the execution (up to 24 h by
default). Any operator, tooling process, or infrastructure service with access to the
Temporal UI, Temporal visibility API, or workflow history therefore had read access to a
live, tenant-scoped bearer credential — a confidentiality violation and a lateral
privilege-escalation surface. GitHub issue #633.

**Root cause (code-verified).**
`apps/control-plane/src/runtime/flow-executor.mjs::startExecution` (line ~691) and
`retryExecution` (line ~869) each called `client.workflow.start` with a `memo:
{ [EXECUTION_TOKEN_MEMO_KEY]: executionToken }` option.
`EXECUTION_TOKEN_MEMO_KEY` was exported from
`apps/control-plane/src/runtime/execution-token.mjs`. The memo write was REDUNDANT: the
token is already carried in the Temporal workflow args as `args[0].tenant.executionToken`
(the `InlineWorkflowInput` tenant envelope built by `startInputFor`), which is exactly
where the worker reads it (`services/workflow-worker` reads `args[0].tenant.executionToken`,
never the memo). `EXECUTION_TOKEN_MEMO_KEY` was only ever written, never read.

## What Changes
- `apps/control-plane/src/runtime/flow-executor.mjs`: removed the `memo:
  { [EXECUTION_TOKEN_MEMO_KEY]: executionToken }` option from both `client.workflow.start`
  calls (`startExecution` and `retryExecution`). Corrected the misleading comments at both
  sites to explain that the token travels in the workflow args (tenant envelope) and must
  NOT be placed in the memo because the memo is persisted as `json/plain` in
  visibility/history with no PayloadCodec configured (#633). The `startInputFor` helper and
  the worker's reading path are unchanged.
- `apps/control-plane/src/runtime/execution-token.mjs`: removed the now-unused
  `EXECUTION_TOKEN_MEMO_KEY` export. The rest of the module (`mintExecutionToken`,
  `validateExecutionToken`, the error codes) is unchanged.

## Impact
- The per-execution HMAC bearer token is no longer persisted in plaintext in Temporal
  workflow history or the visibility store. Operators with Temporal UI or API access no
  longer see the live credential.
- No functional change: the worker's activity-authorization path is unaffected because it
  always read the token from `args[0].tenant.executionToken`, not the memo.
- No API contract changes, no DB schema changes, no Helm chart changes.
- Affected specs: `workflows`.
