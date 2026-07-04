// Unit tests for the shared Card primitive (change: add-757-console-dataplane-design-system).
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './card'

describe('Card', () => {
  it('renders the shared card idiom with a data-slot hook', () => {
    const { container } = render(
      <Card data-testid="card-root">
        <CardHeader>
          <CardTitle>Title</CardTitle>
          <CardDescription>Description</CardDescription>
        </CardHeader>
        <CardContent>Body</CardContent>
      </Card>
    )

    const card = screen.getByTestId('card-root')
    expect(card.getAttribute('data-slot')).toBe('card')
    expect(card.className).toMatch(/rounded-3xl/)
    expect(card.className).toMatch(/bg-card\/70/)
    expect(container.querySelector('[data-slot="card-header"]')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Title' })).toBeInTheDocument()
    expect(screen.getByText('Description')).toBeInTheDocument()
    expect(screen.getByText('Body')).toBeInTheDocument()
  })

  it('merges a custom className instead of dropping the shared idiom', () => {
    const { container } = render(<Card className="mt-4">content</Card>)
    const card = container.querySelector('[data-slot="card"]')
    expect(card?.className).toMatch(/mt-4/)
    expect(card?.className).toMatch(/rounded-3xl/)
  })
})
