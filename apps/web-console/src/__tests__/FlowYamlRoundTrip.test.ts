// Property-based round-trip tests for the YAML serialiser (change: add-console-flow-yaml-editor).
//
// For EVERY shared DSL fixture (the round-trip corpus owned by add-flows-dsl-schema), assert:
//   definition -> canonical YAML -> definition  is lossless for execution semantics, and
//   canvasMetadata survives independently.
// Also asserts determinism (same input -> byte-identical YAML) and the comment-discard policy.
// These are pure-module tests: no DOM, no Monaco, framework-free except for the vitest harness.
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  parseYamlToFlow,
  serializeFlowToYaml
} from '@/lib/flows/yaml-serialiser'
import {
  compareRoundTrip,
  roundTripDefinition
} from '@/lib/flows/yaml-round-trip'
import type { FlowDefinition } from '@/types/flows'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE_DIR = resolve(
  __dirname,
  '../../../../services/internal-contracts/src/fixtures/flows'
)

const EXPECTED_FIXTURES = [
  'minimal-3-node',
  'branch-retry',
  'parallel-fan-out',
  'human-approval',
  'sub-flow-ref'
] as const

function loadFixture(name: string): FlowDefinition {
  return JSON.parse(readFileSync(resolve(FIXTURE_DIR, `${name}.json`), 'utf8')) as FlowDefinition
}

function allFixtures(): Array<{ name: string; doc: FlowDefinition }> {
  return readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ name: f.replace(/\.json$/, ''), doc: loadFixture(f.replace(/\.json$/, '')) }))
}

describe('FlowYamlRoundTrip: corpus identity', () => {
  it('exposes all five named DSL fixtures', () => {
    const names = new Set(allFixtures().map((f) => f.name))
    for (const expected of EXPECTED_FIXTURES) {
      expect(names.has(expected), `fixture ${expected} present`).toBe(true)
    }
  })

  for (const name of EXPECTED_FIXTURES) {
    it(`round-trip identity over ${name} (execution semantics)`, () => {
      const original = loadFixture(name)
      const roundTripped = roundTripDefinition(original)
      const { semanticsEqual } = compareRoundTrip(original, roundTripped)
      expect(semanticsEqual, `${name} semantics survive YAML round-trip`).toBe(true)
    })
  }

  it('property: every fixture round-trips losslessly (semantics + canvasMetadata)', () => {
    for (const { name, doc } of allFixtures()) {
      const roundTripped = roundTripDefinition(doc)
      const { semanticsEqual, canvasMetadataEqual } = compareRoundTrip(doc, roundTripped)
      expect(semanticsEqual, `${name} semantics`).toBe(true)
      expect(canvasMetadataEqual, `${name} canvasMetadata`).toBe(true)
    }
  })
})

describe('FlowYamlRoundTrip: canvasMetadata survives independently', () => {
  it('preserves non-empty canvasMetadata across the round-trip', () => {
    const doc: FlowDefinition = {
      apiVersion: 'v1.0',
      name: 'with-canvas',
      nodes: [
        { id: 'a', type: 'task', taskType: 'noop', next: 'b' },
        { id: 'b', type: 'task', taskType: 'noop' }
      ],
      canvasMetadata: {
        nodes: { a: { x: 120, y: 40 }, b: { x: 120, y: 200 } },
        zoom: 1.5
      }
    }
    const roundTripped = roundTripDefinition(doc)
    const { canvasMetadataEqual } = compareRoundTrip(doc, roundTripped)
    expect(canvasMetadataEqual).toBe(true)
    expect(roundTripped.canvasMetadata).toEqual(doc.canvasMetadata)
  })

  it('a semantic change is NOT masked by canvasMetadata equality', () => {
    const base = loadFixture('minimal-3-node')
    const mutated: FlowDefinition = {
      ...base,
      nodes: base.nodes.map((n, i) =>
        i === 0 ? ({ ...n, taskType: 'DIFFERENT' } as FlowDefinition['nodes'][number]) : n
      )
    }
    const { semanticsEqual } = compareRoundTrip(base, mutated)
    expect(semanticsEqual).toBe(false)
  })
})

describe('FlowYamlRoundTrip: determinism + comment policy', () => {
  it('serialises the same graph to byte-identical YAML on repeat calls', () => {
    for (const { name, doc } of allFixtures()) {
      expect(serializeFlowToYaml(doc), `${name} stable`).toBe(serializeFlowToYaml(doc))
    }
  })

  it('canvasMetadata is the final top-level key in serialised output', () => {
    const doc = loadFixture('minimal-3-node')
    const withMeta: FlowDefinition = { ...doc, canvasMetadata: { nodes: { 'step-1': { x: 1, y: 2 } } } }
    const yaml = serializeFlowToYaml(withMeta)
    const topKeys = yaml
      .split('\n')
      .filter((line) => /^[A-Za-z]/.test(line))
      .map((line) => line.split(':')[0])
    expect(topKeys.at(-1)).toBe('canvasMetadata')
  })

  it('discards YAML comments on a canvas (parse->serialise) round-trip', () => {
    const doc = loadFixture('minimal-3-node')
    const commented = `# top comment\n${serializeFlowToYaml(doc)}`
    expect(commented).toMatch(/# top comment/)
    const reserialised = serializeFlowToYaml(parseYamlToFlow(commented))
    expect(reserialised).not.toMatch(/# top comment/)
  })
})
