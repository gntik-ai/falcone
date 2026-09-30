# Flow lifecycle audit outbox

Flow definition create, update, publish, and delete write one event to
`flow_audit_outbox` in the same metadata database transaction as the Flow change.
The executor relays these rows to `FLOW_AUDIT_TOPIC` (default
`falcone.audit.flow-lifecycle`). This is a platform topic; the tenant events API
only addresses physical `evt.<workspaceId>.*` topics.

An outbox insert failure rolls back the Flow mutation. The API returns HTTP 503
with code `AUDIT_UNAVAILABLE`; callers can retry the rolled-back mutation.
Gateway callers should reuse their `Idempotency-Key`. Kafka failure after a successful mutation leaves the row
pending. The relay retries with exponential backoff capped by
`FLOW_AUDIT_BACKOFF_CAP_MS` (default 60000 ms). The default attempt budget is
derived from a seven day retry window; `FLOW_AUDIT_MAX_ATTEMPTS` can override
it. The relay processes up to 100 due rows per tick. Published rows are kept
for 30 days, then purged in batches. Failed rows are never purged.

`falcone_flow_audit_outbox_rows{state="pending"}` and
`falcone_flow_audit_outbox_rows{state="failed"}` on `/metrics` show the backlog.
`falcone_flow_audit_relay_last_success_timestamp_seconds` shows when the relay
last completed a tick, so monitoring can detect a stale backlog gauge when the
metadata database is unavailable. It is zero until the first successful tick.
An alert on failed rows needs operator action. After restoring Kafka and the
platform topic, requeue a specific failed event with an authorized metadata
database connection:

```sql
UPDATE flow_audit_outbox
SET attempts = 0, failed_at = NULL, next_attempt_at = now()
WHERE event_id = '<event UUID>' AND failed_at IS NOT NULL;
```

The `failed_at` predicate makes a repeat of this command harmless while that
row is pending or delivered. Requeue retains the same `event_id`; consumers
should deduplicate on that ID because a crash after a Kafka acknowledgement but
before the outbox commit can replay the event. Inspect the pending and failed
gauges after requeue and confirm the event on the platform topic.
