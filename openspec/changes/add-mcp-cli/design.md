## Context

There is no Falcone CLI yet. The monorepo is a pnpm workspace (`apps/*`, `services/*`); a new package under `apps/` joins the workspace automatically. The CLI must be thin and testable: the CI test scripts glob `tests/{unit,adapters,contracts}` (not package co-located tests), so the command logic lives in pure modules verified with `node --test` locally, mirroring the control-plane convention.

## Goals / Non-Goals

**Goals:** a `falcone` bin with an extensible group/command dispatcher; pure, unit-tested `init`/`dev`/`deploy` logic; credential-derived tenancy with a hard no-cross-tenant guard.

**Non-Goals:** the Falcone Server SDK itself (#401 — `init` uses the upstream MCP SDK today and notes the swap); a production tunnel/Inspector implementation (the plan is built + tested, spawning is thin wiring); a CLI for non-mcp capabilities.

## Decisions

- **Pure core, thin bin.** `parseArgs` + `dispatch(parsed, handlers)` are pure; `scaffoldServer`, `buildDevPlan`, `buildDeployRequest`/`formatDeployResult`, `resolveContext` are pure. `bin/falcone.mjs` only does argv/fs/fetch/stdout. This keeps every acceptance criterion unit-testable without a network or a cluster.
- **Tenancy is credential-fixed.** `resolveContext` reads `FALCONE_TOKEN`/`FALCONE_TENANT`; a `--tenant` flag may only echo the credential's tenant (else refused, exit 4). Deploy/dev requests derive the workspace path from the resolved context, never from arguments — so the CLI cannot construct a cross-tenant request.
- **Deploy rides the workspace-scoped management route.** `POST /v1/mcp/workspaces/{workspaceId}/servers` with a bearer token, mirroring the gateway's workspace-scoped MCP routing (#389) and the custom-hosting deploy (#394).
- **Scaffolds are runnable today.** TS/Python/Go templates use the upstream MCP SDK (Streamable HTTP / FastMCP / go-sdk) with a `ping` tool, so `init` output runs immediately; the Falcone Server SDK import (#401) is a one-line swap noted in each file.
- **Exit codes.** Usage/unknown command = 2, not-authenticated/missing-workspace = 3, cross-tenant = 4 — distinct, testable, scriptable.

## Risks / Trade-offs

- *Server SDK not yet available (#401)* → scaffold against the upstream MCP SDK now; swap the import when #401 lands. The scaffold stays runnable in the meantime.
- *Package tests not run by CI* → verified locally with `node --test`; consistent with the control-plane co-located convention. The lockfile importer entry is committed so `--frozen-lockfile` stays green.

## Migration Plan

Additive: a new `apps/cli` package + the `pnpm-lock.yaml` importer entry. Nothing else changes; no other package depends on it yet.

## Open Questions

- Login UX (device-code vs. token paste) and where credentials persist — currently env-based (`FALCONE_TOKEN`/`FALCONE_TENANT`); a `falcone login` is a follow-up.
- Whether `dev`'s tunnel uses the gateway's existing ingress or a dedicated dev tunnel.
