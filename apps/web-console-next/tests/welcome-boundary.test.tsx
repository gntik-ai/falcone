import { createElement } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, test, vi } from 'vitest'
import { App } from '../src/App'
import { changeLocale } from '../src/i18n'

const fault = vi.hoisted(() => ({ active: true }))
vi.mock('../src/pages/welcome', async (original) => {
  const page = await original<typeof import('../src/pages/welcome')>()
  return { default: function Fault() {
    if (fault.active) throw new Error('synthetic-welcome-render-failure')
    return createElement(page.default)
  } }
})

for (const locale of ['es', 'en'] as const) {
  test(`${locale} welcome render faults replace the auth layout and retry the actual route`, async () => {
    await changeLocale(locale)
    fault.active = true
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    render(<MemoryRouter><App /></MemoryRouter>)
    expect((await screen.findAllByText('500', { exact: true }))[0]).toBeVisible()
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.queryByRole('img', { name: 'In Falcone' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'In Falcone Console' })).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(/503|req_8f2c41d07a9b|acme-web|synthetic-welcome-render-failure/)
    fault.active = false
    fireEvent.click(screen.getByRole('button', { name: locale === 'es' ? 'Reintentar' : 'Retry' }))
    expect(await screen.findByRole('heading', { name: 'In Falcone Console' })).toBeVisible()
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.getByRole('img', { name: 'In Falcone' })).toBeVisible()
    expect(screen.queryByText('500')).not.toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })
}
