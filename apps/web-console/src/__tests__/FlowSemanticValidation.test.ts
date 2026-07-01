// bbx: client-side semantic validation via the SHARED contract validator
// (change: add-console-flow-designer).
import { describe, expect, it } from 'vitest'

import {
  groupErrorsByNode,
  isExpressionParseable,
  validateFlowSemantics
} from '@/components/flows/semanticValidation'
import type { FlowDefinition } from '@/types/flows'

function definition(nodes: FlowDefinition['nodes']): FlowDefinition {
  return { apiVersion: 'v1.0', name: 'spec', nodes }
}

describe('validateFlowSemantics (shared FLW rule set)', () => {
  it('flags duplicate node IDs with FLW-E001 on the affected node', () => {
    const errors = validateFlowSemantics(
      definition([
        { id: 'step-1', type: 'task', taskType: 'send-email' },
        { id: 'step-1', type: 'task', taskType: 'send-email' }
      ])
    )
    const e001 = errors.filter((error) => error.code === 'FLW-E001')
    expect(e001).toHaveLength(1)
    expect(e001[0]?.nodeId).toBe('step-1')
    expect(e001[0]?.message).toBe('ID de nodo duplicado "step-1"; los ID de nodo deben ser únicos dentro del flujo.')

    const byNode = groupErrorsByNode(errors)
    expect(byNode.get('step-1')?.some((error) => error.code === 'FLW-E001')).toBe(true)
  })

  it('flags a cycle with FLW-E002', () => {
    const errors = validateFlowSemantics(
      definition([
        { id: 'a', type: 'task', taskType: 'send-email', next: 'b' },
        { id: 'b', type: 'task', taskType: 'send-email', next: 'a' }
      ])
    )
    expect(errors.some((error) => error.code === 'FLW-E002')).toBe(true)
  })

  it('flags a dangling next reference with FLW-E003 on the originating node', () => {
    const errors = validateFlowSemantics(
      definition([{ id: 'a', type: 'task', taskType: 'send-email', next: 'ghost' }])
    )
    const e003 = errors.filter((error) => error.code === 'FLW-E003')
    expect(e003).toHaveLength(1)
    expect(e003[0]?.nodeId).toBe('a')
  })

  it('flags an unknown taskType with FLW-E006 when a catalog is provided', () => {
    const errors = validateFlowSemantics(
      definition([{ id: 'a', type: 'task', taskType: 'not-in-catalog' }]),
      { taskTypeCatalog: ['send-email', 'http-request'] }
    )
    const e006 = errors.find((error) => error.code === 'FLW-E006' && error.nodeId === 'a')
    expect(e006?.message).toBe(
      'Tipo de tarea desconocido "not-in-catalog"; no está presente en el catálogo de tipos de tarea.'
    )
  })

  it('flags an unparseable branch arm expression with FLW-E005', () => {
    const errors = validateFlowSemantics(
      definition([
        { id: 'br', type: 'branch', arms: [{ when: 'input.total >', next: 'a' }, { when: 'true', next: 'a' }] },
        { id: 'a', type: 'task', taskType: 'send-email' }
      ])
    )
    const e005 = errors.find((error) => error.code === 'FLW-E005' && error.nodeId === 'br')
    expect(e005?.message).toBe('La expresión "input.total >" no puede analizarse con el motor cel.')
  })

  it('returns an empty list for a clean graph', () => {
    const errors = validateFlowSemantics(
      definition([
        { id: 'a', type: 'task', taskType: 'send-email', next: 'b' },
        { id: 'b', type: 'wait', duration: 'PT10M' }
      ]),
      { taskTypeCatalog: ['send-email'] }
    )
    expect(errors).toEqual([])
  })
})

describe('isExpressionParseable (FLW-E005 inline feedback)', () => {
  it('accepts a valid CEL expression', () => {
    expect(isExpressionParseable('input.total > 100')).toBe(true)
  })

  it('rejects a syntactically invalid expression', () => {
    expect(isExpressionParseable('input.total >')).toBe(false)
  })

  it('rejects an empty expression', () => {
    expect(isExpressionParseable('')).toBe(false)
  })
})
