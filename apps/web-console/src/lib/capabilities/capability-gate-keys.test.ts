import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { BOOLEAN_CAPABILITY_KEYS, isBooleanCapabilityKey } from './catalog-keys'

// Audit guard (#790, Scenario 2): every `CapabilityGate capability="X"` and
// `useCapabilityGate('X')` usage across the console source MUST reference a capability key
// that exists in the platform boolean-capability catalog. A gate keyed on a phantom key
// (e.g. `workflows`, `functions_public`) can never be satisfied — `useCapabilityGate` is
// fail-closed and the effective-capabilities endpoint never returns a key absent from the
// catalog — so the gated surface renders permanently dimmed for every tenant on every plan.
//
// This test reads the source files directly (it is independent of the type system, so it
// still catches phantom keys introduced via `as`-casts or `// @ts-expect-error`).

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

function listSourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...listSourceFiles(full))
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      // Exclude test files: they mock the gate and legitimately exercise unknown keys.
      out.push(full)
    }
  }
  return out
}

// `<CapabilityGate ... capability="X" ...>` — capability prop with a string literal.
const GATE_PROP_RE = /capability=(?:"([^"]+)"|'([^']+)')/g
// `useCapabilityGate('X')` / `useCapabilityGate("X")` — direct hook call with a literal.
const HOOK_CALL_RE = /useCapabilityGate\(\s*(?:"([^"]+)"|'([^']+)')\s*\)/g

interface Usage {
  key: string
  file: string
}

function collectUsages(): Usage[] {
  const usages: Usage[] = []
  for (const file of listSourceFiles(SRC_DIR)) {
    const content = readFileSync(file, 'utf8')
    // Only inspect prop occurrences inside files that actually reference CapabilityGate, to
    // avoid matching an unrelated `capability="..."` attribute on some other element.
    if (content.includes('CapabilityGate')) {
      for (const match of content.matchAll(GATE_PROP_RE)) {
        usages.push({ key: match[1] ?? match[2], file })
      }
    }
    for (const match of content.matchAll(HOOK_CALL_RE)) {
      usages.push({ key: match[1] ?? match[2], file })
    }
  }
  return usages
}

describe('console CapabilityGate keys reference the boolean-capability catalog (#790)', () => {
  it('finds at least the known catalog-keyed gates (sanity: the scan actually matches usages)', () => {
    const usages = collectUsages()
    expect(usages.length).toBeGreaterThan(0)
    // The Realtime page is gated on the real `realtime` key — proves the scan sees real gates.
    expect(usages.some((u) => u.key === 'realtime')).toBe(true)
  })

  it('every CapabilityGate / useCapabilityGate key exists in the boolean-capability catalog', () => {
    const usages = collectUsages()
    const offenders = usages.filter((u) => !isBooleanCapabilityKey(u.key))
    expect(
      offenders,
      `Found CapabilityGate/useCapabilityGate usages keyed on capabilities absent from the ` +
        `boolean-capability catalog (${BOOLEAN_CAPABILITY_KEYS.join(', ')}). Such gates are ` +
        `fail-closed forever. Offenders:\n` +
        offenders.map((o) => `  - "${o.key}" in ${o.file}`).join('\n')
    ).toEqual([])
  })
})
