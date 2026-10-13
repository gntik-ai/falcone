import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import test from 'node:test'

test('colour lint rejects literal hex and raw palette fixtures while accepting semantic tokens', () => {
  const lint = (fixture) => spawnSync(process.execPath, [
    resolve('apps/web-console-next/scripts/lint-colors.mjs'),
    resolve(`tests/unit/fixtures/web-console-next/${fixture}`)
  ], { encoding: 'utf8' })
  assert.equal(lint('semantic.tsx').status, 0, 'semantic tokens must pass')
  assert.equal(lint('hex.css').status, 1, 'hex colours must fail')
  assert.equal(lint('palette.tsx').status, 1, 'raw palette classes must fail')
})
