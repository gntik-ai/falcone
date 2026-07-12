/**
 * `falcone mcp init <lang>` — scaffold a runnable MCP server (change: add-mcp-cli, #400).
 *
 * Pure generation of a per-language MCP server skeleton (TypeScript / Python / Go) using each
 * ecosystem's MCP SDK. Returns a { path: content } file map + the run command; the command writes
 * the files. The Falcone Server SDK (#401) drops in as the import once it ships — noted in each
 * template so the scaffold is runnable today against the upstream MCP SDK.
 */

import { CliError } from '../cli.mjs';

const LANGS = new Set(['ts', 'python', 'go']);

function sanitizeName(name) {
  const slug = String(name ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'mcp-server';
}

const TS_SERVER = (name) => `// ${name} — Falcone-hosted MCP server (scaffolded by \`falcone mcp init ts\`).
// Swap @modelcontextprotocol/sdk for @in-falcone/mcp-server-sdk (#401) when available.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from 'node:http';

const server = new McpServer({ name: '${name}', version: '0.1.0' });

server.tool('ping', 'Health check', {}, async () => ({ content: [{ type: 'text', text: 'pong' }] }));

const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
await server.connect(transport);
createServer((req, res) => transport.handleRequest(req, res)).listen(Number(process.env.PORT) || 8080);
`;

const TS_PKG = (name) => JSON.stringify({
  name, version: '0.1.0', private: true, type: 'module',
  scripts: { start: 'node server.mjs' },
  dependencies: { '@modelcontextprotocol/sdk': '^1.0.0' },
}, null, 2) + '\n';

const PY_SERVER = (name) => `# ${name} — Falcone-hosted MCP server (scaffolded by \`falcone mcp init python\`).
# Swap mcp for the Falcone Server SDK (#401) when available.
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("${name}")


@mcp.tool()
def ping() -> str:
    """Health check."""
    return "pong"


if __name__ == "__main__":
    mcp.run(transport="streamable-http")
`;

const PY_REQS = '# Falcone MCP server (#400)\nmcp>=1.0.0\n';

const GO_SERVER = (name) => `// ${name} — Falcone-hosted MCP server (scaffolded by \`falcone mcp init go\`).
// Swap the upstream SDK for the Falcone Server SDK (#401) when available.
package main

import (
	"context"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func main() {
	server := mcp.NewServer(&mcp.Implementation{Name: "${name}", Version: "0.1.0"}, nil)
	mcp.AddTool(server, &mcp.Tool{Name: "ping", Description: "Health check"},
		func(ctx context.Context, req *mcp.CallToolRequest, args struct{}) (*mcp.CallToolResult, any, error) {
			return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: "pong"}}}, nil, nil
		})
	_ = server.Run(context.Background(), &mcp.StreamableHTTPTransport{})
}
`;

const GO_MOD = (name) => `module ${name}\n\ngo 1.23\n\nrequire github.com/modelcontextprotocol/go-sdk v0.2.0\n`;

const README = (name, lang) => `# ${name}

Falcone-hosted MCP server scaffolded with \`falcone mcp init ${lang}\`.

Run it locally with \`falcone mcp dev\`, then \`falcone mcp deploy\` to host it on Falcone.
`;

/**
 * Scaffold a runnable MCP server for the given language.
 * @param {{ lang:string, name?:string }} input
 * @returns {{ lang:string, name:string, files:Record<string,string>, runCommand:string }}
 */
export function scaffoldServer({ lang, name } = {}) {
  if (!LANGS.has(lang)) {
    throw new CliError(`Unsupported language "${lang ?? ''}". Use one of: ts, python, go.`, 2);
  }
  const serverName = sanitizeName(name ?? lang + '-mcp-server');
  if (lang === 'ts') {
    return {
      lang, name: serverName, runCommand: 'npm install && npm start',
      files: { 'server.mjs': TS_SERVER(serverName), 'package.json': TS_PKG(serverName), 'README.md': README(serverName, lang) },
    };
  }
  if (lang === 'python') {
    return {
      lang, name: serverName, runCommand: 'pip install -r requirements.txt && python server.py',
      files: { 'server.py': PY_SERVER(serverName), 'requirements.txt': PY_REQS, 'README.md': README(serverName, lang) },
    };
  }
  return {
    lang, name: serverName, runCommand: 'go mod tidy && go run .',
    files: { 'main.go': GO_SERVER(serverName), 'go.mod': GO_MOD(serverName), 'README.md': README(serverName, lang) },
  };
}
