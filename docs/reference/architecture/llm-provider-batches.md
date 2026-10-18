# LLM provider batches

The HTTP batch API is under `/v1/workspaces/{workspaceId}/llm/completions/batches`.
POST accepts a connection/model selection and 1–1,000 items, for example:

```json
{
  "connectionId": "anthropic-main",
  "model": "configured-model",
  "items": [{ "customId": "question-1", "prompt": "Hello", "maxTokens": 128 }]
}
```

Each item accepts the completion fields, except streaming. A batch selects one
connection and model. Items have unique ASCII `customId` values of 1–64 letters,
digits, underscores or hyphens. Batches support Anthropic and native
`openai-responses` connections. Compatible `openai` connections remain unsupported
(422 `LLM_BATCH_UNSUPPORTED`). Anthropic structured output is unsupported.
Completion fields such as `maxTokens`, `temperature` and `promptCache` belong on
items; specifying them at the batch level returns 400. Streaming is unsupported.

POST returns 202 for accepted and uncertain submissions. An `Idempotency-Key`
binds the canonical input to the verified tenant, workspace and principal. Replay
returns the stored batch with 200, including after connection deletion. Different
input returns 422. Uncertain creating calls are never repeated; provider 429 and
failures before creation release the binding. Provider authentication/rejection
errors return the adapter status (424).
The standard key format still applies: 8–128 ASCII letters, digits, periods,
underscores, colons or hyphens. Invalid keys return 400 before submission.

GET on the collection lists newest first. GET on `/{batchId}` returns metadata;
GET on `/{batchId}/items` returns outcomes, content, usage and individual error
codes. Collections accept `limit` (1–100, default 50) and opaque `cursor` values;
items additionally accept a `status` filter. Results carry `nextCursor`, or null.
POST on `/{batchId}/cancel` durably records intent and attempts cancellation.
It makes at most one provider cancel call; polling and result ingestion run in
the background. Repeated cancellation preserves the polling deadline and leaves
retries to reconciliation. Intent recorded during submission survives acceptance without
revoking the submitting request's fence.
DELETE on `/{batchId}` requires a terminal batch and removes its items.
All batch routes require `data:write` for API keys, following the existing
completion prefix's scope checks.

## Driver contract

`resolveBatchDriver(providerType)` returns an optional frozen adapter `batch`.
The state machine and storage do not select behavior by provider name.

- `submit(ctx)` returns `{ type: 'accepted', providerBatchId, expiresAt }` or
  `{ type: 'failedBeforeCreate', error }`, or throws the creating-call error.
  `ctx.items` contains normalized completion requests. `ctx.persist(state)`
  updates driver-owned JSON state with submission fencing; always await it.
- `poll(ctx)` and `cancel(ctx)` return normalized batch metadata: `counts`,
  `ended`, `expired`, `expiresAt`, `endedAt`, and `cancelAcknowledged`.
  Only provider evidence may acknowledge cancellation.
- `results(ctx)` returns a raw response with a JSONL body. URLs are derived from
  the configured endpoint and provider id; provider-supplied URLs are ignored.
- Pure `parseBatch(json)`, `parseResultLine(line, customIds)` and
  `countsMatch(providerCounts, itemCounts)` own validation and mapping.
  A result has `customId`, a terminal item `status`, and completion fields or
  `errorCode`. Unknown ids/types and malformed data are response-invalid errors.
- I/O uses the injected transport. Errors preserve `phase` (`network`, `body`,
  or `response` with the original `httpStatus`). Resolved keys stay in call
  context. Only secret references and non-secret provider state are durable.

Batch driver calls reject provider redirects (`redirect: 'error'`). This prevents
a redirect from bypassing the batch endpoint guard. Existing synchronous and
streaming completions retain their default Fetch redirect behavior.

## Reconciliation and operations

`LLM_BATCH_POLL_INTERVAL_MS` defaults to 60 seconds, clamped to 10–600 seconds.
The metadata-backed executor claims up to 20 due batches with five-minute leases
and version fencing. Background calls revalidate the endpoint and secret
allow-list, then resolve the secret afresh. Connection edits never redirect jobs.
Each pending item transition and its usage insert share a Postgres transaction.
Repeated ingestion cannot meter an item twice.

