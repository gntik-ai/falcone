import { readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { expect, test } from 'vitest'

const root = resolve(__dirname, '..')
const entry = resolve(root, 'src/pages/consoleFlowRun.tsx')
const specifier = /(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g
const extensions = ['', '.ts', '.tsx', '/index.ts', '/index.tsx']
function resolveLocal(from: string, target: string) {
  for (const extension of extensions) {
    try { const path = resolve(dirname(from), target + extension); readFileSync(path); return path } catch { /* Try the next extension. */ }
  }
  throw new Error(`Unresolved import ${target} from ${from}`)
}
function graph() {
  const files = new Map<string, string[]>(), external = new Set<string>(), queue = [entry]
  while (queue.length) {
    const file = queue.pop()!
    if (files.has(file) || file.endsWith('.json') || file.endsWith('.css')) continue
    const imports = [...readFileSync(file, 'utf8').matchAll(specifier)].map((match) => match[1])
    files.set(file, imports)
    for (const item of imports) { if (item.startsWith('.')) queue.push(resolveLocal(file, item)); else external.add(item) }
  }
  return { files, external }
}

test('the page renders nodes only through its own runNodeTypes and imports nothing from the designer or the legacy app', () => {
  const { files, external } = graph()
  const names = [...files.keys()].map((file) => relative(root, file))
  expect(names).toContain('src/pages/consoleFlowRun/RunNode.tsx')
  expect(names.filter((name) => name.includes('consoleFlowDesigner'))).toEqual([])
  expect(names.filter((name) => /nodes\/nodeTypes/.test(name))).toEqual([])
  expect(names.every((name) => name.startsWith('src/'))).toBe(true)
  expect([...external].filter((name) => name.startsWith('@/') || name.includes('web-console/') || name.includes('apps/'))).toEqual([])
  const canvas = readFileSync(resolve(root, 'src/pages/consoleFlowRun/RunCanvas.tsx'), 'utf8')
  expect(canvas).toContain('nodeTypes={runNodeTypes}')
  expect(canvas).not.toMatch(/flowNodeTypes/)
})

test('the page adds no events client, EventSource or query credential of its own', () => {
  const { files } = graph()
  for (const [file] of files) {
    const source = readFileSync(file, 'utf8')
    expect(source, relative(root, file)).not.toMatch(/EventSource|apikey|anonKey|api-key/i)
  }
  const stream = readFileSync(resolve(root, 'src/pages/consoleFlowRun/stream.ts'), 'utf8')
  expect(stream).toContain('streamFlowExecutionEvents')
  expect(stream).not.toMatch(/\?[a-z]+=/)
})
