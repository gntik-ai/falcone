## ADDED Requirements

### Requirement: Dimensioned append-only usage

The system SHALL extend `workspace_llm_usage` using `ADD COLUMN IF NOT EXISTS`
with nullable request_id, attempt, connection_id, provider_type, mode, execution_id,
node_id, batch_id, batch_item_id, cache_read_tokens, cache_write_tokens,
reasoning_tokens, status, price_source, price_list_id, price_catalog_version,
currency, cost_micros and estimated_cost_micros. Modes SHALL be sync, stream or
batch; statuses SHALL be recorded or budget_refused. Existing rows SHALL keep
null dimensions. A partial unique index on (tenant_id, workspace_id, request_id,
attempt) WHERE request_id IS NOT NULL and `ON CONFLICT DO NOTHING` SHALL prevent
duplicate attempts. Every table and query SHALL be scoped by tenant and workspace.

#### Scenario: Duplicate ingestion and tenant isolation

- **WHEN** an attempt is recorded twice in one tenant/workspace
- **THEN** only one usage row is added
- **AND** another tenant sharing the workspace identifier sees none of its rows

### Requirement: Trusted request and invocation identity

HTTP completions SHALL get a fresh UUID and attempt 1 on every sync or stream
call, independent of Idempotency-Key. Body fields SHALL never supply usage identity.
`dispatchTask` SHALL derive invocation { executionId, runId, nodeId, activityId,
attempt } from input.nodeId and Context.current().info and forward it through
llmComplete to executeLlmComplete. The request ID SHALL be
`flow:<executionId>:<runId>:<nodeId>:<activityId>` with execution_id and node_id.
Reconciled batch items SHALL record `batch:<batchId>:<customId>`, attempt 1, mode
batch and batch/item dimensions inside their existing transaction. Connection ID
and provider type SHALL come from the connection resolved by prepare().

#### Scenario: Retries and subsequent workflow runs

- **WHEN** a flow activity returns usage on attempts 1 and 2
- **THEN** two attempt rows count as one logical request
- **AND** another run with the same workflow, node and activity IDs gets a different request ID

#### Scenario: HTTP idempotency does not merge provider usage

- **WHEN** two completions share an Idempotency-Key
- **THEN** both calls receive distinct usage request IDs

### Requirement: Immutable pricing and ledger currency

The reviewed `llm-adapters/price-catalog.mjs` SHALL export catalogVersion, currency
USD and entries, which may be empty. Entries SHALL identify providerType, model,
mode sync or batch, integer nonnegative input/output micros per MTok, nullable
cache rates, sourceUrl and verifiedAt. There SHALL be no runtime catalog write API.
`workspace_llm_ledger_settings`, `workspace_llm_price_lists`, `workspace_llm_prices`
and `workspace_llm_budgets` SHALL all carry tenant_id and workspace_id. Workspace
price PUT SHALL append an immutable UUID snapshot, including an empty snapshot;
only the newest list SHALL be active. Rates SHALL be integer micros per MTok.
The first price-list/budget PUT or platform-priced cost SHALL set the ledger's
ISO currency (`^[A-Z]{3}$`), which SHALL never change. A conflicting PUT SHALL
return 409 LLM_CURRENCY_LOCKED even after deleting the budget.

#### Scenario: Snapshot replacement preserves recorded money

- **WHEN** a new workspace price list replaces the active list
- **THEN** earlier usage keeps its price_list_id and cost
- **AND** a removed model becomes unpriced unless the platform supplies a matching price

#### Scenario: Platform cost locks currency

- **WHEN** the first priced usage uses the USD platform catalog
- **THEN** a subsequent EUR price-list or budget PUT returns 409 LLM_CURRENCY_LOCKED

### Requirement: Deterministic monetary costs

The price mode SHALL be sync for sync/stream usage and batch for batches. First
match SHALL win: workspace requested mode, platform requested mode, then for
batch only workspace sync, then platform sync. Platform entries SHALL apply only
when ledger currency is unset or equals catalog currency. No conversion occurs.
Each priced row SHALL preserve price_source, price_list_id or
price_catalog_version, and currency; unmatched rows SHALL have null cost/source.
Uncached input SHALL be max(promptTokens - cacheReadTokens - cacheWriteTokens, 0).
Cache rates SHALL fall back to input rate. Reasoning SHALL not be counted again
because it is already included in completionTokens. BigInt cost SHALL be
round-half-up of (uncached*input + cacheRead*readRate + cacheWrite*writeRate +
completion*output) / 1,000,000. Monetary API values SHALL be decimal strings.

