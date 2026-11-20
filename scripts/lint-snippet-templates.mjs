import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import vm from 'node:vm'

import { realtimeSnippetTemplates } from './realtime-snippet-templates.data.mjs'

const FALLBACKS = {
  '{REALTIME_ENDPOINT}': 'wss://rt.example.test',
  '{WORKSPACE_ID}': 'ws_example',
  '{CHANNEL_TYPE}': 'postgresql-changes'
}

function fill(template) {
  return Object.entries(FALLBACKS).reduce((acc, [token, value]) => acc.replaceAll(token, value), template)
}

function toParsableJavascript(code) {
  return code.replace(/^import .*$/gm, '')
}

function parseMarkdownCodeBlocks(markdown) {
  const matches = markdown.matchAll(/```(javascript|typescript|js|ts|python)\n([\s\S]*?)```/g)
  return Array.from(matches, (match) => ({ language: match[1], code: match[2].trim() }))
}

let failed = false
for (const item of realtimeSnippetTemplates) {
  const code = fill(item.template)
  if (/Bearer [A-Za-z0-9_\-.]{20,}/.test(code) || /eyJ[A-Za-z0-9_\-]{20,}/.test(code)) {
    console.error(`Embedded credential-like token detected in ${item.id}`)
    failed = true
  }

  if (item.language === 'javascript') {
    try {
      new vm.Script(toParsableJavascript(code))
    } catch (error) {
      console.error(`JavaScript syntax error in ${item.id}: ${error.message}`)
      failed = true
    }
  } else if (item.language === 'python') {
    const python = spawnSync('python3', ['-c', 'import ast,sys; ast.parse(sys.stdin.read())'], { input: code, encoding: 'utf8' })
    if (python.error && python.error.code === 'ENOENT') {
      console.warn(`WARN python3 not available; skipping Python syntax validation for ${item.id}`)
    } else if (python.status !== 0) {
      console.error(`Python syntax error in ${item.id}: ${python.stderr}`)
      failed = true
    }
  }
}

const guides = [
  'docs/guides/realtime/frontend-quickstart.md',
  'docs/guides/realtime/nodejs-quickstart.md',
  'docs/guides/realtime/python-quickstart.md'
]

for (const guide of guides) {
  const markdown = readFileSync(new URL(`../${guide}`, import.meta.url), 'utf8')
  const blocks = parseMarkdownCodeBlocks(markdown)
  if (blocks.length < 3) {
    console.error(`Expected at least 3 code blocks in ${guide}`)
    failed = true
  }
}

// Realtime snippets now live in the next console's locale catalogue.
for (const locale of ['en', 'es']) {
  const catalog = JSON.parse(readFileSync(new URL(`../apps/web-console-next/src/locales/${locale}/pages.console-realtime-page.json`, import.meta.url), 'utf8'))
  for (const item of realtimeSnippetTemplates) {
    if (!catalog.entries[item.id]) {
      console.error(`Catalog missing snippet id ${item.id} in ${locale}`)
      failed = true
    }
  }
}

// Per-page catalogues replaced the shared legacy catalogue. Read their literal
// templates, so syntax and placeholder checks still cover the served snippets.
const { createRequire } = await import('node:module')
const requireNext = createRequire(new URL('../apps/web-console-next/package.json', import.meta.url))
const ts = requireNext('typescript')
for (const page of ['consoleFunctions', 'consolePostgres', 'consoleStorage']) {
  const file = new URL(`../apps/web-console-next/src/pages/${page}/snippets.ts`, import.meta.url)
  const source = ts.createSourceFile(file.pathname, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  let templates
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (declaration.name.getText(source) !== 'templates') continue
      templates = ts.isAsExpression(declaration.initializer) ? declaration.initializer.expression : declaration.initializer
    }
  }
  if (!templates || !ts.isArrayLiteralExpression(templates) || templates.elements.length < 3) throw new Error(`Missing templates in ${file.pathname}`)
  for (const [index, entry] of templates.elements.entries()) {
    let code, language
    if (ts.isStringLiteral(entry)) {
      code = entry.text
      language = ['shell', 'javascript', 'python'][index] ?? 'shell'
    } else {
      const fields = Object.fromEntries(entry.properties.filter(ts.isPropertyAssignment).map((property) => [property.name.getText(source), property.initializer.text]))
      code = fields.code
      language = fields.language === 'js' ? 'javascript' : fields.language
    }
    if (typeof code !== 'string') throw new Error(`Missing template code in ${file.pathname}`)
    code = code.replaceAll('{PORT}', '5432')
    if (/Bearer [A-Za-z0-9_\-.]{20,}/.test(code) || /eyJ[A-Za-z0-9_\-]{20,}/.test(code)) throw new Error(`Embedded credential-like token in ${page}`)
    if (language === 'javascript') new vm.Script(`(async () => {\n${toParsableJavascript(code)}\n})`)
    if (language === 'python') {
      const python = spawnSync('python3', ['-c', 'import ast,sys; ast.parse(sys.stdin.read())'], { input: code, encoding: 'utf8' })
      if (python.error?.code === 'ENOENT') console.warn(`WARN python3 not available; skipping Python syntax validation for ${page}`)
      else if (python.error) throw python.error
      else if (python.status !== 0) throw new Error(`Python syntax error in ${page}: ${python.stderr}`)
    }
  }
}

if (failed) process.exit(1)
console.log('Realtime snippet templates validated successfully.')
