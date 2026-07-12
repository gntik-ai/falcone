# @in-falcone/mcp-server-sdk

Tenant-scoped Falcone clients for MCP tools, over the official MCP SDKs. Write a tool that
reads/writes the tenant's data in a few lines — automatically scoped to the caller's tenant
(RLS-bound) with no way to escape that scope.

> **Status: Preview.** Part of [MCP server hosting](../../docs-site/guide/mcp.md) (Preview), under
> the platform's not-production-ready posture. The TypeScript module is the unit-tested reference;
> the Python module mirrors its contract.

## TypeScript / JavaScript (unit-tested reference)

```js
import { createFalconeMcpServer, defineFalconeTool } from '@in-falcone/mcp-server-sdk'

// `mcpServer` is an official MCP server (e.g. @modelcontextprotocol/sdk McpServer);
// `resolveTenant` derives the tenant from the VERIFIED request credential (never tool args);
// `call` is the executor/data-plane transport the host wires in.
const falcone = createFalconeMcpServer({ mcpServer, resolveTenant, call })

falcone.tool(defineFalconeTool({
  name: 'list_orders',
  description: 'List the tenant orders',
  handler: async (args, ctx) => ctx.db.select('orders', { status: args.status }),
}))
```

`ctx` exposes `db`, `storage`, `functions`, `events`, all pre-bound to the resolved
tenant/workspace. The bound scope is forced onto every call; user data (filter/row/payload) is
passed through untouched, and the executor binds the query to the tenant via RLS.

## Python (FastMCP, contract-matching reference)

See `python/falcone_mcp/` — `create_falcone_context` / `falcone_tool` mirror the same
tenant-injection contract over FastMCP. The TypeScript module is the unit-tested reference; the
Python module matches its contract.

## Guarantee

The tenant/workspace come from the verified credential, never from tool arguments, and there is no
API to widen or change the injected scope — a tool cannot reach another tenant.
