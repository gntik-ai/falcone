// Unit tests for the shared Table primitive (change: add-757-console-dataplane-design-system).
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table'

function renderSampleTable() {
  return render(
    <Table aria-label="Sample table">
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>State</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>alpha</TableCell>
          <TableCell>active</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  )
}

describe('Table', () => {
  it('renders one header style behind a data-slot hook', () => {
    const { container } = renderSampleTable()

    const table = screen.getByRole('table', { name: 'Sample table' })
    expect(table.getAttribute('data-slot')).toBe('table')
    expect(container.querySelector('[data-slot="table-container"]')).toBeInTheDocument()
    expect(container.querySelector('[data-slot="table-header"]')).toBeInTheDocument()
    expect(container.querySelector('[data-slot="table-body"]')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'alpha' })).toBeInTheDocument()
  })

  it('keeps the shared header idiom (bg-muted uppercase) by default', () => {
    renderSampleTable()
    const header = screen.getByRole('columnheader', { name: 'Name' }).closest('thead')
    expect(header?.className).toMatch(/bg-muted\/50/)
    expect(header?.className).toMatch(/uppercase/)
  })
})
