import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { FlowProblemsPanel } from './FlowProblemsPanel'

describe('FlowProblemsPanel', () => {
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
      { code: 'FLW-E999', nodeId: null, message: 'Internal server failure' }
    ]} />)
    expect(screen.getByText('Los ID de nodo deben ser únicos dentro del flujo.')).toBeInTheDocument()
    expect(screen.getByText('La validación del flujo encontró un error.')).toBeInTheDocument()
    expect(screen.queryByText('Duplicate node ID "dup"')).not.toBeInTheDocument()
    expect(screen.queryByText('Internal server failure')).not.toBeInTheDocument()
  })
})
