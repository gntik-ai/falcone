// Flow view switcher: canvas <-> YAML <-> side-by-side (change: add-console-flow-yaml-editor).
//
// Two synchronised views of ONE canonical document (the YAML). The pure reducer in
// lib/flows/view-sync.ts owns the dirty-state, conflict and graceful-degradation rules; this
// component is the presentational shell:
//   - three mutually-exclusive mode buttons reflecting the active mode;
//   - the canvas is supplied by the caller as a render prop (renderCanvas) and is always fed
//     the LAST-VALID definition, so an in-progress invalid YAML edit degrades gracefully;
//   - the YAML pane is the FlowYamlEditor (Monaco, lazily loaded);
//   - banners surface a blocked switch (invalid YAML) and the degraded-canvas warning.
//
// The publish/save path is unchanged: this component never calls the server; the host page's
// Save/Publish buttons remain authoritative (server-side validation per add-flows-control-plane-api).
import { useCallback, useMemo, useReducer } from 'react'

import { FlowYamlEditor, type FlowEditorValidity } from '@/components/flows/FlowYamlEditor'
import { Button } from '@/components/ui/button'
import {
  canSaveDraft,
  canvasDefinition,
  initViewSync,
  makeViewSyncReducer,
  type ViewMode,
  type ViewSyncDeps
} from '@/lib/flows/view-sync'
import { parseYamlToFlow, serializeFlowToYaml } from '@/lib/flows/yaml-serialiser'
import type { FlowDefinition } from '@/types/flows'

export interface FlowViewSwitcherProps {
  definition: FlowDefinition
  taskTypeCatalog?: string[]
  // Render the canvas for the supplied (last-valid) definition. Returning the existing
  // designer canvas keeps the two views in sync without this component knowing about React Flow.
  renderCanvas: (definition: FlowDefinition) => React.ReactNode
  // Notified whenever the canonical document changes (host persists the draft when allowed).
  onDocumentChange?: (definition: FlowDefinition, canSave: boolean) => void
  initialMode?: ViewMode
}

const MODES: Array<{ id: ViewMode; label: string }> = [
  { id: 'canvas', label: 'Canvas' },
  { id: 'yaml', label: 'YAML' },
  { id: 'side-by-side', label: 'Side by side' }
]

const deps: ViewSyncDeps = { parse: parseYamlToFlow, serialize: serializeFlowToYaml }
const reducer = makeViewSyncReducer(deps)

export function FlowViewSwitcher({
  definition,
  taskTypeCatalog,
  renderCanvas,
  onDocumentChange,
  initialMode = 'canvas'
}: FlowViewSwitcherProps) {
  const [state, dispatch] = useReducer(
    reducer,
    { definition, initialMode },
    ({ definition: def, initialMode: mode }) => initViewSync(def, deps, mode)
  )

  const setMode = useCallback((mode: ViewMode) => {
    dispatch({ type: 'SET_MODE', mode })
  }, [])

  const onYamlChange = useCallback(
    (yaml: string) => {
      dispatch({ type: 'EDIT_YAML', yaml })
    },
    []
  )

  // Surface validity from the editor; the draft-save guard is `canSaveDraft(state)` and is
  // recomputed from the reducer (yamlInvalid) — onValidityChange is used for marker-driven
  // semantic validity, which also blocks save when there are FLW-E markers.
  const onValidityChange = useCallback(
    (validity: FlowEditorValidity) => {
      const allowSave = validity.valid && canSaveDraft({ ...state, yamlInvalid: !validity.parseable })
      onDocumentChange?.(canvasDefinition(state), allowSave)
    },
    [onDocumentChange, state]
  )

  const showCanvas = state.mode === 'canvas' || state.mode === 'side-by-side'
  const showYaml = state.mode === 'yaml' || state.mode === 'side-by-side'
  const degraded = state.yamlInvalid && showCanvas
  const currentDefinition = useMemo(() => canvasDefinition(state), [state])

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="flow-view-switcher" data-mode={state.mode}>
      <div className="flex items-center gap-1 border-b border-border px-3 py-1.5" role="tablist" aria-label="Flow view">
        {MODES.map((mode) => (
          <Button
            key={mode.id}
            size="sm"
            variant={state.mode === mode.id ? 'default' : 'ghost'}
            role="tab"
            aria-selected={state.mode === mode.id}
            data-testid={`view-mode-${mode.id}`}
            data-active={String(state.mode === mode.id)}
            onClick={() => setMode(mode.id)}
          >
            {mode.label}
          </Button>
        ))}
      </div>

      {state.banner ? (
        <p
          data-testid="flow-view-banner"
          className="border-b border-border bg-amber-50 px-3 py-1 text-xs text-amber-700"
          role="alert"
        >
          {state.banner}
        </p>
      ) : null}

      <div className={`flex min-h-0 flex-1 ${state.mode === 'side-by-side' ? 'flex-row' : 'flex-col'}`}>
        {showCanvas ? (
          <div
            className="min-h-0 min-w-0 flex-1"
            data-testid="flow-canvas-pane"
            data-degraded={String(degraded)}
          >
            {degraded ? (
              <p
                data-testid="flow-canvas-degraded-banner"
                className="bg-amber-100 px-3 py-1 text-xs text-amber-800"
                role="status"
              >
                Showing the last valid version. Fix the YAML to resume editing on the canvas.
              </p>
            ) : null}
            {renderCanvas(currentDefinition)}
          </div>
        ) : null}

        {showYaml ? (
          <div className="min-h-0 min-w-0 flex-1 border-border data-[sbs=true]:border-l" data-sbs={String(state.mode === 'side-by-side')} data-testid="flow-yaml-pane">
            <FlowYamlEditor
              value={state.yamlText}
              onChange={onYamlChange}
              taskTypeCatalog={taskTypeCatalog}
              onValidityChange={onValidityChange}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default FlowViewSwitcher