#### Scenario: Exact price fixture

- **WHEN** 1,000 uncached input and 1,000 output tokens each cost 1,000,000 micros/MTok
- **THEN** cost_micros is exactly 2,000

#### Scenario: Mode and currency fallback

- **WHEN** a batch has both a platform batch price and workspace sync price
- **THEN** it uses the platform batch price
- **AND** a EUR ledger ignores the USD catalog

### Requirement: Workspace monthly budget enforcement

A budget SHALL have limit_micros, the locked currency and period month (UTC
calendar month). Before any sync, stream or batch provider call, the system SHALL
check month-to-date recorded cost plus its estimate against the limit, without
reservations. Estimate SHALL use ceil(message-content characters / 4), input
rate, and maxTokens else model catalog maxOutputTokens else 4096 output tokens,
with BigInt and ceiling division by 1,000,000. A batch SHALL sum item estimates
using batch price resolution. Under a budget, string contents and text parts
SHALL be counted; uncountable parts SHALL return 400 INVALID_LLM_MESSAGES before
provider I/O. Without a budget, existing message behavior SHALL be preserved.
Over limit SHALL return 422 LLM_BUDGET_EXCEEDED before provider I/O and record one
budget_refused row with zero tokens and estimated_cost_micros. An unpriced model
under a budget SHALL return 422 LLM_PRICE_MISSING. These 422s SHALL be non-retryable
for llm.complete. Provider usage SHALL be recorded before local JSON validation,
which SHALL continue to return 502 on invalid structured output.

#### Scenario: Budget refusal is auditable and makes no provider call

- **WHEN** spend plus estimate exceeds the limit
- **THEN** the caller receives 422 LLM_BUDGET_EXCEEDED without provider fetch
- **AND** the ledger contains the refusal and estimate

#### Scenario: Missing prices fail closed

- **WHEN** a budget exists but neither source prices the model
- **THEN** the completion returns 422 LLM_PRICE_MISSING without provider fetch

#### Scenario: Charged invalid JSON

- **WHEN** a provider returns usage with invalid structured JSON
- **THEN** the caller still receives 502 and the recorded usage counts toward spend

### Requirement: Ledger APIs and authorization

The system SHALL expose GET/PUT `/v1/workspaces/{id}/llm-usage/prices`, returning
the active list, platform version/currency and effective entries marked by source;
GET/PUT/DELETE budget; GET ledger with from, to, opaque cursor and limit <=500,
newest first, returning every usage and cost dimension; and GET summary with
from/to and groupBy model, connection, execution, node, batch or UTC day. Summary
SHALL return distinct logical requests (legacy null IDs count once per row),
attempts, token sums and costMicros by currency. budget_refused SHALL be excluded
from summary attempts and the unchanged legacy GET /llm-usage response. Existing
legacy scope rules SHALL remain unchanged. Only new routes SHALL require
data:read/data:write. Price/budget PUT/DELETE SHALL be structural writes and their
catalog entries structural_admin; reads SHALL be data_access. Existing server
helpers SHALL keep their names.

#### Scenario: Multi-stage run attribution

- **WHEN** a multi-stage run finishes
- **THEN** summary groupBy=execution and groupBy=node expose usage and cost per run/stage

#### Scenario: API keys cannot change pricing or budgets

- **WHEN** an API key attempts a price or budget write
- **THEN** the request returns 403 before mutation

### Requirement: Tenant purge and additive upgrade

Schema setup SHALL upgrade the old usage schema idempotently, leaving historical
rows readable. TENANT_PURGE_TABLES SHALL include all four new tables with prices
before price_lists. Purge SHALL remove their rows only for the selected tenant.

#### Scenario: Real Postgres upgrade and purge

- **GIVEN** an old usage table and two tenants with populated price lists, prices, settings and budgets
- **WHEN** schema setup runs and one tenant is purged
- **THEN** the partial unique index and monthly costs work and only that tenant's ledger data disappears
