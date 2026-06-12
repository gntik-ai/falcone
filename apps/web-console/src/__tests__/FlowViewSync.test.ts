// Pure tests for the view-switcher state machine (change: add-console-flow-yaml-editor).
//
// Drives the reducer directly (no DOM, no Monaco) to cover the dirty-state, conflict and
// graceful-degradation spec scenarios:
//   - Default mode is canvas
//   - Switching from dirty (valid) YAML to canvas flushes edits
//   - Switching from invalid YAML to canvas is blocked + banner + stays in YAML
//   - Canvas shows last-valid graph during invalid YAML, draft-save guard is off
//   - Recovery on a valid edit clears the banner and updates the model
import { describe, expect, it } from 'vitest'

import {
  canSaveDraft,
  canvasDefinition,
  initViewSync,
  makeViewSyncReducer,
  type ViewSyncDeps
} from '@/lib/flows/view-sync'
import { parseYamlToFlow, serializeFlowToYaml } from '@/lib/flows/yaml-serialiser'
import type { FlowDefinition } from '@/types/flows'

const deps: ViewSyncDeps = {
  parse: parseYamlToFlow,
  serialize: serializeFlowToYaml
}
const reducer = makeViewSyncReducer(deps)

function baseDef(): FlowDefinition {
  return {
    apiVersion: 'v1.0',
    name: 'base',
    nodes: [
      { id: 'a', type: 'task', taskType: 'a', next: 'b' },
      { id: 'b', type: 'task', taskType: 'b' }
    ]
  }
}

describe('view-sync: defaults', () => {
  it('starts in canvas mode, clean, not invalid', () => {
    const state = initViewSync(baseDef(), deps)
    expect(state.mode).toBe('canvas')
    expect(state.dirty).toBe(false)
    expect(state.yamlInvalid).toBe(false)
    expect(state.banner).toBeNull()
    expect(canSaveDraft(state)).toBe(true)
  })
})

describe('view-sync: dirty YAML -> canvas flushes edits', () => {
  it('advances the last-valid model on a valid YAML edit and reflects it on the canvas', () => {
    let state = initViewSync(baseDef(), deps, 'yaml')
    const editedDef: FlowDefinition = {
      ...baseDef(),
      nodes: [
        { id: 'a', type: 'task', taskType: 'CHANGED', next: 'b' },
        { id: 'b', type: 'task', taskType: 'b' }
      ]
    }
    state = reducer(state, { type: 'EDIT_YAML', yaml: serializeFlowToYaml(editedDef) })
    expect(state.dirty).toBe(true)
    expect(state.yamlInvalid).toBe(false)
    // Switch to canvas: the flushed model carries the YAML change.
    state = reducer(state, { type: 'SET_MODE', mode: 'canvas' })
    expect(state.mode).toBe('canvas')
    const onCanvas = canvasDefinition(state)
    expect(onCanvas.nodes[0]).toMatchObject({ taskType: 'CHANGED' })
  })
})

describe('view-sync: invalid YAML blocks switch', () => {
  it('blocks canvas switch, shows a banner, stays in YAML, protects the draft', () => {
    let state = initViewSync(baseDef(), deps, 'yaml')
    state = reducer(state, { type: 'EDIT_YAML', yaml: 'name: [broken\nnodes: - x' })
    expect(state.yamlInvalid).toBe(true)
    expect(state.banner).toBeTruthy()
    expect(canSaveDraft(state)).toBe(false)
    // Canvas still shows the last-valid graph (degradation).
    expect(canvasDefinition(state).nodes[0]).toMatchObject({ taskType: 'a' })

    const blocked = reducer(state, { type: 'SET_MODE', mode: 'canvas' })
    expect(blocked.mode).toBe('yaml') // switch did NOT complete
    expect(blocked.banner).toBeTruthy()
  })

  it('also blocks the side-by-side switch while invalid', () => {
    let state = initViewSync(baseDef(), deps, 'yaml')
    state = reducer(state, { type: 'EDIT_YAML', yaml: ': : :' })
    const blocked = reducer(state, { type: 'SET_MODE', mode: 'side-by-side' })
    expect(blocked.mode).toBe('yaml')
    expect(blocked.banner).toBeTruthy()
  })
})

describe('view-sync: recovery', () => {
  it('clears the banner and updates the model when YAML becomes valid again', () => {
    let state = initViewSync(baseDef(), deps, 'yaml')
    state = reducer(state, { type: 'EDIT_YAML', yaml: 'name: [broken' })
    expect(state.yamlInvalid).toBe(true)
    const fixedDef: FlowDefinition = {
      ...baseDef(),
      nodes: [{ id: 'a', type: 'task', taskType: 'recovered' }]
    }
    state = reducer(state, { type: 'EDIT_YAML', yaml: serializeFlowToYaml(fixedDef) })
    expect(state.yamlInvalid).toBe(false)
    expect(state.banner).toBeNull()
    expect(canSaveDraft(state)).toBe(true)
    expect(canvasDefinition(state).nodes[0]).toMatchObject({ taskType: 'recovered' })
    // Now the switch succeeds.
    state = reducer(state, { type: 'SET_MODE', mode: 'canvas' })
    expect(state.mode).toBe('canvas')
  })
})

describe('view-sync: canvas edit re-derives YAML (comment policy)', () => {
  it('a canvas edit replaces the buffer with canonical comment-free YAML', () => {
    let state = initViewSync(baseDef(), deps, 'yaml')
    state = reducer(state, { type: 'EDIT_YAML', yaml: `# note\n${serializeFlowToYaml(baseDef())}` })
    expect(state.yamlText).toMatch(/# note/)
    state = reducer(state, { type: 'EDIT_CANVAS', definition: baseDef() })
    expect(state.yamlText).not.toMatch(/# note/)
  })
})
