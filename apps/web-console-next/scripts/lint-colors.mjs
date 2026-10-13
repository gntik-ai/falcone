import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const hex = /#[\da-f]{3}(?:[\da-f]{1}|[\da-f]{3}(?:[\da-f]{2})?)?\b/i
const palette = /\b(?:bg|text|border|ring|outline|divide|shadow|fill|stroke|from|via|to|decoration|accent|caret)-(?:black|white|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|[1-9]00|950))\b/

function files(path) {
  if (!statSync(path).isDirectory()) return [path]
  return readdirSync(path).flatMap((name) => {
    if (name === 'test' || /\.(test|spec)\.[cm]?[jt]sx?$/.test(name)) return []
    return files(`${path}/${name}`)
  })
}

try {
  const paths = process.argv.slice(2)
  const defaults = ['../src', '../index.html'].map((path) => fileURLToPath(new URL(path, import.meta.url)))
  let violations = 0
  for (const file of (paths.length ? paths : defaults).flatMap(files)) {
    if (!/\.(css|html|[cm]?[jt]sx?)$/.test(file)) continue
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, index) => {
      if (hex.test(line) || palette.test(line)) {
        console.error(`${file}:${index + 1}: use semantic colour tokens`)
        violations++
      }
    })
  }
  if (violations) process.exitCode = 1
  else console.log('Colour lint passed')
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
