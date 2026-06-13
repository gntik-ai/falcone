## Why

Custom-server authors need a local dev loop, and **no Falcone CLI exists today**. This issue (#400, epic #386) bootstraps a minimal CLI harness scoped to the `mcp` command group, extensible to other capabilities later.

## What Changes

- **New CLI package** `@in-falcone/cli` (`apps/cli`) with a `falcone` bin and an `mcp` command group:
  - **`init <ts|python|go>`** — scaffold a runnable MCP server per language (using each ecosystem's MCP SDK; the Falcone Server SDK from #401 drops in as the import when it ships).
  - **`dev`** — build the local run + tunnel + MCP Inspector plan, bound to the credential's tenant/workspace.
  - **`deploy`** — push an image or source to the runtime via the control-plane (#394 custom hosting) and print the endpoint.
- **Auth + tenancy:** the CLI authenticates with Falcone credentials; the tenant is fixed by the credential and a `--tenant` that disagrees is **refused** — the CLI can never target another tenant.
- **Testable core:** all decisions (arg parsing, scaffolding, dev/deploy planning, context resolution) are pure modules with unit tests; the bin entry is thin I/O (argv/fs/fetch/stdout).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `mcp`: add the **CLI** — `falcone mcp init / dev / deploy`, authenticated with Falcone credentials and scoped to the caller's tenant. Builds on the runtime (#388), custom hosting (#394), and the Server SDK (#401, deferred import).

## Impact

- **New package:** `apps/cli` (`@in-falcone/cli`): `bin/falcone.mjs` (thin) + `src/{cli,context}.mjs` + `src/mcp/{scaffold,dev,deploy}.mjs` + co-located tests. `pnpm-lock.yaml` gains the no-deps importer entry.
- **Out of scope:** a full CLI for all Falcone capabilities (this only establishes the harness + `mcp` group); the real tunnel/Inspector process spawning and the live deploy network call are thin wiring over the tested plans.
