// Pure tests for the FLW-E -> Monaco-marker mapping (change: add-console-flow-yaml-editor).
//
// Exercises the semantic-validation core (shared FLW-E rules) and the line-anchoring marker
// mapper without a DOM or a worker. Covers the spec scenarios:
//   - Duplicate node ID produces a FLW-E001 marker on the duplicate's line
//   - A clean document produces no semantic markers
//   - Invalid YAML yields no semantic markers (structural diagnostics handled elsewhere)
//   - nodeId is always present in the marker message
import { describe, expect, it } from 'vitest'

import { runFlowSemantics } from '@/lib/flows/semantic-validation-core'
import { buildNodeLineIndex, toFlowMarkers } from '@/lib/flows/semantic-markers'
import { serializeFlowToYaml } from '@/lib/flows/yaml-serialiser'
import type { FlowDefinition } from '@/types/flows'

function yamlOf(def: FlowDefinition): string {
  return serializeFlowToYaml(def)
}

describe('semantic markers: FLW-E001 duplicate node id', () => {
  it('emits a FLW-E001 marker anchored to the duplicate node line', () => {
    const def: FlowDefinition = {
      apiVersion: 'v1.0',
      name: 'dup',
      nodes: [
        { id: 'same', type: 'task', taskType: 'a', next: 'same' },
        { id: 'same', type: 'task', taskType: 'b' }
      ]
    }
    const yaml = yamlOf(def)
    const { parseable, markers } = runFlowSemantics({ yaml })
    expect(parseable).toBe(true)
    const e001 = markers.find((m) => m.code === 'FLW-E001')
    expect(e001, 'a FLW-E001 marker is present').toBeTruthy()
    expect(e001?.nodeId).toBe('same')
    expect(e001?.message).toContain('FLW-E001')
    expect(e001?.message).toContain('same')
    // The duplicate id appears twice; the marker line must point at a real id line (>1).
    const lineIndex = buildNodeLineIndex(yaml)
    expect(lineIndex.get('same')).toBeGreaterThan(1)
    expect(e001?.line).toBe(lineIndex.get('same'))
  })
})

describe('semantic markers: clean document', () => {
  it('produces no semantic markers for a well-formed flow', () => {
    const def: FlowDefinition = {
      apiVersion: 'v1.0',
      name: 'clean',
      nodes: [
        { id: 'a', type: 'task', taskType: 'a', next: 'b' },
        { id: 'b', type: 'task', taskType: 'b' }
      ]
    }
    const { parseable, markers } = runFlowSemantics({ yaml: yamlOf(def) })
    expect(parseable).toBe(true)
    expect(markers).toHaveLength(0)
  })
})

describe('semantic markers: degradation + anchoring details', () => {
  it('returns parseable=false and no markers for syntactically invalid YAML', () => {
    const { parseable, markers } = runFlowSemantics({ yaml: 'name: [oops\nnodes: - bad' })
    expect(parseable).toBe(false)
    expect(markers).toHaveLength(0)
  })

  it('anchors a dangling-reference (FLW-E003) marker to the offending node line', () => {
    const def: FlowDefinition = {
      apiVersion: 'v1.0',
      name: 'dangling',
      nodes: [{ id: 'start', type: 'task', taskType: 'a', next: 'ghost' }]
    }
    const yaml = yamlOf(def)
    const { markers } = runFlowSemantics({ yaml })
    const e003 = markers.find((m) => m.code === 'FLW-E003')
    expect(e003?.nodeId).toBe('start')
    expect(e003?.line).toBe(buildNodeLineIndex(yaml).get('start'))
  })

  it('falls back to line 1 with nodeId in the message when no line is derivable', () => {
    const markers = toFlowMarkers(
      [{ code: 'FLW-E007', nodeId: 'triggers[0]', message: 'bad cron' }],
      'apiVersion: v1.0\nname: x\nnodes:\n  - id: a\n    type: task\n    taskType: a\n'
    )
    expect(markers[0].line).toBe(1)
    expect(markers[0].message).toContain('triggers[0]')
  })

  it('honours the task-type catalog for FLW-E006', () => {
    const def: FlowDefinition = {
      apiVersion: 'v1.0',
      name: 'cat',
      nodes: [{ id: 'a', type: 'task', taskType: 'unknown-task' }]
    }
    const yaml = yamlOf(def)
    const withCatalog = runFlowSemantics({ yaml, taskTypeCatalog: ['known-task'] })
    expect(withCatalog.markers.some((m) => m.code === 'FLW-E006')).toBe(true)
    const withoutCatalog = runFlowSemantics({ yaml })
    expect(withoutCatalog.markers.some((m) => m.code === 'FLW-E006')).toBe(false)
  })
})
