import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

test('pin CLI accepts exact public pins and peer suffixes, and rejects missing, ranged or mismatched pins', () => {
  const root = mkdtempSync(join(tmpdir(), 'falcone-pins-'))
  const manifestPath = join(root, 'apps/web-console-next/package.json')
  const lockPath = join(root, 'pnpm-lock.yaml')
  const dependencies = {
    '@gntik-ai/ui': '0.5.0',
    '@gntik-ai/blocks': '0.5.0',
    '@gntik-ai/templates': '0.5.0',
    '@gntik-ai/tokens': '0.2.1'
  }
  const lock = `importers:
  apps/web-console-next:
    dependencies:
      '@gntik-ai/ui':
        specifier: 0.5.0
        version: 0.5.0(react@19.3.0)
      '@gntik-ai/blocks':
        specifier: 0.5.0
        version: 0.5.0
      '@gntik-ai/templates':
        specifier: 0.5.0
        version: 0.5.0
      '@gntik-ai/tokens':
        specifier: 0.2.1
        version: 0.2.1
`
  mkdirSync(join(root, 'apps/web-console-next'), { recursive: true })
  const run = (manifest = dependencies, lockfile = lock) => {
    writeFileSync(manifestPath, JSON.stringify({ dependencies: manifest }))
    writeFileSync(lockPath, lockfile)
    return spawnSync(process.execPath, [resolve('scripts/validate-gntik-ui-pin.mjs'), '--root', root], { encoding: 'utf8' })
  }
  try {
    assert.equal(run().status, 0, 'exact pins with a peer suffix must pass')
    for (const name of Object.keys(dependencies)) {
      assert.equal(run({ ...dependencies, [name]: '^0.5.0' }).status, 1, `${name} manifest range`)
      const removed = { ...dependencies }
      delete removed[name]
      assert.equal(run(removed).status, 1, `${name} missing from manifest`)
    }
    assert.equal(run(dependencies, lock.replace('specifier: 0.5.0', 'specifier: ^0.5.0')).status, 1)
    assert.equal(run(dependencies, lock.replace('version: 0.5.0(react@19.3.0)', 'version: 0.4.0(react@19.3.0)')).status, 1)
    assert.equal(run(dependencies, lock.replace(/      '@gntik-ai\/tokens':[\s\S]*$/, '')).status, 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
