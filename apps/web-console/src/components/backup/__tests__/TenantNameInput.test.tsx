import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { TenantNameInput } from '../TenantNameInput'

function Wrapper({ onMatch }: { onMatch: (isMatch: boolean) => void }) {
  const [value, setValue] = useState('')
  return <TenantNameInput tenantName="Tenant ABC" value={value} onChange={setValue} onMatch={onMatch} />
}

describe('TenantNameInput', () => {
  it('matches exactly and case-sensitively', () => {
    const onMatch = vi.fn()
    render(<Wrapper onMatch={onMatch} />)
    const input = screen.getByLabelText('Tenant name confirmation')
    fireEvent.change(input, { target: { value: 'tenant abc' } })
    expect(onMatch).toHaveBeenLastCalledWith(false)
    fireEvent.change(input, { target: { value: 'Tenant ABC' } })
    expect(onMatch).toHaveBeenLastCalledWith(true)
  })
})
