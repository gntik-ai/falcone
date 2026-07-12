/**
 * @in-falcone/mcp-server-sdk — public surface (change: add-mcp-server-sdk, #401).
 * Write a tenant-scoped MCP tool against Falcone in a few lines, over the official MCP SDK.
 */
export { createFalconeContext } from './context.mjs';
export { createFalconeMcpServer, defineFalconeTool } from './server.mjs';
