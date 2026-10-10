import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { FlowProblemsPanel } from './FlowProblemsPanel'
import { evaluateConnection } from './connectionRules'
import { definitionToNodes } from './flowGraphModel'

describe('FlowProblemsPanel', () => {
  it('preserves the Spanish connection rejection with both node IDs', () => {
    const verdict = evaluateConnection(
      { source: 'end', target: 'start' },
      [],
      [{ id: 'start-end', source: 'start', target: 'end' }]
    )
    expect(verdict.ok).toBe(false)

    render(<FlowProblemsPanel problems={[
      {
        source: 'interaction',
        code: verdict.code!,
        nodeId: 'end',
        message: verdict.message!
      },
      { code: 'FLW-E002', nodeId: 'start', message: 'Cycle detected on the server' }
    ]} />)

    expect(screen.getByText('Conectar "end" con "start" crearía un ciclo; el grafo de nodos debe ser acíclico (FLW-E002).')).toBeInTheDocument()
    expect(screen.getByText('El grafo de nodos contiene un ciclo.')).toBeInTheDocument()
    expect(screen.queryByText('Cycle detected on the server')).not.toBeInTheDocument()
  })

  const connectionNodes = definitionToNodes({
    apiVersion: 'v1.0',
    name: 'connection-rejections',
    nodes: [
      { id: 'branch-1', type: 'branch', arms: [{ when: 'true', next: 'task-1' }], default: 'end' },
      { id: 'task-1', type: 'task', taskType: 'noop' }
    ]
  })
  for (const scenario of [
    {
      code: 'INCOMPLETE',
      connection: { source: null, target: 'end' },
      edges: [],
      message: 'La conexión debe tener un nodo origen y un nodo destino.'
    },
    {
      code: 'SELF_LOOP',
      connection: { source: 'task-1', target: 'task-1' },
      edges: [],
      message: 'El nodo "task-1" no puede conectarse consigo mismo.'
    },
    {
      code: 'BRANCH_ARM_ARITY',
      connection: { source: 'branch-1', target: 'end', sourceHandle: 'arm-0' },
      edges: [{ id: 'occupied-arm', source: 'branch-1', target: 'task-1', sourceHandle: 'arm-0' }],
      message: 'El handle de rama "arm-0" del nodo "branch-1" ya tiene una conexión saliente.'
    },
    {
      code: 'NEXT_ARITY',
      connection: { source: 'task-1', target: 'end' },
      edges: [{ id: 'occupied-next', source: 'task-1', target: 'another-step' }],
      message: 'El nodo "task-1" ya tiene una conexión saliente; su tipo ("task") admite un solo siguiente paso.'
    }
  ]) {
    it(`preserves the console-owned ${scenario.code} explanation`, () => {
      const verdict = evaluateConnection(scenario.connection, connectionNodes, scenario.edges)
      expect(verdict.ok).toBe(false)
      expect(verdict.code).toBe(scenario.code)

      render(<FlowProblemsPanel problems={[
        {
          source: 'interaction',
          code: verdict.code!,
          nodeId: scenario.connection.source,
          message: verdict.message!
        }
      ]} />)

      expect(screen.getByText(scenario.message)).toBeInTheDocument()
    })
  }

  it('muestra el título del panel de validación en español', () => {
    render(
      <FlowProblemsPanel
        problems={[
          {
            nodeId: 'br',
            code: 'FLW-E005',
            message: 'Expression "input.total >" cannot be parsed by the cel engine.',
            params: { expression: 'input.total >', engine: 'cel' }
          }
        ]}
      />
    )

    expect(screen.getByText('Problemas (1)')).toBeInTheDocument()
    expect(screen.getByText('La expresión "input.total >" no puede analizarse con el motor cel.')).toBeInTheDocument()
  })

  it('renderiza diagnósticos semánticos FLW en español sin ocultar valores técnicos', () => {
    render(
      <FlowProblemsPanel
        problems={[
          {
            nodeId: 'step-1',
            code: 'FLW-E006',
            message:
              'Unknown task type "not-in-catalog"; it is not in the task-type catalog.',
            params: { taskType: 'not-in-catalog' }
          },
          {
            nodeId: 'triggers[0]',
            code: 'FLW-E007',
            message: 'Cron schedule "0 9" is not a valid POSIX cron expression (5 or 6 fields).',
            params: { schedule: '0 9' }
          },
          {
            nodeId: 'pause',
            code: 'FLW-E008',
            message: 'Duration "30 seconds" of wait node "pause" is not a valid ISO 8601 duration.',
            params: { duration: '30 seconds', nodeId: 'pause' }
          }
        ]}
      />
    )

    expect(screen.getByText('Problemas (3)')).toBeInTheDocument()
    expect(
      screen.getByText('Tipo de tarea desconocido "not-in-catalog"; no está presente en el catálogo de tipos de tarea.')
    ).toBeInTheDocument()
    expect(screen.getByText('La programación cron "0 9" no es una expresión cron POSIX válida (5 o 6 campos).')).toBeInTheDocument()
    expect(screen.getByText('La duración "30 seconds" del nodo de espera "pause" no es una duración ISO 8601 válida.')).toBeInTheDocument()
  })

  it('never renders raw server messages for unknown codes or absent params', () => {
    render(<FlowProblemsPanel problems={[
      { code: 'FLW-E001', nodeId: 'dup', message: 'Duplicate node ID "dup"' },
      { code: 'FLW-E002', nodeId: 'end', message: 'Cycle from end to start' },
      { code: 'SELF_LOOP', nodeId: 'task-1', message: 'Server says self-loop' },
      { code: 'FLW-E999', nodeId: null, message: 'Internal server failure' }
    ]} />)
    expect(screen.getByText('Los ID de nodo deben ser únicos dentro del flujo.')).toBeInTheDocument()
    expect(screen.getByText('El grafo de nodos contiene un ciclo.')).toBeInTheDocument()
    expect(screen.getAllByText('La validación del flujo encontró un error.')).toHaveLength(2)
    expect(screen.queryByText('Duplicate node ID "dup"')).not.toBeInTheDocument()
    expect(screen.queryByText('Cycle from end to start')).not.toBeInTheDocument()
    expect(screen.queryByText('Server says self-loop')).not.toBeInTheDocument()
    expect(screen.queryByText('Internal server failure')).not.toBeInTheDocument()
  })
})
