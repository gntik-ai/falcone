import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const root = resolve(import.meta.dirname, '../..')
const stack = join(root, 'tests/e2e/stack.sh')
const collector = join(root, 'tests/e2e/failure-diagnostics.mjs')
const postRenderer = join(root, 'tests/e2e/helm-temporal-postrenderer/render.sh')
const seeded = 'diagnostic-seeded-password'

function fixture(overrides = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'falcone-1051-'))
  const randomCredential = randomBytes(24).toString('hex')
  const unknownCredential = randomBytes(24).toString('hex')
  const dispatcher = join(directory, 'dispatch')
  writeFileSync(dispatcher, `#!${process.execPath}
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const args = process.argv.slice(2)
const command = path.basename(process.argv[1])
const text = args.join(' ')
const dir = process.env.BBX_DIR
fs.appendFileSync(path.join(dir, 'calls'), JSON.stringify({ command, args }) + '\\n')
function out(value) { fs.writeSync(1, value + '\\n') }
function manifest(kind, name) { return '---\\napiVersion: v1\\nkind: ' + kind + '\\nmetadata:\\n  name: ' + name + '\\n' }
if (command === 'helm') {
  if (args.includes('--help')) { out('      --atomic   roll back on failure'); process.exit(0) }
  if (args[0] === 'template') {
    const index = args.indexOf('-s')
    if (index < 0) {
      out(manifest('Job', 'falcone-temporal-schema') + manifest('Job', 'falcone-temporal-db-bootstrap') + manifest('ConfigMap', 'retained'))
    } else {
      const template = args[index + 1]
      const name = template.includes('db-bootstrap') ? 'falcone-temporal-db-bootstrap'
        : template.includes('schema-job') ? 'falcone-temporal-schema'
        : template.includes('temporal/bootstrap') ? 'falcone-temporal-bootstrap'
        : path.basename(template, '.yaml')
      out(manifest(template.includes('external-secrets/') ? 'ExternalSecret' : 'Job', name))
    }
  }
  if (args[0] === 'upgrade') {
    const renderer = args[args.indexOf('--post-renderer') + 1]
    const input = path.join(dir, 'render-input')
    fs.writeFileSync(input, manifest('Job', 'falcone-temporal-schema') + manifest('Job', 'falcone-temporal-db-bootstrap') + manifest('ConfigMap', 'retained'))
    const fd = fs.openSync(input, 'r')
    const result = spawnSync(renderer, { encoding: 'utf8', env: process.env, timeout: 5000, stdio: [fd, 'pipe', 'pipe'] })
    fs.closeSync(fd)
    fs.writeFileSync(path.join(dir, 'rendered'), result.stdout || '')
    if (result.status !== 0 || /kind: Job/.test(result.stdout)) process.exit(91)
    // Simulate stale Jobs from an earlier phase-one install. Re-apply must not
    // reuse their expired deadline; delete must happen before reconciliation.
    fs.writeFileSync(path.join(dir, 'stale'), 'present')
  }
  process.exit(0)
}
if (command === 'kubectl') {
  if (args[0] === 'config') { out('kind-failure-fixture'); process.exit(0) }
  if (args[0] === 'apply') {
    const data = fs.readFileSync(0, 'utf8')
    if (/name: falcone-temporal-(schema|db-bootstrap)/.test(data)) {
      if (!fs.existsSync(path.join(dir, 'ready')) || fs.existsSync(path.join(dir, 'stale'))) process.exit(92)
      fs.appendFileSync(path.join(dir, 'job-applies'), data)
    }
    if (data.includes('name: platform-temporal')) fs.writeFileSync(path.join(dir, 'external-applied'), 'yes')
    process.exit(0)
  }
  if (args[0] === 'delete' && args[1] === 'job') {
    fs.rmSync(path.join(dir, 'stale'), { force: true }); process.exit(0)
  }
  if (args[0] === 'wait') {
    if (args[1] === process.env.BBX_FAIL_WAIT) { out('Job Failed or injected timeout'); process.exit(37) }
    if (args[1] === 'externalsecret/platform-temporal-credentials') {
      if (!fs.existsSync(path.join(dir, 'external-applied'))) process.exit(93)
      fs.writeFileSync(path.join(dir, 'ready'), 'yes')
    }
    process.exit(0)
  }
  if (args[0] === 'rollout' && process.env.BBX_FAIL_ROLLOUT === 'true') process.exit(38)
  if (args[0] === 'get' && args[1] === 'secret') {
    if (process.env.BBX_MISSING_SECRET === 'true' || !fs.existsSync(path.join(dir, 'ready'))) process.exit(39)
    out('secret/in-falcone-temporal'); process.exit(0)
  }
  if (args[0] === 'get' && args[1] === 'deployment' && args.includes('name')) { out('deployment/test'); process.exit(0) }
  if (args[0] === 'get' && args[1] === 'pods') {
    if (process.env.BBX_DIAGNOSTICS_FAIL === 'true') process.exit(40)
    if (text.includes('jsonpath=')) {
      const status = { phase: 'Pending', containerStatuses: [
        { name: 'app', ready: false, restartCount: 2, state: { waiting: { reason: 'CreateContainerConfigError', message: 'secret "in-falcone-temporal" not found' } }, lastState: { terminated: { reason: 'Error', message: process.env.E2E_BOOTSTRAP_SUPERADMIN_PASSWORD, exitCode: 1 } } },
        { name: 'sidecar', ready: false, state: { terminated: { reason: 'Error', exitCode: 2 } } },
      ], initContainerStatuses: [{ name: 'init-db', ready: false, state: { waiting: { reason: 'ImagePullBackOff', message: 'image unavailable' } } }] }
      out('temporal-stuck\\t' + JSON.stringify(status))
      out('credential-bootstrap-failed\\t' + JSON.stringify({ phase: 'Failed', containerStatuses: [{ name: 'credential-loader', ready: false, state: { terminated: { reason: 'Error', exitCode: 1 } } }] }))
      out('completed-job\\t' + JSON.stringify({ phase: 'Succeeded' }))
      out('ready-pod\\t' + JSON.stringify({ phase: 'Running', conditions: [{ type: 'Ready', status: 'True' }], containerStatuses: [{ name: 'app', ready: true }] }))
      if (process.env.BBX_MANY_PODS === 'true') for (let i = 0; i < 100; i++) out('stuck-' + i + '\\t' + JSON.stringify(status))
    } else {
      out(process.env.BBX_FAIL_HEALTH === 'true' ? 'temporal-stuck 0/1 Pending 0 1m' : 'app 1/1 Running 0 1m')
    }
    process.exit(0)
  }
  if (args[0] === 'get' && args[1] === 'events') {
    const items = Array.from({ length: 60 }, (_, i) => ({ lastTimestamp: new Date(1700000000000 + i * 1000).toISOString(), reason: 'BackOff', message: 'event-' + i + ' ' + process.env.E2E_BOOTSTRAP_KEYCLOAK_ADMIN_PASSWORD }))
    out(JSON.stringify(items.reverse())); process.exit(0)
  }
  if (args[0] === 'logs') {
    if (/bootstrap|credential/.test(text)) { out(process.env.BBX_UNKNOWN_CREDENTIAL); process.exit(0) }
    for (let i = 0; i < 120; i++) out('log-line-' + i + ' ' + 'x'.repeat(40))
    out('known ' + process.env.E2E_BOOTSTRAP_KEYCLOAK_ADMIN_PASSWORD)
    out('random ' + process.env.E2E_BOOTSTRAP_SUPERADMIN_PASSWORD)
    out('password="' + process.env.BBX_UNKNOWN_CREDENTIAL + '"')
    out('postgres://user:' + process.env.BBX_UNKNOWN_CREDENTIAL + '@db/test')
    out('opaque ' + process.env.BBX_UNKNOWN_CREDENTIAL)
    process.exit(0)
  }
  process.exit(0)
}
if (command === 'curl' && process.env.BBX_FAIL_SMOKE === 'true') process.exit(1)
process.exit(0)
`, { mode: 0o755 })
  for (const name of ['kubectl', 'helm', 'curl', 'sleep']) symlinkSync(dispatcher, join(directory, name))
  writeFileSync(join(directory, 'calls'), '')
  const env = {
    ...process.env,
    // These clients are application processes, not nested Node test workers.
    NODE_TEST_CONTEXT: '',
    PATH: `${directory}:${dirname(process.execPath)}:/usr/bin:/bin`,
    BBX_DIR: directory,
    BBX_UNKNOWN_CREDENTIAL: unknownCredential,
    E2E_NAMESPACE_MODE: 'ephemeral',
    E2E_NAMESPACE: 'diagnostic-test',
    E2E_KUBECONFIG: '/dev/null',
    KUBECONFIG: '/dev/null',
    E2E_HELM_CHART: 'fake-chart',
    E2E_BOOTSTRAP_KEYCLOAK_ADMIN_USERNAME: 'test-admin',
    E2E_BOOTSTRAP_KEYCLOAK_ADMIN_PASSWORD: seeded,
    E2E_BOOTSTRAP_SUPERADMIN_PASSWORD: randomCredential,
    E2E_FWD: ' ',
    ...overrides,
  }
  const run = (file = stack) => {
    const result = spawnSync(file === stack ? 'bash' : process.execPath, [file, file === stack ? 'up' : env.E2E_NAMESPACE], {
      cwd: root, env, encoding: 'utf8', timeout: 15_000, maxBuffer: 2 * 1024 * 1024,
    })
    return { ...result, output: `${result.stdout ?? ''}\n${result.stderr ?? ''}` }
  }
  return {
    run, directory, env, randomCredential, unknownCredential,
    calls: () => readFileSync(join(directory, 'calls'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse),
    cleanup: () => {
      spawnSync('bash', [stack, 'down'], { cwd: root, env, stdio: 'ignore', timeout: 5000 })
      rmSync(directory, { recursive: true, force: true })
    },
  }
}

