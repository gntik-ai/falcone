## 1. CLI harness

- [x] 1.1 New package `apps/cli` (`@in-falcone/cli`, type module, `bin: falcone`); `pnpm-lock.yaml` importer entry committed (frozen-lockfile safe)
- [x] 1.2 `src/cli.mjs`: `parseArgs` (positionals + `--key value`/`--key=value`/boolean), `dispatch(parsed, handlers)` over injected handlers, `USAGE`, `CliError(exitCode)`
- [x] 1.3 `bin/falcone.mjs`: thin I/O wiring (argv → resolveContext → dispatch → fs/fetch/stdout)

## 2. mcp commands (pure)

- [x] 2.1 `src/mcp/scaffold.mjs` `scaffoldServer({lang,name})` → runnable TS/Python/Go server file map + run command; unsupported lang → CliError(2); name sanitized
- [x] 2.2 `src/mcp/dev.mjs` `buildDevPlan({context,port})` → run + tunnel + Inspector plan bound to the credential tenant/workspace
- [x] 2.3 `src/mcp/deploy.mjs` `buildDeployRequest({context,image|source})` → workspace-scoped `POST /v1/mcp/workspaces/{ws}/servers` + bearer auth (path from context, never args); `formatDeployResult`
- [x] 2.4 `src/context.mjs` `resolveContext({env,flags})` — token+tenant required; `--tenant` mismatch refused (no cross-tenant, exit 4); workspace from flag/env; `authHeaders` / `requireWorkspace`

## 3. Verify

- [x] 3.1 Unit tests (18): parseArgs/dispatch, context (auth required, cross-tenant refused, workspace), scaffold (ts/python/go + reject), dev plan, deploy request (workspace-scoped, image XOR source) + result formatting
- [x] 3.2 Bin smoke test: `--help`, `init ts` writes files, `deploy` without creds → exit 3, `--tenant other` → exit 4
- [x] 3.3 `pnpm lint` (new package doesn't break validate:repo) + `openspec validate --strict` pass

## 4. Finalize

- [x] 4.1 Note: `init` scaffolds against the upstream MCP SDK today; the Falcone Server SDK (#401) import is a one-line swap. `login` UX + real tunnel/Inspector spawning + live deploy network call are thin wiring over the tested plans (follow-ups).
