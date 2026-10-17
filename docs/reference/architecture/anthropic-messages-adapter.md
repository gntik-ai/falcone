# Anthropic Messages adapter release note

Connections with `providerType: 'anthropic'` now use the native Anthropic Messages
protocol. Operators must set their endpoint to the Messages endpoint, such as
`https://api.anthropic.com/v1/messages`. Endpoints are used exactly as configured;
the executor does not rewrite or migrate them.

Existing Anthropic connections pointing at an OpenAI-compatible endpoint will fail:
a rejected request returns HTTP 424, while a Chat Completions response returns a
retryable HTTP 502 `LLM_PROVIDER_RESPONSE_INVALID`.

The adapter sends `x-api-key` and `anthropic-version: 2023-06-01`, lifts system
messages to the top-level system field, and defaults `max_tokens` to 4096 when
`maxTokens` is omitted. That default can truncate long replies, reported as
`finishReason: 'length'`; set `maxTokens` explicitly when needed.

HTTP completions and `llm.complete` accept optional `promptCache: 'system'` to mark
the system block with ephemeral cache control. Without this option, no cache
control is sent. Explicit `messages` still take precedence over `system` and
`prompt`. OpenAI adapters ignore the option.

Returned usage distinguishes `cacheReadTokens` and `cacheWriteTokens`. Both cache
counts contribute to `promptTokens` alongside uncached input. Persistence of the
cache counts is deferred to #946.

There is no schema migration or persisted data change. Roll back by reverting the
image digest. Flows saved with `promptCache` fail validation on the older image;
flows omitting it remain valid.
