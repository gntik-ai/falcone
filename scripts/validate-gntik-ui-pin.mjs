import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const pins = {
  '@gntik-ai/ui': '0.5.0',
  '@gntik-ai/blocks': '0.5.0',
  '@gntik-ai/templates': '0.5.0',
  '@gntik-ai/tokens': '0.2.1'
}

try {
  const args = process.argv.slice(2)
  if (args.length && (args.length !== 2 || args[0] !== '--root')) {
    throw new Error('Usage: node scripts/validate-gntik-ui-pin.mjs [--root directory]')
  }
  const root = args[1] ?? fileURLToPath(new URL('../', import.meta.url))
  const manifest = JSON.parse(readFileSync(resolve(root, 'apps/web-console-next/package.json'), 'utf8'))
  const lock = parse(readFileSync(resolve(root, 'pnpm-lock.yaml'), 'utf8'))
  const importer = lock.importers?.['apps/web-console-next']?.dependencies
  for (const [name, expected] of Object.entries(pins)) {
    const entry = importer?.[name]
    if (manifest.dependencies?.[name] !== expected || entry?.specifier !== expected ||
        String(entry?.version).split('(')[0] !== expected) {
      throw new Error(`${name} must be exactly ${expected} in the manifest and lockfile importer`)
    }
  }
  console.log('gntik-ui pins match the manifest and lockfile')
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
