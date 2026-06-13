#!/usr/bin/env node
/**
 * Falcone CLI entry (change: add-mcp-cli, #400). Thin I/O wiring over the pure command modules:
 * parse argv -> resolve credential context -> dispatch to the mcp handlers. All decisions live in
 * src/* (unit-tested); this file only does process/argv/fs/stdout side effects.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { parseArgs, dispatch, CliError } from '../src/cli.mjs';
import { resolveContext } from '../src/context.mjs';
import { scaffoldServer } from '../src/mcp/scaffold.mjs';
import { buildDevPlan } from '../src/mcp/dev.mjs';
import { buildDeployRequest, formatDeployResult } from '../src/mcp/deploy.mjs';

const handlers = {
  mcp: {
    async init({ positionals, flags }) {
      const lang = positionals[0];
      const { files, name, runCommand } = scaffoldServer({ lang, name: flags.name });
      const outDir = String(flags.out ?? name);
      for (const [rel, content] of Object.entries(files)) {
        const dest = join(outDir, rel);
        await mkdir(dirname(dest), { recursive: true });
        await writeFile(dest, content);
      }
      return { ok: true, output: `Scaffolded ${lang} MCP server "${name}" in ${outDir}/\n  run: (cd ${outDir} && ${runCommand})` };
    },
    async dev({ flags }) {
      const context = resolveContext({ env: process.env, flags });
      const plan = buildDevPlan({ context, port: flags.port ? Number(flags.port) : undefined });
      return {
        ok: true,
        output: `Dev loop for tenant ${plan.tunnel.tenantId} / workspace ${plan.tunnel.workspaceId}:\n` +
          `  run:       ${plan.run.command} (port ${plan.run.port})\n` +
          `  tunnel:    local ${plan.tunnel.localPort} -> tenant ${plan.tunnel.tenantId}\n` +
          `  inspector: ${plan.inspector.url} -> ${plan.inspector.target}`,
      };
    },
    async deploy({ flags }) {
      const context = resolveContext({ env: process.env, flags });
      const request = buildDeployRequest({ context, image: flags.image, source: flags.source, name: flags.name });
      const res = await fetch(request.url, { method: request.method, headers: request.headers, body: JSON.stringify(request.body) });
      if (!res.ok) throw new CliError(`Deploy failed: ${res.status} ${res.statusText}`, 1);
      return { ok: true, output: formatDeployResult(await res.json().catch(() => ({}))) };
    },
  },
};

try {
  const result = await dispatch(parseArgs(process.argv.slice(2)), handlers);
  if (result?.output) process.stdout.write(result.output + '\n');
  process.exit(0);
} catch (err) {
  process.stderr.write(`${err.message}\n`);
  process.exit(err instanceof CliError ? err.exitCode : 1);
}