Cancellation is retried until acknowledged. Results ingestion retains committed
items across broken streams. Finalization checks item count, pending items and
driver counts. Ten attempts or 24 hours after ending produce `incomplete`, with
pending items marked `missing` and no usage for them. For drivers without recovery hooks, unresolved submissions fail
after 15 minutes (five for a crashed `submitting` request). A running batch fails
24 hours after its expiry. Guard/auth failures use the maximum polling interval;
429 and server errors double the previous delay up to ten minutes.

Items remain until terminal deletion or tenant purge. On rollback, leave both
new tables in place. Reverting stops reconciliation of provider jobs: operators
must cancel active jobs first or accept that they will remain unreconciled.
The real-Postgres CI suite gates lease races, stale writers and atomic usage.

## OpenAI Responses batches

The configured endpoint pathname must end in `/v1/responses`. The driver derives
Files and Batches paths from its base, preserving query parameters and encoding
provider ids. Upload uses multipart `purpose=batch` and JSONL. Each line sends
the existing Responses request body to `/v1/responses`, removes `stream`, and
retains `store: false`. Creation uses a 24-hour completion window and the Falcone
batch id in metadata. The input file id and `createIssuedAt` are persisted before
creation; a lost fence prevents the create. Upload failure releases the binding.
Definite create rejection attempts input deletion; an ambiguous create keeps the
file and binding and is never resubmitted.

Without a persisted input file, recovery fails after five minutes with
`LLM_BATCH_SUBMIT_INTERRUPTED` and releases the binding without provider access.
With a file, recovery sweeps the batch list, matching both `input_file_id` and
`metadata.falcone_batch_id`. Each pass reads up to five pages of 100 entries.
`sweepStartedAt` and `sweepAfter` retain progress across restarts. A complete
sweep reaches the ten-minute lookback before the row's creation or
`has_more: false`; the next sweep starts at the newest page. Recovery polls every ten minutes.

A complete no-match sweep started at least fifteen minutes after `createIssuedAt`
allows input-file deletion, confirmed by a subsequent GET returning 404.
`inputFileDeletedAt` records that confirmation in provider state. Deletion does
not prove that an already sent create cannot be accepted. Searches continue until
25 hours after create issuance, and termination additionally requires a complete
no-match sweep started after both the horizon and confirmed deletion. Only then
is `LLM_BATCH_SUBMIT_UNCERTAIN` terminal. A match at any time becomes tracked,
including a batch the provider fails after its input disappears. A create held
for more than 25 hours remains an accepted residual risk.

Provider validation failure errors pending items without usage. Ended batches
read output and then error files. Per-item `providerDetail` records `file` and
`httpStatus`; accounting counts distinct persisted items, not lines or normalized
outcomes. Thus an HTTP-200 failed Responses body is errored locally while still
counting as provider-completed. Cached and reasoning token usage uses the same
Responses parser as synchronous requests. Committed successes survive retries.

After both files reach EOF, absent items may become canceled or expired only
when provider-completed equals the reported completed count and provider-failed
is at least the reported failed count. A mismatch synthesizes nothing and retries
until `incomplete`. An expired provider batch finalizes as `expired`, retaining
successes and usage, including when cancellation was previously acknowledged.
After terminal ingestion (including incomplete and validation failure), input,
output and error files each receive one best-effort DELETE. Cleanup is not retried
after a crash or failed deletion.

The optional hooks are `validateEndpoint`, `guardEachRequest`,
`interruptedSubmission`, `resolveUncertain`, multi-stream `results`,
`absentItems`, `failedItems`, `finalStatus`, and `cleanup`. Resolution receives
`batchId`, `createdAt`, injected `now()` and fenced `persist(state)`. Count checks
also receive persisted items. Multi-request guards revalidate the lease, endpoint
and secret before each transport request, including between result files.
Anthropic omits these hooks and retains its existing recovery and result paths.
