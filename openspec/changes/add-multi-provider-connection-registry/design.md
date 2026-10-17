# LLM connection registry design

## Decision 1: registry

`workspace_llm_connections` contains non-null text `tenant_id`, `workspace_id` and
`connection_id`; nullable text `display_name`, `provider_type`, `endpoint` and
`default_model`; `allowed_models jsonb NOT NULL DEFAULT '[]'`; nullable jsonb
`secret_ref`; `is_default boolean NOT NULL DEFAULT false`; and `created_at` and
`updated_at` timestamptz, non-null and defaulting to now(). The primary key is
`(tenant_id, workspace_id, connection_id)`. A partial unique index on
`(tenant_id, workspace_id) WHERE is_default` allows at most one default, and an
index on `workspace_id` supports the retained tenant-less read branch.

Connection identifiers match `^[a-z0-9][a-z0-9-]{0,62}$`. Each workspace holds at
most 32 connections. Public store writes and the legacy mirror use the same
transactional advisory lock per tenant/workspace. A before-insert registry trigger
also enforces the capacity constraint. Updates at capacity remain legal.
The in-memory store provides the same named-connection and default semantics.

Only config and `secretRef` are persisted. Resolved secrets are never stored or
returned. An empty model allow-list permits no model. Config writes run the
existing secret-reference and endpoint guards before touching storage.

Tenant purge deletes every registry connection before deleting legacy provider
rows. It does not rely on the mirror trigger, which deletes only the default.

## Decision 2: copy and rolling-update fence

Executor schema setup uses one transaction, first taking
`pg_advisory_xact_lock(hashtext('workspace_llm_connections'))`, then locking the
legacy `workspace_llm_providers` table in SHARE ROW EXCLUSIVE mode. It adds
`migrated_at`, creates the registry, copies unmigrated rows to `default` with
`is_default=true` and both timestamps taken from legacy `updated_at`, using
`ON CONFLICT DO NOTHING`, then marks rows migrated and installs the mirror trigger.
The lock briefly blocks legacy writes; the copy is a short set-based operation.
Repeated or concurrent setup copies once. Deleting a migrated connection does not
cause it to return on the next schema setup.

The BEFORE INSERT/UPDATE/DELETE legacy trigger mirrors config writes to the
current default, promotes an existing `default` row if there is no default, or
inserts `default` if absent. Only the last case checks capacity. Deletes remove
only the default; updates that change only `migrated_at` mirror nothing. New
executor code writes exclusively to the registry. The old table, its unique
constraint and the mirror trigger are retained for rollback compatibility.

Accepted rollout risk (operator, 2026-10-16): with two executor replicas rolling,
old replicas may briefly serve the default as it stood before edits made through
new replicas. Accepted rollback risk: an old image does not see edits made after
the upgrade. Old-image writes are still mirrored, so re-upgrading requires no data
repair. Retaining the old table and constraint preserves rollback safety.

## Decision 3: collection API and authorization

The collection is `/v1/workspaces/{workspaceId}/llm-providers`, with items at
`/{connectionId}`. GET lists by connectionId, POST creates, GET reads an item,
PUT replaces mutable fields and DELETE removes an item. Only POST creates.
The first connection becomes default; POST or PUT with `isDefault:true` moves
the default in the same transaction. PUT cannot clear the current default with
`isDefault:false`. Deleting a default leaves no default and promotes nothing.

Tenant identity comes exclusively from the verified caller. The existing
structural-write gate and workspace binding check apply to all three write
routes. Tenant owner/admin, platform admin and superadmin may write; workspace
owner/admin must be bound to the target workspace. Developer, viewer, no-role
and API-key callers are denied. Reads retain the singular route's identity rules.

The route expressions are end-anchored to keep singular and plural paths distinct.
The three write templates are catalogued as `structural_admin`. APISIX 2003-llm
already matches the plural paths; no deployment-repository change is needed.

## Decision 4: compatibility and worker reads

Singular PUT updates the default, otherwise promotes `default` or inserts it if
capacity allows. Singular GET returns the legacy shape plus `connectionId`, or
404 `LLM_PROVIDER_NOT_FOUND`. Singular DELETE retains `{ removed }` and removes
only the default. Completion and streaming without a selector use the default;
absence returns 422 `LLM_PROVIDER_MISSING` even if non-default connections exist.

A singular PUT without `displayName` preserves the existing connection's name,
including when promoting the `default` row. Named PUT still replaces mutable
fields. An unknown named PUT returns 404 regardless of identifier syntax, as do
GET and DELETE; identifier validation on POST still returns 400.

Worker `getProvider` performs no DDL. It selects the registry default, falling
back to the old single-row read only for SQLSTATE 42P01. Permission, connection
and other database errors propagate. An empty registry result never triggers a
legacy read. Existing branches without a tenant argument are retained.

## Validation

Blackbox tests exercise the real HTTP parser, dispatcher, authorization and
executor without listening sockets. Existing completion tests change only the
setup identity's role. A fake database boundary verifies fail-closed worker reads.
A dedicated PostgreSQL 17 integration suite uses the verbatim 7916f62 upsert SQL
and isolated schemas to verify copy fidelity, repeat setup, old-image writes,
capacity and concurrent schema/connection creation. CI requires that database
suite and runs all five LLM blackbox suites.
