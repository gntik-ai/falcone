import { LiveAnnouncer } from '@gntik-ai/ui'
import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, test } from 'vitest'
import { App } from '../src/App'
import welcomeEs from '../src/locales/es/pages.welcome-page.json'
import welcomeEn from '../src/locales/en/pages.welcome-page.json'
import { StatusPage } from '../src/StatusPage'
import { changeLocale } from '../src/i18n'

const copy = {
  es: {
    shell: ['Falcone', '.', 'Consola', 'Menú de usuario', 'Idioma', 'Español', 'Inglés', 'Acerca de', 'dev', ...Object.values(welcomeEs)],
    states: [
      ['loading', 'Cargando', 'Espera un momento.'],
      ['empty', 'Sin resultados', 'No hay elementos para mostrar.'],
      ['unauthorized', 'Acceso requerido', 'Inicia sesión para continuar.'],
      ['forbidden', 'Acceso denegado', 'No tienes permiso para ver esta página.'],
      ['notFound', 'Página no encontrada', 'No se ha encontrado la página solicitada.'],
      ['serverError', 'Error del servidor', 'No se pudo completar la solicitud.'],
      ['network', 'Error de conexión', 'Comprueba tu conexión e inténtalo de nuevo.']
    ]
  },
  en: {
    shell: ['Falcone', '.', 'Console', 'User menu', 'Language', 'Spanish', 'English', 'About', 'dev', ...Object.values(welcomeEn)],
    states: [
      ['loading', 'Loading', 'Please wait.'],
      ['empty', 'No results', 'There are no items to display.'],
      ['unauthorized', 'Sign in required', 'Sign in to continue.'],
      ['forbidden', 'Access denied', 'You do not have permission to view this page.'],
      ['notFound', 'Page not found', 'The requested page could not be found.'],
      ['serverError', 'Server error', 'The request could not be completed.'],
      ['network', 'Connection error', 'Check your connection and try again.']
    ]
  }
} as const

for (const locale of ['es', 'en'] as const) {
  for (const [state, title, body] of copy[locale].states) {
    test(`${locale} shell and ${state} expose only translated text and names`, async () => {
      await changeLocale(locale)
      const { container } = render(<LiveAnnouncer><MemoryRouter><App /></MemoryRouter><StatusPage state={state} /></LiveAnnouncer>)
      await screen.findByRole('heading', { name: 'In Falcone Console' })
      for (const details of container.querySelectorAll('details')) details.open = true
      expect(screen.getByRole('heading', { name: title })).toBeVisible()
      expect(screen.getByText(body)).toBeVisible()
      await waitFor(() => expect([...container.querySelectorAll('[aria-live]')].some((region) => region.textContent === `${title}. ${body}`)).toBe(true))
      const allowed = new Set<string>([...copy[locale].shell, title, body, `${title}. ${body}`])
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
      while (walker.nextNode()) {
        const text = walker.currentNode.textContent?.trim()
        if (text) expect(allowed.has(text), `unexpected text: ${text}`).toBe(true)
      }
      for (const node of container.querySelectorAll('[aria-label], [title], [placeholder], [alt]')) {
        for (const attribute of ['aria-label', 'title', 'placeholder', 'alt']) {
          const text = node.getAttribute(attribute)
          if (text) expect(allowed.has(text), `unexpected ${attribute}: ${text}`).toBe(true)
        }
      }
      expect(screen.getByRole('img', { name: locale === 'es' ? 'Consola' : 'Console' })).toBeVisible()
      expect(screen.getByRole('combobox', { name: locale === 'es' ? 'Idioma' : 'Language' })).toBeVisible()
    })
  }
}

test('a status announcement follows locale changes', async () => {
  render(<LiveAnnouncer><StatusPage state="network" /></LiveAnnouncer>)
  await act(() => changeLocale('en'))
  await waitFor(() => expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent('Connection error. Check your connection and try again.'))
})
