## Why

**Instant MCP** is the differentiator: with a toggle, a tenant's existing backend becomes an MCP server — its database schema, functions, storage and events turned into agent tools, with no hand-written server. This is the "PostgREST moment" for MCP. The hard-won lesson from teams running many production servers is that **auto-generated tools from a raw schema/API perform poorly with LLMs** — so generation is **generation + a mandatory curation layer (#393)**, never a raw dump. This change delivers the **generators** and the **draft manifest** they feed into curation. It resolves issue **#392** (epic #386); feeds #393 (curation), and rides the runtime (#388), gateway (#389), OAuth (#390) and the executor's RLS-bound data path (ADR-1/ADR-4).

## What Changes

- **Extensible per-resource generators** (a registry keyed by resource type), each producing draft MCP tools from a tenant resource description:
  - **PostgreSQL schema → query tools**: per table, a read `query_<table>` (filterable) and a mutating `insert_<table>`, with an input schema derived from the columns; targets the **RLS-bound data API** (`/v1/postgres/workspaces/{ws}/data/{db}/schemas/{schema}/tables/{table}`).
  - **Functions → action tools**: per function, `invoke_<fn>` → `/v1/functions/{id}/invoke`.
  - **Storage → object tools**: get / put / delete objects → `/v1/objects/{bucket}/{key}`.
  - **Events → pub/sub tools**: `publish_event` / `subscribe_events` → `/v1/events/publish` · `/v1/events/subscribe`.
- A dispatcher `generateInstantManifest(serverId, resources)` → a **draft manifest** `{ status: 'draft', requiresCuration: true, tools: [...] }`. Each tool carries an LLM-oriented description, input schema, `mutates`, a **suggested** per-tool scope, and its `source` resource.
- **Never auto-publishes**: the manifest is always a draft that must pass curation (#393) before any tool is served. Generation is deterministic and idempotent (re-running on the same resources yields the same manifest, diffable against the curated set).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `mcp`: add Instant-MCP generation requirements — generate a **draft** tool manifest from tenant resources (DB schema, functions, storage, events) via extensible generators; generated tools map to RLS-bound, tenant-scoped operations; nothing is published without curation. Builds on the foundational `mcp` capability (#387).

## Impact

- **Control-plane:** generator modules + tests in `apps/control-plane/src/` (co-located; extractable later). Pure functions — execution of the generated tools rides the existing executor (RLS-bound, ADR-1/ADR-4).
- **Out of scope:** the curation UX + publish gate (#393); hosting/connecting (#388/#389/#397); custom servers (#394). The generated query tools' *execution* (already RLS-bound via the executor) is not re-implemented here.