test('Temporal jobs are deferred, recreated and completed after ESO reconciliation', () => {
  const f = fixture()
  try {
    const result = f.run()
    assert.equal(result.status, 0, result.output)
    const manifests = readFileSync(join(f.directory, 'job-applies'), 'utf8')
    assert.ok(manifests.indexOf('falcone-temporal-db-bootstrap') < manifests.indexOf('falcone-temporal-schema'))
    assert.match(readFileSync(join(f.directory, 'rendered'), 'utf8'), /name: retained/)
    assert.doesNotMatch(result.output, /failure diagnostics/)
  } finally { f.cleanup() }
})

test('ephemeral failures preserve status and emit safe diagnostics for all namespaces', async (t) => {
  for (const [name, overrides, expected] of [
    ['DB bootstrap Failed', { BBX_FAIL_WAIT: 'job/falcone-temporal-db-bootstrap' }, 37],
    ['schema incomplete', { BBX_FAIL_WAIT: 'job/falcone-temporal-schema' }, 37],
    ['namespace bootstrap Failed', { BBX_FAIL_WAIT: 'job/falcone-temporal-bootstrap' }, 37],
    ['ESO timeout', { BBX_FAIL_WAIT: 'externalsecret/platform-temporal-credentials' }, 37],
    ['target Secret missing', { BBX_MISSING_SECRET: 'true' }, 39],
    ['rollout failure', { BBX_FAIL_ROLLOUT: 'true' }, 38],
    ['healthy failure', { BBX_FAIL_HEALTH: 'true' }, 1],
    ['smoke failure', { BBX_FAIL_SMOKE: 'true', E2E_HEALTH_PATH: '/health' }, 1],
  ]) {
    await t.test(name, () => {
      const f = fixture(overrides)
      try {
        const result = f.run()
        assert.equal(result.status, expected, result.output)
        for (const namespace of ['diagnostic-test', 'eso-system', 'secret-store']) {
          assert.match(result.output, new RegExp(`Namespace ${namespace}: pods`))
          assert.match(result.output, new RegExp(`Namespace ${namespace}: last 40 events sorted by time`))
        }
        assert.match(result.output, /CreateContainerConfigError/)
        assert.match(result.output, /secret "in-falcone-temporal" not found/)
        assert.match(result.output, /init-db/)
        assert.match(result.output, /ImagePullBackOff/)
        assert.match(result.output, /previous terminated: reason=Error/)
        assert.match(result.output, /Logs .* --previous/)
        assert.doesNotMatch(result.output, /completed-job|ready-pod/)
        for (const value of [seeded, f.randomCredential, f.unknownCredential]) assert.ok(!result.output.includes(value))
        const logs = f.calls().filter(({ command, args }) => command === 'kubectl' && args[0] === 'logs')
        assert.ok(logs.some(({ args }) => args.includes('--previous')))
        assert.ok(logs.every(({ args }) => args.includes('--tail=75') && args.includes('--limit-bytes=8192')))
        assert.ok(logs.every(({ args }) => !/credential|bootstrap|secret-store/.test(args.join(' '))))
        assert.ok(f.calls().every(({ command, args }) => command !== 'kubectl'
          || !(args[0] === 'describe' || args.includes('env') || (args[0] === 'get' && args[1] === 'secret' && !args.includes('name')))))
      } finally { f.cleanup() }
    })
  }
})

