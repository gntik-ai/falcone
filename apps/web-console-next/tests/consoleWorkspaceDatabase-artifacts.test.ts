import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { expect, test } from 'vitest'
// @ts-expect-error Browser helpers intentionally use native JavaScript modules.
import { scanTree } from './parity/artifact-scan.mjs'
import { dsn, password, sharedDsn } from './parity/pages/console-workspace-database-page.manifest'

const require = createRequire(import.meta.url)
const run = promisify(execFile)

test('database fixture source stays safe in finished reports with Git diff metadata', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'database-report-'))
  try {
    // In CI Playwright captures the PR diff even for probes that never visit the database page.
    const source = await readFile(resolve('tests/parity/pages/console-workspace-database-page.manifest.ts'), 'utf8')
    const metadata = { gitDiff: source.split('\n').map((line) => `+${line}`).join('\n') }
    const reportPath = join(directory, 'results.json')
    const htmlPath = join(directory, 'html')
    const configPath = join(directory, 'playwright.config.mjs')
    await writeFile(configPath, `export default ${JSON.stringify({
      testDir: directory, testMatch: 'probe.spec.mjs', workers: 1, retries: 0,
      captureGitInfo: { commit: false, diff: false }, metadata,
      outputDir: join(directory, 'results'),
      reporter: [['json', { outputFile: reportPath }], ['html', { outputFolder: htmlPath, open: 'never' }]],
    })}`)
    const playwright = pathToFileURL(require.resolve('@playwright/test')).href
    await writeFile(join(directory, 'probe.spec.mjs'), `import playwright from ${JSON.stringify(playwright)};
const { test } = playwright;
test('forced failure retains report metadata without a browser', () => { throw new Error('Forced artifact regression probe'); });`)
    const result = await run(process.execPath, [require.resolve('@playwright/test/cli'), 'test', '--config', configPath], {
      timeout: 20_000, env: { ...process.env, PLAYWRIGHT_NO_COPY_PROMPT: '1' },
    }).then(() => ({ code: 0 }), (error: { code: number }) => ({ code: error.code }))
    expect(result.code).toBe(1)
    const report = JSON.parse(await readFile(reportPath, 'utf8'))
    expect(report.errors).toEqual([])
    expect(report.stats.unexpected).toBe(1)
    expect(report.suites[0].specs[0].tests[0].results[0].error.message).toContain('Forced artifact regression probe')
    expect(report.config.metadata.gitDiff === metadata.gitDiff).toBe(true)
    expect((await readFile(join(htmlPath, 'index.html'), 'utf8')).includes('data:application/zip;base64,')).toBe(true)
    // Scan the finished reports, not the temporary probe config used to supply the metadata.
    for (const path of [reportPath, htmlPath]) {
      expect(scanTree(path, [password, dsn, sharedDsn]).hits, 'finished report contains no protected fixture value').toEqual([])
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 30_000)
