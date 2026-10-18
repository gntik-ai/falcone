# add-openai-batch-driver

## Problem

Issue #1186 adds OpenAI Batch API support to the provider-neutral batch API from
issue #945. At source 0364933, native `openai-responses` connections have no batch
driver and return 422 `LLM_BATCH_UNSUPPORTED`.

## Scope and decision

Add a frozen driver to the native Responses adapter. Upload JSONL requests using
its existing request builder, persist the input file and create timestamp under
the submission fence, then create a 24-hour Responses batch with the Falcone id
in metadata. Compatible `openai` connections remain unsupported.

Add optional reconciler hooks for resumable uncertain-create discovery, failed
provider batches, ordered output/error streams, durable per-item accounting,
absent canceled/expired items, final status, and best-effort file cleanup.
Drivers that omit these hooks, including Anthropic, keep the existing behavior.
All provider requests retain lease fencing, BYOK endpoint/secret checks, and
redirect rejection. Keys exist only in request context.

## Recovery and risk

A submission without a persisted input file is interrupted after five minutes
and releases its idempotency binding. An uncertain create with an input file is
never recreated. Sweeps examine at most five pages of 100 batches per pass,
retain progress across restarts, and stop at a ten-minute creation lookback.
A complete sweep started at least fifteen minutes after create issuance permits
input deletion, followed by a GET returning 404. Failure is allowed only after
25 hours and a complete sweep started after both that horizon and confirmed
deletion. A discovered match is always tracked, including provider failures.

R1: no schema, route, surface/conformance-manifest, dependency, or deployment
change. A create held by OpenAI for more than 25 hours can remain untracked;
this is the accepted residual risk. Rollback removes OpenAI reconciliation,
so active jobs and provider files may require operator handling.

## Validation

Exercise the native driver contract and every shared #945 executor scenario for
Anthropic and OpenAI. Add deletion and create races, resumable pagination,
25-hour recovery, partial result files, accounting mismatches, cached/reasoning
usage, and cleanup checks. CI supplies real Postgres and socket-based checks
where sandbox restrictions prevent execution.
