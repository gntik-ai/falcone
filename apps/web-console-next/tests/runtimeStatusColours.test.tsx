import { screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import ConsoleRuntimePage from '../src/pages/consoleRuntime'
import { ConsoleContextProvider } from '../src/shell/context'
import es from '../src/locales/es/pages.console-runtime-page.json'
import { ready, runtimePath } from './parity/pages/consoleRuntime.manifest'
import { login, renderWithSession, strictFetch, tenantUrl } from './shell-support'

let requests: ReturnType<typeof strictFetch>
afterEach(() => requests?.verify())

// The existing browser parity contract requires semantic background utilities,
// including muted surfaces for states that cannot report runtime readiness.
test.each([
  ['ready', es.state.ready, 'success', 'bg-success/15'],
  ['degraded', es.state.degraded, 'warning', 'bg-warning/16'],
  ['unavailable', es.state.unavailable, 'warning', 'bg-warning/16'],
  ['unverified', es.state.unverified, 'neutral', 'bg-muted'],
  ['disabled', es.state.disabled, 'neutral', 'bg-muted'],
  ['rebuilding', es.state.unknown, 'neutral', 'bg-muted'],
])('runtime state %s retains its semantic background and tone', async (state, label, tone, background) => {
  login(['platform_auditor'])
  requests = strictFetch({
    [`GET ${tenantUrl}`]: { items: [] },
    [`GET ${runtimePath}`]: { ...ready, state },
  })
  renderWithSession(<ConsoleContextProvider><ConsoleRuntimePage /></ConsoleContextProvider>, { route: '/console/runtime' })

  const status = await screen.findByLabelText(es.statusName.replace('{state}', label))
  expect(status).toHaveAttribute('data-tone', tone)
  expect(status).toHaveClass(background)
})
