import { describe, expect, it } from 'vitest'

import { describeFlowValidationError } from './validation-errors'

const cases = [
  ['FLW-E001', { nodeId: 'dup' }, 'ID de nodo duplicado "dup"; los ID de nodo deben ser únicos dentro del flujo.'],
  ['FLW-E002', { nodeId: 'a' }, 'El grafo de nodos contiene un ciclo alcanzable desde el nodo "a".'],
  ['FLW-E003', { nodeId: 'start', target: 'ghost-node' }, 'El nodo "start" referencia el nodo desconocido "ghost-node".'],
  ['FLW-E004', { flowId: 'does-not-exist', flowVersion: 'v9.9' }, 'La referencia de subflujo does-not-exist@v9.9 no pudo resolverse.'],
  ['FLW-E005', { expression: 'amount > > 100', engine: 'cel' }, 'La expresión "amount > > 100" no puede analizarse con el motor cel.'],
  ['FLW-E006', { taskType: 'not-in-catalog' }, 'Tipo de tarea desconocido "not-in-catalog"; no está presente en el catálogo de tipos de tarea.'],
  ['FLW-E007', { schedule: '0 9' }, 'La programación cron "0 9" no es una expresión cron POSIX válida (5 o 6 campos).'],
  ['FLW-E008', { duration: '30 seconds', nodeId: 'pause' }, 'La duración "30 seconds" del nodo de espera "pause" no es una duración ISO 8601 válida.'],
  ['FLW-E009', { nodeId: 'decide' }, 'La rama "decide" necesita al menos dos brazos, o un brazo más una conexión predeterminada.']
] as const

const fallbacks = [
  'Los ID de nodo deben ser únicos dentro del flujo.',
  'El grafo de nodos contiene un ciclo.',
  'Una conexión referencia un nodo desconocido.',
  'No se pudo resolver una referencia de subflujo.',
  'No se pudo analizar una expresión con el motor configurado.',
  'El tipo de tarea no está presente en el catálogo.',
  'La programación cron no es válida (5 o 6 campos).',
  'La duración del nodo de espera no es una duración ISO 8601 válida.',
  'La rama necesita al menos dos brazos, o un brazo más una conexión predeterminada.'
]

describe('describeFlowValidationError', () => {
  for (const [index, [code, params, expected]] of cases.entries()) {
    it(`localizes ${code} without changing technical values`, () => {
      expect(describeFlowValidationError({ code, nodeId: 'node', params })).toBe(expected)
    })

    it(`uses Spanish fallback for ${code} without params`, () => {
      const error = { code, nodeId: 'node', message: 'Raw English server error' }
      expect(describeFlowValidationError(error)).toBe(fallbacks[index])
    })
  }

  it('never echoes an unknown server error', () => {
    const error = { code: 'FLW-E999', nodeId: 'node', params: { message: 'Internal failure' }, message: 'Internal failure' }
    expect(describeFlowValidationError(error)).toBe('La validación del flujo encontró un error.')
  })

  it('uses fallback when params are incomplete or malformed', () => {
    expect(describeFlowValidationError({ code: 'FLW-E005', nodeId: null, params: { expression: 'x' } })).toBe(fallbacks[4])
    expect(describeFlowValidationError({ code: 'FLW-E008', nodeId: 'pause', params: { duration: 30, nodeId: 'pause' } })).toBe(fallbacks[7])
  })
})
