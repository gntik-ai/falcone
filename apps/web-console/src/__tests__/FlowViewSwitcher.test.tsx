// Component test for FlowViewSwitcher (change: add-console-flow-yaml-editor).
//
// Mocks FlowYamlEditor (and therefore Monaco) with a textarea stub so the switcher's mode,
// dirty-state, conflict and degradation behaviours are exercised in jsdom. Covers the spec
// scenarios: default mode is canvas; clicking YAML renders the editor; side-by-side renders
// both panes; invalid YAML blocks the switch with a banner; recovery clears it.
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Stub FlowYamlEditor: a textarea bound to value/onChange. It also calls onValidityChange so
// the switcher's save-guard path runs, mirroring the real editor's contract.
vi.mock('@/components/flows/FlowYamlEditor', () => ({
  FlowYamlEditor: ({
    value,
    onChange
  }: {
    value: string
    onChange: (v: string) => void
  }) => (
    <textarea
      data-testid="yaml-editor-stub"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}))

import { FlowViewSwitcher } from '@/components/flows/FlowViewSwitcher'
import type { FlowDefinition } from '@/types/flows'

function definition(): FlowDefinition {
  return {
    apiVersion: 'v1.0',
    name: 'switch-me',
    nodes: [
      { id: 'a', type: 'task', taskType: 'a', next: 'b' },
      { id: 'b', type: 'task', taskType: 'b' }
    ]
  }
}

function renderSwitcher(initialMode?: 'canvas' | 'yaml' | 'side-by-side') {
  return render(
    <FlowViewSwitcher
      definition={definition()}
      initialMode={initialMode}
      renderCanvas={(def) => (
        <div data-testid="canvas-stub" data-name={def.name} data-first-task={def.nodes[0]?.type}>
          canvas: {def.nodes.length} nodes
        </div>
      )}
    />
  )
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('FlowViewSwitcher: modes', () => {
  it('defaults to canvas mode with only the canvas pane visible', () => {
    renderSwitcher()
    expect(screen.getByTestId('flow-view-switcher')).toHaveAttribute('data-mode', 'canvas')
    expect(screen.getByTestId('view-mode-canvas')).toHaveAttribute('data-active', 'true')
    expect(screen.getByTestId('flow-canvas-pane')).toBeInTheDocument()
    expect(screen.queryByTestId('flow-yaml-pane')).toBeNull()
  })

  it('renders the editor when YAML mode is clicked, hiding the canvas', async () => {
    renderSwitcher()
    await userEvent.click(screen.getByTestId('view-mode-yaml'))
    expect(screen.getByTestId('flow-view-switcher')).toHaveAttribute('data-mode', 'yaml')
    expect(screen.getByTestId('flow-yaml-pane')).toBeInTheDocument()
    expect(screen.getByTestId('yaml-editor-stub')).toBeInTheDocument()
    expect(screen.queryByTestId('flow-canvas-pane')).toBeNull()
  })

  it('renders both panes in side-by-side mode', async () => {
    renderSwitcher()
    expect(screen.getByRole('tablist', { name: /vista del flujo/i })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: /lado a lado/i }))
    expect(screen.getByTestId('flow-canvas-pane')).toBeInTheDocument()
    expect(screen.getByTestId('flow-yaml-pane')).toBeInTheDocument()
  })
})

describe('FlowViewSwitcher: dirty -> canvas flush', () => {
  it('reflects a valid YAML edit on the canvas after switching back', async () => {
    renderSwitcher('yaml')
    const textarea = screen.getByTestId('yaml-editor-stub')
    const edited = `apiVersion: v1.0
name: edited-name
nodes:
  - id: a
    type: task
    taskType: a
`
    // Replace the whole document with a valid edit.
    await userEvent.clear(textarea)
    await userEvent.paste(edited)
    await userEvent.click(screen.getByTestId('view-mode-canvas'))
    await waitFor(() => {
      expect(screen.getByTestId('canvas-stub')).toHaveAttribute('data-name', 'edited-name')
    })
  })
})

describe('FlowViewSwitcher: invalid YAML blocks the switch', () => {
  it('blocks canvas switch, shows a banner, and stays in YAML', async () => {
    renderSwitcher('yaml')
    const textarea = screen.getByTestId('yaml-editor-stub')
    await userEvent.clear(textarea)
    await userEvent.paste('name: [unterminated\nnodes: - x')
    await userEvent.click(screen.getByTestId('view-mode-canvas'))
    // Switch did not complete; still in YAML; a banner explains why.
    expect(screen.getByTestId('flow-view-switcher')).toHaveAttribute('data-mode', 'yaml')
    const banner = screen.getByTestId('flow-view-banner')
    expect(banner).toHaveTextContent('No se puede cambiar de vista')
    expect(banner).toHaveTextContent('Corrige primero los errores resaltados')
    expect(banner).not.toHaveTextContent('Cannot switch views')
    expect(banner).not.toHaveTextContent('Fix the highlighted errors first')
  })

  it('shows the degraded canvas banner in side-by-side while YAML is invalid', async () => {
    renderSwitcher('side-by-side')
    const textarea = screen.getByTestId('yaml-editor-stub')
    await userEvent.clear(textarea)
    await userEvent.paste('name: [broken')
    await waitFor(() => {
      expect(screen.getByTestId('flow-canvas-pane')).toHaveAttribute('data-degraded', 'true')
      expect(screen.getByTestId('flow-view-banner')).toHaveTextContent('El YAML no es válido')
      expect(screen.getByTestId('flow-view-banner')).not.toHaveTextContent('YAML is invalid')
      expect(screen.getByTestId('flow-view-banner')).not.toHaveTextContent('draft will not be saved')
      expect(screen.getByTestId('flow-canvas-degraded-banner')).toHaveTextContent('Se muestra la última versión válida')
    })
  })

  it('clears the banner and allows the switch once the YAML is valid again', async () => {
    renderSwitcher('yaml')
    const textarea = screen.getByTestId('yaml-editor-stub')
    await userEvent.clear(textarea)
    await userEvent.paste('name: [broken')
    await userEvent.click(screen.getByTestId('view-mode-canvas'))
    expect(screen.getByTestId('flow-view-switcher')).toHaveAttribute('data-mode', 'yaml')

    await userEvent.clear(textarea)
    await userEvent.paste(`apiVersion: v1.0
name: fixed
nodes:
  - id: a
    type: task
    taskType: a
`)
    await userEvent.click(screen.getByTestId('view-mode-canvas'))
    await waitFor(() => {
      expect(screen.getByTestId('flow-view-switcher')).toHaveAttribute('data-mode', 'canvas')
    })
    expect(screen.queryByTestId('flow-view-banner')).toBeNull()
  })
})
