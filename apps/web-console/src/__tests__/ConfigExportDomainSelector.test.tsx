import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConfigExportDomainSelector } from '@/components/ConfigExportDomainSelector'
import type { DomainAvailability } from '@/api/configExportApi'

afterEach(cleanup)

const DOMAINS: DomainAvailability[] = [
  { domain_key: 'iam', availability: 'available', description: 'IAM configuration (Keycloak)' },
  { domain_key: 'postgres_metadata', availability: 'available', description: 'PostgreSQL schema and metadata' },
  { domain_key: 'functions', availability: 'not_available', description: 'OpenWhisk serverless functions', reason: 'OW disabled' },
]

describe('ConfigExportDomainSelector', () => {
  it('renders all domains; disables not_available ones', () => {
    render(<ConfigExportDomainSelector domains={DOMAINS} selectedDomains={[]} onChange={() => {}} />)
    expect(screen.getByTestId('domain-check-iam')).not.toBeDisabled()
    expect(screen.getByTestId('domain-check-postgres_metadata')).not.toBeDisabled()
    expect(screen.getByTestId('domain-check-functions')).toBeDisabled()
  })

  it('checkbox toggle fires onChange with updated selection', () => {
    const onChange = vi.fn()
    render(<ConfigExportDomainSelector domains={DOMAINS} selectedDomains={['iam']} onChange={onChange} />)
    fireEvent.click(screen.getByTestId('domain-check-postgres_metadata'))
    expect(onChange).toHaveBeenCalledWith(['iam', 'postgres_metadata'])
  })

  it('"Select All Available" selects only available domains', () => {
    const onChange = vi.fn()
    render(<ConfigExportDomainSelector domains={DOMAINS} selectedDomains={[]} onChange={onChange} />)
    fireEvent.click(screen.getByTestId('select-all-btn'))
    expect(onChange).toHaveBeenCalledWith(['iam', 'postgres_metadata'])
  })

  it('shows reason tooltip for not_available domains', () => {
    render(<ConfigExportDomainSelector domains={DOMAINS} selectedDomains={[]} onChange={() => {}} />)
    const reason = screen.getByTestId('domain-reason-functions')
    expect(reason).toHaveAttribute('title', 'OW disabled')
  })
})
