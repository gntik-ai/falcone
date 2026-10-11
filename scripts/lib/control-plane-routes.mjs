import { Worker } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { routes as seedRoutes } from '../../apps/control-plane/routes.mjs';
import { loadRoutes, matchRoute } from '../../apps/control-plane/route-table.mjs';
import { SUPPORTED_INVOKES } from '../../apps/control-plane/route-invoke.mjs';

const root = new URL('../../', import.meta.url);
// Empty environment keeps export inspection independent of live DB/Kafka/Vault
// configuration and prevents import-time backend initialization using credentials.
async function importExportTypes(url) {
  const source = `
    import { parentPort, workerData } from 'node:worker_threads';
    try {
      const module = await import(workerData);
      const functions = [];
      for (const [name, value] of Object.entries(module)) {
        if (typeof value === 'function') functions.push(name);
        else if (value && typeof value === 'object') {
          for (const [key, member] of Object.entries(value)) {
            if (typeof member === 'function') functions.push(name + '.' + key);
          }
        }
      }
      parentPort.postMessage({ functions });
    } catch (error) {
      parentPort.postMessage({ error: { code: error.code, message: error.message } });
    }
  `;
  const result = await new Promise((resolve, reject) => {
    const worker = new Worker(source, { eval: true, env: {}, execArgv: ['--input-type=module'], workerData: url });
    worker.once('message', message => { resolve(message); void worker.terminate(); });
    worker.once('error', reject);
    worker.once('exit', code => reject(new Error(`Export inspection worker exited ${code} before reporting exports`)));
  });
  if (result.error) throw Object.assign(new Error(result.error.message), { code: result.error.code });
  return new Set(result.functions);
}
export async function readRouteReconciliationInputs() {
  const readJson = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));
  return {
    catalog: await readJson('apps/control-plane/route-map.json'),
    runtime: await readJson('apps/control-plane/route-map.runtime.json'),
    allowlist: await readJson('apps/control-plane/route-map.allowlist.json')
  };
}

// Uses exactly the server's seed precedence and URL matcher. Importing modules
// inspects exports only: no server bootstrap, pools, connections or credentials.
export async function collectRouteCatalogViolations({ catalog, runtime, seed = seedRoutes, allowlist = [], checkExports = true } = {}) {
  const table = loadRoutes(runtime, seed);
  const errors = [];
  const resolveRoute = entry => typeof entry.path === 'string'
    ? matchRoute(table, entry.method, entry.path.replace(/\{\w+\}/g, 'catalog-probe'))?.route : null;
  const key = entry => `${entry.method} ${entry.path}`;
  const exclusions = new Set();
  for (const entry of allowlist) {
    if (!entry.method || !entry.path || !entry.reason?.trim() || !/#\d+|https:\/\/github\.com\/.+\/issues\/\d+/.test(entry.issue ?? '')) {
      errors.push(`${key(entry)} invalid allowlist entry: method, path, reason and issue reference are required`);
    }
    if (exclusions.has(key(entry))) errors.push(`${key(entry)} duplicate allowlist entry`);
    exclusions.add(key(entry));
    if (!catalog.some(route => key(route) === key(entry))) errors.push(`${key(entry)} allowlist route is absent from the catalog`);
    if (resolveRoute(entry)) errors.push(`${key(entry)} allowlist route is already wired`);
  }
  const moduleCache = new Map();
  const inspect = async (entry, module, name) => {
    const relativePath = module.replace(/^\/repo\//, '');
    const url = module.startsWith('/repo/') || !module.startsWith('/')
      ? new URL(relativePath, root).href : pathToFileURL(resolve(module)).href;
    try {
      if (!moduleCache.has(url)) moduleCache.set(url, importExportTypes(url));
      const functions = await moduleCache.get(url);
      if (!functions.has(name)) errors.push(`${key(entry)} export ${name} is not a function in ${module}`);
    } catch (error) {
      // Missing installed dependencies are an environment limit for local tests;
      // the build and CI (with installed dependencies) must run this check in full.
      if (error.code === 'ERR_MODULE_NOT_FOUND' && /Cannot find package /.test(error.message)) throw error;
      errors.push(`${key(entry)} cannot import ${module}: ${error.code ?? error.name}`);
    }
  };
  for (const entry of catalog) {
    if (!entry.method || !entry.path || !entry.module || entry.module === 'NONE' || exclusions.has(key(entry))) continue;
    const route = resolveRoute(entry);
    if (!route) { errors.push(`${key(entry)} missing runtime route`); continue; }
    const invoke = route.invoke ?? (route.localHandler ? 'ctx' : 'callercontext-overrides');
    if (!(SUPPORTED_INVOKES.has(invoke) || (invoke === 'ctx' && route.localHandler))) errors.push(`${key(entry)} unsupported invoke ${invoke}`);
    const module = route.localHandler ? 'apps/control-plane/b-handlers.mjs' : route.module;
    const name = route.localHandler ? `LOCAL_HANDLERS.${route.localHandler}` : route.export;
    if (entry.module.replace(/^\/repo\//, '') !== module?.replace(/^\/repo\//, '') || entry.export !== name || (entry.invoke === 'localHandler' && route.localHandler ? 'ctx' : entry.invoke) !== invoke) {
      errors.push(`${key(entry)} catalog module/export/invoke differs from the effective runtime route`);
    }
    if (checkExports) {
      await inspect(entry, entry.module, entry.export);
      if (module !== entry.module || name !== entry.export) await inspect(entry, module, name);
    }
  }
  return errors;
}
