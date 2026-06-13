# MCP Server Hosting

**MCP (Model Context Protocol) hosting** lets a tenant expose its Falcone backend to AI agents as
**tools**: an agent (Cursor, Claude Code, claude.ai, VS Code, …) connects to your hosted MCP server
over **Streamable HTTP**, authenticates with **OAuth 2.1**, and calls curated tools that read and
write *your* data — automatically scoped to your tenant.

This page is the tenant/developer guide. For how it works internally see
[MCP Architecture](/architecture/mcp); for deploy/operate see the
[MCP Runbook](/architecture/mcp-runbook); for the decision record see
[ADR-12](/architecture/adrs#adr-12-mcp-server-hosting-runtime-gateway-oauth-and-isolation).

::: warning Status — active development
MCP hosting is built as a complete set of curation, registry, OAuth, quota, observability and SDK
components (epic #386) with a real-stack E2E suite. The control-plane HTTP routes that serve the
management API live are the remaining integration step — see the
[Roadmap](/guide/roadmap) and the [MCP Architecture](/architecture/mcp#status-and-maturity) status
note. The shapes below are the intended, code-grounded product surface.
:::

## Three ways to get a server

| Source | What it is | Built on |
| --- | --- | --- |
| **Instant MCP** | Generate tools from an existing resource (a Postgres schema, a function, a bucket, an events topic) | `mcp-instant-generator` |
| **Custom (bring-your-own)** | Host your own container image as an MCP server | `mcp-custom-hosting` |
| **Official** | Falcone's curated, read-first platform tools | `mcp-official-catalog` / `mcp-official-server` |

Every source produces a **draft** tool set that must pass **curation** before it can serve traffic
— Instant MCP never publishes a raw dump.

## Mandatory curation

Auto-generated tools degrade an agent's tool-call quality, so a draft tool set passes a
**curation gate** before it is connectable:

- **Enable/disable** tools, **rewrite descriptions** for the LLM, and **assign a scope** to each
  mutating tool.
- **Publish** is refused unless every enabled mutating tool has a scope and at least one tool is
  enabled.
- Only a **published** manifest is connectable — a draft or un-published curated set is never served.

Best practice: keep the surface small, give each tool a one-line description of *when* to use it,
and gate every write behind an explicit scope.

## Connecting a client

Open the **Connect** tab on the server detail page in the console for one-click and copy-paste
configs. Transport is **Streamable HTTP**; authentication is the per-tenant **OAuth 2.1** flow —
**no static secret** is embedded in any config.

**Add to Cursor** (one click):

```
cursor://anysphere.cursor-deeplink/mcp/install?name=<server>&config=<base64 of {"url":"<endpoint>"}>
```

**Claude Code** — `.mcp.json`:

```json
{ "mcpServers": { "<server>": { "type": "http", "url": "<endpoint>" } } }
```

**VS Code** — `.vscode/mcp.json`:

```json
{ "servers": { "<server>": { "type": "http", "url": "<endpoint>" } } }
```

**claude.ai** — add a **custom connector** in Settings → Connectors and paste the server's remote
URL.

You can also **try a tool before connecting** in the console **Playground**: pick a tool, supply
JSON arguments, and invoke it through the OAuth flow to see the structured result.

## Writing a tool — the Server SDK

The `@in-falcone/mcp-server-sdk` wraps the official MCP SDK and injects a tenant-scoped `ctx` so a
tool reads or writes your data in a few lines, already RLS-bound:

```js
import { createFalconeMcpServer, defineFalconeTool } from '@in-falcone/mcp-server-sdk'

const falcone = createFalconeMcpServer({ mcpServer, resolveTenant, call })

falcone.tool(defineFalconeTool({
  name: 'list_orders',
  description: 'List the tenant orders',
  handler: async (args, ctx) => ctx.db.select('orders', { status: args.status }),
}))
```

`ctx` exposes `db`, `storage`, `functions`, and `events`, pre-bound to the tenant/workspace resolved
from the **verified credential** — there is no API to widen or change that scope, so a tool cannot
reach another tenant. A Python (FastMCP) reference mirrors the same contract.

## The CLI

The `falcone` CLI bootstraps a local dev loop for custom servers:

```sh
falcone mcp init ts --name my-server     # scaffold a runnable MCP server (ts | python | go)
falcone mcp dev                          # run locally + tunnel + MCP Inspector, scoped to your tenant
falcone mcp deploy --image <ref>         # deploy to the runtime and print the endpoint
```

The CLI authenticates with your Falcone credential; the tenant is fixed by that credential and a
`--tenant` that disagrees is refused — you can never target another tenant.

## Flows as tools

A published **Flow** (durable Temporal workflow) can be exposed as a **long-running MCP tool**:
invoking it starts a flow execution and returns an MCP **Task** the agent polls to completion
(running → completed/failed/cancelled), reusing the flows executions API.

## Versioning & the "rug-pull" guard

Each server version is pinned by an **immutable image digest**. When a new version changes a tool's
**description or scope**, it is **held for review** and does not serve traffic until you approve it —
so a server cannot silently change behavior under your agents. You can **roll back** to any
previously approved version.

## Quotas, limits & cost

Per-tenant quotas cap **running servers** and **tools per server**; rate limits cap **tool calls per
minute** per server and per OAuth client (noisy-neighbor protection). Idle servers **scale to zero**
and cold-start on demand, so an unused server costs nothing. MCP tool-invocation volume appears in
your **quota posture** and the per-tenant **audit** trail.

## Isolation

Your server runs in your tenant's namespace, reachable only through the gateway; its egress is
constrained so it cannot reach another tenant's services. Server endpoint, tools, logs, and OAuth
credentials are all tenant-scoped — another tenant cannot see or reach them.
