import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { parse } from 'yaml'

test('the app typechecks, rejects a src type error, and builds assets under each supported base', () => {
  const cwd = resolve('apps/web-console-next')
  const run = (tool, args, env = {}) => spawnSync(process.execPath, [
    resolve(cwd, tool), ...args
  ], { cwd, encoding: 'utf8', env: { ...process.env, ...env } })
  const typecheck = () => run('node_modules/typescript/bin/tsc', ['--noEmit'])
  const clean = typecheck()
  assert.equal(clean.status, 0, clean.stdout + clean.stderr)
  const negative = resolve(cwd, `src/typecheck-negative-${process.pid}.ts`)
  try {
    writeFileSync(negative, 'export const deliberatelyInvalid: number = "invalid"\n')
    const rejected = typecheck()
    assert.equal(rejected.status, 2, rejected.stdout + rejected.stderr)
  } finally {
    rmSync(negative, { force: true })
  }
  for (const base of ['/next/', '/']) {
    const built = run('node_modules/vite/bin/vite.js', ['build'], { VITE_BASE_PATH: base })
    assert.equal(built.status, 0, built.stdout + built.stderr)
    const html = readFileSync(resolve(cwd, 'dist/index.html'), 'utf8')
    const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
      .map(match => match[1]).filter(url => url.includes('/assets/'))
    assert.ok(assets.length >= 2, 'the entry script and stylesheet must be emitted')
    for (const url of assets) assert.ok(url.startsWith(`${base}assets/`), `${url} must use ${base}`)
  }
})

test('the PR job preserves read-only permissions and covers both apps and build bases', () => {
  const workflow = parse(readFileSync('.github/workflows/ci.yml', 'utf8'))
  assert.deepEqual(workflow.permissions, { contents: 'read' })
  const job = workflow.jobs['web-console-next']
  assert.ok(job, 'the new job must exist')
  assert.equal(job.if, undefined, 'the job must run on every PR')
  assert.equal(job.permissions, undefined, 'the job must inherit read-only permissions')
  const commands = job.steps.map(step => step.run ?? '').join('\n')
  for (const command of [
    'pnpm install --frozen-lockfile',
    'node scripts/validate-gntik-ui-pin.mjs',
    'pnpm --filter @in-falcone/web-console-next lint:colors',
    'pnpm --filter @in-falcone/web-console-next typecheck',
    'pnpm --filter @in-falcone/web-console-next test',
    'pnpm --filter @in-falcone/web-console-next build',
    'node --test tests/unit/web-console-next-build.test.mjs',
    'pnpm --filter @in-falcone/web-console exec vite build',
    'docker build -f apps/web-console/Dockerfile .'
  ]) assert.ok(commands.includes(command), `the job must run ${command}`)
  assert.match(commands, /for base in \/next\/ \//)
  assert.match(commands, /VITE_BASE_PATH="\$base"/)
  const jobText = JSON.stringify(job)
  assert.doesNotMatch(jobText, /secrets\./)
  assert.ok(!jobText.includes(['NODE', 'AUTH', 'TOKEN'].join('_')))
  assert.ok(!jobText.includes(['npm', 'pkg', 'github', 'com'].join('.')))
  assert.ok(Object.hasOwn(workflow.on, 'pull_request'))
})
