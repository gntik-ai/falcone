import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('web-console CI runs the console-api tests as a required, failing step', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8')
  const job = workflow.split('\n  web-console:\n')[1].split('\n  web-console-next:\n')[0]
  const steps = job.split(/\n      - name: /)
  const packageStep = steps.find(step => step.includes('pnpm --filter @in-falcone/console-api test'))
  assert.ok(packageStep, 'The web-console job must run the shared API suite')
  assert.match(packageStep, /\n        run: pnpm --filter @in-falcone\/console-api test\s*$/)
  assert.doesNotMatch(packageStep, /continue-on-error|if:/)
  assert.doesNotMatch(steps[0], /continue-on-error/)
  assert.equal(steps.some(step => step.includes('pnpm --filter @in-falcone/web-console test')), false, 'the unserved legacy console no longer gates CI')
  const next = workflow.split('\n  web-console-next:\n')[1].split('\n  cutover-gate:\n')[0]
  assert.ok(next.split(/\n      - name: /).find(step => /\n        run: pnpm --filter @in-falcone\/web-console-next test\s*$/.test(step)),
    'the web-console-next job runs the console unit tests')
})