test('diagnostic collection failure never changes the original exit code', () => {
  const f = fixture({ BBX_FAIL_WAIT: 'job/falcone-temporal-schema', BBX_DIAGNOSTICS_FAIL: 'true' })
  try {
    const result = f.run()
    assert.equal(result.status, 37, result.output)
    assert.match(result.output, /Pod status unavailable/)
  } finally { f.cleanup() }
})

test('diagnostics bound pod, container, event, log and total output', () => {
  const f = fixture({ BBX_MANY_PODS: 'true' })
  try {
    const result = f.run(collector)
    assert.equal(result.status, 0, result.output)
    assert.ok(Buffer.byteLength(result.output) <= 64 * 1024 + 1)
    assert.ok(result.output.trim().split('\n').length <= 600)
    assert.match(result.output, /Additional unhealthy pods omitted/)
    assert.ok(f.calls().filter(({ args }) => args[0] === 'logs').length <= 18)
    assert.doesNotMatch(result.output, /event-19 /)
    assert.ok(result.output.indexOf('event-20 ') < result.output.indexOf('event-59 '))
    const podSections = result.stderr.split(/(?=Pod [a-z0-9.-]+:)/).slice(1)
    for (const section of podSections) {
      const beforeEvents = section.split('>> Namespace')[0]
      assert.ok(Buffer.byteLength(beforeEvents) <= 8 * 1024 + 100)
    }
  } finally { f.cleanup() }
})

test('post-renderer retains unrelated Jobs and works with custom release names', () => {
  const manifest = ['schema', 'db-bootstrap', 'bootstrap'].map((suffix) => `---\n# Source: chart\napiVersion: batch/v1\nkind: Job\nmetadata:\n  name: "custom-temporal-${suffix}"\nspec:\n  template:\n    metadata:\n      name: nested\n`).join('')
  const directory = mkdtempSync(join(tmpdir(), 'falcone-renderer-'))
  const input = join(directory, 'manifest')
  writeFileSync(input, manifest)
  const fd = openSync(input, 'r')
  try {
    const result = spawnSync('bash', [postRenderer], { env: { ...process.env, E2E_TEMPORAL_RELEASE: 'custom' }, stdio: [fd, 'pipe', 'pipe'], encoding: 'utf8', timeout: 5000 })
    assert.equal(result.status, 0, result.stderr)
    assert.doesNotMatch(result.stdout, /custom-temporal-(schema|db-bootstrap)/)
    assert.match(result.stdout, /custom-temporal-bootstrap/)
  } finally { closeSync(fd); rmSync(directory, { recursive: true, force: true }) }
})
