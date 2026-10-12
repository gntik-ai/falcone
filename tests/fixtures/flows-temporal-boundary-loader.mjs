// Test adapter for external Temporal/CEL runtimes. All Falcone modules remain real.
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const workerRequire = createRequire(new URL('../../apps/workflow-worker/package.json', import.meta.url));
let typescript;
try { typescript = workerRequire('typescript'); } catch (err) {
  if (err.code !== 'MODULE_NOT_FOUND') throw err;
}
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@temporalio/activity' || specifier === '@temporalio/workflow') {
    return { url: new URL('./flows-temporal-boundary.mjs', import.meta.url).href, shortCircuit: true };
  }
  if (specifier === 'cel-js') {
    return { url: new URL('./flows-temporal-boundary.mjs', import.meta.url).href, shortCircuit: true };
  }
  if (specifier.startsWith('.') && context.parentURL?.endsWith('.ts')) {
    const candidate = new URL(`${specifier}.ts`, context.parentURL);
    if (existsSync(candidate)) return { url: candidate.href, shortCircuit: true };
    const index = new URL(`${specifier}/index.ts`, context.parentURL);
    if (existsSync(index)) return { url: index.href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
export async function load(url, context, nextLoad) {
  if (url.endsWith('.ts')) {
    if (typescript) {
      const { outputText } = typescript.transpileModule(readFileSync(new URL(url), 'utf8'), {
        compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ES2022 },
      });
      return { format: 'module', source: outputText, shortCircuit: true };
    }
    // The sandbox has Node 22's native stripping but no installed workspace dependencies.
    return nextLoad(url, { ...context, format: 'module-typescript' });
  }
  return nextLoad(url, context);
}
