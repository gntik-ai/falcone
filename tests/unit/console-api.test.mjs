// Run the same public-export scenarios as Vitest when workspace dependencies are unavailable.
// Node's TypeScript stripping is limited to this source package; no application aliases are used.
import { registerHooks, stripTypeScriptTypes } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const packageRoot = new URL('../../packages/console-api/', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('package.json', packageRoot), 'utf8'))
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === manifest.name || specifier.startsWith(`${manifest.name}/`)) {
      const subpath = specifier === manifest.name ? '.' : `.${specifier.slice(manifest.name.length)}`
      const target = manifest.exports[subpath]
      if (!target) throw new Error(`Unexported console-api subpath: ${subpath}`)
      return { url: new URL(target, packageRoot).href, shortCircuit: true }
    }
    if (specifier.startsWith('.') && context.parentURL?.startsWith(packageRoot.href)) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL)
      if (existsSync(candidate)) return { url: candidate.href, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url.startsWith(packageRoot.href) && url.endsWith('.ts')) {
      return {
        format: 'module',
        source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), { mode: 'strip', sourceUrl: url }),
        shortCircuit: true
      }
    }
    return nextLoad(url, context)
  }
})

const { httpCases } = await import('../../packages/console-api/tests/cases/http.mjs')
for (const [name, run] of httpCases) test(name, run)

function browserWindow() {
  const target = new EventTarget()
  const storage = new Map()
  target.sessionStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key),
    clear: () => storage.clear()
  }
  return target
}
const { sessionCases } = await import('../../packages/console-api/tests/cases/session.mjs')
for (const [name, run] of sessionCases) test(name, async () => {
  globalThis.window = browserWindow()
  try { await run() } finally { delete globalThis.window }
})

const { loaderCases } = await import('../../packages/console-api/tests/cases/loaders.mjs')
for (const [name, run] of loaderCases) test(name, async () => {
  globalThis.window = browserWindow()
  try { await run() } finally { delete globalThis.window }
})

const { fixtureCases } = await import('../../packages/console-api/tests/cases/fixtures.mjs')
for (const [name, run] of fixtureCases) test(name, run)

const { coreCases } = await import('../../packages/console-api/tests/cases/core.mjs')
for (const [name, run] of coreCases) test(name, run)

const { clientCases } = await import('../../packages/console-api/tests/cases/clients.mjs')
for (const [name, run] of clientCases) test(name, async () => {
  globalThis.window = browserWindow()
  try { await run() } finally { delete globalThis.window }
})
