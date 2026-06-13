/**
 * Falcone CLI argument parsing + dispatch (change: add-mcp-cli, #400; epic #386).
 *
 * Bootstraps a minimal CLI harness scoped to the `mcp` command group (init / dev / deploy),
 * extensible to other capabilities later. Pure parsing + a dispatch table over injected handlers,
 * so the command logic is unit-testable without spawning processes or making network calls.
 */

/**
 * Parse argv (without node + script) into a structured command.
 * Supports `--key value`, `--key=value`, and boolean `--flag`.
 * @param {string[]} argv
 * @returns {{ group:string|null, command:string|null, positionals:string[], flags:Record<string,string|boolean> }}
 */
export function parseArgs(argv = []) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const body = token.slice(2);
      const eq = body.indexOf('=');
      if (eq >= 0) {
        flags[body.slice(0, eq)] = body.slice(eq + 1);
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        flags[body] = argv[++i];
      } else {
        flags[body] = true;
      }
    } else {
      positionals.push(token);
    }
  }
  const [group = null, command = null, ...rest] = positionals;
  return { group, command, positionals: rest, flags };
}

export const USAGE = `falcone — Falcone CLI

Usage:
  falcone mcp init <ts|python|go> --name <server>   Scaffold a runnable MCP server
  falcone mcp dev [--port <n>]                       Run locally with a tunnel + MCP Inspector
  falcone mcp deploy (--image <ref> | --source <dir>) Deploy to the runtime and print the endpoint

Global:
  --workspace <id>   Target workspace (within your credential's tenant)
  --help             Show this help
`;

/**
 * Dispatch a parsed command to the matching handler. Handlers are injected (DI) so the dispatcher
 * is pure and testable; the bin entry wires the real handlers.
 * @param {ReturnType<typeof parseArgs>} parsed
 * @param {{ mcp: Record<string, Function> }} handlers
 */
export async function dispatch(parsed, handlers = {}) {
  const { group, command, flags } = parsed;
  if (flags.help || !group) return { ok: true, output: USAGE };
  const groupHandlers = handlers[group];
  if (!groupHandlers) throw new CliError(`Unknown command group "${group}".`, 2);
  const handler = command ? groupHandlers[command] : null;
  if (!handler) throw new CliError(`Unknown command "${group} ${command ?? ''}".`, 2);
  return handler(parsed);
}

export class CliError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
  }
}
