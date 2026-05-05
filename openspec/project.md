# In Falcone — project context (OpenSpec)

> Edit this file once with your real values; it is the agent's anchor
> for "what is this project" across every prompt.

## Identity

In Falcone is a self-hosted, multi-tenant Backend-as-a-Service (BaaS)
platform deployed via a single Helm chart on Kubernetes or OpenShift.

## Repository entry points

| Concern | Path |
| ------- | ---- |
| Public API contract | `apps/control-plane/openapi/` |
| Web console (frontend) | `apps/web-console/` |
| Control plane backend | `apps/control-plane/` |
| Provisioning saga | `services/provisioning-orchestrator/` |
| API gateway config | `services/gateway-config/` |
| Identity provider config | `services/keycloak-config/` |
| Helm umbrella chart | `charts/in-falcone/` |
| Architecture decisions | `docs/adr/` |
| Legacy SpecKit user stories | `docs/tasks/` *(historical only)* |
| Existing tests | `tests/` (root) and `apps/web-console/e2e/` |

## Stack baseline

- Node.js 20+ ESM, pnpm workspaces
- React 18 + Vite + Tailwind (web-console)
- PostgreSQL, MongoDB, Kafka, OpenWhisk, S3-compatible
- Keycloak for identity (two-realm tier)
- APISIX as gateway
- External Secrets Operator + Vault for secret distribution

## Sources of truth

| Type | Path | Purpose |
| ---- | ---- | ------- |
| Capability spec | `openspec/specs/` | What the platform does today |
| Change proposal | `openspec/changes/` | What we're changing next |
| ADR | `docs/adr/` | Why an architectural decision was made |

The legacy `docs/tasks/us-*.md` files are historical context. Capability
specs reference them via `Trace.` links but do not inherit from them.

## Validators that must remain green

```bash
corepack pnpm validate:repo
corepack pnpm lint
corepack pnpm test:unit
```

The full validator list is in the root `package.json` under `scripts`.

## Output language

All artefacts in `openspec/` (specs, change proposals, archived
proposals) are written in **English**, regardless of the language the
prompt or the human conversation uses.
