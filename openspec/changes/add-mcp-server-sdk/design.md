## Context

MCP servers (#391/#392/#394) and the CLI scaffolds (#400) all need the same thing: a tool handler that can touch the tenant's data without re-implementing tenant scoping. The #387 context-injection model says the tenant is credential-derived and the core is stateless. This SDK packages that as a thin wrapper over the official MCP SDK.

## Goals / Non-Goals

**Goals:** a pure, unit-tested context injector (`db`/`storage`/`functions`/`events`) that forces the credential-bound tenant onto every call and cannot be escaped; an official-MCP-SDK wrapper that resolves the tenant per request and injects a fresh ctx; a TS reference plus a contract-matching Python module.

**Non-Goals:** the executor/data-plane transport (injected as `call`); generated data-API SDKs (`openapi-sdk-service`); curation/generation; a full Go SDK (follow-up).

## Decisions

- **Authoritative scope is the request envelope.** Each client call builds `{ capability, op, ...userData }` and `scoped()` forces `tenantId`/`workspaceId` from the binding on top, stripping any envelope-level override. The executor binds the query to that tenant via RLS. **User data (filter/row/payload) is passed through untouched** — a `tenant_id` column filter is just data and is harmless because RLS still binds to the credential's tenant. This is the correct boundary: sanitize the scope envelope, never corrupt user data.
- **Tenant from the verified request, never args.** `createFalconeMcpServer` calls the host's `resolveTenant(request)` (credential-derived) per invocation and builds the ctx — tool arguments never influence the scope. Stateless: a fresh ctx per call, no per-connection state (#387 tenet).
- **No escape API + frozen ctx.** The ctx and its clients are `Object.freeze`d; there is no `setTenant`/`withTenant`. A tool cannot swap a client or mutate the scope.
- **Duck-typed official-SDK wrapper.** `createFalconeMcpServer` accepts any object with `.tool(name, description, inputSchema, handler)` (the @modelcontextprotocol/sdk shape), so it works with the real SDK and is unit-testable with a fake server.
- **`.mjs` + JSDoc, node --test.** Matches the control-plane/CLI convention so the SDK is testable in the node path and consumable from TS/JS. Python mirrors the same contract over FastMCP (reference, verified by the shared design).

## Risks / Trade-offs

- *User data containing tenant-named fields* → intentionally preserved as data; isolation is enforced by the authoritative envelope + RLS, not by scrubbing user payloads (which would corrupt legitimate data). Tested explicitly.
- *Python not node-tested* → it mirrors the unit-tested TS contract; a Python test harness is a follow-up. TS is the authoritative reference.

## Migration Plan

Additive: a new package + the `pnpm-lock.yaml` importer entry. The CLI scaffolds (#400) and servers (#391/#392) swap to this import incrementally; nothing breaks today.

## Open Questions

- The exact `call` transport contract vs. the executor's data-API plan (`buildPostgresDataApiPlan`) — kept abstract here; the host wires it.
- A full Go SDK (the third official language) — follow-up.
