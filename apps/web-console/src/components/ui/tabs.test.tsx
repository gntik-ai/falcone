// Unit tests for the shared Tabs primitive (change: add-757-console-dataplane-design-system).
// Covers the accessible contract the spec delta requires: role=tablist/tab, aria-selected,
// roving tabindex and ArrowLeft/ArrowRight/Home/End keyboard navigation.
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs'

function ControlledTabs() {
  const [value, setValue] = useState('a')
  return (
    <Tabs value={value} onValueChange={setValue}>
      <TabsList aria-label="Demo tabs">
        <TabsTrigger value="a">Tab A</TabsTrigger>
        <TabsTrigger value="b">Tab B</TabsTrigger>
        <TabsTrigger value="c">Tab C</TabsTrigger>
      </TabsList>
      <TabsContent value="a">Panel A</TabsContent>
      <TabsContent value="b">Panel B</TabsContent>
      <TabsContent value="c">Panel C</TabsContent>
    </Tabs>
  )
}

describe('Tabs', () => {
  it('renders a tablist with one selected tab and only the active panel', () => {
    render(<ControlledTabs />)

    const tablist = screen.getByRole('tablist', { name: 'Demo tabs' })
    expect(tablist).toBeInTheDocument()

    const tabA = screen.getByRole('tab', { name: 'Tab A' })
    const tabB = screen.getByRole('tab', { name: 'Tab B' })
    expect(tabA).toHaveAttribute('aria-selected', 'true')
    expect(tabB).toHaveAttribute('aria-selected', 'false')
    expect(tabA).toHaveAttribute('tabIndex', '0')
    expect(tabB).toHaveAttribute('tabIndex', '-1')

    expect(screen.getByText('Panel A')).toBeInTheDocument()
    expect(screen.queryByText('Panel B')).not.toBeInTheDocument()
  })

  it('activates a tab on click', async () => {
    const user = userEvent.setup()
    render(<ControlledTabs />)

    await user.click(screen.getByRole('tab', { name: 'Tab B' }))

    expect(screen.getByRole('tab', { name: 'Tab B' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Panel B')).toBeInTheDocument()
    expect(screen.queryByText('Panel A')).not.toBeInTheDocument()
  })

  it('supports ArrowRight/ArrowLeft/Home/End roving-tabindex keyboard navigation', async () => {
    const user = userEvent.setup()
    render(<ControlledTabs />)

    screen.getByRole('tab', { name: 'Tab A' }).focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Tab B' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Tab B' })).toHaveFocus()

    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Tab C' })).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{ArrowRight}')
    // wraps back to the first tab
    expect(screen.getByRole('tab', { name: 'Tab A' })).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tab', { name: 'Tab C' })).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{Home}')
    expect(screen.getByRole('tab', { name: 'Tab A' })).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{End}')
    expect(screen.getByRole('tab', { name: 'Tab C' })).toHaveAttribute('aria-selected', 'true')
  })
})
