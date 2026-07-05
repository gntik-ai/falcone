// Repo guard (change: add-console-descaffold-dark-theme, issue #744).
//
// Requirement: "The system SHALL render ... all surfaces SHALL use theme tokens so content is
// legible in the dark theme" / Scenario "Dark-theme table/panel": "it uses theme tokens (no
// hardcoded bg-white/bg-slate-*)".
//
// This scans the WHOLE authenticated console source tree for the exact light-mode escapes the
// #744 verification census found (`bg-white`, `bg-slate-<n>`, `text-slate-<n>`) so a future PR
// can't reintroduce them one file at a time without this test catching it. Tests/stories are
// excluded (they assert behavior, not visual chrome) and `SANCTIONED_EXCEPTIONS` is the one
// escape hatch — kept empty by this change; adding a path there should be rare and reviewed.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

const SRC_ROOT = join(__dirname)

// Intentionally empty: every file the #744 verification census flagged has been migrated to
// design tokens (bg-card/bg-muted/text-foreground/text-muted-foreground) or the shared
// Card/Table/Badge primitives. Add a path here ONLY with a comment justifying why the literal
// class is not a dark-theme regression (e.g. a vendored snippet whose color is not console UI).
const SANCTIONED_EXCEPTIONS: string[] = []

const FORBIDDEN_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'bg-white', pattern: /\bbg-white\b/g },
  { name: 'bg-slate-<n>', pattern: /\bbg-slate-\d+\b/g },
  { name: 'text-slate-<n>', pattern: /\btext-slate-\d+\b/g }
]

const EXCLUDED_FILE_PATTERN = /\.(test|stories)\.(tsx?|jsx?)$/
const SOURCE_FILE_PATTERN = /\.(tsx?|jsx?)$/

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    const stats = statSync(fullPath)
    if (stats.isDirectory()) {
      walk(fullPath, out)
    } else if (SOURCE_FILE_PATTERN.test(entry) && !EXCLUDED_FILE_PATTERN.test(entry)) {
      out.push(fullPath)
    }
  }
  return out
}

describe('[#744][Scenario: Dark-theme table/panel] no hardcoded light-mode color utilities in the console source tree', () => {
  const files = walk(SRC_ROOT)
  expect(files.length).toBeGreaterThan(50) // sanity: the walk actually found the console source tree

  for (const { name, pattern } of FORBIDDEN_PATTERNS) {
    it(`contains no "${name}" occurrences outside the sanctioned-exception list`, () => {
      const offenders: string[] = []

      for (const filePath of files) {
        const relPath = relative(SRC_ROOT, filePath)
        if (SANCTIONED_EXCEPTIONS.includes(relPath)) continue

        const content = readFileSync(filePath, 'utf8')
        const matches = content.match(pattern)
        if (matches && matches.length > 0) {
          offenders.push(`${relPath} (${matches.length}x)`)
        }
      }

      expect(offenders).toEqual([])
    })
  }

  it('the sanctioned-exception list only references files that exist', () => {
    const existing = new Set(files.map((filePath) => relative(SRC_ROOT, filePath)))
    for (const exception of SANCTIONED_EXCEPTIONS) {
      expect(existing.has(exception)).toBe(true)
    }
  })

  // #744 item 6: the console renders dark-root (no `.dark` class is ever set on <html> — see
  // globals.css), so a `text-X-700 dark:text-X-300` tone pair renders its light-mode `-700` half
  // unconditionally; the `dark:` variant is dead code. FlowStatusBadge's RunStatusBadge and ~17
  // other spots had this inert pairing; all were pinned to their `-300` tone directly (#757's
  // precedent for FlowStatusBadge draft/published). This guards the whole tree against the pattern
  // creeping back in a NEW file.
  it('contains no inert `text-<color>-700 … dark:text-<color>-300` tone pair', () => {
    const pairPattern = /text-([a-z]+)-700\b[^"'`]*dark:text-\1-300\b/g
    const offenders: string[] = []

    for (const filePath of files) {
      const relPath = relative(SRC_ROOT, filePath)
      const content = readFileSync(filePath, 'utf8')
      const matches = content.match(pairPattern)
      if (matches && matches.length > 0) {
        offenders.push(`${relPath} (${matches.length}x)`)
      }
    }

    expect(offenders).toEqual([])
  })
})
