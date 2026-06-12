// View-switcher synchronisation state machine (change: add-console-flow-yaml-editor).
//
// A pure, framework-free reducer modelling the canvas <-> YAML <-> side-by-side switcher so
// the dirty-state, conflict, and graceful-degradation rules are testable without a DOM or
// Monaco. The React component (FlowViewSwitcher) is a thin shell over this reducer.
//
// Invariants (from the workflows spec):
//   - YAML is the canonical document. `lastValidYaml`/`lastValidDefinition` always hold the
//     most recent SYNTACTICALLY valid state; an invalid edit never overwrites them.
//   - Switching from YAML to canvas/side-by-side flushes valid YAML edits into the model
//     (commitYaml) BEFORE the switch; an invalid YAML blocks the switch and surfaces a banner.
//   - While the YAML is invalid the canvas shows the last-valid graph with a warning banner
//     and the draft-save guard (canSaveDraft) is false, so no PATCH /flows/:id is issued.

import type { FlowDefinition } from '@/types/flows'

export type ViewMode = 'canvas' | 'yaml' | 'side-by-side'

export interface ViewSyncState {
  mode: ViewMode
  // Current editor buffer (may be invalid mid-edit).
  yamlText: string
  // Last syntactically valid YAML / its parsed definition — the canvas authority.
  lastValidYaml: string
  lastValidDefinition: FlowDefinition
  // True while `yamlText` is NOT syntactically valid YAML.
  yamlInvalid: boolean
  // Unsaved edits exist relative to the last persisted draft.
  dirty: boolean
  // Transient banner shown on a blocked switch / degraded canvas.
  banner: string | null
}

export interface ViewSyncDeps {
  // Inject the parse so the reducer stays free of the yaml dependency (and so tests can
  // exercise the state logic deterministically). Returns the parsed definition or throws.
  parse: (yaml: string) => FlowDefinition
  // Inject the serialise so a canvas edit (definition) re-derives canonical YAML.
  serialize: (definition: FlowDefinition) => string
}

export function initViewSync(
  definition: FlowDefinition,
  deps: ViewSyncDeps,
  mode: ViewMode = 'canvas'
): ViewSyncState {
  const yaml = deps.serialize(definition)
  return {
    mode,
    yamlText: yaml,
    lastValidYaml: yaml,
    lastValidDefinition: definition,
    yamlInvalid: false,
    dirty: false,
    banner: null
  }
}

export type ViewSyncAction =
  | { type: 'EDIT_YAML'; yaml: string }
  | { type: 'EDIT_CANVAS'; definition: FlowDefinition }
  | { type: 'SET_MODE'; mode: ViewMode }
  | { type: 'MARK_SAVED' }
  | { type: 'DISMISS_BANNER' }

// The reducer needs the deps; expose a factory so React can `useReducer` over a bound reducer.
export function makeViewSyncReducer(deps: ViewSyncDeps) {
  return function reducer(state: ViewSyncState, action: ViewSyncAction): ViewSyncState {
    switch (action.type) {
      case 'EDIT_YAML': {
        let parsed: FlowDefinition | null = null
        try {
          parsed = deps.parse(action.yaml)
        } catch {
          parsed = null
        }
        if (parsed) {
          // Valid edit: advance the last-valid authority and clear any degradation banner.
          return {
            ...state,
            yamlText: action.yaml,
            lastValidYaml: action.yaml,
            lastValidDefinition: parsed,
            yamlInvalid: false,
            dirty: true,
            banner: null
          }
        }
        // Invalid edit: keep last-valid model untouched; mark invalid + warn.
        return {
          ...state,
          yamlText: action.yaml,
          yamlInvalid: true,
          dirty: true,
          banner: 'YAML is invalid — the canvas shows the last valid version and the draft will not be saved until you fix it.'
        }
      }
      case 'EDIT_CANVAS': {
        // A canvas edit re-derives canonical YAML (comments discarded — see serialiser policy).
        const yaml = deps.serialize(action.definition)
        return {
          ...state,
          yamlText: yaml,
          lastValidYaml: yaml,
          lastValidDefinition: action.definition,
          yamlInvalid: false,
          dirty: true,
          banner: null
        }
      }
      case 'SET_MODE': {
        const leavingYaml = state.mode === 'yaml' || state.mode === 'side-by-side'
        const enteringCanvas = action.mode === 'canvas' || action.mode === 'side-by-side'
        // Conflict guard: leaving a YAML pane for the canvas while the YAML is invalid blocks
        // the switch and explains why — the user stays put.
        if (leavingYaml && enteringCanvas && state.yamlInvalid) {
          return {
            ...state,
            banner: 'Cannot switch views: the YAML is syntactically invalid. Fix the highlighted errors first.'
          }
        }
        // Valid switch: the last-valid model is already current (EDIT_YAML kept it in sync),
        // so the canvas will reflect the flushed edits.
        return { ...state, mode: action.mode, banner: null }
      }
      case 'MARK_SAVED':
        return { ...state, dirty: false }
      case 'DISMISS_BANNER':
        return { ...state, banner: null }
      default:
        return state
    }
  }
}

// Draft-save guard: a draft may be persisted only when the document is syntactically valid.
// Wired at the auto-save call site so an invalid YAML never triggers PATCH /flows/:id.
export function canSaveDraft(state: ViewSyncState): boolean {
  return !state.yamlInvalid
}

// The graph the canvas should render right now: always the last-valid definition, so an
// invalid in-progress YAML edit degrades to the last good graph rather than blanking out.
export function canvasDefinition(state: ViewSyncState): FlowDefinition {
  return state.lastValidDefinition
}
