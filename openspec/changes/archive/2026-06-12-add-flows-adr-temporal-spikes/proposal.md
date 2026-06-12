## Why

Falcone has no durable workflow engine; the Temporal adoption decision and its two highest-risk assumptions — DSL interpreter durability and the tenancy model — are unvalidated and block the entire flows epic (#355). Recording the decision as an ADR and completing two targeted spikes converts assumptions into evidence before production code is written.

## What Changes

- A new ADR entry is appended to `docs-site/architecture/adrs.md` capturing: Temporal adoption rationale, TypeScript SDK choice (grounded in the Node 22 ESM stack across `apps/` and `services/`), chosen tenancy model, definition-passing strategy, expression engine selection (CEL vs JSONata), PostgreSQL SQL visibility decision, and internal/operator-only UI stance.
- Spike A: a prototype TypeScript DSL interpreter that parses a minimal YAML flow (3 nodes: branch + retry) and executes it against a local Temporal dev server, with a mid-run worker-kill/resume verification.
- Spike B: two tenancy model prototypes (namespace-per-tenant vs shared-namespace + search-attribute filtering) with worker-fleet/connection measurements and a documented comparison table.
- Spike code is parked under a clearly-marked directory (not in production paths).

## Capabilities

### New Capabilities

- `workflows`: Architecture decision record and de-risking spike outcomes for the Temporal-based durable workflow engine. This is the ADR + spike tier of the capability; production interpreter, Helm deploy, API, and tenancy enforcement are owned by sibling changes.

### Modified Capabilities

(none — no existing spec requirements change)

## Impact

- **Target file (deliverable, not read):** `docs-site/architecture/adrs.md` — ADR appended following existing numbered format.
- **Code evidence for SDK choice:** `apps/control-plane/Dockerfile` (FROM node:22-alpine), `apps/control-plane/package.json` (`"type":"module"`, `@in-falcone/control-plane`); all services under `services/` use `.mjs` modules with `"type":"module"` — no other backend language present.
- **Tenancy context evidence:** `services/adapters/src/tenant-rls-context.mjs::withTenantRlsContext`, `apps/control-plane/src/runtime/server.mjs::resolveIdentity` — establishes the `tenantId`/`workspaceId` propagation pattern that the tenancy spike must align with.
- **No production code changes** — spike artefacts are prototype-only and explicitly out of scope for production paths.
- **Blocks:** #357 (Helm), #358 (console), #359 (interpreter), #361, #362.
