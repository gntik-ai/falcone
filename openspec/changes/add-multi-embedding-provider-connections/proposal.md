# Multiple embedding provider connections

## Why

Issue #1172 (GAP-FAL-001d) extends the LLM connection registry pattern from #937
to embeddings. A second provider must coexist with the first, and each vector
column must be able to select the connection used for writes and text searches.

## What changes

- Add a tenant/workspace registry of up to 32 named embedding connections.
- Keep the singular provider API operating on the default connection.
- Copy legacy configuration once and mirror old-executor writes to the default.
- Carry an optional connection selector through mappings, auto-embedding and KNN.
- Preserve structural authorization, BYOK guards and complete tenant purge.

## Scope

Source repository only. Model snapshots, collection-level mapping routes, console
UI, chart changes and deployment execution are excluded. Retain the legacy table,
its unique constraint and its mirror trigger.
