// Component test for FlowYamlEditor (change: add-console-flow-yaml-editor).
//
// Monaco cannot run under jsdom, so the heavy MonacoYamlSurface is mocked with a plain
// <textarea> stub that bubbles changes through the same onChange contract. The worker is also
// unavailable in jsdom, so the editor falls back to its synchronous validation path — exactly
// the behaviour we assert: invalid/semantically-broken YAML drives onValidityChange.valid=false
// (the draft-save guard the host reads), and a clean document drives valid=true.
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Mock the lazily-imported Monaco surface with a controllable textarea. The default export is
// what React.lazy resolves to.
vi.mock('@/components/flows/MonacoYamlSurface', () => ({
  default: ({
    value,
    onChange,
    semanticMarkers
  }: {
    value: string
    onChange: (v: string) => void
    semanticMarkers: Array<{ code: string }>
  }) => (
    <div data-testid="monaco-yaml-surface-stub">
      <textarea
        data-testid="yaml-textarea"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <ul data-testid="semantic-markers">
        {semanticMarkers.map((marker, index) => (
          <li key={index} data-code={marker.code}>
            {marker.code}
          </li>
        ))}
      </ul>
    </div>
  )
}))

import { FlowYamlEditor, type FlowEditorValidity } from '@/components/flows/FlowYamlEditor'

const VALID_YAML = `apiVersion: v1.0
name: ok
nodes:
  - id: a
    type: task
    taskType: a
    next: b
  - id: b
    type: task
    taskType: b
`

afterEach(() => {
  vi.clearAllMocks()
})

describe('FlowYamlEditor', () => {
  it('mounts the Monaco surface after the lazy import resolves', async () => {
    render(<FlowYamlEditor value={VALID_YAML} onChange={() => {}} />)
    expect(await screen.findByTestId('monaco-yaml-surface-stub')).toBeInTheDocument()
    expect(screen.getByTestId('flow-yaml-editor')).toHaveAttribute('data-yaml-valid', 'true')
  })

  it('reports valid=true and no semantic markers for a clean document', async () => {
    const validity: FlowEditorValidity[] = []
    render(
      <FlowYamlEditor
        value={VALID_YAML}
        onChange={() => {}}
        onValidityChange={(v) => validity.push(v)}
      />
    )
    await screen.findByTestId('monaco-yaml-surface-stub')
    await waitFor(() => expect(validity.length).toBeGreaterThan(0))
    const last = validity.at(-1)!
    expect(last.parseable).toBe(true)
    expect(last.valid).toBe(true)
    expect(last.markers).toHaveLength(0)
  })

  it('surfaces a FLW-E001 marker and reports valid=false on a duplicate node id', async () => {
    const duplicate = `apiVersion: v1.0
name: dup
nodes:
  - id: same
    type: task
    taskType: a
  - id: same
    type: task
    taskType: b
`
    const validity: FlowEditorValidity[] = []
    render(
      <FlowYamlEditor
        value={duplicate}
        onChange={() => {}}
        onValidityChange={(v) => validity.push(v)}
      />
    )
    await screen.findByTestId('monaco-yaml-surface-stub')
    await waitFor(() => {
      const markers = screen.getByTestId('semantic-markers')
      expect(markers.querySelector('[data-code="FLW-E001"]')).not.toBeNull()
    })
    const last = validity.at(-1)!
    expect(last.valid).toBe(false)
    expect(last.markers.some((m) => m.code === 'FLW-E001')).toBe(true)
  })

  it('marks data-yaml-valid=false and reports valid=false for syntactically invalid YAML', async () => {
    const validity: FlowEditorValidity[] = []
    render(
      <FlowYamlEditor
        value={'name: [unterminated\nnodes: - x'}
        onChange={() => {}}
        onValidityChange={(v) => validity.push(v)}
      />
    )
    await screen.findByTestId('monaco-yaml-surface-stub')
    await waitFor(() => expect(validity.length).toBeGreaterThan(0))
    expect(screen.getByTestId('flow-yaml-editor')).toHaveAttribute('data-yaml-valid', 'false')
    expect(validity.at(-1)!.parseable).toBe(false)
    expect(validity.at(-1)!.valid).toBe(false)
  })

  it('propagates edits through onChange and re-validates', async () => {
    const onChange = vi.fn()
    const validity: FlowEditorValidity[] = []
    render(
      <FlowYamlEditor
        value={VALID_YAML}
        onChange={onChange}
        onValidityChange={(v) => validity.push(v)}
      />
    )
    const textarea = await screen.findByTestId('yaml-textarea')
    await userEvent.clear(textarea)
    await userEvent.type(textarea, 'x')
    expect(onChange).toHaveBeenCalled()
  })
})
