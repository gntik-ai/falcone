## Context

`getTotalAllocatedExcluding` sums the sibling workspaces' allocations for a (tenant, dimension) so `upsertSubQuota` can reject an allocation that would push the tenant over its effective limit. Its real-Postgres branch ran:

```
SELECT COALESCE(SUM(allocated_value), 0) AS total
  FROM workspace_sub_quotas
 WHERE tenant_id = $1 AND dimension_key = $2 AND workspace_id <> $3
 FOR UPDATE
```

PostgreSQL forbids `FOR UPDATE` with an aggregate (`SUM`), raising `0A000: FOR UPDATE is not allowed with aggregate functions`. The query therefore always errors at runtime; the surrounding `upsertSubQuota` transaction rolls back and the action returns 500. The over-limit guard (422) is never reached.

The function is called only from `upsertSubQuota`, which wraps it in `BEGIN; SET LOCAL TRANSACTION ISOLATION LEVEL SERIALIZABLE`. The `FOR UPDATE` was the author's pessimistic lock on the sibling rows to prevent two concurrent allocations from each reading a stale, under-the-limit total and both committing (write skew).

## Decision

Preserve the pessimistic row lock; make it legal by relocating `FOR UPDATE` to a non-aggregate inner subquery:

```
SELECT COALESCE(SUM(allocated_value), 0) AS total
  FROM (
    SELECT allocated_value
      FROM workspace_sub_quotas
     WHERE tenant_id = $1 AND dimension_key = $2 AND workspace_id <> $3
     FOR UPDATE
  ) locked_rows
```

The inner query locks exactly the rows the original locked; the outer query aggregates. This is the minimal change that keeps the intended concurrency semantics (the lock is not merely delegated to SERIALIZABLE) while removing the illegal aggregate+`FOR UPDATE` combination.

### Alternatives considered

- **Drop `FOR UPDATE` entirely, rely on SERIALIZABLE.** Correct for the current sole caller (which is SERIALIZABLE), but silently weakens the function for any future non-serializable caller. Rejected in favour of keeping the explicit lock.
- **`SELECT ... FOR UPDATE` (rows) then sum in JS.** Equivalent, but an extra round-trip of all sibling rows; the subquery form keeps the single round-trip and the SQL `SUM`.

## Risks

- Low. Behavior-preserving for the in-memory-store branch (untouched) and for the limit-comparison logic. The only change is the SQL text of the locked aggregate, validated end-to-end against real Postgres via the `tests/env` slice.
