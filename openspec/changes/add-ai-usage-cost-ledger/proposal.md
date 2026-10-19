# Dimensioned AI usage and monetary cost ledger

## Why

Issue #946 (GAP-FAL-007) needs request, retry, connection, flow stage and batch
attribution, with reproducible costs and a workspace budget checked before calls.
Provider usage must also survive local structured-output JSON validation errors.

## What changes

- Extend the append-only usage log with trusted identity, cache/reasoning tokens,
  price provenance, costs and auditable budget refusals. Preserve the old rollup.
- Add a reviewed platform catalog and immutable workspace price snapshots.
- Lock each workspace ledger to one currency and check UTC calendar-month spend
  plus a conservative estimate without reservations (operator decisions D1–D3).
- Add price, budget, ledger and summary APIs under the existing `/llm-usage` prefix.
- Forward Temporal invocation identity, account batch items transactionally, and
  include new tables in tenant purge. Add offline and real-Postgres coverage.

## Scope and risk

R1, source repository only. Schema additions are nullable columns and new tables;
old images can ignore them. Concurrent requests may exceed a budget because no
reservation is taken. No deployment, Helm, APISIX or `/v1/platform` route changes.
No embeddings, currency conversion, CSV, runtime platform-price writes, quotas,
or per-user/per-tenant budgets. Dependencies #945 and #1171 are already present.
