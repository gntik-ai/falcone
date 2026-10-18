# LLM provider batches delta

## ADDED Requirements

### Requirement: Native OpenAI Responses batches

Only `openai-responses` connections SHALL resolve a frozen OpenAI batch driver.
Other compatible provider types SHALL retain 422 `LLM_BATCH_UNSUPPORTED`.
The endpoint pathname SHALL end in `/v1/responses`; all Files and Batches URLs
SHALL derive from its base, preserve query parameters, and encode ids.
Each uploaded JSONL line SHALL contain `custom_id`, `method: POST`,
`url: /v1/responses`, and the native request body without `stream`, retaining
`store: false`. Creation SHALL use `input_file_id`, `endpoint: /v1/responses`,
`completion_window: 24h`, and `metadata.falcone_batch_id`.

#### Scenario: Fenced create

- GIVEN an uploaded input file
- WHEN its fenced provider-state write loses ownership
- THEN no create request is sent.
- WHEN upload fails before creation
- THEN the batch fails and its binding is released.
- WHEN create is ambiguously accepted
- THEN its input file and binding remain, and creation is never repeated.
- WHEN create is definitely rejected
- THEN input deletion is attempted best effort.

### Requirement: Safe uncertain-create recovery

A submission without `inputFileId` SHALL fail after five minutes with
`LLM_BATCH_SUBMIT_INTERRUPTED` and release its binding, without provider I/O.
Uncertain submissions with a file SHALL use resumable newest-first list sweeps,
at most five pages of 100 batches per pass, with a ten-minute lookback before
the Falcone row's creation. Both input file and Falcone metadata SHALL match.
Sweep progress SHALL persist under the active lease and reset only at a match
or complete sweep. Polling SHALL use the maximum interval during recovery.

#### Scenario: Deletion fence and late acceptance

- GIVEN no match in a complete sweep started fifteen minutes after create issuance
- WHEN DELETE succeeds or returns 404, followed by a GET returning 404
- THEN confirmed deletion is persisted and searches continue.
- WHEN a later sweep finds a match, even one failed by the provider
- THEN it becomes tracked `in_progress`.
- WHEN deletion or its confirmation fails
- THEN recovery retries and never treats that failure as proof of absence.

#### Scenario: Recovery horizon

- GIVEN 25 hours have elapsed since `createIssuedAt` and input deletion is confirmed
- WHEN a complete sweep started after both events finds no match
- THEN the batch fails with `LLM_BATCH_SUBMIT_UNCERTAIN`.
- WHEN the current sweep is incomplete or started before either event
- THEN recovery continues without a terminal failure.

### Requirement: OpenAI result mapping and accounting

Batch metadata SHALL require `object: batch` and map all eight statuses,
request counts, file ids, cancellation evidence and Unix timestamps. Provider
validation failure SHALL error every pending item with
`LLM_PROVIDER_REQUEST_REJECTED`, without usage, and finalize as failed.

#### Scenario: Ordered files and durable accounting

- GIVEN an ended provider batch with output and error files
- WHEN reconciled
- THEN output is read before errors, using guarded JSONL ingestion.
- THEN every ingested item retains `{ file, httpStatus }` in provider detail.
- THEN provider-completed counts use distinct persisted output items with 2xx HTTP
  status, including failed Responses bodies; provider-failed counts use distinct
  error-file items or non-2xx output items.
- THEN retries never duplicate successful-item usage.

#### Scenario: Per-item normalization

- GIVEN a 2xx result
- THEN the shipped Responses parser preserves cached and reasoning token usage.
- GIVEN an HTTP-200 failed body
- THEN its AdapterError becomes an item error and ingestion continues.
- GIVEN a non-2xx result
- THEN the adapter's HTTP error code is retained.
- GIVEN `batch_expired` or `batch_cancelled`
- THEN the outcome is expired or canceled respectively.
- GIVEN any other provider error
- THEN the outcome is errored with `LLM_PROVIDER_ERROR`.
- GIVEN malformed JSON or an unknown custom id
- THEN ingestion reports `LLM_PROVIDER_RESPONSE_INVALID`.

#### Scenario: Absent items and completion

- GIVEN both files reached clean EOF
- WHEN distinct provider-completed equals `request_counts.completed` and
  provider-failed is at least `request_counts.failed`
- THEN absent items may become canceled or expired for those provider statuses.
- OTHERWISE no absent outcome is synthesized and existing incomplete limits apply.
- THEN finalization additionally requires every item and the provider total to match.
- THEN provider expiry finalizes as expired, retaining successes and usage.
- THEN input, output and error files each receive one best-effort DELETE.

### Requirement: Preserve shared batch safety

Optional hooks SHALL preserve the existing Anthropic behavior when omitted.
All provider I/O SHALL use the shared transport with lease assertions, endpoint
blocking, secret snapshot resolution, and `redirect: error`. API keys SHALL NOT
enter durable state, result details, logs or error messages. No migration or
public state/route change is required.
