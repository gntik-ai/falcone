# Embedding connection registry design

## Registry and writes

`workspace_embedding_connections` stores tenant, workspace and connection IDs,
display name, provider type, model, endpoint, dimension, secret reference, default
flag and creation/update timestamps. The primary key is the three IDs. Connection
IDs match `^[a-z0-9][a-z0-9-]{0,62}$`; display names are at most 128 characters.
A partial unique index permits at most one default per tenant/workspace, an index
supports workspace lookup, and a trigger enforces the 32-connection limit.

Writes use the LLM registry's per-workspace advisory-lock pattern. The first
connection becomes default; explicit default moves are atomic. Deleting a default
leaves none. New code writes only the registry. Secret-reference and endpoint
guards run before writes; plaintext keys are stripped. Identity supplies tenant
IDs, and structural authorization protects all collection and item writes.

## Copy and compatibility

Schema setup takes the registry advisory lock and a SHARE ROW EXCLUSIVE lock on
the legacy table in one transaction. It creates schema objects idempotently, adds
`migrated_at`, copies unmarked rows into connection `default` with both timestamps
from legacy `updated_at`, uses `ON CONFLICT DO NOTHING`, and marks copied rows.
Repeated and concurrent setup never recreates a deleted migrated connection.

A legacy mirror trigger forwards old-executor inserts and updates to the default,
promoting or creating `default` when needed, and deletes only the default. Deletes
fail with `EMBEDDING_CONNECTION_IN_USE` if an explicit mapping names it. The copy,
mirror and current writes retain the LLM pattern's lock ordering.

Accepted rollout/rollback risk: old images read legacy data and cannot see edits
made exclusively through the new registry. Old-image writes still mirror forward.
The legacy table, unique constraint and trigger remain in place.

## Mapping selection

Mappings gain nullable `connection_id`. Named mapping writes validate existence
in the same tenant/workspace. Auto-embedding passes each mapping's selector, and
KNN text search resolves the vector column's mapping before embedding. Missing
named connections return 422 before provider calls; absent selectors use the
default. Explicit mappings block both singular and plural connection deletion.

Both in-memory stores keep their existence check and mapping write synchronous.
An in-memory mapping store bound to a Postgres provider store instead uses the
public connection lookup, translating an absent connection to the same 422.
Production constructs both stores from the same metadata pool.

## Validation

HTTP blackbox suites cover registry operations, compatibility, authorization,
guards and mapping selection. PostgreSQL integration covers copy fidelity,
idempotency, concurrency and the old executor's SQL. Persistence and purge tests
exercise the new registry. CI requires the database suite and existing LLM and
embedding regressions; database execution remains pending in the maker sandbox.
