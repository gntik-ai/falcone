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
            message: 'La expresión "input.total >" no puede analizarse con el motor cel.'
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
              'Tipo de tarea desconocido "not-in-catalog"; no está presente en el catálogo de tipos de tarea.'
          },
          {
            nodeId: 'triggers[0]',
            code: 'FLW-E007',
            message: 'La programación cron "0 9" no es una expresión cron POSIX válida (5 o 6 campos).'
          },
          {
            nodeId: 'pause',
            code: 'FLW-E008',
            message: 'La duración "30 seconds" del nodo de espera "pause" no es una duración ISO 8601 válida.'
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
})
