import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, test, vi } from 'vitest'
import { App } from '../src/App'
import { changeLocale } from '../src/i18n'
import es from '../src/locales/es/pages.welcome-page.json'
import en from '../src/locales/en/pages.welcome-page.json'

vi.mock('../src/pages/welcome', () => { throw new Error('synthetic-chunk-load-failure') })

for (const locale of ['es', 'en'] as const) {
  const copy = locale === 'es' ? es : en
  test(`${locale} a failed welcome chunk shows the translated 500 boundary without partial content`, async () => {
    await changeLocale(locale)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    render(<MemoryRouter><App /></MemoryRouter>)
    expect((await screen.findAllByText('500', { exact: true }))[0]).toBeVisible()
    expect(screen.getByRole('heading', { level: 1, name: locale === 'es' ? 'Error del servidor' : 'Server error' })).toBeVisible()
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.queryByRole('img', { name: 'In Falcone' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: copy.title })).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(/503|req_8f2c41d07a9b|acme-web|synthetic-chunk-load-failure/)
    expect(fetch).not.toHaveBeenCalled()
  })
}
