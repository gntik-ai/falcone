// #744 item 5: --card used to equal --background in BOTH :root and .dark, so every `bg-card`
// panel had ZERO elevation against the page background. This parses the raw CSS custom properties
// and asserts --card is distinct from --background in both blocks (and that --card-foreground is
// untouched, since #734/brand tokens are out of this change's scope).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const CSS_PATH = join(__dirname, 'globals.css')
const css = readFileSync(CSS_PATH, 'utf8')

function extractBlock(selector: string): string {
  const start = css.indexOf(`${selector} {`)
  if (start === -1) throw new Error(`selector "${selector}" not found in globals.css`)
  const end = css.indexOf('}', start)
  return css.slice(start, end)
}

function extractVar(block: string, name: string): string {
  const match = block.match(new RegExp(`${name}:\\s*([^;]+);`))
  if (!match) throw new Error(`variable "${name}" not found in block`)
  return match[1].trim()
}

describe('[#744][Scenario: Dark-theme table/panel] globals.css card elevation token', () => {
  it(':root gives --card a distinct value from --background (cards are visually elevated)', () => {
    const root = extractBlock(':root')
    expect(extractVar(root, '--card')).not.toBe(extractVar(root, '--background'))
  })

  it('.dark gives --card a distinct value from --background (cards are visually elevated)', () => {
    const dark = extractBlock('\n.dark')
    expect(extractVar(dark, '--card')).not.toBe(extractVar(dark, '--background'))
  })

  it('--card-foreground contrast token is untouched (brand/typeface tokens are #734 scope, not this change)', () => {
    const root = extractBlock(':root')
    const dark = extractBlock('\n.dark')
    expect(extractVar(root, '--card-foreground')).toBe('210 40% 98%')
    expect(extractVar(dark, '--card-foreground')).toBe('210 40% 98%')
  })
})
